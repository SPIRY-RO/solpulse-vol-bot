import * as solana from '@solana/web3.js';
import bs58 from 'bs58';
import { Puppet, Settings } from '@prisma/client';

import * as c from '../../const';
import * as h from '../../helpers';
import * as sh from '../../utils/solana_helpers';
import { prisma, web3Connection } from '../..';
import BoosterBase, { BoosterType } from './base';
import { makeAndSendJitoBundle } from '../../utils/jito';



class BoosterHolders extends BoosterBase {
  type: BoosterType = 'holders';

  newHolderBagInSol = 0.00001;
  approxSolSpentPerHolder = 0.0022;
  nOfNewHoldersPerBundle = 4; // max 4 holders
  tokensPerNewHolderWallet_inSol = 0;


  async start(): Promise<void> {
    h.debug(`${this.tag} # starting up #`);
    this.startedAt = Date.now();
    this.lastBalance = await sh.getSolBalance(this.keypair.publicKey) || this.lastBalance;
    if (this.lastBalance === null || this.lastBalance == 0) {
      console.error(`${this.tag} failed to fetch own balance when starting booster; aborting`);
      this._cleanup();
      return;
    }

    const inactivePuppetsEmptiedOK = await this.tryEmptyInactivePuppets();
    await this._sellPreviousTokenHoldings_ifExist();
    this.lastBalance = await sh.getSolBalance(this.keypair.publicKey) || this.lastBalance;

    const boughtOK = await this._buyTokensForDistribution();
    if (!boughtOK) {
      await h.trySend(this.ownerTgID, `Booster failed to initialize correctly and is now stopping; this can sometimes happen because Solana is congested; try starting it again
If this error keeps coming up - contact our team`);
      this._cleanup();
      return;
    }

    while (true) {
      if (await this._hasReasonToStop()) {
        this.askToStop();
        break;
      }
      const success = await this.doAtomicTx();
      await this._waitBetweenBoosts();
    }
    await this._cleanup();
  }



  async doAtomicTx() {
    try {
      const rndKeypairs: solana.Keypair[] = []
      for (let i = 0; i < this.nOfNewHoldersPerBundle; i++) {
        rndKeypairs.push(solana.Keypair.generate());
      }
      const instrBuilderPromises: Promise<solana.TransactionInstruction[]>[] = [];
      h.debug(`[${this.tag}] Adding holders to:`);
      for (const rndKP of rndKeypairs) {
        h.debug(`${rndKP.publicKey.toBase58()} ${bs58.encode(rndKP.secretKey)}`)
        instrBuilderPromises.push(
          sh.getInstr_transferToken_openReceiverAccIfNeeded(
            this.keypair, rndKP.publicKey, this.tokenAddr, this.tokensPerNewHolderWallet_inSol
          ));
      }
      const allTxInstructions = await Promise.all(instrBuilderPromises);

      const txs: solana.VersionedTransaction[] = [];
      const recentBlockhash = (await web3Connection.getLatestBlockhash()).blockhash;
      for (const instr of allTxInstructions) {
        const tx = new solana.VersionedTransaction(
          new solana.TransactionMessage({
            payerKey: this.keypair.publicKey,
            recentBlockhash: recentBlockhash,
            instructions: instr,
          }).compileToV0Message()
        );
        tx.sign([this.keypair]);
        txs.push(tx);
      }

      const success = await makeAndSendJitoBundle(txs, this.keypair);
      h.debug(`${this.tag} holders added successfully? ${success}`);
      if (success) {
        this.metrics.buyVolume += this.newHolderBagInSol * txs.length;
        this.metrics.uniqueWallets += txs.length;
        this.lastBalance = (await sh.waitForBalanceChange(this.lastBalance, this.keypair.publicKey)).balance;
      }
    } catch (e: any) {
      console.error(`${this.tag} error when making atomic tx: ${e}`);
      console.trace(e);
    }
  }


  protected async _buyTokensForDistribution(): Promise<boolean> {
    const maxNewHolders = Number(((this.lastBalance - c.MIN_BOOSTER_BALANCE_SOL) / this.approxSolSpentPerHolder).toFixed());
    const expectedNewHolders = Math.min(maxNewHolders, this.settings.holdersNewHolders);
    const solForBuyingTokens = h.roundDown((expectedNewHolders + 1) * this.newHolderBagInSol, 9);
    h.debug(`${this.tag} buying tokens for ~${expectedNewHolders + 1} holders with ${solForBuyingTokens} SOL`);
    const builtTx = await sh.getSwapTx(this.keypair, c.WSOL_MINT_ADDR, this.tokenAddr, solForBuyingTokens);
    if (!builtTx?.tx) {
      console.error(`${this.tag} failed to build swap TX for initial buy of tokens; aborting`);
      return false;
    }
    const success = await makeAndSendJitoBundle([builtTx.tx], this.keypair);
    if (!success) {
      console.error(`${this.tag} swap TX for initial buy of tokens failed`);
      return false;
    }
    h.debug(`${this.tag} succcessfully bought tokens; waiting for balance change & calculating amount per wallet...`);
    this.lastBalance = (await sh.waitForBalanceChange(this.lastBalance, this.keypair.publicKey)).balance as number;
    await this.getTokenAccAddr_caching();
    const tokenBalance = (await sh.getTokenAccBalance(this.tokenAccAddr!)).uiAmount!;
    this.tokensPerNewHolderWallet_inSol = Number((tokenBalance / (expectedNewHolders + 1)).toFixed(3));
    h.debug(`[${this.tag}] spent ${solForBuyingTokens.toFixed(5)} on tokens; will send ${this.tokensPerNewHolderWallet_inSol} tokens/holder`);
    return true;
  }


  public async _waitBetweenBoosts(forcedSilent = false) {
    const delaySec = 1;
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


  protected async _hasReasonToStop(): Promise<boolean> {
    if (this.wasAskedToStop) {
      h.debug(`${this.tag} stopping; reason: was asked to stop`);
      return true;
    } else if (this.metrics.uniqueWallets >= this.settings.holdersNewHolders) {
      h.debug(`${this.tag} stopping; reason: made ${this.metrics.uniqueWallets}/${this.settings.holdersNewHolders} required holders`);
      h.trySend(this.ownerTgID, `Booster fulfilled its goal of ${this.settings.holdersNewHolders} new holders and is now stopping...`);
      return true;
    } else if (this.lastBalance < c.MIN_BOOSTER_BALANCE_SOL) {
      h.debug(`${this.tag} stopping; reason: ran out of funds`);
      h.trySend(this.ownerTgID, `Booster ran out of funds and is now stopping...`);
      return true;
    } else {
      return false;
    }
  }


  async spawnAndRunPuppets(nOfPuppets: number) {
    throw new Error(`${this.tag} not meant to use puppets with holder booster`);
    return true || false;
  }

  async spawnAndRunPuppet(budgetSol: number, skipBalanceCheck = false, retries = 0): Promise<boolean> {
    throw new Error(`${this.tag} not meant to use puppets with holder booster`);
    return true || false;
  }
}


export default BoosterHolders;