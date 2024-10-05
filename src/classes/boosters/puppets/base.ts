import * as solana from '@solana/web3.js';
import bs58 from 'bs58';

import BoosterBase, { BoosterType } from '../base';
import * as c from '../../../const';
import * as h from '../../../helpers';
import * as sh from '../../../utils/solana_helpers';
import { prisma, web3Connection } from '../../..';
import { makeAndSendJitoBundle } from '../../../utils/jito';

const allActivePuppets: PuppetBase[] = [];

class PuppetBase {
  type: BoosterType = "base";

  keypair: solana.Keypair;
  booster: BoosterBase;
  lastBalance: number = 0;
  wasAskedToStop: boolean = false;
  isInitializing: boolean = true;
  //@ts-ignore
  protected _tokenAccAddr: solana.PublicKey = null;

  static isPuppetActive(puppetAddr: solana.PublicKey | string) {
    if (typeof puppetAddr === "string")
      puppetAddr = new solana.PublicKey(puppetAddr);
    for (const puppet of allActivePuppets) {
      if (puppet.keypair.publicKey.equals(puppetAddr))
        return true;
    }
    return false;
  }

  /*
  static getPuppetBy(puppetAddr: solana.PublicKey | string) {
    if (typeof puppetAddr === "string")
      puppetAddr = new solana.PublicKey(puppetAddr);
    for (const puppet of allActivePuppets) {
      if (puppet.keypair.publicKey.equals(puppetAddr))
        return puppet;
    }
    return null;
  }
    */

  constructor(keypair: solana.Keypair, booster: BoosterBase) {
    this.keypair = keypair;
    this.booster = booster;
    allActivePuppets.push(this);
    this.booster.puppets.push(this);
    h.debug(`new puppet: ${this.address} ${bs58.encode(this.keypair.secretKey)}`);
  }

  get tag() {
    return `[p:${h.getShortAddr(this.keypair.publicKey)}]`;
  }

  get address() {
    return this.keypair.publicKey;
  }

  // abstract method
  async run() {
  }


  // abstract method
  async doAtomicTx(lastTokenBalance: number = 0): Promise<boolean> {
    return true || false;
  }


  public async _waitBetweenBoosts(forcedSilent = false) {
    let delaySec = 0;
    if (this.booster.type == 'volume') {
      const invertedSpeedValue = c.BOOSTER_TOP_GEAR - this.booster.settings.volumeSpeed;
      delaySec = (invertedSpeedValue * 3) ** 2;
      //delay = getRandomDelayBetweenTx();
    } else if (this.booster.type == 'holders') {
      delaySec = 3;
    } else if (this.booster.type == 'rank') {
      delaySec = 1;
    };
    if (!forcedSilent)
      h.debug(`${this.tag} waiting for ${delaySec}s...`);
    let remainingTime = delaySec * 1000;
    while (remainingTime > 5000) {
      h.sleep(5000);
      remainingTime -= 5000;
      if (this.wasAskedToStop)
        return;
    }
    await h.sleep(remainingTime);
  }


  async refill(budgetSol: number, skipAvailableBoosterBalCheck = false) {
    budgetSol = h.roundDown(budgetSol, 5);
    const success = await this.booster.sendFunds(this.keypair.publicKey, budgetSol, skipAvailableBoosterBalCheck);
    if (success) {
      await this.addToDB();
      this.booster.metrics.uniqueWallets += 1;
      return true;
    } else {
      h.debug(`${this.tag} failed to fill puppet`);
      this._cleanup();
      return false;
    }
  }



  async tryCloseAndSalvageFunds_alwaysCleanup(sendFundsTo: string | solana.PublicKey) {
    if (typeof sendFundsTo === "string")
      sendFundsTo = new solana.PublicKey(sendFundsTo);
    const result = await this._tryCloseAndSalvageFunds(sendFundsTo);
    await this._cleanup();
    return result;
  } 

  protected async _tryCloseAndSalvageFunds(sendFundsTo: solana.PublicKey) {
    let balanceLamps = await sh.getSolBalance(this.keypair.publicKey, true);
    if (balanceLamps === null) {
      balanceLamps = await sh.getSolBalance(this.keypair.publicKey, true);
      if (balanceLamps === null) {
        h.debug(`${this.tag} failed to fetch balance even after a single retry; aborting salvage`);
        return false;
      }
    }

    const tokenAccAddr = await this.getTokenAccAddr_caching();
    if (tokenAccAddr) {
      const closedOK = await this._tryCloseTokenAcc(sendFundsTo);
      if (!closedOK) {
        h.debug(`${this.tag} failed to close token acc; aborting salvage`);
        return false;
      } else {
        h.debug(`${this.tag} closed token acc successfully`);
        balanceLamps = (await sh.waitForBalanceChange(balanceLamps, this.keypair.publicKey, true)).balance as number;
      }
    }
    if (balanceLamps == 0) {
      h.debug(`${this.tag} tried to close SOL acc, but our balance is empty; nothing to do`);
      this.lastBalance = balanceLamps;
      return true;
    }

    this.lastBalance = balanceLamps / solana.LAMPORTS_PER_SOL;
    try {
      const lastTxHash = await sh.sendAllSol(this.keypair, sendFundsTo);
      console.log(`${this.tag} submitted tx to send all SOL to booster's wallet; hash: ${lastTxHash}`);
      if (lastTxHash) {
        const { balance: newBalance, success } = await sh.waitForBalanceChange(balanceLamps, this.keypair.publicKey, true);
        if (success) {
          this.lastBalance = newBalance as number / solana.LAMPORTS_PER_SOL;
          h.debug(`${this.tag} closed OK; funds transferred to ${h.getShortAddr(sendFundsTo)}`);
          await this._removeFromDB();
          return true;
        }
      }
      h.debug(`${this.tag} failed to close puppet; tx failed`);
      return false;
    } catch (e: any) {
      h.debug(`${this.tag} failed to close puppet; error: ${e}`);
      return false;
    }
  }


  protected async _tryCloseTokenAcc(sendFundsTo: solana.PublicKey) {
    const tokenAccAddr = await this.getTokenAccAddr_caching();
    if (!tokenAccAddr) {
      h.debug(`${this.tag} token acc not known; refusing to close it`);
      return false;
    }
    const tokenBalance = await sh.getTokenAccBalance(tokenAccAddr);
    const transferInstrs = await sh.getInstr_transferToken_openReceiverAccIfNeeded(
      this.keypair,
      sendFundsTo,
      this.booster.tokenAddr,
      null,
      tokenBalance.amount,
    )
    const closeInstructions = await sh.getInstr_closeSenderAcc(
      this.keypair, sendFundsTo, this.booster.tokenAddr
    );

    if (!closeInstructions) {
      h.debug(`${this.tag} failed to build close acc instructions`);
      return false;
    } else if (!transferInstrs) {
      h.debug(`${this.tag} failed to build token transfer instructions`);
      return false;
    }
    const tx = new solana.VersionedTransaction(
      new solana.TransactionMessage({
        payerKey: this.keypair.publicKey,
        recentBlockhash: (await web3Connection.getLatestBlockhash()).blockhash,
        instructions: [...transferInstrs, ...closeInstructions],
      }).compileToV0Message()
    );
    tx.sign([this.keypair]);
    const success = await makeAndSendJitoBundle([tx], this.keypair);
    return success;
  }


  async getTokenAccAddr_caching() {
    if (!this._tokenAccAddr) {
      const tokenAcc = await sh.getTokenAcc(this.booster.tokenAddr, this.keypair.publicKey)
      if (tokenAcc && tokenAcc.pubkey)
        this._tokenAccAddr = tokenAcc.pubkey;
    }
    return this._tokenAccAddr;
  }

  askToStop() {
    h.debug(`${this.tag} asking this puppet to stop...`);
    this.wasAskedToStop = true;
  }

  async waitUntilStopped() {
    const timeoutAfterMs = 120 * 1000;
    const startedAt = Date.now();
    h.debug(`${this.tag} waiting for this puppet to stop for up to ${timeoutAfterMs / 1000}s`);
    while (Date.now() < startedAt + timeoutAfterMs) {
      await h.sleep(2000);
      if (!PuppetBase.isPuppetActive(this.address))
        return true;
    }
    h.debug(`${this.tag} waiting for this puppet to stop timed out after ${timeoutAfterMs / 1000}s`);
    return false;
  }


  // abstract method
  protected _hasReasonToStop(): boolean {
    return true || false;
  }

  async addToDB() {
    return await prisma.puppet.create({
      data: {
        boosterID: this.booster.internalID!,
        ownerTgID: this.booster.ownerTgID,
        privKey: bs58.encode(this.keypair.secretKey),
        pubKey: this.keypair.publicKey.toBase58(),
      }
    });
  }

  protected async _removeFromDB() {
    return await prisma.puppet.deleteMany({
      where: {
        privKey: bs58.encode(this.keypair.secretKey),
      }
    })
  }

  protected async _cleanup() {
    try {
      // do not remove from DB in here; removal is only to be done when funds were successfully salvaged
      allActivePuppets.splice(allActivePuppets.indexOf(this), 1);
      this.booster.puppets.splice(this.booster.puppets.indexOf(this), 1);
    } catch (e: any) {
      console.error(`${this.tag} error when cleaning up: ${e}`);
    }
  }
}


export default PuppetBase;