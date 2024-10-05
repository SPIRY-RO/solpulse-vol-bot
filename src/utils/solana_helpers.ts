import * as solana from '@solana/web3.js';
import * as raySDK from '@raydium-io/raydium-sdk';
import * as spl from '@solana/spl-token';
import bs58 from 'bs58';
import axios from 'axios';

import { web3Connection } from '..';
import { envConf } from '../config';
import * as h from '../helpers';
import * as c from '../const';
import { makeAndSendJitoBundle } from './jito';



/* Auto-transacting functions */

export async function sendSol(
  fromKeypair: solana.Keypair,
  toAddr: string | solana.PublicKey,
  amountLamps: string | number | bigint | null,
) {
  if (typeof toAddr === "string")
    toAddr = new solana.PublicKey(toAddr);
  amountLamps = BigInt(parseInt(amountLamps as string));

  const tag = `[sol:${h.getShortAddr(fromKeypair.publicKey)}->${h.getShortAddr(toAddr)}]`;

  let currentAttempt = 0;
  const maxAttempts = 10;
  while (currentAttempt < maxAttempts) {
    if (currentAttempt != 0) {
      const currentBalance = await getSolBalance(fromKeypair.publicKey, true);
      if (currentBalance && currentBalance < amountLamps + BigInt(c.DEFAULT_SOLANA_FEE_IN_LAMPS)) {
        const newAmount = BigInt(currentBalance - c.DEFAULT_SOLANA_FEE_IN_LAMPS);
        h.debug(`${tag} trying to send more SOL than possible(${amountLamps}); sending all available SOL instead(${newAmount})`);
        amountLamps = newAmount;
      }
    }

    const transaction = new solana.Transaction().add(
      solana.SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey: toAddr,
        lamports: amountLamps,
      })
    );

    try {

      h.debug(`${tag} attempt ${currentAttempt + 1}; amount ${amountLamps}`);
      const txHash = await solana.sendAndConfirmTransaction(web3Connection, transaction, [fromKeypair]);
      h.debug(`${tag} tx sent, awaiting confirmation...`);

      const confirmation = await web3Connection.getSignatureStatus(txHash);
      if (confirmation?.value?.err) {
        throw new Error(`Error: ${tag} tx failed: ${JSON.stringify(confirmation.value?.err)}`);
      }

      h.debug(`${tag} tx confirmed! hash: ${txHash}`);
      return txHash;
    } catch (error: any) {
      currentAttempt += 1;
      console.warn(`${tag} attempt ${currentAttempt}, error: ${error.message}`);

      if (currentAttempt >= maxAttempts) {
        console.error(`${tag} max attempts reached; tx failed`);
        return null;
      }
      await h.sleep(1000);
    }
  }
}


export async function sendAllSol(fromKeypair: solana.Keypair, toAddr: string | solana.PublicKey) {
  if (typeof toAddr === "string")
    toAddr = new solana.PublicKey(toAddr);
  const balance = await getSolBalance(fromKeypair.publicKey, true) || 0;
  const amountInLamps = balance - c.DEFAULT_SOLANA_FEE_IN_LAMPS;

  const txHash = await sendSol(fromKeypair, toAddr, amountInLamps);
  return txHash;
}


export async function sendSol_waitForBalChange(
  senderKeypair: solana.Keypair,
  receiverAddr: solana.PublicKey,
  amountLamps: string | number | bigint | null,
  checkReceiverBalance = false,
): Promise<boolean> {
  const balanceCheckTimeout = 90 * 1000;
  const tag = `[${h.getShortAddr(senderKeypair.publicKey)}->${h.getShortAddr(receiverAddr)}]`;
  let checkBalanceOfAddr = senderKeypair.publicKey;
  if (checkReceiverBalance)
    checkBalanceOfAddr = receiverAddr;
  let balance = await getSolBalance(checkBalanceOfAddr, true);
  if (balance === null) {
    h.debug(`${tag} failed to fetch initial balance; aborting SOL transfer`);
    return false;
  }

  const txHash = await sendSol(senderKeypair, receiverAddr, amountLamps);
  if (!txHash) {
    h.debug(`${tag} failed to submit SOL transfer tx`);
    return false;
  }
  const { success } = await waitForBalanceChange(
    balance, checkBalanceOfAddr, true, balanceCheckTimeout);
  if (success) {
    h.debug(`${tag} tx succeeded; hash: ${txHash.toString()}`);
    return true;
  } else {
    console.error(`${tag} no balance change registered; assuming the tx has failed`);
    return false;
  }
}


export async function sendAllSol_waitForBalChange(
  senderKeypair: solana.Keypair,
  receiverAddr: solana.PublicKey,
  checkReceiverBalance = false,
): Promise<boolean> {
  const balanceCheckTimeout = 90 * 1000;
  const tag = `[${h.getShortAddr(senderKeypair.publicKey)}->${h.getShortAddr(receiverAddr)}]`;
  let checkBalanceOfAddr = senderKeypair.publicKey;
  if (checkReceiverBalance)
    checkBalanceOfAddr = receiverAddr;
  let balance = await getSolBalance(checkBalanceOfAddr, true);
  if (balance === null) {
    h.debug(`${tag} failed to fetch initial balance; aborting SOL transfer`);
    return false;
  }

  const txHash = await sendAllSol(senderKeypair, receiverAddr);
  if (!txHash) {
    h.debug(`${tag} failed to submit SOL transfer tx`);
    return false;
  }
  const { success } = await waitForBalanceChange(
    balance, checkBalanceOfAddr, true, balanceCheckTimeout);
  if (success) {
    h.debug(`${tag} tx succeeded; hash: ${txHash.toString()}`);
    return true;
  } else {
    console.error(`${tag} no balance change registered; assuming the tx has failed`);
    return false;
  }
}


export async function ensureTokenAccountExists(keypair: solana.Keypair, tokenAddr: solana.PublicKey) {
  const tag = `[${h.getShortAddr(keypair.publicKey)}]`
  h.debug(`${tag} making a small swap TX to ensure that token account is open...`);
  const builtTx = await getSwapTx(keypair, c.WSOL_MINT_ADDR, tokenAddr, 0.00001);
  if (!builtTx) {
    h.debug(`${tag} can't build swap TX when trying to open token account; aborting`);
    return false;
  }
  const success = await makeAndSendJitoBundle([builtTx.tx], keypair);
  if (!success) {
    h.debug(`${tag} initial swap TX that was supposed to ensure we've an open token account failed; aborting`);
    return false;
  }
  h.debug(`${tag} swap TX succeeded; token account is now definitely open`);
  return true;
}


/* Transaction Builders */

export type SwapTxBuilderOutput = {
  tx: solana.VersionedTransaction,
  estimates: JupiterEstimates,
}

export async function getSwapTx(
  keypair: solana.Keypair,
  fromToken: string | solana.PublicKey,
  toToken: string | solana.PublicKey,
  amountFrom_inSol: number | string,
  slippagePercent?: number | null,
): Promise<SwapTxBuilderOutput | null> {
  try {
    if (!slippagePercent)
      slippagePercent = c.SWAP_SLIPPAGE_PERCENT;
    if (typeof (fromToken) !== "string")
      fromToken = fromToken.toBase58();
    if (typeof (toToken) !== "string")
      toToken = toToken.toBase58();

    h.debug(`[${h.getShortAddr(fromToken)}->${h.getShortAddr(toToken)}] getting estimates`);
    const estimates = await calcAmountOut(fromToken, toToken, amountFrom_inSol, slippagePercent);
    if (!estimates.rawResponseData) {
      console.error(`[${h.getShortAddr(fromToken)}->${h.getShortAddr(toToken)}] failed to get quote; not transacting`);
      return null;
    }

    const jupiterSwapResp = await axios({
      method: "POST",
      url: `${c.JUPITER_API_URL}/swap`,
      data: {
        quoteResponse: estimates.rawResponseData,
        userPublicKey: keypair.publicKey.toString(),
        wrapAndUnwrapSol: true,
        prioritizationFeeLamports: c.SWAP_PRIORITY_FEE_IN_LAMPS,
      },
    });
    const { swapTransaction } = jupiterSwapResp.data;
    // Deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");
    const tx = solana.VersionedTransaction.deserialize(swapTransactionBuf);
    tx.sign([keypair]);
    return { tx, estimates };

  } catch (e: any) {
    h.debug(`[${h.getShortAddr(fromToken)}->${h.getShortAddr(toToken)}] error while building swap tx: ${e}`);
    if (e.response) {
      // The request was made and the server responded with a non-2xx status code
      console.error(e.response.data);
      console.error(e.response.status);
      console.error(e.response.headers);
    } else {
      console.trace(e);
    }
    return null;
  }
}



/* Instruction Builders */

export async function getInstr_transferToken_openReceiverAccIfNeeded(
  senderKeypair: solana.Keypair,
  receiverAddr: solana.PublicKey,
  tokenAddr: string | solana.PublicKey,
  tokenAmount_inSol: string | number | null,
  tokenAmount_inLamps?: string | number | bigint | null,
) {
  if (typeof (tokenAddr) === "string")
    tokenAddr = new solana.PublicKey(tokenAddr);
  const tag = `[token:${h.getShortAddr(senderKeypair.publicKey)}->${h.getShortAddr(receiverAddr)}]`;
  if ((!tokenAmount_inSol && !tokenAmount_inLamps) || (tokenAmount_inSol && tokenAmount_inLamps)) {
    throw new SyntaxError(`${tag} You need to specify token amount either in solana or lamports`);
  }
  if (tokenAmount_inSol)
    tokenAmount_inLamps = await tokenFromSolToLamps(tokenAmount_inSol, tokenAddr);
  else
    tokenAmount_inLamps = BigInt(tokenAmount_inLamps as string);

  const existingSenderTokenAcc = await spl.getOrCreateAssociatedTokenAccount(web3Connection, senderKeypair, tokenAddr, senderKeypair.publicKey);
  const associatedDestinationTokenAddr = await spl.getAssociatedTokenAddress(
    tokenAddr,
    receiverAddr,
  );
  const receiverTokenAcc = await getTokenAcc(tokenAddr, receiverAddr);

  const instructions: solana.TransactionInstruction[] = [];
  if (!receiverTokenAcc?.pubkey) {
    instructions.push(spl.createAssociatedTokenAccountInstruction(
      senderKeypair.publicKey,
      associatedDestinationTokenAddr,
      receiverAddr,
      tokenAddr,
    ));
  }
  instructions.push(spl.createTransferInstruction(
    existingSenderTokenAcc.address,
    associatedDestinationTokenAddr,
    senderKeypair.publicKey,
    tokenAmount_inLamps,
  ));
  h.debug(`${tag} made instructions to send ${tokenAmount_inSol || `${tokenAmount_inLamps} lamports of`} tokens${(!receiverTokenAcc?.pubkey ? ` & open receiver token acc` : '')}`);
  return instructions;
}


export async function getInstr_closeSenderAcc(
  senderKeypair: solana.Keypair,
  sendFreedSolToAddr: solana.PublicKey,
  tokenAddr: string | solana.PublicKey,
) {
  if (typeof (tokenAddr) === "string")
    tokenAddr = new solana.PublicKey(tokenAddr);
  const senderTokenAcc = await getTokenAcc(tokenAddr, senderKeypair.publicKey);
  //const senderTokenAcc = await spl.getOrCreateAssociatedTokenAccount(web3Connection, senderKeypair, tokenAddr, senderKeypair.publicKey);
  if (!senderTokenAcc) {
    console.warn(`[${h.getShortAddr(senderKeypair.publicKey)}] doesn't have token acc, but tried closing it; token: ${h.getShortAddr(tokenAddr)}`);
    return null;
  }

  const closeTokenAccInstr = spl.createCloseAccountInstruction(
    //senderTokenAcc.address,
    senderTokenAcc.pubkey,
    sendFreedSolToAddr,
    senderKeypair.publicKey,
  );
  return [closeTokenAccInstr];
}




export async function calcAmountOut(
  fromToken: string | solana.PublicKey,
  toToken: string | solana.PublicKey,
  tokenAmountIn_inSol: number | string,
  slippagePercent?: number | null,
): Promise<JupiterEstimates> {
  if (!slippagePercent)
    slippagePercent = c.SWAP_SLIPPAGE_PERCENT;
  if (typeof (fromToken) !== "string")
    fromToken = fromToken.toBase58();
  if (typeof (toToken) !== "string")
    toToken = toToken.toBase58();

  const tokenAmountIn_inLamps = await tokenFromSolToLamps(tokenAmountIn_inSol, fromToken);
  const conversionFailed = (tokenAmountIn_inSol && !tokenAmountIn_inLamps);
  if (conversionFailed) {
    h.debug(`[${h.getShortAddr(fromToken)}->${h.getShortAddr(toToken)}] solana to lamports conversion for this token failed`);
    h.debug(`Returning empty estimates`);
    return { ...emptyEstimates };
  }

  try {
    const response = await axios({
      method: "GET",
      url: `${c.JUPITER_API_URL}/quote`,
      params: {
        inputMint: fromToken,
        outputMint: toToken,
        amount: tokenAmountIn_inLamps,
        slippageBps: slippagePercent * 100,
      },
    });
    if (response.status !== 200) {
      h.debug(`[${h.getShortAddr(fromToken)}->${h.getShortAddr(toToken)}] got quote response with status != 200`);
      h.debug(response);
      h.debug(`Returning empty estimates`);
      return { ...emptyEstimates };
    }

    const { inAmount, outAmount, otherAmountThreshold, priceImpactPct } = response.data;

    const decimals = { in: 9, out: 9 }
    if (fromToken !== c.WSOL_MINT_ADDR)
      decimals.in = await getTokenDecimals(fromToken);
    if (toToken !== c.WSOL_MINT_ADDR)
      decimals.out = await getTokenDecimals(toToken);

    const amountIn_inSol = Number((Number(inAmount || 0) / 10 ** decimals.in).toFixed(decimals.in));
    const amountOut_inSol = Number((Number(outAmount || 0) / 10 ** decimals.out).toFixed(decimals.out));
    const minAmountOut_inSol = Number((Number(otherAmountThreshold || 0) / 10 ** decimals.out).toFixed(decimals.out));
    /*
    h.debug(`Jupiter quote:`);
    h.debug(`Token in: ${fromToken}`);
    h.debug(`Token out: ${toToken}`);
    h.debug(`Amount in: ${amountIn_inSol}`);
    h.debug(`Amount out: ${amountOut_inSol}`);
    h.debug(`Amount out min: ${minAmountOut_inSol}`);
    */
    return {
      amountIn_inSol,
      amountOut_inSol,
      minAmountOut_inSol,
      priceImpact: priceImpactPct || 0,
      rawResponseData: response?.data || null,
    }
  } catch (e: any) {
    console.error(`[${h.getShortAddr(fromToken)}->${h.getShortAddr(toToken)}] error when fetching quote: ${e}`);
    if (e.response) {
      // The request was made and the server responded with a non-2xx status code
      console.error(e.response.data);
      console.error(e.response.status);
      console.error(e.response.headers);
    } else {
      console.trace(e);
    }
    h.debug(`Returning empty estimates`);
    return { ...emptyEstimates };
  }
}
export type JupiterEstimates = {
  amountIn_inSol: number,
  amountOut_inSol: number,
  minAmountOut_inSol: number,
  priceImpact: number,
  rawResponseData: any,
}
const emptyEstimates = {
  amountIn_inSol: 0,
  amountOut_inSol: 0,
  minAmountOut_inSol: 0,
  priceImpact: 0,
  rawResponseData: null,
}


export async function waitForBalanceChange(
  initialBalance: number, address: string | solana.PublicKey, inLamps = false, timeoutOverride?: number,
) {
  let timeout = timeoutOverride || 45 * 1000;
  if (typeof (address) === "string") {
    address = new solana.PublicKey(address);
  }
  let currentBalance = initialBalance;
  const startedAt = Date.now();
  while (initialBalance == currentBalance) {
    const newBalance = await getSolBalance(address, inLamps);
    if (newBalance !== null)
      currentBalance = newBalance;
    else
      h.debug(`[${h.getShortAddr(address)}] received empty(${newBalance}) balance; ignoring`);
    await h.sleep(1000);
    if (Date.now() > startedAt + timeout) {
      h.debug(`[${h.getShortAddr(address)}] balance check timed out after ${timeout / 1000}s`);
      if (!inLamps)
        currentBalance = Number(currentBalance);
      return { balance: currentBalance, success: false };
    }
  }
  h.debug(`[${h.getShortAddr(address)}] balance changed: ${initialBalance} -> ${currentBalance}`);
  if (!inLamps)
    currentBalance = Number(currentBalance);
  return { balance: (inLamps ? currentBalance : Number(currentBalance)), success: true }
}


export async function tokenFromSolToLamps(tokenAmount: number | string, tokenAddr: string | solana.PublicKey) {
  let tokenDecimals = 0;
  if (typeof (tokenAddr) === "string") {
    tokenAddr = new solana.PublicKey(tokenAddr);
  }
  tokenDecimals = await getTokenDecimals(tokenAddr);
  if (!tokenDecimals)
    return 0;
  const figure = Number((Number(tokenAmount) * 10 ** tokenDecimals).toFixed());
  //h.debug(`SOL -> lamps: ${tokenAmount} * 10**${tokenDecimals} -> ${figure}`);
  return figure;
}


export async function getTokenDecimals(tokenAddr: string | solana.PublicKey) {
  if (typeof (tokenAddr) === "string")
    tokenAddr = new solana.PublicKey(tokenAddr);
  let retries = 3;
  while (retries > 0) {
    try {
      const result = await web3Connection.getTokenSupply(tokenAddr);
      //console.log({tokenAddr: tokenAddr.toBase58(), decimals: result.value.decimals});
      return result.value.decimals;
    } catch (e: any) {
      console.warn(`[${h.getShortAddr(tokenAddr)}] failed to get token decimals with error: ${e}`);
    }
    retries -= 1;
  }
  console.error(`[${h.getShortAddr(tokenAddr)}] failed to get token decimals; exhausted all retries`);
  return 0;
}


export async function canTokenBeTraded(tokenAddr: string | solana.PublicKey) {
  if (typeof (tokenAddr) === "string")
    tokenAddr = new solana.PublicKey(tokenAddr);
  const estimates = await calcAmountOut(raySDK.WSOL.mint, tokenAddr, 0.1);
  if (!estimates || !estimates.rawResponseData || !estimates.amountIn_inSol || !estimates.amountOut_inSol) {
    h.debug(`[${h.getShortAddr(tokenAddr)}] got no estimates; assuming it can't be traded`);
    return false;
  } else {
    h.debug(`[${h.getShortAddr(tokenAddr)}] got estimates, so can be traded`);
    return true;
  }
}


export async function getTokenAcc(tokenAddr: string | solana.PublicKey, walletAddr: string | solana.PublicKey) {
  if (typeof (tokenAddr) === "string")
    tokenAddr = new solana.PublicKey(tokenAddr);
  if (typeof (walletAddr) === "string")
    walletAddr = new solana.PublicKey(walletAddr);
  try {
    for (const acc of await getTokenAccsAll(walletAddr)) {
      if (acc.accountInfo?.mint?.equals(tokenAddr)) {
        return acc;
      }
    }
  } catch (e: any) {
    h.debug(`[${h.getShortAddr(walletAddr)}] failed to get token acc addr; token: ${tokenAddr.toBase58()}; error: ${e}`);
    return null;
  }
  return null;
  /* Alternative approach; throws an error if the account doesn't exist
  const senderTokenAddr = await spl.getAssociatedTokenAddress(tokenAddr, this.keypair.publicKey, true);
  senderTokenAccount = (await spl.getAccount(web3, senderTokenAddr)).address;
  */
}

export async function getTokenAccsAll(forWallet: solana.PublicKey) {
  try {
    const walletTokenAccounts = await web3Connection.getTokenAccountsByOwner(forWallet, {
      programId: raySDK.TOKEN_PROGRAM_ID,
    });
    return walletTokenAccounts.value.map((i) => ({
      pubkey: i.pubkey,
      programId: i.account.owner,
      accountInfo: raySDK.SPL_ACCOUNT_LAYOUT.decode(i.account.data),
    }));
  } catch (e: any) {
    console.error(`Error when fetching token accounts for wallet ${forWallet?.toBase58()}`)
    return [];
  }
}

export async function getTokenAccBalance(tokenAccount: solana.PublicKey): Promise<solana.TokenAmount> {
  if (typeof (tokenAccount) === "string")
    tokenAccount = new solana.PublicKey(tokenAccount);
  try {
    const balance = await web3Connection.getTokenAccountBalance(tokenAccount);
    return balance.value;
  } catch (e: any) {
    return {
      amount: '',
      decimals: 0,
      uiAmount: 0,
    }
  }
}

export async function getSolBalance(address: string | solana.PublicKey, inLamps = false) {
  if (typeof (address) === "string")
    address = new solana.PublicKey(address);
  try {
    const balanceLamps = await web3Connection.getBalance(address);
    if (inLamps)
      return balanceLamps;
    return balanceLamps / solana.LAMPORTS_PER_SOL;
  } catch (e: any) {
    console.error(`[${h.getShortAddr(address)}] error while getting balance: ${e}`);
    return null;
  }
}



export async function getTokenValueInSol(tokenAmountSol: number, tokenAddr: string | solana.PublicKey) {
  if (tokenAmountSol == 0)
    return 0;
  if (typeof (tokenAddr) === "string")
    tokenAddr = new solana.PublicKey(tokenAddr);
  try {
    const estimates = await calcAmountOut(tokenAddr.toBase58(), c.WSOL_MINT_ADDR, tokenAmountSol);
    const tokenValueInSol = estimates?.minAmountOut_inSol;
    //console.log(`token value in SOL: ${tokenValueInSol}`);
    return tokenValueInSol || 0;
  } catch (e: any) {
    console.error(`Error in token -> SOL estimation: ${e}`);
    return 0;
  }
}

export async function getSolValueInToken(solAmount_inSol: string | number, tokenAddr: string | solana.PublicKey) {
  if (typeof (tokenAddr) === "string")
    tokenAddr = new solana.PublicKey(tokenAddr);
  try {
    const estimates = await calcAmountOut(c.WSOL_MINT_ADDR, tokenAddr.toBase58(), solAmount_inSol);
    //console.log(estimates);
    const solValueInToken = Number(estimates?.amountOut_inSol);
    //console.log(`SOL value in token: ${solValueInToken}`);
    return solValueInToken || 0;
  } catch (e: any) {
    console.error(`Error in SOL -> token estimation: ${e}`);
    return 0;
  }
}


export async function tryGetRentExemptionFee(address: solana.PublicKey | string, inLamports = false) {
  if (typeof (address) === "string")
    address = new solana.PublicKey(address);
  try {
    const accountInfo = await web3Connection.getAccountInfo(address);
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
