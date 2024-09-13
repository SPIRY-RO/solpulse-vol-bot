import * as solana from "@solana/web3.js";
import { Context } from "telegraf";

import { answerCbQuerySafe, getExpiryTsHoursFromNow, keypairFrom, tryEditOrReply, tryReply } from "../helpers";
import { DEF_MESSAGE_OPTS, envConf } from "../config";
import { prisma, telegraf, userManager, web3Connection } from "..";
import * as c from "../const";
import * as h from "../helpers";
import RaydiumSwap from "../classes/RaydiumSwap";
import { makeAndSendJitoBundle } from "../utils/jito";
import { workMenuBackButton, workMenuBackButtonKeyboard } from "../commands/start";

export async function showRentOptions(ctx: Context) {
  answerCbQuerySafe(ctx);
  await tryEditOrReply(
    ctx,
    `How long would you like to rent the bot for?
${c.icons.hourglassFull} If you still have time left, purchased hours will be added to it ${c.icons.hourglassEmpty}`,
    {
      reply_markup: getPaymentKeyboard(),
      ...DEF_MESSAGE_OPTS,
    }
  );
}

export async function rentBot(ctx: Context, durationHours: string | number) {
  answerCbQuerySafe(ctx);
  const user = await userManager.getOrCreateUser(ctx.from?.id);

  const priceSol = c.RENT_HOUR_TO_PRICE_MAP[durationHours];
  if (!priceSol) {
    await tryReply(ctx, `Invalid rent duration specified: ${durationHours}; try again`);
    return;
  }
  durationHours = Number(durationHours);

  let expiryTs: number;
  if (user.rentExpiresAt > Date.now()) {
    const msToAdd = durationHours * 60 * 60 * 1000;
    expiryTs = user.rentExpiresAt + msToAdd;
  } else {
    expiryTs = getExpiryTsHoursFromNow(durationHours);
  }
  try {
    const workWalletKP = keypairFrom(user.workWalletPK);
    const balanceLamps = await web3Connection.getBalance(workWalletKP.publicKey);
    const balanceSol = balanceLamps / solana.LAMPORTS_PER_SOL;
    const minAllowedBalanceSol = priceSol + 0.001;

    if (balanceSol < minAllowedBalanceSol) {
      await tryReply(
        ctx,
        `Not enough funds. You need at least ${minAllowedBalanceSol} SOL; you have: ${balanceSol} SOL`,
        { reply_markup: workMenuBackButtonKeyboard }
      );
      return;
    }

    let transferAmount = 0;
    if (user.referredByTgID) {
      const refFee = (priceSol / 100) * c.REFERRAL_FEE_PERC;
      h.rewardReferrerOf(user, refFee);
      transferAmount = (priceSol - refFee) * solana.LAMPORTS_PER_SOL;
    } else {
      transferAmount = priceSol * solana.LAMPORTS_PER_SOL;
    }
    const raySwap = new RaydiumSwap(workWalletKP, new solana.PublicKey(c.WSOL_MINT_ADDR));
    const transferTx = await raySwap.getSolTransferTx(
      null,
      new solana.PublicKey(envConf.REVENUE_WALLET),
      transferAmount
    );

    h.tryEditOrReply(ctx, `Funds detected. Beginning transfer... Waiting time: 20-60 seconds`);
    const success = await makeAndSendJitoBundle([transferTx], workWalletKP);
    if (success) {
      await prisma.user.update({
        where: { internalID: user.internalID },
        data: { rentExpiresAt: expiryTs },
      });
      await h.trySend(
        envConf.TEAM_NOTIFICATIONS_CHAT,
        `Received <b>${(transferAmount / solana.LAMPORTS_PER_SOL).toFixed(
          4
        )}</b> SOL after gas & referral fees\nFrom user ${await h.getUserProfileLinkFrom(user.tgID)}`,
        DEF_MESSAGE_OPTS
      );
      // debug; TODO REMOVE in the future
      await h.trySend(
        envConf.TEAM_NOTIFICATIONS_CHAT_FALLBACK,
        `Received <b>${(transferAmount / solana.LAMPORTS_PER_SOL).toFixed(
          4
        )}</b> SOL after gas & referral fees\nFrom user ${await h.getUserProfileLinkFrom(user.tgID)}`,
        DEF_MESSAGE_OPTS
      );
    } else {
      await h.tryReply(ctx, `Failed to send rent funds; try again. If this error keeps repeating, contact our team.`);
      return;
    }

    await h.tryEditOrReply(
      ctx,
      `Congratulations! Your rent is now valid for the next ${durationHours} hour(s)!
You can start using the bot right away`,
      { reply_markup: workMenuBackButtonKeyboard, ...DEF_MESSAGE_OPTS }
    );
    return;
  } catch (e: any) {
    await tryReply(ctx, `An error ocurred while handling your payment. Details for devs:\n${e}`);
    console.error(`Error while renting bot: ${e}`);
    console.trace(e);
    return;
  }
}

function getPaymentKeyboard() {
  const CHAIN_TICKER = "SOL";
  const hours = Object.keys(c.RENT_HOUR_TO_PRICE_MAP);
  const prices = Object.values(c.RENT_HOUR_TO_PRICE_MAP);
  return {
    inline_keyboard: [
      [
        { text: `${hours[0]} hour - ${prices[0]} ${CHAIN_TICKER}`, callback_data: `data-rent-${hours[0]}` },
        { text: `${hours[1]} hours - ${prices[1]} ${CHAIN_TICKER}`, callback_data: `data-rent-${hours[1]}` },
      ],
      [
        { text: `${hours[2]} hours - ${prices[2]} ${CHAIN_TICKER}`, callback_data: `data-rent-${hours[2]}` },
        { text: `${hours[3]} hours - ${prices[3]} ${CHAIN_TICKER}`, callback_data: `data-rent-${hours[3]}` },
      ],
      [
        { text: `${hours[4]} hours - ${prices[4]} ${CHAIN_TICKER}`, callback_data: `data-rent-${hours[4]}` },
        { text: `1 week - ${prices[5]} ${CHAIN_TICKER}`, callback_data: `data-rent-${hours[5]}` },
      ],
      [
        { text: `${Number(hours[6])/24} days - ${prices[6]} ${CHAIN_TICKER}`, callback_data: `data-rent-${hours[6]}` },
      ],
      [workMenuBackButton],
    ],
  };
}
