
import * as solana from '@solana/web3.js';
import bs58 from 'bs58';

import { prisma, userManager, web3Connection } from "..";
import { DEF_MESSAGE_OPTS } from "../config";
import * as c from "../const";
import * as h from "../helpers";
import { showHelpMessage } from "./help";
import { wizardSetAddr_name } from '../scenes/set-active-address';
import { Context } from 'telegraf';


const workMenuKeyboard = {
  inline_keyboard: [
    [
      {
        text: `${c.icons.lock} Unlock usage`,
        callback_data: `show_rent`,
      },
      {
        text: `${c.icons.cashBankHouse} My wallet`,
        callback_data: `wallet`,
      },
    ],
    /*
    [
      {
        text: `My boosters`,
        callback_data: `my_boosters`,
      },
    ],
    */
    [
      {
        text: `${c.icons.chartBars} Boost volume`,
        callback_data: `data-boosterShow-volume`,
      },
      {
        text: `${c.icons.cup} Boost rank`,
        callback_data: `data-boosterShow-rank`,
      },
      {
        text: `${c.icons.bag} Boost holders`,
        callback_data: `data-boosterShow-holders`,
      },
    ],
    [
      {
        text: `${c.icons.handshake} Referrals`,
        callback_data: `referrals`,
      },
      {
        text: `${c.icons.refresh} Refresh`,
        callback_data: `work_menu_refresh`
      },
    ],
    [
      {
        text: `${c.icons.write} Change token address`,
        callback_data: `token_address_wizard`,
      },
    ],
  ]
}

export const workMenuBackButtonKeyboard = {
  inline_keyboard: [[{
    text: `${c.icons.backArrow} Main menu`,
    callback_data: `work_menu`,
  }]]
};
export const workMenuBackButton = {
  text: `${c.icons.backArrow} Main menu`,
  callback_data: `work_menu`,
};



export async function refreshWorkMenu(ctx: any) {
  return workMenu(ctx, true);
}

export async function showWorkMenu(ctx: any) {
  const isPMs = (ctx.chat?.type === "private");
  if (!isPMs) {
    await h.tryReply(ctx, `This command is intended for use in PMs`);
    return;
  } 
  return workMenu(ctx, false);
}

async function workMenu(ctx: any, onlyRefresh = false) {
  h.answerCbQuerySafe(ctx);

  const user = await userManager.getOrCreateUser(ctx.from.id);
  const settings = await userManager.getOrCreateSettingsFor(ctx.from.id);
  const balanceLamps = await web3Connection.getBalance(h.keypairFrom(user.workWalletPrivKey).publicKey);
  const balanceSol = balanceLamps / solana.LAMPORTS_PER_SOL;
  //const tokenData = await web3.getParsedAccountInfo(new solana.PublicKey(settings.selectedTokenAddr));

  if (!settings.selectedTokenAddr) {
    return ctx.scene.enter(wizardSetAddr_name, {});
  }

  const text = `${c.icons.rocket}${c.icons.chartBars} Main menu ${c.icons.chartBars}${c.icons.rocket}

${c.icons.moonWhite} Token: <code>${settings.selectedTokenAddr}</code>

${c.icons.clockRed} Rent time left: <b>${h.secondsToTimingNotation((user.rentExpiresAt - Date.now()) / 1000)}</b>

${c.icons.cashBanknote} Balance: <b>${balanceSol < c.MIN_BOOSTER_BALANCE_SOL ? 'empty' : `${balanceSol.toFixed(4)}`}</b> SOL

Go to "${c.icons.cashBankHouse} My wallet" to deposit or withdraw funds.
Press "${c.icons.lock} Unlock usage" once you're ready to boost your project.
`;

  if (onlyRefresh)
    await h.tryEdit(ctx, text, { reply_markup: workMenuKeyboard, ...DEF_MESSAGE_OPTS });
  else
    await h.tryEditOrReply(ctx, text, { reply_markup: workMenuKeyboard, ...DEF_MESSAGE_OPTS });
  return;
}




/* Start message */

const startMessage = `
${c.icons.chartBars} Welcome to Syndicate Boosting Bot ${c.icons.rocket}

We are here to provide you the best Volume Boosting Bot on Solana

${c.icons.flame} Efficient Volume Handling 
- Maximize the impact of every trade with a system designed to manage volume smoothly and effectively.

${c.icons.sprout} Organic Volume Module 
- Create a consistent and reliable trading volume that attracts investors and builds long-term market trust.

${c.icons.shield} Anti BOTS-Protection 
- Protect your trades with built-in defense against MEV exploitation.


${c.icons.chainLink} For support contact @SpiryBTC for sales @dukuweb3

To start click "${c.icons.moonWhite} Enter Token Address ${c.icons.moonWhite}" button below.
`;

export async function showWelcomeMessage(ctx: Context) {
  h.answerCbQuerySafe(ctx);
  const isPMs = (ctx.chat?.type === "private");
  if (!isPMs) {
    await h.tryReply(ctx, `This command is intended for use in PMs`);
    return;
  }
  const userSettings = await userManager.getOrCreateSettingsFor(ctx.from?.id)

  const keyboard = [
    [
      {
        text: "=== CHOOSE FROM MENU BELOW ===",
        callback_data: "none",
      },
    ],
    [{
      text: `${c.icons.moonWhite} Enter token address to boost ${c.icons.moonWhite}`,
      callback_data: `token_address_wizard`,
    }],
    [{
      text: `${c.icons.cashBankHouse} Wallet`,
      callback_data: `wallet`,
    }],
    [{
      text: `${c.icons.handshake} Affiliate Program`,
      callback_data: `referrals`,
    }]
  ];

  if (userSettings.selectedTokenAddr) {
    keyboard.push([{
      text: `${c.icons.diskette} Use previous address ${c.icons.diskette}`,
      callback_data: `work_menu`,
    }]);
  }

  await h.tryEditOrReply(ctx, startMessage, {
    reply_markup: {
      inline_keyboard: keyboard,
    }
  });
  return;
}


export async function referIfNeeded_thenShowStart(ctx: any, referrerInfo?: string) {
  const senderID_str = String(ctx.from?.id);

  if (!referrerInfo) {
    return showWelcomeMessage(ctx);
  }
  referrerInfo = referrerInfo.slice(2); // strip away "r-" 
  //@ts-ignore
  if (isNaN(referrerInfo)) {
    const text = `Received referrer ID, but it appears to be broken: ${referrerInfo}`;
    console.warn(text);
    await h.tryReply(ctx, text);
    return showWelcomeMessage(ctx);
  }
  const referrer = await userManager.getUser(referrerInfo);
  if (!referrer) {
    const text = `Attempting to refer to non-existent user: ${referrerInfo}`;
    console.warn(text);
    await h.tryReply(ctx, text);
    return showWelcomeMessage(ctx);
  }
  let thisUser = await userManager.getUser(senderID_str);
  if (thisUser) {
    console.warn(`User account already exists; not referring them`);
    return showWelcomeMessage(ctx);
  } else {
    thisUser = await userManager.getOrCreateUser(senderID_str);
  }
  if (thisUser.referredByTgID) {
    const text = `Current user ${senderID_str} is already referred by someone else; will not overwrite the existing referrer`;
    console.warn(text);
    //await tryReply(ctx, text);
    return showWelcomeMessage(ctx);
  } else if (thisUser.tgID === referrer.tgID) {
    console.warn(`User ${thisUser.tgID} attempted to refer themselves; likely clicked their own referral link`);
    return showWelcomeMessage(ctx);
  }
  await prisma.user.update({
    where: {
      internalID: thisUser.internalID,
    },
    data: {
      referredByTgID: referrer.tgID,
    }
  })
  console.info(`Referred user ${thisUser.tgID} to ${referrer.tgID} successfully`);
  await h.tryReply(ctx, '✅ You have successfully used a referral link');

  return showWelcomeMessage(ctx);
}