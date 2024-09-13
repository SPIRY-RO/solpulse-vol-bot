/*
 Tremendous respect to the guys at Chainstack for making the class with this repo available
 and easy-to-use. A lot was rewritten to fit it all into a single class,
 but it came ready-to-use out-of-the-box. Sources:
 https://docs.chainstack.com/docs/solana-how-to-perform-token-swaps-using-the-raydium-sdk
 https://github.com/chainstacklabs/raydium-sdk-swap-example-typescript.git
*/

import * as solana from '@solana/web3.js';
import * as raySDK from '@raydium-io/raydium-sdk';
import * as spl from '@solana/spl-token';
import { Wallet } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import axios from 'axios';

import { web3Connection } from '..';
import { envConf } from '../config';
import * as h from '../helpers';
import * as sh from '../utils/solana_helpers';
import * as c from '../const';
import { makeAndSendJitoBundle } from '../utils/jito';
import { debug, getRandomNumber } from '../helpers';
import { jitoTip } from '../utils/jito-tip-deamon';


class RaydiumSwap {
  //@ts-ignore
  wallet: Wallet;
  //@ts-ignore
  keypair: solana.Keypair;
  tokenAddress: solana.PublicKey;
  tokenDecimals: number = 9;

  private _cachedPoolData: raySDK.LiquidityPoolKeysV4 | null = null;

  constructor(initialKeypair: solana.Keypair, tokenAddress: solana.PublicKey) {
    this.tokenAddress = tokenAddress;
    this.useNewWallet_fromKeypair(initialKeypair);
    this.init();
  }

  async init() {
    this.tokenDecimals = await sh.getTokenDecimals(this.tokenAddress);
  }

  useNewWallet_fromPrivkey(privateKey: string) {
    this.keypair = solana.Keypair.fromSecretKey(Uint8Array.from(bs58.decode(privateKey)));
    this.wallet = new Wallet(this.keypair);
  }
  useNewWallet_fromKeypair(keypair: solana.Keypair) {
    this.keypair = keypair;
    this.wallet = new Wallet(keypair)
  }


  async sellTokenForSOL(
    sellerKeypair: solana.Keypair | null,
    fromToken: string,
    fromAmount: number | string,
    //maxMicroLamports: number = c.MAX_LAMPS_RAYDIUM_PRIORITY_FEE,
  ) {
    if (!sellerKeypair)
      sellerKeypair = this.keypair;

    try {
      const { signedTx: signedTx, amountIn_inSol: amountIn, amountOutMin_inSol: amountOutMin } = await this.getSwapTransaction(
        new Wallet(sellerKeypair),
        fromToken,
        c.WSOL_MINT_ADDR,
        fromAmount,
      );
      if (!signedTx) {
        console.error(`[${h.getShortAddr(fromToken)}] failed to build SOL -> token swap tx`);
        return false;
      }

      console.info(`Selling ${fromAmount} token for ~${amountOutMin} SOL`);

      const hasSucceeded = await makeAndSendJitoBundle([signedTx], this.keypair);
      return hasSucceeded;
    } catch (e: any) {
      console.error(`Error while selling token for SOL: ${e}`);
      return false;
    }
  }


  async buyTokenWithSol_openAccIfNeeded(
    senderKeypair: solana.Keypair | null,
    toToken: string,
    fromAmount: number | string,
  ) {
    fromAmount = Number(fromAmount);
    try {
      // account is opened implicitly here
      let wallet = this.wallet;
      if (senderKeypair)
        wallet = new Wallet(senderKeypair);
      //@ts-ignore
      const {
        signedTx: signedTx, amountIn_inSol: amountIn, amountOutMin_inSol: amountOutMin
      } = await this.getSwapTransaction(
        wallet,
        c.WSOL_MINT_ADDR,
        toToken,
        fromAmount,
        null,
        //maxMicroLamports,
      );

      console.info(`Buying token with ${fromAmount} worth of SOL; also opening token account`);
      const result = await makeAndSendJitoBundle([signedTx!], senderKeypair || this.keypair);
      return result;
    } catch (e: any) {
      console.error(`Error while buying token & opening account: ${e}`);
      return false;
    }
  }



  async closeAccountTest() {
    //async closeAccountTest(addrToClose: string | solana.PublicKey) {
    /*
    if (typeof (addrToClose) === "string")
      addrToClose = new solana.PublicKey(addrToClose);
    */

    const newPK = 'X7zVBF9c5X3xpqambqMxgQGD7ekVMZjBbXit1G2L9UyFcKJymgsa9JhaMwDxghxyUMF3Qt9pnnLaX45fgiH4epL';
    //const newKeypair = solana.Keypair.generate();
    const newKeypair = h.keypairFrom(newPK);
    const newWallet = new Wallet(newKeypair);
    console.log(`KP: ${bs58.encode(newKeypair.secretKey)} ${newKeypair.publicKey.toBase58()}`);

    const openTx = await this.getSolTransferTx(null, newKeypair.publicKey, 0.0021 * 10 ** 9);
    //let jitoResult = await makeAndSendJitoBundle([transferTX], this.keypair);
    //console.log(`Sent SOL OK?: ${jitoResult}`);

    const balanceLamps = await web3Connection.getBalance(newKeypair.publicKey);
    const tip = jitoTip.chanceOf75;
    const jitoExpenses = tip + c.DEFAULT_SOLANA_FEE_IN_LAMPS;
    const transferExpenses = await this.getUnusableSOL_forFullClosure_inLamports();
    const transferAmount = balanceLamps - (transferExpenses + jitoExpenses);
    console.log(`${transferAmount} = ${balanceLamps} - (${transferExpenses} + ${jitoExpenses})`);

    const instructions_simulation = [
      solana.ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: c.DEFAULT_uLAMPS_PER_CU,
      }),
      solana.SystemProgram.transfer({
        fromPubkey: newWallet.publicKey,
        toPubkey: this.keypair.publicKey,
        lamports: 2101000,
      })
    ];


    const txToSimulate = new solana.VersionedTransaction(
      new solana.TransactionMessage({
        payerKey: this.wallet.publicKey,
        recentBlockhash: (await web3Connection.getLatestBlockhash()).blockhash,
        instructions: instructions_simulation,
      }).compileToV0Message()
    );
    txToSimulate.sign([newKeypair]);

    const simRes = await this.simulateVersionedTransaction(txToSimulate);
    console.log('Simulation TX):');
    console.log(simRes);
    console.log(`Errors:`);
    console.log(simRes.value?.err);
    console.log(`Logs`);
    console.log(simRes.value.logs);


    const instructions = [
      solana.ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: c.DEFAULT_uLAMPS_PER_CU,
      }),
      solana.SystemProgram.transfer({
        fromPubkey: newWallet.publicKey,
        toPubkey: this.keypair.publicKey,
        lamports: 2101000,
      })
    ];

    const txToSend = new solana.VersionedTransaction(
      new solana.TransactionMessage({
        payerKey: this.wallet.publicKey,
        recentBlockhash: (await web3Connection.getLatestBlockhash()).blockhash,
        instructions,
      }).compileToV0Message()
    );
    txToSend.sign([newKeypair]);

    const jitoResult = await makeAndSendJitoBundle([txToSend], newKeypair, tip);
    console.log(`Closed acc OK?: ${jitoResult}`);

    return txToSend;
  }


  async getTokenTransferTx_openAccIfNeeded(
    tokenAddr: string | solana.PublicKey,
    tokenAmount_inSol: string | number,
    receiverAddr: solana.PublicKey,
    senderTokenAccountAddr?: solana.PublicKey,
    priorityMicroLampsPerCU: number = c.DEFAULT_uLAMPS_PER_CU,
  ) {
    if (typeof (tokenAddr) === "string")
      tokenAddr = new solana.PublicKey(tokenAddr);

    const tokenAmount_inLamps = await sh.tokenFromSolToLamps(tokenAmount_inSol, tokenAddr);

    if (!senderTokenAccountAddr) {
      senderTokenAccountAddr = (await spl.getOrCreateAssociatedTokenAccount(web3Connection, this.keypair, tokenAddr, this.keypair.publicKey)).address;
    }
    const associatedDestinationTokenAddr = await spl.getAssociatedTokenAddress(
      tokenAddr,
      receiverAddr,
    );
    const receiverTokenAccountAddr = (await sh.getTokenAcc(this.tokenAddress, receiverAddr))?.pubkey;

    const instructions = [
      solana.ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityMicroLampsPerCU,
      }),
    ];
    if (!receiverTokenAccountAddr) {
      instructions.push(spl.createAssociatedTokenAccountInstruction(
        this.keypair.publicKey,
        associatedDestinationTokenAddr,
        receiverAddr,
        tokenAddr,
      ));
    }
    instructions.push(spl.createTransferInstruction(
      senderTokenAccountAddr,
      associatedDestinationTokenAddr,
      this.keypair.publicKey,
      tokenAmount_inLamps,
    ));
    const versionedTransaction = new solana.VersionedTransaction(
      new solana.TransactionMessage({
        payerKey: this.wallet.publicKey,
        recentBlockhash: (await web3Connection.getLatestBlockhash()).blockhash,
        instructions,
      }).compileToV0Message()
    );
    versionedTransaction.sign([this.wallet.payer]);
    return versionedTransaction;
  }



  async getSolTransfer_andOpenTokenAccTx(receiverAddr: string | solana.PublicKey, sendToReceiverSol: number, tokenAddr?: solana.PublicKey) {
    if (typeof (receiverAddr) === "string")
      receiverAddr = new solana.PublicKey(receiverAddr);
    if (!tokenAddr)
      tokenAddr = this.tokenAddress
    const sendToReceiverLamps = BigInt((sendToReceiverSol * solana.LAMPORTS_PER_SOL).toFixed());
    const associatedDestinationTokenAddr = await spl.getAssociatedTokenAddress(
      tokenAddr,
      receiverAddr,
    );
    const instructions = [
      solana.ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: c.DEFAULT_uLAMPS_PER_CU,
      }),
      solana.SystemProgram.transfer({
        fromPubkey: this.keypair.publicKey,
        toPubkey: receiverAddr,
        lamports: sendToReceiverLamps,
      }),
      spl.createAssociatedTokenAccountInstruction(
        this.keypair.publicKey,
        associatedDestinationTokenAddr,
        receiverAddr,
        tokenAddr,
      ),
    ];
    const tx = new solana.VersionedTransaction(
      new solana.TransactionMessage({
        payerKey: this.keypair.publicKey,
        recentBlockhash: (await web3Connection.getLatestBlockhash()).blockhash,
        instructions,
      }).compileToV0Message()
    );
    tx.sign([new Wallet(this.keypair).payer]);
    return tx;
  }


  async buyTokenThenSell(
    senderKeypair: solana.Keypair | null,
    fromToken: string,
    toToken: string,
    fromAmountSol: number | string,
    toAmountSol_alreadyInWallet: number | string = 0,
    simulateSwap: boolean = false,
    //priorityMaxLamps: number = c.MAX_LAMPS_RAYDIUM_PRIORITY_FEE,
  ): Promise<{ bought: number, sold: number, gas: number } | null> {
    try {
      const raydiumSwapDirection = 'in';
      if (!senderKeypair)
        senderKeypair = this.keypair;
      const senderWallet = new Wallet(senderKeypair);
      //const gasNeeded_inLamps = priorityMaxLamps;
      if (fromToken == c.WSOL_MINT_ADDR) {
        //fromAmountSol = fromAmountSol - await this.getUnusableSOL_forRaydiumSwap(senderKeypair, gasNeeded_inLamps, 3);
        fromAmountSol = Number(fromAmountSol) - c.RESERVED_BOOSTER_BALANCE_SOL;
      }
      const fromAmount_forBuy1 = Number(fromAmountSol) / 100 * getRandomNumber(25, 75);
      const fromAmount_forBuy2 = Number(fromAmountSol) - fromAmount_forBuy1;

      const { signedTx: signedTx_buy1, amountIn_inSol: amountIn_buy1, amountOutMin_inSol: amountOutMin_buy1
      } = await this.getSwapTransaction(
        senderWallet,
        fromToken,
        toToken,
        fromAmount_forBuy1,
        null,
        //priorityMaxLamps,
      );
      if (!signedTx_buy1) return null;

      const { signedTx: signedTx_buy2, amountIn_inSol: amountIn_buy2, amountOutMin_inSol: amountOutMin_buy2
      } = await this.getSwapTransaction(
        senderWallet,
        fromToken,
        toToken,
        fromAmount_forBuy2,
        null,
        //priorityMaxLamps,
      );
      if (!signedTx_buy2) return null;

      const amountOutMin_calculated =
        Number(amountOutMin_buy1) + Number(amountOutMin_buy2) + Number(toAmountSol_alreadyInWallet);
      //console.log(amountOutMin_calculated);
      //this.printIntendedSwaps(amountIn_buy1, amountIn_buy2, amountOutMin_buy1, amountOutMin_buy2, Number(toAmountSol_alreadyInWallet), amountOutMin_calculated);

      const { signedTx: signedTx_sell, amountIn_inSol: amountIn_sell, amountOutMin_inSol: amountOutMin_sell
      } = await this.getSwapTransaction(
        senderWallet,
        toToken,
        fromToken,
        amountOutMin_calculated,
        null,
        //priorityMaxLamps,
      );
      if (!signedTx_sell) return null;

      if (!signedTx_buy1 || !signedTx_buy2 || !signedTx_sell) {
        console.error(`[${h.getShortAddr(fromToken)}->${h.getShortAddr(toToken)}] failed to get some swap tx(s); will not be performing this tx; amount estimates: ${amountIn_buy1} || ${amountIn_buy2} || ${amountIn_sell} || ${amountOutMin_buy1} || ${amountOutMin_buy2} || ${amountOutMin_sell}`);
        return null;
      }

      const allTxs: solana.VersionedTransaction[] = [signedTx_buy1, signedTx_buy2, signedTx_sell];
      debug(`[${h.getShortAddr(senderKeypair.publicKey)}] sending jito bundle`);
      const result = await makeAndSendJitoBundle(allTxs, senderKeypair);
      debug(`[${h.getShortAddr(senderKeypair.publicKey)}] bundle finished OK? ${result}`);

      if (!result)
        return null;

      return {
        sold: Number(fromAmountSol),
        bought: Number(amountOutMin_sell),
        gas: 0, // deprecated
      }
    } catch (e: any) {
      console.error(`Error while selling then bying token: ${e}`);
      console.trace(e);
      return null;
    }
  };


  async getUnusableSOL_forFullClosure_inLamports(priorityFeeUlampsPerCU = c.DEFAULT_uLAMPS_PER_CU) {
    const reservedSol_inLamps = (c.DEFAULT_SOLANA_FEE_IN_LAMPS +
      + priorityFeeUlampsPerCU / 10 ** 6 * c.DEFAULT_NUM_OF_CU_PER_TX);
    // this doesn't include the jito tip fee. You have to include that manually
    return reservedSol_inLamps;
  }


  async estimateGas(
    fromToken: string,
    toToken: string,
    maxMicroLamports: number,
    raydiumSwapDirection: 'in' | 'out' = 'in',
  ) {

    let amountForSim = 1000;
    if (
      fromToken == c.WSOL_MINT_ADDR && raydiumSwapDirection == 'in' ||
      toToken == c.WSOL_MINT_ADDR && raydiumSwapDirection == 'out'
    ) {
      amountForSim = 0.0001;
    }

    //@ts-ignore
    const { signedTx } = await this.getSwapTransaction(
      null,
      fromToken,
      toToken,
      amountForSim,
      null,
    );

    const simRes = await this.simulateVersionedTransaction(signedTx as solana.VersionedTransaction)

    //console.log('Simulation TX:');
    //console.log(simRes);
    const unitsConsumed = simRes.value.unitsConsumed || 0;
    if (unitsConsumed == 300) {
      console.warn(`Likely an error when simulating transaction to estimate gas(unitsConsumed == 300);
logs:\n${JSON.stringify(simRes.value.logs)}
potential errors:\n${JSON.stringify(simRes.value.err)}
`);
    }
    // this equation is solved by RaydiumSDK on its own
    //(maxMicroLamports == computeUnits * pricePerComputeUnit) 
    // and Solana usually cosumes all gas that was allowed, so
    // below is some SOL gas voodoo, but it looks like
    // the gas fee is actully in lamports already, and not in micro-lamports
    const lampsConsumed = maxMicroLamports;
    //console.log({ unitsConsumed, gasEstimate_lamps: lampsConsumed });
    return lampsConsumed;
  }


  async getSolTransferTx(
    wallet: Wallet | null,
    toAddress: solana.PublicKey,
    amountLamps: number | bigint,
    priorityMicroLampsPerCU: number = c.DEFAULT_uLAMPS_PER_CU,
  ): Promise<solana.VersionedTransaction> {
    if (!wallet)
      wallet = this.wallet;
    if (typeof (amountLamps) == 'number')
      amountLamps = BigInt(amountLamps.toFixed());

    const recentBlockhashForSwap = (await web3Connection.getLatestBlockhash()).blockhash;
    const instructions = [
      solana.ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityMicroLampsPerCU,
      }),
      solana.SystemProgram.transfer({
        fromPubkey: wallet.publicKey,
        toPubkey: toAddress,
        lamports: amountLamps,
      })
    ];
    const messageV0 = new solana.TransactionMessage({
      payerKey: wallet.publicKey,
      recentBlockhash: recentBlockhashForSwap,
      instructions,
    }).compileToV0Message();

    const versionedTx = new solana.VersionedTransaction(messageV0);
    versionedTx.sign([wallet.payer])

    return versionedTx;
  }


  async getSwapTransaction(
    wallet: Wallet | null,
    fromToken: string | solana.PublicKey,
    toToken: string | solana.PublicKey,
    amountFrom_inSol: number | string,
    slippagePercent?: number | null,
  ): Promise<TxBuilderOutput> {
    try {
      if (!wallet)
        wallet = this.wallet;
      if (!slippagePercent)
        slippagePercent = c.SWAP_SLIPPAGE_PERCENT;
      if (typeof (fromToken) !== "string")
        fromToken = fromToken.toBase58();
      if (typeof (toToken) !== "string")
        toToken = toToken.toBase58();

      //console.log(amountFrom_inSol);
      const estimates = await sh.calcAmountOut(fromToken, toToken, amountFrom_inSol, slippagePercent);

      const jupiterSwapResp = await axios({
        method: "POST",
        url: `${c.JUPITER_API_URL}/swap`,
        data: {
          quoteResponse: estimates.rawResponseData,
          userPublicKey: wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          prioritizationFeeLamports: c.SWAP_PRIORITY_FEE_IN_LAMPS,
        },
      });

      const { swapTransaction } = jupiterSwapResp.data;

      // Deserialize the transaction
      const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
      const tx = solana.VersionedTransaction.deserialize(swapTransactionBuf);
      const txUnsigned = solana.VersionedTransaction.deserialize(swapTransactionBuf);

      tx.sign([wallet.payer]);
      return {
        signedTx: tx, unsignedTx: txUnsigned,
        amountIn_inSol: estimates.amountIn_inSol, amountOutMin_inSol: estimates.minAmountOut_inSol
      };

    } catch (e: any) {
      console.error(`Error in RaydiumSwap.getSwapTransaction(): ${String(e)}`);
      console.trace(e);
      return { signedTx: null, unsignedTx: null, amountIn_inSol: null, amountOutMin_inSol: null };
    }
  }


  async simulateVersionedTransaction(tx: solana.VersionedTransaction) {
    const txid = await web3Connection.simulateTransaction(tx)
    return txid
  }


  async getTokenValueInSol(tokenAmountSol: number, tokenAddr?: string | solana.PublicKey) {
    if (tokenAmountSol == 0)
      return 0;
    if (!tokenAddr)
      tokenAddr = this.tokenAddress;
    else if (typeof (tokenAddr) === "string")
      tokenAddr = new solana.PublicKey(tokenAddr);
    try {
      const estimates = await sh.calcAmountOut(tokenAddr.toBase58(), c.WSOL_MINT_ADDR, tokenAmountSol);
      const tokenValueInSol = estimates?.minAmountOut_inSol;
      //console.log(`token value in SOL: ${tokenValueInSol}`);
      return tokenValueInSol || 0;
    } catch (e: any) {
      console.error(`Error in token -> SOL estimation: ${e}`);
      return 0;
    }
  }

  async getSolValueInToken(solAmount_inSol: string | number, tokenAddr?: string | solana.PublicKey,) {
    if (!tokenAddr)
      tokenAddr = this.tokenAddress;
    else if (typeof (tokenAddr) === "string")
      tokenAddr = new solana.PublicKey(tokenAddr);
    try {
      const estimates = await sh.calcAmountOut(c.WSOL_MINT_ADDR, tokenAddr.toBase58(), solAmount_inSol);
      //console.log(estimates);
      const solValueInToken = Number(estimates?.amountOut_inSol);
      //console.log(`SOL value in token: ${solValueInToken}`);
      return solValueInToken || 0;
    } catch (e: any) {
      console.error(`Error in SOL -> token estimation: ${e}`);
      return 0;
    }
  }


  async tryGetRentExemptionFee(wallet: Wallet | null, inLamports = true) {
    try {
      const accountInfo = await web3Connection.getAccountInfo(wallet?.publicKey || this.wallet.publicKey);
      const accountLength = accountInfo?.data.length || 0;
      const rentExemptionLamp = await web3Connection.getMinimumBalanceForRentExemption(accountLength);
      if (inLamports)
        return rentExemptionLamp;
      else
        return rentExemptionLamp / solana.LAMPORTS_PER_SOL;
    } catch (e: any) {
      console.warn(`Failed to get rent-exemption fee; defaulting to 0; error: ${e}`);
      return 0;
    }
  }

  printIntendedSwaps(
    amountIn_buy1: raySDK.TokenAmount | raySDK.CurrencyAmount, amountIn_buy2: raySDK.TokenAmount | raySDK.CurrencyAmount,
    amountOutMin_buy1: raySDK.TokenAmount | raySDK.CurrencyAmount, amountOutMin_buy2: raySDK.TokenAmount | raySDK.CurrencyAmount,
    amountOut_alreadInWallet: number, amountOutMin_calculated: number
  ) {
    //@ts-ignore
    const inDec = amountIn_buy1.currency.decimals || amountIn_buy1.token?.decimals;
    //@ts-ignore
    const outDec = amountOutMin_buy1.currency.decimals || amountOutMin_buy1.token?.decimals;

    console.info(`SOL in: ${amountIn_buy1.toFixed(inDec)} + ${amountIn_buy2.toFixed(inDec)}
Token out: ${amountOutMin_buy1.toFixed(outDec)} + ${amountOutMin_buy2.toFixed(outDec)}
+ ${amountOut_alreadInWallet} already in wallet; total min amount out: ${amountOutMin_calculated}
`);
  }

}

/*
type AccountInfo = {
  pubkey: solana.PublicKey,
  programId: solana.PublicKey,
  accountInfo: raySDK.SplAccountLayout,
}
*/

export type TxBuilderOutput = {
  signedTx: solana.VersionedTransaction | null,
  unsignedTx: solana.VersionedTransaction | null,
  amountIn_inSol: number | null,
  amountOutMin_inSol: number | null,
}

export default RaydiumSwap
