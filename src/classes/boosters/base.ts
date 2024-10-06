import * as solana from '@solana/web3.js';
import bs58 from 'bs58';
import { Puppet, Settings } from '@prisma/client';

import * as c from '../../const';
import * as h from '../../helpers';
import * as sh from '../../utils/solana_helpers';
import { prisma } from '../..';
import PuppetBase from './puppets/base';
import { DEF_MESSAGE_OPTS } from '../../config';
import { makeAndSendJitoBundle } from '../../utils/jito';

const allActiveBoosters: BoosterBase[] = [];


class BoosterBase {
  type: BoosterType = 'base';
  internalID: string | null = null;
  ownerTgID: string
  keypair: solana.Keypair
  tokenAddr: solana.PublicKey
  tokenAccAddr: solana.PublicKey | null;
  settings: Settings;
  startedAt: number = 0;
  puppets: PuppetBase[] = []; // puppets maintains these themselves
  wasAskedToStop = false;
  lastBalance: number = 0;
  metrics: Metrics = { ...emptyMetrics };

  static getActiveByID(dbID: string) {
    for (const booster of allActiveBoosters) {
      if (booster.internalID == dbID)
        return booster;
    }
    return null;
  }

  static getActiveBoosterFor(tokenAddr: string | solana.PublicKey, type: BoosterType, userID: string) {
    if (typeof tokenAddr === "string")
      tokenAddr = new solana.PublicKey(tokenAddr);
    for (const booster of allActiveBoosters) {
      if (booster.tokenAddr.equals(tokenAddr) && booster.type === type && booster.ownerTgID === userID)
        return booster;
    }
    return null;
  }


  constructor(
    ownerKeypair: solana.Keypair, ownerTgID: string, tokenAddr: solana.PublicKey, settings: Settings,
  ) {
    this.keypair = ownerKeypair;
    this.ownerTgID = ownerTgID;
    this.tokenAddr = tokenAddr;
    this.tokenAccAddr = null;
    this.settings = settings;
    allActiveBoosters.push(this);
    this.addToDB();
  }


  async addToDB() {
    try {
      const dbEntry = await prisma.booster.create({
        data: {
          tokenAddress: this.tokenAddr.toBase58(),
          ownerTgID: this.ownerTgID,
          type: this.type,
        }
      });
      this.internalID = dbEntry.internalID;
    } catch (e: any) {
      h.debug(`${this.tag} failed to add to DB; terminating booster`);
      await h.trySend(this.ownerTgID, `Bot encountered internal error and failed to start your booster; details to relay to our team:\n${this.tag}: failed to create database entry`);
    }
  }
  async removeFromDB() {
    try {
      await prisma.booster.delete({ where: { internalID: this.internalID! } });
    } catch (e: any) {
      h.debug(`${this.tag} failed to remove from DB; terminating booster`);
    }
  }

  get tag() {
    return `[b:${h.getShortAddr(this.keypair.publicKey)}|${this.type}]`;
  }

  // abstract function
  async start(): Promise<void> {
    this._cleanup();
  }


  async spawnAndRunPuppets(nOfPuppets: number) {
    const gasReservationPerPuppet = 0.003;
    const minRequiredBalance = (
      c.MIN_BOOSTER_BALANCE_SOL + (c.MIN_NEW_PUPPET_BUDGET + gasReservationPerPuppet) * nOfPuppets);
    const puppetBudget = (this.lastBalance - c.MIN_BOOSTER_BALANCE_SOL) / nOfPuppets - gasReservationPerPuppet;
    if (this.lastBalance < minRequiredBalance || puppetBudget < c.MIN_NEW_PUPPET_BUDGET) {
      if (this.lastBalance < minRequiredBalance) {
        h.debug(`${this.tag} not enough funds to spawn puppets; have: ${this.lastBalance.toFixed(4)}; need min: ${minRequiredBalance.toFixed(4)}`);
        await h.trySend(this.ownerTgID, `Not enough funds to run this type of booster. Have: ${this.lastBalance} SOL; need at least: ${(puppetBudget * nOfPuppets + c.MIN_BOOSTER_BALANCE_SOL).toFixed(5)} SOL`);
      } else {
        h.debug(`${this.tag} not enough funds to spawn puppets; have: ${this.lastBalance.toFixed(4)}; need min: ${minRequiredBalance.toFixed(4)}`);
        await h.trySend(this.ownerTgID, `Not enough funds to run this type of booster. Have: ${this.lastBalance} SOL; need at least: ${minRequiredBalance.toFixed(5)} SOL`);
      }
      return false;
    }
    let spawningPromises: Promise<boolean>[] = [];
    for (let i = 0; i < nOfPuppets; i++) {
      spawningPromises.push(this.spawnAndRunPuppet(puppetBudget, true));
    }
    return true;
  }


  // abstract function
  async spawnAndRunPuppet(budgetSol: number, skipBalanceCheck = false): Promise<boolean> {
    return true || false;
  }



  async sendFunds(receiver: solana.PublicKey, amountSol: number, skipBalanceCheck = false) {
    h.debug(`${this.tag} sending funds to ${h.getShortAddr(receiver)}` + (skipBalanceCheck ? '; skipping balance check' : ''));
    if (!skipBalanceCheck) {
      const balance = await sh.getSolBalance(this.keypair.publicKey);
      if (balance === null) {
        console.warn(`${this.tag} failed to fetch own balance when sending funds; aborting`);
        return false;
      }
      this.lastBalance = balance;
      if (this.lastBalance - amountSol < c.MIN_BOOSTER_BALANCE_SOL) {
        h.debug(`${this.tag} not enough funds to send to ${h.getShortAddr(receiver)}; remainder: ${this.lastBalance - amountSol}; min allowed remainder: ${c.MIN_BOOSTER_BALANCE_SOL}`);
        return false;
      }
    }
    const amountLamps = Number((amountSol * solana.LAMPORTS_PER_SOL).toFixed());
    const checkReceiverBal = true;
    const success = await sh.sendSol_waitForBalChange(this.keypair, receiver, amountLamps, checkReceiverBal);
    if (success) {
      h.debug(`${this.tag} sent ${amountSol} SOL to ${h.getShortAddr(receiver)}`);
    } else {
      console.warn(`${this.tag} failed while sending ${amountSol} SOL to ${h.getShortAddr(receiver)}`);
    }
    return success;
  }



  protected async _sellPreviousTokenHoldings_ifExist() {
    await this.getTokenAccAddr_caching();
    if (this.tokenAccAddr) {
      const tokenBalance = (await sh.getTokenAccBalance(this.tokenAccAddr)).uiAmount!;
      const hasSubstantialTokenHoldings = ((await sh.getTokenValueInSol(tokenBalance, this.tokenAddr)) >= 0.003);
      h.debug(`${this.tag} has substantial token holdings? ${hasSubstantialTokenHoldings}`);
      if (hasSubstantialTokenHoldings) {
        h.debug(`${this.tag} trying to sell our existing tokens`);
        const tx = (await sh.getSwapTx(this.keypair, this.tokenAddr, c.WSOL_MINT_ADDR, tokenBalance))?.tx;
        if (tx) {
          const success = await makeAndSendJitoBundle([tx], this.keypair);
        }
      }
    }
  }


  async onDemand_salvage(inactivePuppets: PuppetBase[]) {
    // for manual salvaging of puppets that you know PKs of, but have no DB entries
    // !!! DO NOT use this in production !!! - funds will go to the first person to run any booster
    const pksToSalvage = [
      '44dpFaN6EHhESPP6Bi7p9HBMPy4xzNKZuDJ5biz8sA2ENYqDq8f8cYWPCrzkTxXkavw1KozqogJXvs4JvY4oaeok',
    ]
    for (const pk of pksToSalvage) {
      inactivePuppets.push(new PuppetBase(h.keypairFrom(pk), this));
    }
    return;
  }


  async tryEmptyInactivePuppets() {
    const userPuppets = await prisma.puppet.findMany({
      where: { ownerTgID: this.ownerTgID }
    })
    const inactivePuppets: PuppetBase[] = [];

    // for manual salvaging of puppets that you know PKs of, but have no DB entries
    //await this.onDemand_salvage(inactivePuppets);

    for (const puppet of userPuppets) {
      if (!PuppetBase.isPuppetActive(puppet.pubKey))
        inactivePuppets.push(
          new PuppetBase(h.keypairFrom(puppet.privKey), this)
        );
    }
    if (inactivePuppets.length === 0)
      return true;

    h.debug(`${this.tag} found ${inactivePuppets.length} inactive puppets; emptying them`);
    const salvagePromises: Promise<boolean>[] = [];
    for (const puppet of inactivePuppets) {
      salvagePromises.push(puppet.tryCloseAndSalvageFunds_alwaysCleanup(this.keypair.publicKey));
    }
    const salvageResults = await Promise.all(salvagePromises);
    h.debug(`${this.tag} results of salvaging funds from ${inactivePuppets.length} puppets:`);
    let overallSuccess = true;
    for (let i = 0; i < salvageResults.length; i++) {
      h.debug(`${this.tag}   ${h.getShortAddr(inactivePuppets[i].address)}: ${salvageResults[i]}`);
      overallSuccess = overallSuccess && salvageResults[i];
    }
    return overallSuccess;
  }


  async hasEnoughFundsForNewPuppet(puppetBudget: number) {
    const balance = await sh.getSolBalance(this.keypair.publicKey);
    if (balance === null) {
      h.debug(`${this.tag} failed to fetch own balance; assuming that we don't have enough funds`);
      return false;
    }
    this.lastBalance = balance;
    return (balance - puppetBudget > c.MIN_BOOSTER_BALANCE_SOL);
  }


  async getTokenAccAddr_caching() {
    if (!this.tokenAccAddr) {
      const tokenAcc = await sh.getTokenAcc(this.tokenAddr, this.keypair.publicKey)
      if (tokenAcc && tokenAcc.pubkey)
        this.tokenAccAddr = tokenAcc.pubkey;
    }
    return this.tokenAccAddr;
  }

  async askToStop() {
    this.wasAskedToStop = true;
  }


  protected async _waitForReasonToStop(): Promise<void> {
    while (true) {
      this.lastBalance = await sh.getSolBalance(this.keypair.publicKey) || this.lastBalance;
      if (await this._hasReasonToStop())
        break;
      await h.sleep(5000);
    }
  }

  // abstract function
  protected async _hasReasonToStop(): Promise<boolean> {
    return true || false;
  }


  protected async _sendMetricsToOwner() {
    let metrics = `${c.icons.book} <b>Results</b> for last booster
${this.tag}`;
    if (this.type === 'volume') {
      metrics += `
Buys: ${this.metrics.buyVolume.toFixed(3)} SOL | sells: ${this.metrics.sellVolume.toFixed(3) || 'N/A'} SOL
Total txs: ${this.metrics.txs}
Unique wallets(market-makers) used: ${this.metrics.uniqueWallets}`;
    } else if (this.type === 'holders') {
      metrics += `
New holders: ${this.metrics.uniqueWallets}`;
    } else if (this.type === 'rank') {
      metrics += `
Unique market-makers used: ${this.metrics.uniqueWallets}
Buys: ${this.metrics.txs}`;
    }
    await h.trySend(this.ownerTgID, metrics, DEF_MESSAGE_OPTS);
  }


  protected async _cleanup() {
    this._sendMetricsToOwner();
    h.debug(`${this.tag} metrics' snapshot before this booster is cleaned up:`);
    h.debug(this.metrics);
    await this.removeFromDB();
    allActiveBoosters.splice(allActiveBoosters.indexOf(this), 1);
    h.debug(`${this.tag} # booster fully stopped #`);
  }




}


export const BOOSTER_TYPES = {
  volume: 'volume',
  holders: 'holders',
  rank: 'rank',
  base: 'base',
} as const;
const _boosterTypes = Object.values(BOOSTER_TYPES);
export type BoosterType = typeof _boosterTypes[number];

export interface Metrics {
  txs: number,
  uniqueWallets: number,
  buys: number,
  sells: number,
  buyVolume: number,
  sellVolume: number,
}
const emptyMetrics: Metrics = {
  txs: 0,
  uniqueWallets: 0,
  buys: 0,
  sells: 0,
  buyVolume: 0,
  sellVolume: 0,
}

export default BoosterBase;