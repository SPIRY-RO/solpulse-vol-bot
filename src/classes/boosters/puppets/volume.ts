
import PuppetBase from './base';
import * as c from '../../../const';
import * as h from '../../../helpers';
import * as sh from '../../../utils/solana_helpers';
import { makeAndSendJitoBundle } from '../../../utils/jito';


class PuppetVolume extends PuppetBase {

  async run() {
    let lastTokenBalance = 0;
    try {
      const recentBalance = await sh.getSolBalance(this.address);
      if (recentBalance === null) {
        console.warn(`${this.tag} failed to fetch balance from the start; terminating all operations on this puppet`);
        return;
      }
      this.lastBalance = recentBalance;
      if (!(await this.getTokenAccAddr_caching())) {
        if (await sh.ensureTokenAccountExists(this.keypair, this.booster.tokenAddr)) {
          this.booster.metrics.txs += 1;
          this.lastBalance = (await sh.waitForBalanceChange(this.lastBalance, this.address)).balance as number;
          await this.getTokenAccAddr_caching();
        }
      }
      while (true) {
        if (this._hasReasonToStop()) {
          h.debug(`${this.tag} found reason to stop; breaking main loop...`);
          break;
        }
        const success = await this.doAtomicTx(lastTokenBalance);
        if (success) {
          const { balance: newBalance } = await sh.waitForBalanceChange(this.lastBalance, this.address);
          this.lastBalance = newBalance as number;
          lastTokenBalance = (await sh.getTokenAccBalance(this._tokenAccAddr!))?.uiAmount || lastTokenBalance;
        }
        await this._waitBetweenBoosts();
      }
      await this.tryCloseAndSalvageFunds_alwaysCleanup(this.booster.keypair.publicKey);
    } catch (e: any) {
      console.error(`${this.tag} caught error in run(): ${e}`);
      console.trace(e);
      await this._cleanup();
    }
  }


  async doAtomicTx(existingTokens_inSol: number = 0): Promise<boolean> {
    const fromAmountSol = Number(this.lastBalance) - c.RESERVED_PUPPET_BALANCE;
    const fromAmount_forBuy1 = h.roundDown(fromAmountSol / 100 * h.getRandomNumber(25, 75), 9);
    const fromAmount_forBuy2 = h.roundDown(fromAmountSol - fromAmount_forBuy1, 9);
    const buy1 = await sh.getSwapTx(this.keypair, c.WSOL_MINT_ADDR, this.booster.tokenAddr, fromAmount_forBuy1);
    const buy2 = await sh.getSwapTx(this.keypair, c.WSOL_MINT_ADDR, this.booster.tokenAddr, fromAmount_forBuy2);
    if (!buy1 || !buy2) {
      h.debug(`${this.tag} failed to build one of buy TXs in volume booster; not continuing`);
      return false;
    }
    const minAmountOut = buy1.estimates.minAmountOut_inSol + buy2.estimates.minAmountOut_inSol + existingTokens_inSol;
    const sell = await sh.getSwapTx(this.keypair, this.booster.tokenAddr, c.WSOL_MINT_ADDR, minAmountOut);
    if (!sell) {
      h.debug(`${this.tag} failed to build sell TX in volume booster; not continuing`);
      return false;
    }
    const txs = [buy1.tx, buy2.tx, sell.tx];
    h.debug(`${this.tag} performing atomic TX; ${this.tag} ${fromAmount_forBuy1} + ${fromAmount_forBuy2} SOL -> ${minAmountOut} token`);
    const success = await makeAndSendJitoBundle(txs, this.keypair);
    h.debug(`${this.tag} atomic TX succeeded: ${success}`);
    if (success) {
      const m = this.booster.metrics;
      m.txs += 3;
      m.buys += 2; m.buyVolume += fromAmountSol;
      m.sells += 1; m.sellVolume += sell.estimates.amountOut_inSol;
    }
    return success;
  }


  protected _hasReasonToStop(): boolean {
    if (this.wasAskedToStop) {
      h.debug(`${this.tag} was asked to stop`);
      return true;
    } else if (this.lastBalance !== 0 && this.lastBalance < c.RESERVED_PUPPET_BALANCE) {
      h.debug(`${this.tag} ran out of funds(${this.lastBalance} SOL left); stopping`);
      return true;
    } else {
      return false;
    }
  }
}

export default PuppetVolume;