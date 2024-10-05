import * as solana from '@solana/web3.js';

import PuppetBase from './base';
import * as c from '../../../const';
import * as h from '../../../helpers';
import * as sh from '../../../utils/solana_helpers';
import { makeAndSendJitoBundle } from '../../../utils/jito';
import { jitoTip } from '../../../utils/jito-tip-deamons';
import { NumericLiteral } from 'typescript';


class PuppetRank extends PuppetBase {
  buysSoFar = 0


  async run() {
    try {
      const recentBalance = await sh.getSolBalance(this.address);
      if (recentBalance === null) {
        console.warn(`${this.tag} failed to fetch balance from the start; terminating all operations on this puppet`);
        return;
      }
      this.lastBalance = recentBalance;
      while (true) {
        if (this._hasReasonToStop()) {
          h.debug(`${this.tag} found reason to stop; breaking main loop...`);
          break;
        }
        const success = await this.doAtomicTx();
        if (success) {
          this.lastBalance = (await sh.waitForBalanceChange(this.lastBalance, this.address)).balance as number;
          this.getTokenAccAddr_caching();
        }
        await this._waitBetweenBoosts();
      }

      const finishedCycleNormally = (this.buysSoFar >= this.booster.settings.rankRotateEveryNTx);
      if (finishedCycleNormally) {
        await this._closeThis_andSpawnAndRunNew();
      } else {
        await this.tryCloseAndSalvageFunds_alwaysCleanup(this.booster.keypair.publicKey);
      }

    } catch (e: any) {
      console.error(`${this.tag} caught error in run(): ${e}`);
      console.trace(e);
      await this._cleanup();
    }
  }


  async doAtomicTx(): Promise<boolean> {
    h.debug(`${this.tag} starting atomic tx`);
    const slippagePerc = 50;
    const buyAmountSOL = 0.00001;
    const txPerBundle = 4;

    try {
      let builtTxPromises: Promise<any>[] = [];
      for (let i = 0; i < txPerBundle; i++) {
        // jito demands that buy sums be different, otherwise it complains about "duplicate transactions" in the bundle
        const buyAmountSOL_changed = h.roundDown((buyAmountSOL + (i / 10 ** 7)), 7);
        builtTxPromises.push(sh.getSwapTx(
          this.keypair,
          c.WSOL_MINT_ADDR,
          this.booster.tokenAddr,
          buyAmountSOL_changed,
          slippagePerc,
        ));
      }
      const builtTxs: sh.SwapTxBuilderOutput[] = await Promise.all(builtTxPromises);
      if (builtTxs.length < 1) {
        console.warn(`${this.tag} failed to build any swap txs; not transacting`);
        return false;
      }

      const buyTxs: solana.VersionedTransaction[] = [];
      for (const builtTx of builtTxs) {
        if (builtTx.tx)
          buyTxs.push(builtTx.tx);
      }
      h.debug(`${this.tag} bundling ${buyTxs.length} micro-buy txs`);
      const success = await makeAndSendJitoBundle(buyTxs, this.keypair, Math.min(jitoTip.chanceOf50, jitoTip.average));
      h.debug(`${this.tag} bundle OK? ${success}`);
      if (success) {
        const m = this.booster.metrics;
        m.txs += txPerBundle;
        this.buysSoFar += txPerBundle;
        m.buys += txPerBundle; m.buyVolume += txPerBundle * buyAmountSOL;
        return true;
      }
      return false;

    } catch (e: any) {
      console.error(`${this.tag} error in atomic tx: ${e}`);
      console.trace(e);
      return false;
    }
  }


  protected _hasReasonToStop(): boolean {
    if (this.wasAskedToStop) {
      h.debug(`${this.tag} was asked to stop`);
      return true;
    } else if (this.lastBalance !== 0 && this.lastBalance < c.RESERVED_PUPPET_BALANCE) {
      h.debug(`${this.tag} ran out of funds(${this.lastBalance} SOL left); stopping`);
      return true;
    } else if (this.buysSoFar >= this.booster.settings.rankRotateEveryNTx) {
      h.debug(`${this.tag} successfully performed ${this.buysSoFar}/${this.booster.settings.rankRotateEveryNTx} required buys; stopping; new puppet should run soon`);
      return true;
    } else {
      return false;
    }
  }



  protected async _closeThis_andSpawnAndRunNew() {
    h.debug(`${this.tag} spawning new puppet & closing this one...`);
    const newPuppet = new PuppetRank(solana.Keypair.generate(), this.booster);
    const success = await this.tryCloseAndSalvageFunds_alwaysCleanup(newPuppet.address);
    if (!success) {
      console.error(`${this.tag} failed to transfer funds to new puppet; new puppet wasn't created`);
      return false;
    } else {
      await newPuppet.addToDB();
      this.booster.metrics.uniqueWallets += 1;
    }
    newPuppet.run(); // must be a non-blocking call
    return true;
  }
}

export default PuppetRank;