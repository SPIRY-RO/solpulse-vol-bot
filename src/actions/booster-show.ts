import * as solana from '@solana/web3.js';
import { Context } from "telegraf";

import BoosterBase, { BoosterType } from '../classes/boosters/base';
import * as c from '../const';
import * as h from '../helpers';
import { DEF_MESSAGE_OPTS } from '../config';
import { prisma, userManager } from '..';
import { Booster as BoosterPrisma } from '@prisma/client';
import { workMenuBackButton } from '../commands/start';
import { solanaUsdPrice } from '../utils/price-feeds';


export async function showBooster(ctx: Context, type: BoosterType, boosterID?: string, refreshOnly = false) {
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
  const userID = String(ctx.from!.id);
  const type: BoosterType = 'volume';
  const user = await userManager.getOrCreateUser(userID);
  const settings = await userManager.getOrCreateSettingsFor(userID);
  const secsOfRentLeft = Number(((user.rentExpiresAt - Date.now()) / 1000).toFixed());
  let existingBooster: BoosterBase | null | undefined;
  if (boosterID)
    existingBooster = BoosterBase.getActiveByID(boosterID);
  else
    existingBooster = BoosterBase.getActiveBoosterFor(settings.selectedTokenAddr, type, userID);

  let powerButton = {
    text: `${c.icons.green} Start`,
    callback_data: `data-boosterStart-${type}`,
  };
  if (existingBooster && !existingBooster.wasAskedToStop)
    powerButton = {
      text: `${c.icons.red} Stop`,
      callback_data: `data-boosterStop-${type}-${existingBooster.internalID}`,
    };
  else if (existingBooster && existingBooster.wasAskedToStop)
    powerButton = {
      text: `${c.icons.white} Stopping...`,
      callback_data: `#`,
    };

  /*
  const mainWalletBalance = Number((await userManager.getWorkWalletBalanceFor(user)).toFixed(4));
  let lastKnownPuppetBalances = 0;
  if (existingBooster) {
    for (const puppet of existingBooster.puppets) {
      lastKnownPuppetBalances += puppet.lastBalance;
    }
  }
  const totalBalance = Number((mainWalletBalance + lastKnownPuppetBalances).toFixed(4));
  */
  const totalVolumeUSD = (((existingBooster?.metrics?.buyVolume || 0) + (existingBooster?.metrics?.sellVolume || 0)) * solanaUsdPrice).toFixed(2);
  const totalBalance = Number((await userManager.getBalFromAllAssociatedWallets_inSol(user)).toFixed(4));
  let volumeBoosterText = `${c.icons.chartBars} Volume Booster ${c.icons.chartBars}

${c.icons.moonWhite} Token:
<code>${settings.selectedTokenAddr}</code>

${c.icons.clockRed} Rent time left: ${h.secondsToTimingNotation(secsOfRentLeft)}

${c.icons.lightning} Booster speed: <b>${settings.volumeSpeed}</b> ${h.getCarFor(settings.volumeSpeed)}
${c.icons.hourglassFull} Booster auto shut-off after: ${h.secondsToTimingNotation(settings.volumeDuration)}
${c.icons.people} Volume will come from ${settings.volumeParallelWallets} wallets

${c.icons.cashBag} Your balance(including puppet-wallets) ${totalBalance} SOL

The fewer wallets you use - the more volume you get for your $ and the less you lose on gas per transaction.
The more wallets - the more organic the transactions will appear.

${c.icons.chartBars} Volume generated:
Buys: ${existingBooster?.metrics?.buyVolume.toFixed(3) || 'N/A'} SOL | sells: ${existingBooster?.metrics?.sellVolume?.toFixed(3) || 'N/A'} SOL
Total volume generated: $${totalVolumeUSD} 
`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `${c.icons.lightning} Speed`,
            callback_data: `settings_speed`,
          },
          {
            text: `${c.icons.hourglassFull} Duration`,
            callback_data: `settings_duration`,
          },
        ],
        [
          {
            text: `${c.icons.cashBankHouse} Number of wallets`,
            callback_data: `settings_volume_parallel`,
          },
        ],
        [
          workMenuBackButton,
          powerButton,
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
  const userID = String(ctx.from!.id);
  const type: BoosterType = 'holders';
  const user = await userManager.getOrCreateUser(userID);
  const settings = await userManager.getOrCreateSettingsFor(userID);
  const secsOfRentLeft = Number(((user.rentExpiresAt - Date.now()) / 1000).toFixed());
  let existingBooster: BoosterBase | null | undefined;
  if (boosterID)
    existingBooster = BoosterBase.getActiveByID(boosterID);
  else
    existingBooster = BoosterBase.getActiveBoosterFor(settings.selectedTokenAddr, type, userID);

  let powerButton = {
    text: `${c.icons.green} Start`,
    callback_data: `data-boosterStart-${type}`,
  };

  if (existingBooster && !existingBooster.wasAskedToStop)
    powerButton = {
      text: `${c.icons.red} Stop`,
      callback_data: `data-boosterStop-${type}-${existingBooster.internalID}`,
    };
  else if (existingBooster && existingBooster.wasAskedToStop)
    powerButton = {
      text: `${c.icons.white} Stopping...`,
      callback_data: `#`,
    }


  let holderBoosterText = `${c.icons.bag} Holder Booster ${c.icons.bag}

${c.icons.moonWhite} Token:
<code>${settings.selectedTokenAddr}</code>

${c.icons.clockRed} Rent time left: ${h.secondsToTimingNotation(secsOfRentLeft)}

${c.icons.cashBag} Your balance: ${(await userManager.getBalFromAllAssociatedWallets_inSol(user)).toFixed(4)} SOL

${c.icons.cashBankHouse} Holders generated: ${existingBooster?.metrics.uniqueWallets || 'N/A'}
${existingBooster ? `Target for <b>this booster</b>: ${existingBooster.settings.holdersNewHolders}\n` : ''}
Each holder costs about 0.0021 SOL. Recommended minimum for this booster is 0.5 SOL or more.
`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `${c.icons.cashBankHouse} Holder Goal: ${settings.holdersNewHolders}`,
            callback_data: `settings_holders`,
          },
        ],
        [
          {
            text: `${c.icons.chevronLeft}${c.icons.cashBankHouse}`,
            callback_data: `settings_holders_dec`,
          },
          powerButton,
          {
            text: `${c.icons.cashBankHouse}${c.icons.chevronRight}`,
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
    await h.tryEdit(ctx, holderBoosterText, keyboard);
  else
    await h.tryEditOrReply(ctx, holderBoosterText, keyboard);
  return;
}



export async function showRankBooster(ctx: Context, boosterID?: string, refreshOnly = false) {
  h.answerCbQuerySafe(ctx);
  const userID = String(ctx.from!.id);
  const type: BoosterType = 'rank';
  const user = await userManager.getOrCreateUser(userID);
  const settings = await userManager.getOrCreateSettingsFor(userID);
  const secsOfRentLeft = Number(((user.rentExpiresAt - Date.now()) / 1000).toFixed());
  let existingBooster: BoosterBase | null | undefined;
  if (boosterID)
    existingBooster = BoosterBase.getActiveByID(boosterID);
  else
    existingBooster = BoosterBase.getActiveBoosterFor(settings.selectedTokenAddr, type, userID);

  let powerButton = {
    text: `${c.icons.green} Start`,
    callback_data: `data-boosterStart-${type}`,
  };
  if (existingBooster && !existingBooster.wasAskedToStop)
    powerButton = {
      text: `${c.icons.red} Stop`,
      callback_data: `data-boosterStop-${type}-${existingBooster.internalID}`,
    };
  else if (existingBooster && existingBooster.wasAskedToStop)
    powerButton = {
      text: `${c.icons.white} Stopping...`,
      callback_data: `#`,
    };

  /*
  const mainWalletBalance = Number((await userManager.getWorkWalletBalanceFor(user)).toFixed(4));
  let lastKnownPuppetBalances = 0;
  if (existingBooster) {
    for (const puppet of existingBooster.puppets) {
      lastKnownPuppetBalances += puppet.lastBalance;
    }
  }
  const totalBalance = Number((mainWalletBalance + lastKnownPuppetBalances).toFixed(4));
  */
 const totalBalance = Number((await userManager.getBalFromAllAssociatedWallets_inSol(user)).toFixed(4));
    
  let volumeBoosterText = `${c.icons.goblet} Rank Booster ${c.icons.goblet}

${c.icons.moonWhite} Token:
<code>${settings.selectedTokenAddr}</code>

${c.icons.clockRed} Rent time left: ${h.secondsToTimingNotation(secsOfRentLeft)}

${c.icons.cashBag} Your balance(including puppet-wallets) ${totalBalance} SOL

Settings:
${c.icons.clockAntique} Fresh wallet interval ${settings.rankRotateEveryNTx}
${c.icons.cashBankHouse} Number of wallets ${settings.rankParallelWallets}

${c.icons.cashBanknote} Buys made: ${existingBooster?.metrics.txs || 'N/A'}
${c.icons.cashBankHouse} Unique makers: ${existingBooster?.metrics.uniqueWallets || 'N/A'}
`;

  const keyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          powerButton,
        ],
        [
          {
            text: `${c.icons.cashBankHouse} Number of wallets`,
            callback_data: `settings_rank_parallel`,
          },
        ],
        [
          {
            text: `${c.icons.clockAntique} Fresh wallet interval`,
            callback_data: `settings_rank_frequency`,
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