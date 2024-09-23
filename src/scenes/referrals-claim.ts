import * as solana from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';
import { Context, Scenes } from "telegraf";

import { prisma, telegraf, userManager, web3Connection } from "..";
import { DEF_MESSAGE_OPTS, envConf } from "../config";
import {
  answerCbQuerySafe, cancelWizardGeneric, debug, getNewRandPK, getNewRandWallet, isSolAddrValid, keypairFrom,
  tryEditOrReply, tryReply, walletFrom
} from "../helpers";
import Booster from "../classes/Booster";
import { DEFAULT_NUM_OF_CU_PER_TX, DEFAULT_SOLANA_FEE_IN_LAMPS, DEFAULT_uLAMPS_PER_CU, MIN_REF_CLAIM_AMOUNT_SOL, NEW_BOOSTER_MIN_ACCEPTED_BALANCE_SOL } from "../const";
import RaydiumSwap from '../classes/RaydiumSwap';
import { makeAndSendJitoBundle } from '../utils/jito';
import { jitoTip } from '../utils/jito-tip-deamons';


export const wizardReferralsClaim_name = "wizard-referrals-claim";

export const wizardReferralsClaim = new Scenes.WizardScene(
  wizardReferralsClaim_name,
  firstStep,
  finalStep,
);
wizardReferralsClaim.command('cancel', cancelWizardGeneric);


async function firstStep(ctx: any) {
  answerCbQuerySafe(ctx);
  const senderID_str = String(ctx.from?.id);
  const user = await userManager.getUser(senderID_str);
  if (!user) {
    await tryReply(ctx, `You don't have any referrals`);
    return ctx.scene.leave();
  } else if (user.unclaimedRefRewards < MIN_REF_CLAIM_AMOUNT_SOL) {
    await tryReply(ctx, `You need to have at least ${MIN_REF_CLAIM_AMOUNT_SOL} SOL of rewards to be able to claim them`);
    return ctx.scene.leave();
  }

  const text = `To claim your referrals, send me your Solana address below, and I will send your reward in SOL to it`;
  await tryReply(ctx, text, DEF_MESSAGE_OPTS);
  return ctx.wizard.next();
}


async function finalStep(ctx: any) {
  const textInput = ctx.message?.text;
  const cbInput = ctx.callbackQuery?.data;
  const senderID_str = String(ctx.from?.id);

  if (!isSolAddrValid(textInput)) {
    await tryReply(ctx, `Invalid address supplied; ${textInput}; try again with another address or do /cancel`);
    return;
  }
  tryReply(ctx, `Received your address. Sending your SOL to it now...\n(this can take a few minutes; we'll notify you when it's done)`);

  const user = await userManager.getUser(senderID_str);
  const destinationAddr = new solana.PublicKey(textInput);
  const jitoFeeLamps = jitoTip.chanceOf95;
  const priorityFeePerCU_uLamps = DEFAULT_uLAMPS_PER_CU;
  const priorityFeeTotalLamps = (priorityFeePerCU_uLamps * DEFAULT_NUM_OF_CU_PER_TX) / 10 ** 6;
  const refFeesWallet = walletFrom(envConf.REFERRAL_FEE_WALLET_PK);
  const refFeesKeypair = keypairFrom(envConf.REFERRAL_FEE_WALLET_PK);
  const grossAmountLamps = user!.unclaimedRefRewards * solana.LAMPORTS_PER_SOL;
  const claimableAmountLamps = grossAmountLamps - (DEFAULT_SOLANA_FEE_IN_LAMPS + priorityFeeTotalLamps + jitoFeeLamps);
  debug(`Attempting to send ${claimableAmountLamps / solana.LAMPORTS_PER_SOL} of SOL to user's ${destinationAddr.toBase58()} wallet`);
  try {
    const recentBlockhashForSwap = (await web3Connection.getLatestBlockhash()).blockhash;
    const instructions = [
      solana.ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFeePerCU_uLamps,
      }),
      solana.SystemProgram.transfer({
        fromPubkey: refFeesWallet.publicKey,
        toPubkey: destinationAddr,
        lamports: claimableAmountLamps,
      })
    ];
    const messageV0 = new solana.TransactionMessage({
      payerKey: refFeesWallet.publicKey,
      recentBlockhash: recentBlockhashForSwap,
      instructions,
    }).compileToV0Message();

    const versionedTx = new solana.VersionedTransaction(messageV0);
    versionedTx.sign([refFeesWallet.payer])

    const sentOK = await makeAndSendJitoBundle([versionedTx], refFeesKeypair, jitoFeeLamps);
    if (sentOK) {
      await prisma.user.update({
        where: {
          internalID: user!.internalID,
        },
        data: {
          unclaimedRefRewards: 0,
        }
      })
      await tryReply(ctx, `Claimed successfully! Check your wallet, <code>${destinationAddr}</code>`, DEF_MESSAGE_OPTS);
    } else {
      await tryReply(ctx, `Failed to claim: transaction didn't go through. You can try again, though!\nIf this keeps happening - notify our team.`)
    }
    return ctx.scene.leave();

  } catch (e: any) {
    console.error(`Error in ${wizardReferralsClaim_name} when trying to claim referral rewards: ${e}`);
    console.trace(e);
    await tryReply(ctx, `Failed to claim due to internal error; details for devs:\n${e}`);
    return ctx.scene.leave();
  }
}
