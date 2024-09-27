import * as solana from "@solana/web3.js";
import * as spl from "@solana/spl-token";
import { Wallet } from "@coral-xyz/anchor";
import bs58 from "bs58";
import { SendTransactionError } from "@solana/web3.js";

import { userManager, prisma, web3Connection as web3Connection } from "..";
import RaydiumSwap, { TxBuilderOutput } from "./RaydiumSwap";
import { DEF_MESSAGE_OPTS, envConf } from "../config";
import { keypairFrom, sleep, getNewRandWallet } from "../helpers";
import { WSOL_MINT_ADDR, DEFAULT_uLAMPS_PER_CU, DEFAULT_NUM_OF_CU_PER_TX } from "../const";
import * as c from "../const";
import * as h from "../helpers";
import * as sh from "../utils/solana_helpers";
import { makeAndSendJitoBundle } from "../utils/jito";
import { Settings, User } from "@prisma/client";
import { jitoTip } from "../utils/jito-tip-deamons";

export const BOOSTER_TYPES = {
  volume: "volume",
  holders: "holders",
  rank: "rank",
} as const;
const _boosterTypes = Object.values(BOOSTER_TYPES);
export type BOOSTER_TYPES_TYPE = (typeof _boosterTypes)[number];

class Booster {
  static newBoosters: Booster[] = [];
  static resActiveBoosters: Booster[] = [];

  //@ts-ignore
  keypair: solana.Keypair;
  //@ts-ignore
  tokenAddress: solana.PublicKey;
  //@ts-ignore
  raySwap: RaydiumSwap;
  tokenAccount?: solana.PublicKey;
  tokenDecimals: number = 9;
  ownerTgID: string;
  puppetWallets: PuppetWallet[] = [];

  type: BOOSTER_TYPES_TYPE;

  //@ts-ignore
  settings: Settings;
  metrics: BoosterMetrics = {
    startingBalance: 0,
    totalTx: 0,
    totalHolders: 0,
    buyVolume: 0,
    sellVolume: 0,
    gasSpent: 0,
    lastKnownSolBal: 0,
    lastKnownTokenBal: 0,
  };

  internalID: string | null = null;
  isActive: boolean = false;
  lastStartAt: number = 0;
  wasAskedToStop: boolean = false;

  private _tokensPerNewHolderWallet_inSol = 0;
  private _wasLastBalanceCheckSuccessful: boolean = false;

  constructor(type: BOOSTER_TYPES_TYPE, tokenAddr: string, user: User) {
    userManager.getOrCreateSettingsFor(user.tgID).then((settings) => (this.settings = settings));
    this.type = type;
    this.tokenAddress = new solana.PublicKey(tokenAddr);
    this.keypair = keypairFrom(user.workWalletPK);
    this.raySwap = new RaydiumSwap(this.keypair, this.tokenAddress);
    this.ownerTgID = user.tgID;
    this._storeInDB();
    Booster.newBoosters.push(this);
  }

  private async init() {
    this.tokenDecimals = await sh.getTokenDecimals(this.tokenAddress);
    const tokenAcc = await sh.getTokenAcc(this.tokenAddress, this.keypair.publicKey);
    this.tokenAccount = tokenAcc?.pubkey;
    if (this.tokenAccount) console.info(`[${this.shortName}] token account exists: ${this.tokenAccount}`);
    else console.info(`[${this.shortName}] no token account found on booster creation`);
  }

  get fullName() {
    return `${this.tokenAddress.toBase58()}|${this.type}`;
  }
  get shortName() {
    const addr = this.tokenAddress.toBase58();
    return `${addr.slice(0, 4) + ".." + addr.slice(-4)}|${this.type}`;
  }
  get puppetWalletBalancesSol() {
    if (this.puppetWallets.length < 1) {
      return "N/A";
    }
    let balances = "";
    for (const puppet of this.puppetWallets) {
      balances += `${puppet.balances.baseSol.toFixed(3)} | `;
    }
    balances = balances.slice(0, -2);
    balances += "SOL";
    return balances;
  }

  get minBalanceToUsePuppets() {
    let nOfPuppets = 0;
    switch (this.type) {
      case "volume":
        nOfPuppets = this.settings.volumeParallelWallets;
        break;
      case "rank":
        nOfPuppets = this.settings.rankParallelWallets;
        break;
      default:
        throw new Error(`This booster type doesn't support puppets: ${this.type}`);
    }
    return 1.1 * nOfPuppets * c.MIN_PUPPET_BALANCE_SOL + c.MIN_BALANCE_SOL;
  }

  async start() {
    await this.init();
    this.metrics.startingBalance = await this.getSolBalance({ inLamports: false });
    while (!this.settings) await sleep(500);

    this.lastStartAt = Date.now();
    Booster.newBoosters.splice(Booster.newBoosters.indexOf(this), 1);
    Booster.resActiveBoosters.push(this);
    //trySend(this.ownerTgID!, `Your booster is now active!`);
    this.isActive = true;

    try {
      switch (this.type) {
        case BOOSTER_TYPES.volume:
          await this._doVolumeBoost();
          break;
        case BOOSTER_TYPES.holders:
          await this._doHolderBoost();
          break;
        case BOOSTER_TYPES.rank:
          await this._doRankBoost();
          break;
        default:
          throw new Error(`Illegal booster type: ${this.type}`);
      }
    } catch (e: any) {
      console.error(`[${this.shortName}] error in Booster.start() that wasn't caught by any other function: ${e}`);
      console.trace(e);
    }

    this._storeMetrics();
    this._sendMetricsToUser();
    this._cleanupAfterStop();
  }

  private async _doVolumeBoost() {
    const requiredType = BOOSTER_TYPES.volume;
    if (this.type !== requiredType)
      throw new Error(
        `Wrong booster type: '${this.type}'; expected: ${requiredType}; create a new booster with the right type if you wish to use this function.`
      );
    console.info(`[${this.shortName}] running booster from wallet '${this.keypair.publicKey.toBase58()}'`);
    let balances = await this.getBalances(this.keypair.publicKey, this.tokenAccount);
    console.info(`[${this.shortName}] initial balances: ${JSON.stringify(balances)}`);
    const hasSubstantialTokenHoldings =
      Number(balances.tokenLamps) > 0 &&
      (await this.raySwap.getTokenValueInSol(balances.tokenSol)) >= c.MIN_BALANCE_SOL;
    if (hasSubstantialTokenHoldings && balances.baseSol < c.MIN_BALANCE_SOL) {
      await this.raySwap.sellTokenForSOL(null, this.tokenAddress.toBase58(), balances.tokenSol);
      balances = await this.waitForBalanceChange(balances, null);
      this.metrics.totalTx += 1;
    }
    const puppetsReady = await this._spawnAndFillBoosterWallets(balances);
    if (!puppetsReady) {
      h.trySend(
        this.ownerTgID,
        `Failed to setup puppet wallets for your ${this.type} booster, either due to low balance (need at least ${this.minBalanceToUsePuppets} SOL) in your wallet or a network error. You can try again.`
      );
      return;
    }
    balances = await this.waitForBalanceChange(balances, null);
    while (true) {
      if (await this.hasReasonsToStop()) break;
      h.debug(this.metrics);
      await this._runVolumeBoostCycle();
      await this._waitBetweenBoosts();
    }
    await h.sleep(3000);
    await this._consolidatePuppetFunds();
    await this.waitForBalanceChange(balances, null); // to record metrics
  }

  private async _runVolumeBoostCycle() {
    const promises: Promise<any>[] = [];
    for (const puppet of this.puppetWallets) {
      if (puppet.balances.baseSol < c.MIN_PUPPET_BALANCE_SOL) {
        h.debug(`[${this.shortName}] ignoring a puppet that ran out of funds: ${puppet.pubkey.toBase58()}`);
        continue;
      }
      promises.push(this._volumeBoostAtomicTx(puppet));
    }
    return await Promise.all(promises);
  }

  private async _volumeBoostAtomicTx(puppet: PuppetWallet) {
    h.debug(`[${this.shortName}] starting atomic tx; wallet: ${h.getShortAddr(puppet.pubkey)}`);
    try {
      const lastKnownTokenBalance = puppet.balances.tokenSol;
      const bundleMetrics = await this.raySwap.buyTokenThenSell(
        puppet.keypair,
        WSOL_MINT_ADDR,
        this.tokenAddress.toBase58(),
        puppet.balances.baseSol - c.RESERVED_BOOSTER_BALANCE_SOL,
        lastKnownTokenBalance
      );
      if (!bundleMetrics) {
        console.warn(`[${this.shortName}] failed to build swap tx on '${puppet.shortAddr}'; not transacting`);
        return;
      }
      await this.waitForBalanceChange(null, puppet);
      if (bundleMetrics && puppet.isLastBalCheckSuccessful) {
        this.metrics.buyVolume += bundleMetrics.bought;
        this.metrics.sellVolume += bundleMetrics.sold;
        this.metrics.gasSpent += bundleMetrics.gas;
        this.metrics.totalTx += 3;
      }

      //@ts-ignore
      if (!puppet.tokenAccAddr) puppet.tokenAccAddr = (await sh.getTokenAcc(this.tokenAddress, puppet.pubkey))?.pubkey;
    } catch (e: any) {
      console.error(`[${this.shortName}] error in boost cycle of puppet ${puppet.pubkey.toBase58()}: ${e}`);
      console.trace(e);
    }
  }

  private async _spawnAndFillBoosterWallets(mainBalances: BoosterBalances) {
    h.debug(`[${this.shortName}] setting up puppet wallets`);
    const nOfWallets = this.type === "volume" ? this.settings.volumeParallelWallets : this.settings.rankParallelWallets;
    const existingPuppetPKs = (await userManager.getOrCreateUser(this.ownerTgID)).lastPuppetPKs;
    const newPKs: string[] = [];
    for (let i = 0; i < nOfWallets; i++) {
      let puppetPK = solana.Keypair.generate();
      if (existingPuppetPKs[i]) puppetPK = h.keypairFrom(existingPuppetPKs[i]);
      else newPKs.push(bs58.encode(puppetPK.secretKey));
      const newPuppet = new PuppetWallet(puppetPK, await this.getBalances(puppetPK.publicKey, null));
      this.puppetWallets.push(newPuppet);
    }
    if (newPKs.length > 0) {
      await prisma.user.update({
        where: { tgID: this.ownerTgID },
        data: { lastPuppetPKs: existingPuppetPKs.concat(newPKs) },
      });
    }
    mainBalances = await this._consolidatePuppetFunds_beforeFilling(mainBalances);
    return await this._fillPuppetWallets(mainBalances);
  }

  private async _consolidatePuppetFunds_beforeFilling(mainBalances: BoosterBalances) {
    try {
      let atLeastOnePuppetGotConsolidated = false;
      for (const puppet of this.puppetWallets) {
        const currentPuppetBalance = await sh.getSolBalance(puppet.pubkey);
        if (currentPuppetBalance > c.RESERVED_BOOSTER_BALANCE_SOL) {
          await this._consolidateSolOf(puppet);
          await this.waitForBalanceChange(null, puppet);
          atLeastOnePuppetGotConsolidated = true || atLeastOnePuppetGotConsolidated;
        }
      }
      if (atLeastOnePuppetGotConsolidated) mainBalances = await this.waitForBalanceChange(mainBalances, null);
      return mainBalances;
    } catch (e: any) {
      console.error(`[${this.shortName}] error while consolidating funds in puppets prior to filling them: ${e}`);
      console.trace(e);
      return mainBalances;
    }
  }

  private async _fillPuppetWallets(mainBalances: BoosterBalances) {
    if (mainBalances.baseSol < this.minBalanceToUsePuppets) {
      console.warn(
        `[${this.shortName}] not enough funds to use puppet wallets: ${mainBalances.baseSol}; need at least ${this.minBalanceToUsePuppets}`
      );
      return false;
    }
    const fundsToReserve = Math.max(3 * c.MIN_BALANCE_SOL, this.minBalanceToUsePuppets);
    const desiredPuppetBalanceSol = (mainBalances.baseSol - fundsToReserve) / this.puppetWallets.length;
    const desiredPuppetBalanceLamps = BigInt((desiredPuppetBalanceSol * solana.LAMPORTS_PER_SOL).toFixed());
    const maxWalletsPerBundle = 4;
    h.debug(`[${this.shortName}] initializing ${this.puppetWallets.length} puppet wallets:`);
    try {
      const bundlesOfTxs: solana.VersionedTransaction[][] = [];
      for (let i = 0; i < this.puppetWallets.length; i++) {
        const puppet = this.puppetWallets[i];
        h.debug(`${puppet.pubkey.toBase58()} ${bs58.encode(puppet.keypair.secretKey)}`);

        let puppetTokenAccAddr = puppet.tokenAccAddr;
        if (!puppetTokenAccAddr) puppetTokenAccAddr = (await sh.getTokenAcc(this.tokenAddress, puppet.pubkey))?.pubkey;

        let tx: solana.VersionedTransaction;
        if (puppetTokenAccAddr)
          tx = await this.raySwap.getSolTransferTx(null, puppet.pubkey, desiredPuppetBalanceLamps);
        else
          tx = await this.raySwap.getSolTransfer_andOpenTokenAccTx(puppet.keypair.publicKey, desiredPuppetBalanceSol);

        const bundleN = Math.floor(i / maxWalletsPerBundle);
        if (!bundlesOfTxs[bundleN]) bundlesOfTxs[bundleN] = [];
        bundlesOfTxs[bundleN].push(tx);
      }

      for (let i = 0; i < bundlesOfTxs.length; i++) {
        const bundleTxs = bundlesOfTxs[i];
        let success = await makeAndSendJitoBundle(bundleTxs, this.keypair, jitoTip.average);
        if (!success) success = await makeAndSendJitoBundle(bundleTxs, this.keypair, jitoTip.average);
        if (!success) {
          console.error(
            `[${this.shortName}] Failed to send funds to puppets; one or more jito bundles failed to execute; no more details are known`
          );
          return false;
        }
        h.debug(`[${this.shortName}] bundle #${i} succeeded when filling puppets`);
      }
      await this._consolidatePuppetFunds();

      await this.waitForPuppetBalanceChanges();
      return true;
    } catch (e: any) {
      console.error(`[${this.shortName}] error while spawning & filling puppet wallets: ${e}`);
      console.trace(e);
      return false;
    }
  }

  private async _consolidatePuppetFunds() {
    const promises: Promise<any>[] = [];
    let bundlesSoFar = 0;
    for (const puppet of this.puppetWallets) {
      promises.push(this._consolidateSolOf(puppet));
      bundlesSoFar += 1;
      if (bundlesSoFar % c.JITO_MAX_BUNDLES_PER_SEC_RATE_LIMIT) await h.sleep(1000);
    }
    const latestBlockhash = (await web3Connection.getLatestBlockhash()).blockhash;
    const tx = new solana.VersionedTransaction(
      new solana.TransactionMessage({
        payerKey: this.keypair.publicKey,
        recentBlockhash: latestBlockhash,
        instructions: [],
      }).compileToV0Message()
    );
    tx.sign([this.keypair]);
    await makeAndSendJitoBundle([tx], this.keypair, jitoTip.average);
    return await Promise.all(promises);
  }

  private async _consolidateSolOf(puppet: PuppetWallet): Promise<boolean> {
    puppet.balances = await this.getBalances(puppet.pubkey, puppet.tokenAccAddr);
    h.debug(`[${puppet.shortAddr}] pre-consolidation balances: ${JSON.stringify(puppet.balances)}`);

    const leftoverTokenValueInSolEquivalent = await this.raySwap.getTokenValueInSol(
      puppet.balances.tokenSol,
      this.tokenAddress
    );

    if (Number(leftoverTokenValueInSolEquivalent) >= 0.005) {
      /* Sell token for SOL */
      h.debug(`[${h.getShortAddr(puppet.pubkey)}] has a substantial amount of SOL; consolidating...`);
      const soldOK = await this.raySwap.sellTokenForSOL(
        puppet.keypair,
        this.tokenAddress.toBase58(),
        puppet.balances.tokenSol
      );
      if (soldOK) puppet.balances = await this.waitForBalanceChange(null, puppet);
    } else if (Number(puppet.balances.tokenLamps) > 0) {
      /* Transfer token to master */
      const transferInstrs = await sh.getInstr_transferToken_openReceiverAccIfNeeded(
        puppet.keypair,
        this.keypair.publicKey,
        this.tokenAddress,
        null,
        puppet.balances.tokenLamps
      );
      const closeInstrs = await sh.getInstr_closeSenderAcc(puppet.keypair, puppet.pubkey, this.tokenAddress);
      if (!closeInstrs) {
        console.warn(
          `[${puppet.shortAddr}] inconsistency when consolidating: found tokens but no token acc; not transacting`
        );
        return false;
      }
      const tx = new solana.VersionedTransaction(
        new solana.TransactionMessage({
          payerKey: puppet.pubkey,
          recentBlockhash: (await web3Connection.getLatestBlockhash()).blockhash,
          instructions: [...transferInstrs, ...closeInstrs],
        }).compileToV0Message()
      );
      
      tx.sign([puppet.keypair]);
      h.debug(`[${this.shortName}] closing token acc of ${puppet.shortAddr}`);
      const jitoResult = await makeAndSendJitoBundle([tx], puppet.keypair, jitoTip.average);
      h.debug(`[${this.shortName}] closed token acc OK? ${jitoResult}; addr: ${puppet.shortAddr}`);
      if (jitoResult) {
        await this.waitForBalanceChange(null, puppet);
      }
    }

    const transferAmountLamps = puppet.balances.baseLamps - c.DEFAULT_SOLANA_FEE_IN_LAMPS;
    if (transferAmountLamps <= 0) {
      console.warn(`[${puppet.shortAddr}] insufficient funds to cover transaction fees.`);
      return false;
    }

    try {
      const lastTxHash = await sh.sendSol(puppet.keypair, this.keypair.publicKey, transferAmountLamps);
      console.log(`[${puppet.shortAddr}] submitted tx to send all SOL to master; hash: ${lastTxHash}`);
      if (lastTxHash) return true;
    } catch (e: any) {
      if (e instanceof SendTransactionError) {
        console.error(`SendTransactionError: ${e.message}`);
        console.error(`Transaction Logs: ${e.logs}`);
      } else {
        console.error(`[${puppet.shortAddr}] error while sending out SOL: ${e}`);
      }
    }
    return false;
  }
  /* Holder Booster */

  private async _doHolderBoost() {
    const requiredType = BOOSTER_TYPES.holders;
    if (this.type !== requiredType)
      throw new Error(
        `Wrong booster type: '${this.type}'; expected: ${requiredType}; create a new booster with the right type if you wish to use this function.`
      );
    console.log(`Boosting holders from wallet '${this.keypair.publicKey.toBase58()}'`);
    const newHolderBagInSol = 0.00001;
    const approxSolSpentPerHolder = 0.0022;
    const nOfNewHoldersPerBundle = 4; // max 4 holders

    let balances = await this.getBalances(this.keypair.publicKey, this.tokenAccount);
    const startBalances = balances;
    this.metrics.lastKnownSolBal = balances.baseSol;
    const hasSubstantialTokenHoldings = (await this.raySwap.getTokenValueInSol(balances.tokenSol)) >= c.MIN_BALANCE_SOL;
    h.debug(
      `Has substantial token holdings? ${hasSubstantialTokenHoldings}; ${await this.raySwap.getTokenValueInSol(
        balances.tokenSol
      )} >= ${c.MIN_BALANCE_SOL}`
    );

    if (Number(balances.tokenLamps) > 0 && hasSubstantialTokenHoldings) {
      await this.raySwap.sellTokenForSOL(null, this.tokenAddress.toBase58(), balances.tokenSol);
      balances = await this.waitForBalanceChange(balances, null);
      this.metrics.totalTx += 1;
    }
    if (await this.hasReasonsToStop(true)) return;
    const expectedNewHolders = Number((balances.baseSol / approxSolSpentPerHolder).toFixed());
    const solForBuyingToken = expectedNewHolders * newHolderBagInSol;
    h.debug(`[${this.shortName}] buying token for ~${expectedNewHolders} holders`);
    await this.raySwap.buyTokenWithSol_openAccIfNeeded(null, this.tokenAddress.toBase58(), solForBuyingToken);
    balances = await this.waitForBalanceChange(balances, null);
    this._tokensPerNewHolderWallet_inSol = Number((balances.tokenSol / expectedNewHolders).toFixed(3));

    h.debug(`[${this.shortName}] ready to start; SOL: ${startBalances.baseSol} -> ${balances.baseSol}; token: ${startBalances.tokenSol} -> ${balances.tokenSol}
Spent ${solForBuyingToken} on tokens; sending ${this._tokensPerNewHolderWallet_inSol} tokens to each holder`);

    while (true) {
      try {
        if (await this.hasReasonsToStop()) break;
        h.debug(this.metrics);
        const rndWallets: Wallet[] = [];
        for (let i = 0; i < nOfNewHoldersPerBundle; i++) {
          rndWallets.push(getNewRandWallet());
        }
        const txs: solana.VersionedTransaction[] = [];
        h.debug(`[${this.shortName}] Adding holders to:`);
        for (const wallet of rndWallets) {
          h.debug(`${wallet.publicKey.toBase58()} ${bs58.encode(wallet.payer.secretKey)}`);
          txs.push(
            await this.raySwap.getTokenTransferTx_openAccIfNeeded(
              this.tokenAddress,
              this._tokensPerNewHolderWallet_inSol,
              wallet.publicKey
            )
          );
        }

        const result = await makeAndSendJitoBundle(txs, this.keypair);
        if (result) {
          this.metrics.buyVolume += newHolderBagInSol * nOfNewHoldersPerBundle;
          this.metrics.totalHolders += 3;
          this.metrics.gasSpent += approxSolSpentPerHolder * nOfNewHoldersPerBundle; // approx amount of SOL lost to gas & rent
        }
        h.debug(`[${this.shortName}] ${nOfNewHoldersPerBundle} holders added successfully? ${result}`);
        this.waitForBalanceChange(balances, null); // performed to update the balances in this.metrics
      } catch (e: any) {
        console.error(`Error inside holder boost cycle: ${e}`);
        console.trace(e);
      }
      await this._waitBetweenBoosts();
    }
    await sleep(5000); // let recent pending txs propagate to blockchain
    balances = await this.getBalances(this.keypair.publicKey, this.tokenAccount);
    if (balances.tokenSol > 0) {
      h.debug(`[${this.shortName}] booster is out of the loop. Selling remaining tokens: ${balances.tokenSol}`);
      await this.raySwap.sellTokenForSOL(null, this.tokenAddress.toBase58(), balances.tokenSol);
      balances = await this.waitForBalanceChange(balances, null);
      this.metrics.totalTx += 1;
    }
  }

  async _doRankBoost() {
    // consolidate funds in puppets
    await this._consolidatePuppetFunds();
    return;
    const requiredType = BOOSTER_TYPES.rank;
    if (this.type !== requiredType)
      throw new Error(
        `Wrong booster type: '${this.type}'; expected: ${requiredType}; create a new booster with the right type if you wish to use this function.`
      );
    console.info(`[${this.shortName}] running booster from wallet '${this.keypair.publicKey.toBase58()}'`);
    let balances = await this.getBalances(this.keypair.publicKey, this.tokenAccount);
    console.info(`[${this.shortName}] initial balances: ${JSON.stringify(balances)}`);
    const hasSubstantialTokenHoldings =
      Number(balances.tokenLamps) > 0 &&
      (await this.raySwap.getTokenValueInSol(balances.tokenSol)) >= c.MIN_BALANCE_SOL;
    if (hasSubstantialTokenHoldings && balances.baseSol < c.MIN_BALANCE_SOL) {
      await this.raySwap.sellTokenForSOL(null, this.tokenAddress.toBase58(), balances.tokenSol);
      balances = await this.waitForBalanceChange(balances, null);
      this.metrics.totalTx += 1;
    }
    //const puppetsSpawned = await this._spawnAndFillBoosterWallets_test(balances);
    const puppetsReady = await this._spawnAndFillBoosterWallets(balances);
    if (!puppetsReady) {
      h.trySend(
        this.ownerTgID,
        `Failed to setup puppet wallets for your ${this.type} booster, either due to low balance (need at least ${this.minBalanceToUsePuppets} SOL) in your wallet or a network error. You can try again.`
      );
      return;
    }
    balances = await this.waitForBalanceChange(balances, null);
    await this._runRankBoostCycles();
    await h.sleep(3000);
    await this._consolidatePuppetFunds();
    await this.waitForBalanceChange(balances, null); // ran to record metrics
  }

  private async _runRankBoostCycles() {
    const promises: Promise<any>[] = [];
    for (const puppet of this.puppetWallets) {
      if (puppet.balances.baseSol < c.MIN_PUPPET_BALANCE_SOL) {
        h.debug(`[${this.shortName}] ignoring a puppet that has no funds: ${puppet.pubkey.toBase58()}`);
        continue;
      }
      promises.push(this._runAtomicTxsForPuppet(puppet));
    }
    return await Promise.all(promises);
  }

  private async _runAtomicTxsForPuppet(puppet: PuppetWallet) {
    while (true) {
      if (puppet.balances.baseSol < c.MIN_PUPPET_BALANCE_SOL) {
        h.debug(`[${this.shortName}] puppet ran out of funds; ${puppet.pubkey.toBase58()}`);
        break;
      }
      if (await this.hasReasonsToStop()) break;
      //h.debug(this.metrics);
      await this._rankBoostAtomicTx(puppet);
      await this._waitBetweenBoosts(true);
    }
  }

  private async _rankBoostAtomicTx(puppet: PuppetWallet) {
    h.debug(`[${this.shortName}] starting atomic tx; wallet: ${h.getShortAddr(puppet.pubkey)}`);
    const slippagePerc = 50;
    const buyAmountSOL = 0.00001;
    const txPerBundle = 4;
    const senderWallet = new Wallet(puppet.keypair);

    try {
      let builtTxPromises: Promise<any>[] = [];
      for (let i = 0; i < txPerBundle; i++) {
        const buyAmountSOL_changed = buyAmountSOL + i / 10 ** 7; // jito demands that buy sums be different, otherwise it complains about "duplicate transactions" in the bundle
        builtTxPromises.push(
          this.raySwap.getSwapTransaction(
            senderWallet,
            c.WSOL_MINT_ADDR,
            this.tokenAddress,
            buyAmountSOL_changed,
            slippagePerc
          )
        );
      }
      const builtTxs: TxBuilderOutput[] = await Promise.all(builtTxPromises);
      if (builtTxs.length < 1) {
        console.warn(`[${this.shortName}] failed to build any swap txs on '${puppet.shortAddr}'; not transacting`);
        return;
      }

      const buyTxs: solana.VersionedTransaction[] = [];
      for (const builtTx of builtTxs) {
        if (builtTx.signedTx) buyTxs.push(builtTx.signedTx);
      }
      h.debug(`[${puppet.shortAddr}] bundling ${buyTxs.length} micro-buy txs`);
      const result = await makeAndSendJitoBundle(buyTxs, puppet.keypair, jitoTip.chanceOf50);
      h.debug(`[${this.shortName}] bundle OK? ${result}`);
      if (result) {
        this.metrics.totalTx += txPerBundle;
        this.waitForBalanceChange(null, puppet); // will auto-update puppet.balances
      }

      if (!puppet.tokenAccAddr) puppet.tokenAccAddr = (await sh.getTokenAcc(this.tokenAddress, puppet.pubkey))?.pubkey;
    } catch (e: any) {
      console.error(`[${this.shortName}] error in boost cycle of puppet ${puppet.pubkey.toBase58()}: ${e}`);
      console.trace(e);
    }
  }

  async ensureTokenAccountExists(balances: BoosterBalances) {
    if (!this.tokenAccount) {
      const tokenAcc = (await sh.getTokenAcc(this.tokenAddress, this.keypair.publicKey))?.pubkey;
      if (tokenAcc) this.tokenAccount = tokenAcc;
    }
    while (!this.tokenAccount) {
      await this.raySwap.buyTokenWithSol_openAccIfNeeded(
        null,
        this.tokenAddress.toBase58(),
        balances.baseSol - c.MIN_BALANCE_SOL * 1.2
      );
      if (!this.tokenAccount) {
        const tokenAcc = (await sh.getTokenAcc(this.tokenAddress, this.keypair.publicKey))?.pubkey;
        if (!tokenAcc) continue;
        this.tokenAccount = tokenAcc;
        this.metrics.totalTx += 1;
      }
    }
  }

  // Function to transfer all SOL to a new wallet
  private async transferAllSol(fromWallet: Wallet, toPublicKey: string) {
    const balance = await web3Connection.getBalance(fromWallet.publicKey);
    if (balance > 0) {
      const transaction = solana.SystemProgram.transfer({
        fromPubkey: fromWallet.publicKey,
        toPubkey: new solana.PublicKey(toPublicKey),
        lamports: balance - 15000, // Subtract 5000 lamports for the transaction fee
      });
      let blockhash = (await web3Connection.getLatestBlockhash("finalized")).blockhash;
      const transactionToSend = new solana.Transaction().add(transaction);
      transactionToSend.recentBlockhash = blockhash;
      transactionToSend.feePayer = fromWallet.publicKey;

      const signedTransaction = await fromWallet.signTransaction(transactionToSend);
      const signature = await web3Connection.sendRawTransaction(signedTransaction.serialize());
      await web3Connection.confirmTransaction(signature);
      console.log(`Transferred ${balance / solana.LAMPORTS_PER_SOL} SOL to new wallet: ${toPublicKey}`);
    } else {
      console.log("No SOL to transfer.");
    }
  } catch (e: any) {
    if (e instanceof solana.SendTransactionError) {
      console.error(`SendTransactionError: ${e.message}`);
      console.error(`Transaction Logs: ${e.logs}`);
    } else {
      console.error(`Failed to transfer SOL: ${e}`);
    }
  }

  // unused
  private async changeWallet(privateKey?: string) {
    console.info(`Changing wallet`);
    let newKeypair = solana.Keypair.generate();
    if (privateKey) {
      newKeypair = solana.Keypair.fromSecretKey(Uint8Array.from(bs58.decode(privateKey)));
    }
    console.info(`New keypair: ${newKeypair.publicKey.toBase58()}:${bs58.encode(newKeypair.secretKey)}`);
    let booster = await prisma.booster.update({
      where: {
        internalID: this.internalID!,
      },
      data: {
        freshWalletPK: bs58.encode(newKeypair.secretKey),
      },
    });

    const successful = await this.transferAllSolTo(newKeypair.publicKey);
    if (!successful) {
      throw Error(`Failed to change wallet`);
    }

    booster = await prisma.booster.update({
      where: {
        internalID: this.internalID!,
      },
      data: {
        freshWalletPK: "",
        activeWalletPK: bs58.encode(newKeypair.secretKey),
        activeWalletAddr: newKeypair.publicKey.toBase58(),
        lastActiveWalletPK: bs58.encode(this.keypair.secretKey),
      },
    });
    console.log("\n\nIn the middle of changing wallet on booster:");
    console.log(booster);

    this.tokenAccount = undefined;
    this.keypair = newKeypair;
    this.raySwap.useNewWallet_fromKeypair(this.keypair);
    this.tokenAccount = (await sh.getTokenAcc(this.tokenAddress, this.keypair.publicKey))?.pubkey;
    console.log(`Found account ${this.tokenAccount} for ${this.tokenAddress.toBase58()}`);
    console.info(`Wallet changed to ${newKeypair.publicKey.toBase58()}`);
    return true;
  }

  async getBalances(
    mainAddr: solana.PublicKey,
    tokenAccAddr: solana.PublicKey | null | undefined
  ): Promise<BoosterBalances> {
    try {
      const baseLamps = await this.getSolBalance({ address: mainAddr });
      const baseSol = baseLamps / solana.LAMPORTS_PER_SOL;
      let tokenSol: number | null = 0,
        tokenLamps = "0";
      if (tokenAccAddr) {
        const quoteBalances = await sh.getTokenAccBalance(tokenAccAddr);
        tokenSol = quoteBalances.uiAmount;
        tokenLamps = quoteBalances.amount;
      }

      return {
        baseSol,
        baseLamps: baseLamps,
        tokenSol: tokenSol || 0,
        tokenLamps,
      };
    } catch (error) {
      console.error("Error fetching balances:", error);
      return { baseSol: 0, baseLamps: 0, tokenSol: 0, tokenLamps: "0" };
    }
  }

  async waitForBalanceChange(
    balancesLast: BoosterBalances | null,
    puppetWallet: PuppetWallet | null,
    analyzeChangedAmount: boolean = false
  ) {
    if ((!balancesLast && !puppetWallet) || (balancesLast && puppetWallet))
      throw SyntaxError(`Either previous balances or a puppet wallet need to be supplied`);
    let mainAddr = this.keypair.publicKey;
    let tokenAccAddr = this.tokenAccount;
    balancesLast = balancesLast as BoosterBalances;
    if (puppetWallet) {
      mainAddr = puppetWallet.pubkey;
      tokenAccAddr = puppetWallet.tokenAccAddr;
      balancesLast = puppetWallet.balances;
    }

    h.debug(`[${h.getShortAddr(mainAddr)}] waiting for balance update...`);
    const maxSolBalChangePerBundlePerc = 25;
    const timeStarted = Date.now();
    let balanceAfter = await this.getBalances(mainAddr, tokenAccAddr);
    while (!this.wasAskedToStop) {
      const balanceUnchanged =
        balanceAfter.baseLamps === balancesLast.baseLamps && balanceAfter.tokenLamps === balancesLast.tokenLamps;
      if (!balanceUnchanged) {
        if (balanceAfter.baseSol < (balancesLast.baseSol * 100) / (100 - maxSolBalChangePerBundlePerc)) {
          break;
        } else if (!analyzeChangedAmount) {
          break;
        } else {
          // amount of SOL has changed by more than 10%, and although the balance has changed,
          // likely only 1/2 txs from the bundle has propagated to blockchain, so balance is not fully updated yet
          h.debug(
            `[${this.shortName}] unsatisfactory balance change ignored: ${balancesLast.baseSol}:${balancesLast.tokenSol} -> ${balanceAfter.baseSol}:${balanceAfter.tokenSol}`
          );
        }
      }

      if (Date.now() - timeStarted > c.BALANCE_CHANGE_CHECK_TIMEOUT) {
        console.warn(`Balances unchanged; timed-out after ${c.BALANCE_CHANGE_CHECK_TIMEOUT / 1000} seconds`);
        const emptyBalancesReceived = balanceAfter.baseSol == 0 && balanceAfter.tokenSol == 0;
        if (!puppetWallet && !emptyBalancesReceived) {
          this._wasLastBalanceCheckSuccessful = false;
          this.metrics.lastKnownSolBal = balanceAfter.baseSol;
          this.metrics.lastKnownTokenBal = balanceAfter.tokenSol;
        } else if (puppetWallet) {
          puppetWallet.isLastBalCheckSuccessful = false;
          puppetWallet.balances = balanceAfter;
        }
        return balanceAfter;
      }
      await sleep(2000);
      balanceAfter = await this.getBalances(mainAddr, tokenAccAddr);
    }
    console.info(
      `[${h.getShortAddr(mainAddr)}] Balances changed: ${balancesLast.baseSol}:${balancesLast.tokenSol} -> ${
        balanceAfter.baseSol
      }:${balanceAfter.tokenSol}`
    );
    const emptyBalancesReceived = balanceAfter.baseSol == 0 && balanceAfter.tokenSol == 0;
    if (!puppetWallet && !emptyBalancesReceived) {
      this._wasLastBalanceCheckSuccessful = true;
      this.metrics.lastKnownSolBal = balanceAfter.baseSol;
      this.metrics.lastKnownTokenBal = balanceAfter.tokenSol;
    } else if (puppetWallet) {
      puppetWallet.isLastBalCheckSuccessful = true;
      puppetWallet.balances = balanceAfter;
    }
    return balanceAfter;
  }

  async waitForPuppetBalanceChanges(): Promise<void> {
    h.debug(`[${this.shortName}] waiting for puppet balance changes...`);
    const promises: Promise<any>[] = [];
    for (const puppet of this.puppetWallets) {
      promises.push(
        this.waitForBalanceChange(null, puppet)
          .then((newBalances) => (puppet.balances = newBalances))
          .catch((e) => {
            console.error(`Error when updating puppet balances for ${puppet.shortAddr}`);
            console.trace(e);
          })
      );
    }
    await Promise.all(promises);
  }

  async transferAllSolTo(newAddress: solana.PublicKey) {
    const balance = await this.getSolBalance();

    const ulampsPerCU = DEFAULT_uLAMPS_PER_CU;
    const priorityFeeLamps = (ulampsPerCU * DEFAULT_NUM_OF_CU_PER_TX) / 10 ** 6;
    const rentExemptionLamp = await this.raySwap.tryGetRentExemptionFee(null);
    h.debug(`Lamports needed to keep acc rent - exempt: ${rentExemptionLamp} `);
    const magicNumber = 1.1; // makes my maths actually work
    const resBalance_normalTx = (priorityFeeLamps + rentExemptionLamp + c.DEFAULT_SOLANA_FEE_IN_LAMPS) * magicNumber;
    const resBalance_forJitoBundle = resBalance_normalTx + jitoTip.average;
    const freeBalance = Number((balance - resBalance_forJitoBundle).toFixed());
    h.debug(`Reserved SOL: ${(balance - freeBalance) / solana.LAMPORTS_PER_SOL} `);

    if (freeBalance < 0)
      throw Error(`Trying to transfer SOL to another wallet, but our balance is too small for that: ${freeBalance} `);

    h.debug(`Available balance after all fees & rent: ${freeBalance} `);
    const tx = await this.raySwap.getSolTransferTx(null, newAddress, freeBalance, ulampsPerCU);

    const newWalletBalanceAtStart = await web3Connection.getBalance(newAddress);
    console.info(
      `initiating transfer of whole wallet balance; ${this.keypair.publicKey.toBase58()} -> ${newAddress.toBase58()} `
    );
    await makeAndSendJitoBundle([tx], this.keypair);

    const timeStarted = Date.now();
    let lastCheckedBalance = 0;
    while (Date.now() - timeStarted < c.BALANCE_CHANGE_CHECK_TIMEOUT) {
      lastCheckedBalance = await web3Connection.getBalance(newAddress);
      if (lastCheckedBalance > newWalletBalanceAtStart) {
        console.info(`New wallet balance changed: ${newWalletBalanceAtStart} -> ${lastCheckedBalance} `);
        console.info(
          `Whole free wallet balance ${freeBalance / solana.LAMPORTS_PER_SOL} sent to ${newAddress.toBase58()} `
        );
        return true;
      }
      await sleep(2000);
    }
    console.error(
      `Moving wallet balance timed - out after ${
        c.BALANCE_CHANGE_CHECK_TIMEOUT / 1000
      } s; target wallet: ${newAddress.toBase58()} `
    );
    return false;
  }

  async getSolBalance(
    { inLamports = true, address }: { inLamports?: boolean; address?: solana.PublicKey } = { inLamports: true }
  ) {
    //console.log(`this.getBalance inLamports: ${ inLamports } `);
    //console.log(`this.getBalance address: ${ address } `);
    if (!address) address = this.keypair.publicKey;
    let balanceLamps = 0;
    try {
      balanceLamps = await web3Connection.getBalance(address);
      //console.log(balanceLamps);
    } catch (e: any) {
      console.error(`Failed to fetch wallet balance: ${e} `);
    }
    if (inLamports) return balanceLamps;
    else return balanceLamps / solana.LAMPORTS_PER_SOL;
  }

  askToStop() {
    console.info(`Asking booster ${this.fullName} to stop & dumping its metrics into DB`);
    this.wasAskedToStop = true;
  }

  /**
   * Checks for a variety of stop conditions for a booster
   * @param {boolean} isStillSettingUp - skips some condition checks that could be true before the booster is done setting up
   * @returns {Promise<Boolean>} whether the booster needs to stop
   */
  async hasReasonsToStop(isStillSettingUp = false) {
    if (this.wasAskedToStop) {
      console.info(`Booster ${this.fullName} received the request to stop`);
      return true;
    } else if (await userManager.hasRentExpired(this.ownerTgID)) {
      console.info(`Rent for ${this.shortName} user ${this.ownerTgID} has expired.Stopping...`);
      h.trySend(this.ownerTgID, `Your rent time with the bot has expired, and we're stopping your booster`);
      return true;
    } else if (this.metrics.lastKnownSolBal < c.MIN_BALANCE_SOL) {
      console.log(`Last known SOL bal: ${this.metrics.lastKnownSolBal}`);
      console.info(`Booster ${this.fullName} ran out of funds`);
      h.trySend(this.ownerTgID, `Booster ${this.shortName} ran out of funds and is now stopping!`);
      return true;
    } else if (
      this.type === "volume" &&
      this.lastStartAt &&
      this.lastStartAt + this.settings.volumeDuration * 1000 < Date.now()
    ) {
      console.info(`Booster ${this.shortName} has ran for the required duration. Stopping...`);
      h.trySend(
        this.ownerTgID,
        `Booster ${this.shortName} auto shut-off as requested, after ${h.secondsToTimingNotation(
          this.settings.volumeDuration
        )}`
      );
      return true;
    } else if ((this.type === "volume" || this.type === "rank") && !isStillSettingUp) {
      let atLeastOnePuppetHasFunds = true;
      for (const puppet of this.puppetWallets) {
        atLeastOnePuppetHasFunds = atLeastOnePuppetHasFunds && puppet.balances.baseSol > c.MIN_PUPPET_BALANCE_SOL;
      }
      if (!atLeastOnePuppetHasFunds) {
        console.info(`Booster ${this.fullName} ran out of funds in its puppet wallets`);
        h.trySend(
          this.ownerTgID,
          `Booster ${this.shortName} ran out of funds in its puppet wallets and is now stopping!`
        );
        return true;
      }
    } else if (this.type === "holders" && this.metrics.totalHolders >= this.settings.holdersNewHolders) {
      const message = `Booster ${this.shortName} has generated the required number of holders ${this.metrics.totalHolders}; stopping...`;
      h.trySend(this.ownerTgID, message);
      console.info(message);
      return true;
    } else if (
      this.type === "holders" &&
      !isStillSettingUp &&
      this.metrics.lastKnownTokenBal < this._tokensPerNewHolderWallet_inSol * 3
    ) {
      console.info(`Booster ${this.shortName} ran out of tokens for holders; stopping`);
      return true;
    }
    return false;
  }

  private async _cleanupAfterStop() {
    h.debug(`[${this.shortName}] cleaning up...`);
    this.isActive = false;
    try {
      for (let i = 0; i < Booster.resActiveBoosters.length; i++) {
        const booster = Booster.resActiveBoosters[i];
        if (booster.internalID == this.internalID) {
          Booster.resActiveBoosters.slice(i, 1);
        }
      }
    } catch (e: any) {
      console.error(`Error while removing active booster from static array in Booster class: ${e}`);
    }
    await prisma.booster.update({
      where: { internalID: this.internalID || undefined },
      data: { isActive: false },
    });
    h.debug(`[${this.shortName}] cleanup complete.`);
  }

  private async _sendMetricsToUser() {
    let metrics = `${c.icons.book} <b>Results</b> for last booster
[${this.shortName}]`;
    if (this.type === "volume") {
      metrics += `
Buys: ${this.metrics.buyVolume.toFixed(3)} SOL | sells: ${this.metrics.sellVolume.toFixed(3) || "N/A"} SOL
Total txs: ${this.metrics.totalTx}`;
    } else if (this.type === "holders") {
      metrics += `
New holders: ${this.metrics.totalHolders}`;
    } else if (this.type === "rank") {
      metrics += `
New holders: ${this.metrics.totalHolders}
Buys: ${this.metrics.totalTx}`;
    }
    await h.trySend(this.ownerTgID, metrics, DEF_MESSAGE_OPTS);
  }

  async remove() {
    try {
      await prisma.booster.delete({
        where: {
          internalID: this.internalID!,
        },
      });

      const userDB = await userManager.getOrCreateUser(this.ownerTgID);
      await prisma.booster.delete({
        where: {
          internalID: this.internalID!,
        },
      });
    } catch (e: any) {
      console.error(`Failed to remove booster ${this.internalID} from DB: ${e}`);
      return false;
    }
    return true;
  }

  private async _storeInDB(isRecreatedFromDB: boolean = false) {
    const boosterDB_existing = await prisma.booster.findFirst({
      where: {
        tokenAddress: this.tokenAddress.toBase58(),
        type: this.type,
        ownerTgID: this.ownerTgID,
        isActive: true,
      },
    });
    if (boosterDB_existing && !isRecreatedFromDB) {
      throw new Error(`Active booster for ${this.tokenAddress.toBase58()} of type '${this.type}' already exists`);
    } else if (boosterDB_existing) {
      this.internalID = boosterDB_existing.internalID;
      return;
    }
    const boosterDB = await prisma.booster.create({
      data: {
        ownerTgID: this.ownerTgID,
        tokenAddress: this.tokenAddress.toBase58(),
        type: this.type,
        activeWalletPK: bs58.encode(this.keypair.secretKey),
        activeWalletAddr: this.keypair.publicKey.toBase58(),
      },
    });
    this.internalID = boosterDB.internalID;
  }

  private async _storeMetrics() {
    await prisma.booster.update({
      where: {
        internalID: this.internalID || undefined,
      },
      data: {
        //initialDeposit: this.metrics.initialDeposit,
        cachedTotalTxs: this.metrics.totalTx,
        cachedTotalHolders: this.metrics.totalHolders,
        cachedBuyVolume: this.metrics.buyVolume,
        cachedSellVolume: this.metrics.sellVolume,
        cachedGasSpent: this.metrics.gasSpent,
      },
    });
  }

  private async _waitBetweenBoosts(forcedSilent = false) {
    let delaySec = 0;
    if (this.type == "volume") {
      const invertedSpeedValue = c.BOOSTER_TOP_GEAR - this.settings.volumeSpeed;
      delaySec = (invertedSpeedValue * 3) ** 2;
      //delay = getRandomDelayBetweenTx();
    } else if (this.type == "holders") {
      delaySec = 4;
    } else if (this.type == "rank") {
      delaySec = 1;
    }
    if (!forcedSilent) h.debug(`[${this.shortName}] waiting for ${delaySec}s...`);
    return await sleep(delaySec * 1000);
  }

  /* Static methods below this point */

  static async isBoosterRunning(internalID: string) {
    const booster = await prisma.booster.findUnique({
      where: {
        internalID: internalID,
        isActive: true,
      },
    });
    if (booster) {
      return true;
    } else {
      return false;
    }
  }

  static async getActiveBoosterDataFor(tokenAddr: string, type: BOOSTER_TYPES_TYPE, tgID?: string | number) {
    tgID = String(tgID);
    const booster = prisma.booster.findFirst({
      where: {
        tokenAddress: tokenAddr,
        type: type,
        ownerTgID: tgID,
        isActive: true,
      },
    });
    return booster;
  }

  static async getBoosterDataBy(internalID: string) {
    return await prisma.booster.findUnique({
      where: {
        internalID: internalID,
      },
    });
  }

  static async getActiveBoosterFor(tokenAddr: string, type: BOOSTER_TYPES_TYPE, tgID?: string | number) {
    const boosterData = await Booster.getActiveBoosterDataFor(tokenAddr, type, tgID);
    if (!boosterData) return null;
    return Booster.getActiveBoosterBy(boosterData.internalID);
  }

  static getActiveBoosterBy(internalID: string) {
    for (let i = 0; i < Booster.resActiveBoosters.length; i++) {
      const booster = Booster.resActiveBoosters[i];
      if (booster.internalID == internalID) {
        return booster;
      }
    }
    return null;
  }

  static getNewBoosterBy(internalID: string) {
    for (let i = 0; i < Booster.newBoosters.length; i++) {
      const booster = Booster.newBoosters[i];
      if (booster.internalID == internalID) {
        return booster;
      }
    }
    return null;
  }

  static async removeBoosterBy(internalID: string) {
    try {
      await prisma.booster.delete({
        where: {
          internalID: internalID,
        },
      });
    } catch (e: any) {
      console.warn(`Failed to remove booster from DB: ${e}`);
    }
  }

  /*
  static async restartBoostersFromDB() {
    const activeBoosters = await prisma.booster.findMany({
      where: {
        isActive: true,
      }
    });
    if (activeBoosters.length == 0) {
      console.info(`No saved active boosters found`);
      return;
    }
    console.info(`Found ${activeBoosters.length} saved active boosters; waiting for ${c.SAVED_BOOSTER_START_DELAY / 1000}s`);
    await sleep(c.SAVED_BOOSTER_START_DELAY);
    for (const boosterData of activeBoosters) {
      const boosterUser = await userManager.getUser(boosterData.ownerTgID);
      const booster = new Booster(
        boosterData.type as BOOSTER_TYPES_TYPE, boosterData.tokenAddress, boosterUser!);
      booster.metrics = {
        startingBalance: 0,
        totalHolders: boosterData.cachedTotalHolders,
        totalTx: boosterData.cachedTotalTxs,
        buyVolume: boosterData.cachedBuyVolume,
        sellVolume: boosterData.cachedSellVolume,
        gasSpent: boosterData.cachedGasSpent,
        lastKnownSolBal: 0,
      }
      booster.start();
    }
  }
  */
}

class PuppetWallet {
  keypair: solana.Keypair;
  tokenAccAddr?: solana.PublicKey;
  balances: BoosterBalances;
  isLastBalCheckSuccessful: boolean = true;

  constructor(keypair: solana.Keypair, balances: BoosterBalances) {
    this.keypair = keypair;
    this.balances = balances;
  }

  get pubkey() {
    return this.keypair.publicKey;
  }

  get shortAddr() {
    const addr = this.pubkey.toBase58();
    return `${addr.slice(0, 4) + ".." + addr.slice(-4)}`;
  }
}

type BoosterMetrics = {
  startingBalance: number;
  totalTx: number;
  totalHolders: number;
  buyVolume: number;
  sellVolume: number;
  gasSpent: number;
  lastKnownSolBal: number;
  lastKnownTokenBal: number;
};

export type BoosterBalances = {
  baseSol: number;
  baseLamps: number;
  tokenSol: number;
  tokenLamps: string;
};

export default Booster;