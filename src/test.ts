import * as solana from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import * as raySDK from '@raydium-io/raydium-sdk';

import { envConf } from "./config";
import * as c from "./const";
import * as h from "./helpers";
import * as sh from "./utils/solana_helpers";
import { web3Connection } from '.';
import { makeAndSendJitoBundle } from './utils/jito';
import { bs58 } from '@coral-xyz/anchor/dist/cjs/utils/bytes';
import { jitoTip, waitForJitoTipMetrics } from './utils/jito-tip-deamons';
import { Wallet } from '@coral-xyz/anchor';


const testConf = {
  executeSwap: false, // Send tx when true, simulate tx when false
  useVersionedTransaction: true,
  tokenAAmount: 0.002, // SOL to sell
  wrappedSolAddr: "So11111111111111111111111111111111111111112",
  addrUSDT: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", // USDT addr
  addrSOLP: "BLXw8gGrwHeDMjEit5TN6VF9UqmYcesFhYejekSoX81d", // SOLP
  direction: "in" as "in" | "out", // Swap direction: 'in' or 'out'
  simulate: true,
};


/*
export async function TestHolderBooster() {
  const pk = '3tV2RZRgg6rf1HpdecAhd2a2tSJymcdkxbUHc8c7Q7tgit1kmS9PUyeMhA9JAbxpz6WAgfX7zxdNR8vVAB3KGEGt';
  const booster = new Booster('holders', pk, swapConfig.tokenBAddress);
  await sleep(2000);
  booster.start();
}

export async function TestVolumeBooster() {
  const booster = new Booster('volume', envConf.TEST_WALLET_SECRET_KEY, swapConfig.tokenBAddress);
  await sleep(2000);
  booster.start();
}


export async function TestCalcAmounts() {
  const keypair = h.keypairFrom(envConf.TEST_WALLET_SECRET_KEY);
  console.log(`Using wallet ${keypair.publicKey.toBase58()} for tests`);
  const tokenAddr = testConf.addrUSDT;
  const raySwap = new RaydiumSwap(keypair, new solana.PublicKey(tokenAddr));
  const builderOutput = await raySwap.getSwapTransaction(null, c.WSOL_MINT_ADDR, tokenAddr, 0.0001);
  console.log(builderOutput);
  //console.log(`Sending Jito bundle`);
  //const result = await makeAndSendJitoBundle([builderOutput.signedTx!], keypair);
  //console.log(`Jito result: ${result}`);
}


export async function TestAirdrop() {
  const receiverKP = solana.Keypair.generate();
  console.log(`Receiver addr: ${receiverKP.publicKey.toBase58()}`);
  const senderKP = h.keypairFrom(envConf.TEST_WALLET_SECRET_KEY);
  const raySwap = new RaydiumSwap(senderKP, new solana.PublicKey(testConf.addrSOLP));
  //await raySwap.sendTokensTo(testConf.tokenAAddress, 5 * 10**6, knownReceiver);
  const tx = await raySwap.getTokenTransferTx_openAccIfNeeded(testConf.addrSOLP, 5 * 10 ** 6, receiverKP.publicKey);
  const result = await makeAndSendJitoBundle([tx], senderKP);
  console.log(`Jito result: ${result}`);
}

export async function TestMisc() {
  const raySwap = new RaydiumSwap(solana.Keypair.generate(), new solana.PublicKey(testConf.addrSOLP));
  await raySwap.getSolValueInToken(0.00001, testConf.addrSOLP);

}



const receiverPK = '3ry5ijSHeGDRreRTgNdwpFX8U3qhhLHGzvpyfv3AVGzaNDfHpKaMvPQ332MZQiePfGPUP3Rah1i2MpCMNoc61WfK';
export async function TestRankBoostWorkflow() {
  await waitForJitoTipMetrics();
  const tokenAddr = testConf.addrSOLP;
  const masterKP = h.keypairFrom(envConf.TEST_WALLET_SECRET_KEY);
  //const receiverKP = solana.Keypair.generate();
  const slaveKP = h.keypairFrom(receiverPK);
  console.log(`Slave: ${slaveKP.publicKey.toBase58()} ${bs58.encode(slaveKP.secretKey)}`);
  const tip = jitoTip.chanceOf95;
  const raySwap = new RaydiumSwap(masterKP, new solana.PublicKey(tokenAddr));

  const solToSendInitially_inLamps = 0.0043 * solana.LAMPORTS_PER_SOL + 2 * jitoTip.chanceOf95;
  const inboundSolTransTx = await raySwap.getSolTransferTx(null, slaveKP.publicKey, solToSendInitially_inLamps);
  console.log(`sending out initial SOL to slave`);
  const result1 = await makeAndSendJitoBundle([inboundSolTransTx], masterKP, tip);
  console.log(`Sent OK? ${result1}`);

  const { signedTx: swapTx } = await raySwap.getSwapTransaction(
    new Wallet(slaveKP), raySDK.WSOL.mint, tokenAddr, 0.00001, 50);
  if (!swapTx) { console.log(`failed to build swap TX`); return; }
  console.log(`Buying a bit of token...`);
  const resultBuy = await makeAndSendJitoBundle([swapTx], slaveKP, tip);
  console.log(`Bought OK? ${resultBuy}`);

  const tokenAcc_slave = await sh.getTokenAcc(tokenAddr, slaveKP.publicKey);
  const quoteBalances = await sh.getTokenAccBalance(tokenAcc_slave?.pubkey!);
  const tokenSol = quoteBalances.inLamps;
  const tokenLamps = quoteBalances.inSol;
  console.log({ tokenSol, tokenLamps });
  const tokenTransferInstrs = await sh.getInstr_transferToken_openReceiverAccIfNeeded(
    slaveKP,
    masterKP.publicKey,
    tokenAddr,
    null,
    tokenLamps,
  );
  const closeTokenAccInstr = spl.createCloseAccountInstruction(
    tokenAcc_slave?.pubkey!,
    masterKP.publicKey,
    slaveKP.publicKey,
  );
  const balanceBefore_inLamps = await sh.getSolBalance(slaveKP.publicKey, true);
  const txInstructions = [...tokenTransferInstrs, closeTokenAccInstr]
  const tx2 = new solana.VersionedTransaction(
    new solana.TransactionMessage({
      payerKey: slaveKP.publicKey,
      recentBlockhash: (await web3Connection.getLatestBlockhash()).blockhash,
      instructions: txInstructions,
    }).compileToV0Message()
  );
  tx2.sign([slaveKP]);

  console.log(`Sending token out & closing account`);
  const result2 = await makeAndSendJitoBundle([tx2], slaveKP, tip);
  console.log(`Sent OK?: ${result2}`);
  const balanceAfter_inLamps = await sh.getSolBalance(slaveKP.publicKey, true);
  console.log({ balanceBefore_inLamps, balanceAfter_inLamps });
  const jitoTipExpense = c.DEFAULT_SOLANA_FEE_IN_LAMPS + tip;
  const gasExpense_inLamps = c.DEFAULT_SOLANA_FEE_IN_LAMPS + jitoTipExpense;
  const solToTransfer_inLamps = balanceAfter_inLamps - gasExpense_inLamps;
  //const solToTransfer_inLamps = balanceAfter_inLamps - c.DEFAULT_SOLANA_FEE_IN_LAMPS;

  const solTransferInstr = [
    solana.SystemProgram.transfer({
      fromPubkey: slaveKP.publicKey,
      toPubkey: masterKP.publicKey,
      lamports: solToTransfer_inLamps,
    })
  ];
  const tx3 = new solana.VersionedTransaction(
    new solana.TransactionMessage({
      payerKey: slaveKP.publicKey,
      recentBlockhash: (await web3Connection.getLatestBlockhash()).blockhash,
      instructions: solTransferInstr,
    }).compileToV0Message()
  );
  tx3.sign([slaveKP]);

  console.log(`Sending all remaining SOL to mater...`);
  const txHash = await web3Connection.sendTransaction(tx3, {
    maxRetries: 3,
    skipPreflight: false,
  })
  //const result3 = await makeAndSendJitoBundle([tx3], slaveKP, tip);
  console.log(`Sent SOL OK? ${txHash}`);
}


export function PkToAddress() {
  const pk = '5t5dfa6oV7DDzBvbasDJoNDjr1Q6KLGLAvSMgsscjuZxEfsz5qxXZTJWWQMx4UR7e6zbgCdbyDYyUrdJeTsFFFw4';
  const kp = h.keypairFrom(pk);
  console.log(`Wallet addr: ${kp.publicKey.toBase58()}`);
}

*/