import * as solana from '@solana/web3.js';
import bs58 from 'bs58';
import { Puppet, Settings } from '@prisma/client';

import * as c from '../../const';
import * as h from '../../helpers';
import * as sh from '../../utils/solana_helpers';
import { prisma } from '../..';
import BoosterBase, { BoosterType } from './base';
import { PuppetRank } from './puppets';



class BoosterRank extends BoosterBase {
  type: BoosterType = 'rank';


  async start(): Promise<void> {
    h.debug(`${this.tag} # starting up #`);
    this.startedAt = Date.now();
    this.lastBalance = await sh.getSolBalance(this.keypair.publicKey) || this.lastBalance;
    if (this.lastBalance === null || this.lastBalance == 0) {
      console.error(`${this.tag} failed to fetch own balance when starting booster; aborting`);
      this._cleanup();
      return;
    }
    const tokenAcc = await sh.getTokenAcc(this.tokenAddr, this.keypair.publicKey)
    if (!tokenAcc?.pubkey) {
      if (!await sh.ensureTokenAccountExists(this.keypair, this.tokenAddr)) {
        h.debug(`${this.tag} couldn't ensure that token account is open`);
      } else {
        h.debug(`${this.tag} opened token account that previously didn't exist`);
      }
    }
    const inactivePuppetsEmptiedOK = await this.tryEmptyInactivePuppets();
    this.lastBalance = await sh.getSolBalance(this.keypair.publicKey) || this.lastBalance;
    const spawnedOK = await this.spawnAndRunPuppets(this.settings.rankParallelWallets);
    if (!spawnedOK) {
      console.error(`${this.tag} failed to spawn puppets; stopping the booster`);
      await h.trySend(this.ownerTgID, `Booster failed to initialize correctly and is now stopping; this can sometimes happen because Solana is congested; try starting it again
If this error keeps coming up - contact our team`);
      this._cleanup();
      return;
    }

    await this._waitForReasonToStop();
    h.debug(`${this.tag} # asking all puppets to stop #`);
    this.wasAskedToStop = true;
    const puppetStoppagePromises: Promise<boolean>[] = [];
    for (const puppet of this.puppets) {
      puppet.askToStop();
      puppetStoppagePromises.push(puppet.waitUntilStopped());
    }
    await Promise.all(puppetStoppagePromises);
    h.debug(`${this.tag} # all puppets assumed stopped; doing final cleanup #`);
    await this._cleanup();
  }



  async spawnAndRunPuppet(budgetSol: number, skipBalanceCheck = false, retries = 0): Promise<boolean> {
    const maxRetries = 5;
    if (this.wasAskedToStop) {
      h.debug(`${this.tag} booster is stopped; not spawning new puppets`);
      return false;
    }
    const puppet = new PuppetRank(solana.Keypair.generate(), this);
    const filledOK = await puppet.refill(budgetSol, skipBalanceCheck);
    if (!filledOK) {
      if (!await this.hasEnoughFundsForNewPuppet(budgetSol)) {
        h.debug(`${this.tag} not enough funds to spawn new puppet`);
        return false;
      } else if (retries >= 5) {
        h.debug(`${this.tag} failed to spawn new puppet ${maxRetries} times; giving up`);
        return false;
      }
      console.warn(`${this.tag} failed to fill newly-spawned puppet: ${h.getShortAddr(puppet.address)}; removing it and retrying with a new one`);
      return await this.spawnAndRunPuppet(budgetSol, skipBalanceCheck, retries + 1);
    }

    puppet.run() // this will spawn new puppets when it finishes
    return true;
  }



  protected async _hasReasonToStop(): Promise<boolean> {
    if (this.wasAskedToStop) {
      h.debug(`${this.tag} stopping; reason: was asked to stop`);
      return true;
    } else if (this.lastBalance < c.RESERVED_BOOSTER_BALANCE_SOL) {
      h.debug(`${this.tag} stopping; reason: ran out of funds`);
      h.trySend(this.ownerTgID, `Booster ran out of funds and is now stopping...`);
      return true;
    } else if (this.puppets.length === 0) {
      h.debug(`${this.tag} stopping; all puppets finished working`);
      h.trySend(this.ownerTgID, `Stopping the booster, because it no longer has any active puppets`);
      return true;
    } else {
      return false;
    }
  }


}


export default BoosterRank;