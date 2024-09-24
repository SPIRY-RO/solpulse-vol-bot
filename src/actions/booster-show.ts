import * as solana from '@solana/web3.js';
import { Context } from "telegraf";

import Booster, { BOOSTER_TYPES_TYPE } from '../classes/Booster';
import * as c from '../const';
import * as h from '../helpers';
import { DEF_MESSAGE_OPTS } from '../config';
import { prisma, userManager } from '..';
import { Booster as BoosterPrisma } from '@prisma/client';
import { workMenuBackButton } from '../commands/start';


export async function showBooster(ctx: Context, type: BOOSTER_TYPES_TYPE, boosterID?: string, refreshOnly = false) {
  const senderID = ctx.from?.id;

  switch (type) {
    case 'volume':
      showVolumeBooster(ctx, boosterID, refreshOnly);
      break;
    case 'holders':
      showHoldersBooster(ctx, boosterID, refreshOnly);
      break;
    case 'rank':
      showRankBooster(ctx, boosterID, refreshOnly);
      break;
    default:
      break;
  }
  return;
}


async function showVolumeBooster(ctx: Context, boosterID?: string, refreshOnly = false) {
  h.answerCbQuerySafe(ctx);
  const userID = ctx.from?.id;
  const type: BOOSTER_TYPES_TYPE = 'volume';
  const user = await userManager.getOrCreateUser(userID);
  const settings = await userManager.getOrCreateSettingsFor(userID);
  const secsOfRentLeft = Number(((user.rentExpiresAt - Date.now()) / 1000).toFixed());
  let existingBooster: Booster | null | undefined;
  if (boosterID)
    existingBooster = Booster.getActiveBoosterBy(boosterID);
  else
    existingBooster = await Booster.getActiveBoosterFor(settings.selectedTokenAddr, type, userID);

  let powerButton = {
    text: `${c.icons.green} Start`,
    callback_data: `data-boosterStart-${type}`,
  };
  if (existingBooster && existingBooster.isActive && !existingBooster.wasAskedToStop)
    powerButton = {
      text: `${c.icons.red} Stop`,
      callback_data: `data-boosterStop-${type}-${existingBooster.internalID}`,
    };
  else if (existingBooster && existingBooster.isActive && existingBooster.wasAskedToStop)
    powerButton = {
      text: `${c.icons.white} Stopping...`,
      callback_data: `#`,
    };

  let volumeBoosterText = `${c.icons.chartBars} Volume Booster ${c.icons.chartBars}

${c.icons.moonWhite} Token:
<code>${settings.selectedTokenAddr}</code>

${c.icons.clockRed} Rent time left: ${h.secondsToTimingNotation(secsOfRentLeft)}

${c.icons.lightning} Booster speed: <b>${settings.volumeSpeed}</b> ${h.getCarFor(settings.volumeSpeed)}
${c.icons.hourglassFull} Booster auto shut-off after: ${h.secondsToTimingNotation(settings.volumeDuration)}

${c.icons.cashBankHouse} Your balance: ${(await userManager.getWorkWalletBalanceFor(user)).toFixed(4)} SOL
${c.icons.bot} Wallets: ${existingBooster?.puppetWalletBalancesSol || 'N/A'}

${c.icons.chartBars} Volume generated:
Buys: ${existingBooster?.metrics?.buyVolume?.toFixed(3) || 'N/A'} SOL | sells: ${existingBooster?.metrics?.sellVolume?.toFixed(3) || 'N/A'} SOL
`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `${c.icons.lightning} Speed`,
            callback_data: `settings_speed`,
          },
          powerButton,
          {
            text: `${c.icons.hourglassFull} Duration`,
            callback_data: `settings_duration`,
          },
        ],
        [
          workMenuBackButton,
          {
            text: `${c.icons.refresh} Refresh`,
            callback_data: `data-boosterRefresh-${type}`,
          },
        ],
      ]
    },
    ...DEF_MESSAGE_OPTS,
  }

  if (refreshOnly)
    await h.tryEdit(ctx, volumeBoosterText, keyboard);
  else
    await h.tryEditOrReply(ctx, volumeBoosterText, keyboard);
  return;
}



async function showHoldersBooster(ctx: Context, boosterID?: string, refreshOnly = false) {
  h.answerCbQuerySafe(ctx);
  const userID = ctx.from?.id;
  const type: BOOSTER_TYPES_TYPE = 'holders';
  const user = await userManager.getOrCreateUser(userID);
  const settings = await userManager.getOrCreateSettingsFor(userID);
  const secsOfRentLeft = Number(((user.rentExpiresAt - Date.now()) / 1000).toFixed());
  let existingBooster: Booster | null | undefined;
  if (boosterID)
    existingBooster = Booster.getActiveBoosterBy(boosterID);
  else
    existingBooster = await Booster.getActiveBoosterFor(settings.selectedTokenAddr, type, userID);

  let powerButton = {
    text: `${c.icons.green} Start`,
    callback_data: `data-boosterStart-${type}`,
  };
  if (existingBooster && existingBooster.isActive && !existingBooster.wasAskedToStop)
    powerButton = {
      text: `${c.icons.red} Stop`,
      callback_data: `data-boosterStop-${type}-${existingBooster.internalID}`,
    };
  else if (existingBooster && existingBooster.isActive && existingBooster.wasAskedToStop)
    powerButton = {
      text: `${c.icons.white} Stopping...`,
      callback_data: `#`,
    };

  let volumeBoosterText = `${c.icons.bag} Holder Booster ${c.icons.bag}

${c.icons.moonWhite} Token:
<code>${settings.selectedTokenAddr}</code>

${c.icons.clockRed} Rent time left: ${h.secondsToTimingNotation(secsOfRentLeft)}

${c.icons.cashBag} Your balance: ${(await userManager.getWorkWalletBalanceFor(user)).toFixed(4)} SOL

${c.icons.peopleGrayFaceless} Holders generated: ${existingBooster?.metrics.totalHolders || 'N/A'}
${existingBooster?.isActive ? `Target for <b>this booster</b>: ${existingBooster.settings.holdersNewHolders}\n` : ''}
Each holder costs about 0.0021 SOL
`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `${c.icons.peopleGrayFaceless} Holder Goal: ${settings.holdersNewHolders}`,
            callback_data: `settings_holders`,
          },
        ],
        [
          {
            text: `${c.icons.chevronLeft}${c.icons.peopleGrayFaceless}`,
            callback_data: `settings_holders_dec`,
          },
          powerButton,
          {
            text: `${c.icons.peopleGrayFaceless}${c.icons.chevronRight}`,
            callback_data: `settings_holders_inc`,
          },
        ],
        [
          workMenuBackButton,
          {
            text: `${c.icons.refresh} Refresh`,
            callback_data: `data-boosterRefresh-${type}`,
          },
        ],
      ]
    },
    ...DEF_MESSAGE_OPTS,
  }

  if (refreshOnly)
    await h.tryEdit(ctx, volumeBoosterText, keyboard);
  else
    await h.tryEditOrReply(ctx, volumeBoosterText, keyboard);
  return;
}



export async function showRankBooster(ctx: Context, boosterID?: string, refreshOnly = false) {
  h.answerCbQuerySafe(ctx);
  const userID = ctx.from?.id;
  const type: BOOSTER_TYPES_TYPE = 'rank';
  const user = await userManager.getOrCreateUser(userID);
  const settings = await userManager.getOrCreateSettingsFor(userID);
  const secsOfRentLeft = Number(((user.rentExpiresAt - Date.now()) / 1000).toFixed());
  let existingBooster: Booster | null | undefined;
  if (boosterID)
    existingBooster = Booster.getActiveBoosterBy(boosterID);
  else
    existingBooster = await Booster.getActiveBoosterFor(settings.selectedTokenAddr, type, userID);

  let powerButton = {
    text: `${c.icons.green} Start`,
    callback_data: `data-boosterStart-${type}`,
  };
  if (existingBooster && existingBooster.isActive && !existingBooster.wasAskedToStop)
    powerButton = {
      text: `${c.icons.red} Stop`,
      callback_data: `data-boosterStop-${type}-${existingBooster.internalID}`,
    };
  else if (existingBooster && existingBooster.isActive && existingBooster.wasAskedToStop)
    powerButton = {
      text: `${c.icons.white} Stopping...`,
      callback_data: `#`,
    };

  const mainWalletBalance = Number((await userManager.getWorkWalletBalanceFor(user)).toFixed(4));
  let lastKnownPuppetBalances = 0;
  if (existingBooster) {
    for (const puppet of existingBooster.puppetWallets) {
      lastKnownPuppetBalances += puppet.balances.baseSol;
    }
  }
  const totalBalance = Number((mainWalletBalance + lastKnownPuppetBalances).toFixed(4));
    
  let volumeBoosterText = `${c.icons.goblet} Rank Booster ${c.icons.goblet}
The Rank Boost will pump DexScreener metrics to super-boost your token's ranking on it by:

- Increasing number of transactions
- Ratio of buys to sells -> More buys then sells
- Ratio of buyers to sellers -> More buyers then sellers
- Number of makers -> More traders

Ideal and most cost-efficient for new launches and charts with some organic volume.

${c.icons.moonWhite} Token:
<code>${settings.selectedTokenAddr}</code>

${c.icons.clockRed} Rent time left: ${h.secondsToTimingNotation(secsOfRentLeft)}

${c.icons.cashBag} Your balance${lastKnownPuppetBalances ? '(including puppet wallets)' : ''}: ${totalBalance} SOL

${c.icons.cashBanknote} Buys made: ${existingBooster?.metrics.totalTx || 'N/A'}
`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          powerButton,
        ],
        [
          workMenuBackButton,
          {
            text: `${c.icons.refresh} Refresh`,
            callback_data: `data-boosterRefresh-${type}`,
          },
        ],
      ]
    },
    ...DEF_MESSAGE_OPTS,
  }

  if (refreshOnly)
    await h.tryEdit(ctx, volumeBoosterText, keyboard);
  else
    await h.tryEditOrReply(ctx, volumeBoosterText, keyboard);
  return;
}





/*
async function junkPile(ctx: Context, boosterID?: string) {
  const booster = Booster.getBoosterDataBy(boosterID);
  if (!booster) {
    tryReply(ctx, 'Booster not found');
    return;
  } else if (booster.ownerTgID !== String(senderID)) {
    tryReply(ctx, 'You are not the owner of this booster');
    return;
  }

  // show stats
  let text = `Boosting for <code>${booster.tokenAddress.toBase58()}</code>
Deposited amount: ${booster.metrics.initialDeposit} SOL
Remaining amount: ${booster.metrics.lastKnownSolBal || 'N/A'} SOL
Gas & rent: ${booster.metrics.gasSpent} SOL
Buy volume generated: ${booster.metrics.buyVolume} SOL
Sell volume generated: ${booster.metrics.sellVolume} SOL
Number of unique holders: ${booster.metrics.totalHolders || 1} holder(s)
`;
}
*/