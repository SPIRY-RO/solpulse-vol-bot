import * as solana from '@solana/web3.js';
import * as raySDK from '@raydium-io/raydium-sdk';
import * as spl from '@solana/spl-token';
import { Wallet } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import axios from 'axios';

import { envConf } from '../config';
import * as h from '../helpers';
import * as c from '../const';
import { web3Connection } from '..';



export async function calcAmountOut(
  fromToken: string | solana.PublicKey,
  toToken: string | solana.PublicKey,
  tokenAmountIn_inSol: number | string,
  slippagePercent?: number | null,
) {
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

    const decimals = {in: 9, out: 9}
    if (fromToken !== c.WSOL_MINT_ADDR)
      decimals.in = await getTokenDecimals(fromToken);
    if (toToken !== c.WSOL_MINT_ADDR)
      decimals.out = await getTokenDecimals(toToken);

    const amountIn_inSol = Number((Number(inAmount || 0) / 10**decimals.in).toFixed(decimals.in));
    const amountOut_inSol = Number((Number(outAmount || 0) / 10**decimals.out).toFixed(decimals.out));
    const minAmountOut_inSol = Number((Number(otherAmountThreshold || 0) / 10**decimals.out).toFixed(decimals.out));
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
    console.trace(e);
    h.debug(`Returning empty estimates`);
    return { ...emptyEstimates };
  }
}
const emptyEstimates = {
  amountIn_inSol: 0,
  amountOut_inSol: 0,
  minAmountOut_inSol: 0,
  priceImpact: 0,
  rawResponseData: null,
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
  for (const acc of await getTokenAccsAll(walletAddr)) {
    if (acc.accountInfo.mint.equals(tokenAddr)) {
      return acc;
    }
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
      uiAmount: null
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
    console.error(`Error while getting wallet balance: ${e}`);
    return 0;
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

  if ((!tokenAmount_inSol && !tokenAmount_inLamps) || (tokenAmount_inSol && tokenAmount_inLamps)) {
    throw new SyntaxError(`You need to specify token amount either in solana or lamports`);
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


/* Full transaction functions */

export async function sendSol(
  senderKeypair: solana.Keypair,
  receiverAddr: solana.PublicKey,
  amountLamps: string | number | bigint | null,
) {
  amountLamps = BigInt(amountLamps as string);
  try {
    const solTransferInstr = [
      solana.SystemProgram.transfer({
        fromPubkey: senderKeypair.publicKey,
        toPubkey: receiverAddr,
        lamports: amountLamps,
      })
    ];
    const tx3 = new solana.VersionedTransaction(
      new solana.TransactionMessage({
        payerKey: senderKeypair.publicKey,
        recentBlockhash: (await web3Connection.getLatestBlockhash()).blockhash,
        instructions: solTransferInstr,
      }).compileToV0Message()
    );
    tx3.sign([senderKeypair]);

    h.debug(`[${h.getShortAddr(senderKeypair.publicKey)}] sending ${amountLamps.toString()} lamports of SOL to ${receiverAddr.toBase58()}`);
    const txHash = await web3Connection.sendTransaction(tx3, {
      maxRetries: 5,
      skipPreflight: false,
    })
    h.debug(`[${h.getShortAddr(senderKeypair.publicKey)}] tx submitted: ${txHash}`);
    return txHash;
  } catch (e: any) {
    console.error(`[${h.getShortAddr(senderKeypair.publicKey)}] error while sending out SOL: ${e}`);
    console.trace(e);
    return null;
  }
}