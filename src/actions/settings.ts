import { Context } from "telegraf";

import { prisma, userManager } from '..';
import * as h from '../helpers';
import * as c from '../const';
import { workMenuBackButton } from "../commands/start";
import { showBooster } from "./booster-show";


const speedKeyboard = {
  inline_keyboard: [
    [
      {
        text: `${c.icons.tractor} Very slow`,
        callback_data: `data-settings-speed-1`,
      },
      {
        text: `${c.icons.truck} Slow`,
        callback_data: `data-settings-speed-2`,
      },
    ],
    [
      {
        text: `${c.icons.car} Normal`,
        callback_data: `data-settings-speed-3`,
      },
      {
        text: `${c.icons.racecar} Fast`,
        callback_data: `data-settings-speed-4`,
      },
    ],
    [
      {
        text: `${h.getCarFor(5)} Max`,
        callback_data: `data-settings-speed-5`,
      },
    ],
    [
      {
        text: `${c.icons.backArrow} Back`,
        callback_data: `data-boosterShow-volume`
      }
    ]
  ],
}


export async function showSpeedSettings(ctx: any) {
  h.answerCbQuerySafe(ctx);
  const userID = String(ctx.from.id);
  const settings = await userManager.getOrCreateSettingsFor(userID);

  await h.tryEditOrReply(ctx, `Volume booster speed

1 = ${h.getCarFor(1)} Very slow
2 = ${h.getCarFor(2)} Slow
3 = ${h.getCarFor(3)} Normal
4 = ${h.getCarFor(4)} Fast
5 = ${h.getCarFor(5)} Maximum

Current: ${settings.volumeSpeed} ${h.getCarFor(settings.volumeSpeed)}`, {
    reply_markup: speedKeyboard,
  });
}


export async function setSpeedSettings(ctx: any, speed: number | string) {
  if (isNaN(speed as number)) {
    throw Error(`Speed is NaN: ${speed}`);
  }

  h.answerCbQuerySafe(ctx);
  const userID = String(ctx.from.id);
  await prisma.settings.update({
    where: {
      ownerTgID: userID,
    },
    data: {
      volumeSpeed: Number(speed),
    }
  });
  return await showSpeedSettings(ctx);
}



const durationKeyboard = {
  inline_keyboard: [
    [
      {
        text: `1 Hour`,
        callback_data: `data-settings-duration-3600`,
      },
      {
        text: `2 Hours`,
        callback_data: `data-settings-duration-7200`,
      },
      {
        text: `3 Hours`,
        callback_data: `data-settings-duration-10800`,
      },
    ],
    [
      {
        text: `${c.icons.backArrow} Back`,
        callback_data: `data-boosterShow-volume`
      }
    ]
  ],
}

export async function showDurationSettings(ctx: any) {
  h.answerCbQuerySafe(ctx);
  const userID = String(ctx.from.id);
  const settings = await userManager.getOrCreateSettingsFor(userID);

  await h.tryEditOrReply(ctx, `${c.icons.hourglassFull} Volume booster duration ${c.icons.hourglassFull}

How long to run the volume boost for.

Current: ${h.secondsToTimingNotation(settings.volumeDuration)}`, {
    reply_markup: durationKeyboard,
  });
}


export async function setDurationSettings(ctx: any, duration: number | string) {
  if (isNaN(duration as number)) {
    throw Error(`Duration is NaN: ${duration}`);
  }

  h.answerCbQuerySafe(ctx);
  const userID = String(ctx.from.id);
  await prisma.settings.update({
    where: {
      ownerTgID: userID,
    },
    data: {
      volumeDuration: Number(duration),
    }
  });
  return await showDurationSettings(ctx);
}



const volumeParallelWalletsKeyboard = {
  inline_keyboard: [
    [
      {
        text: `2`,
        callback_data: `data-settings-parallelVolume-2`,
      },
      {
        text: `3`,
        callback_data: `data-settings-parallelVolume-3`,
      },
      {
        text: `4`,
        callback_data: `data-settings-parallelVolume-4`,
      },
    ],
    [
      {
        text: `10`,
        callback_data: `data-settings-parallelVolume-10`,
      },
      {
        text: `15`,
        callback_data: `data-settings-parallelVolume-15`,
      },
      {
        text: `25`,
        callback_data: `data-settings-parallelVolume-25`,
      },
    ],
    [
      {
        text: `${c.icons.backArrow} Back`,
        callback_data: `data-boosterShow-volume`
      }
    ]
  ],
}


export async function showVolumeParallelSettings(ctx: any) {
  h.answerCbQuerySafe(ctx);
  const userID = String(ctx.from.id);
  const settings = await userManager.getOrCreateSettingsFor(userID);

  await h.tryEditOrReply(ctx, `${c.icons.people} Number of wallets ${c.icons.people}

How many wallets to use in parallel

${c.icons.people} Current: ${settings.volumeParallelWallets}`, {
    reply_markup: volumeParallelWalletsKeyboard,
  });
}


export async function setVolumeParallelSettings(ctx: any, parallelWallets: number | string) {
  if (isNaN(parallelWallets as number)) {
    throw Error(`parallelWallets is NaN: ${parallelWallets}`);
  }

  h.answerCbQuerySafe(ctx);
  const userID = String(ctx.from.id);
  await prisma.settings.update({
    where: {
      ownerTgID: userID,
    },
    data: {
      volumeParallelWallets: Number(parallelWallets),
    }
  });
  return await showVolumeParallelSettings(ctx);
}



/* Holder booster settings */

export async function holderSettingsIncrease(ctx: any) {
  h.answerCbQuerySafe(ctx);
  const userID = String(ctx.from.id);
  const currentSettings = await userManager.getOrCreateSettingsFor(userID);

  let newTotalHolders = currentSettings.holdersNewHolders + c.HOLDER_INCREMENT_STEP;
  if (newTotalHolders > c.MAX_HOLDERS_PER_BOOSTER)
    newTotalHolders = c.HOLDER_INCREMENT_STEP;

  await prisma.settings.update({
    where: {
      ownerTgID: userID,
    },
    data: {
      holdersNewHolders: newTotalHolders,
    }
  });
  return await showBooster(ctx, 'holders');
}


export async function holderSettingsDecrease(ctx: any) {
  h.answerCbQuerySafe(ctx);
  const userID = String(ctx.from.id);
  const currentSettings = await userManager.getOrCreateSettingsFor(userID);

  let newTotalHolders = currentSettings.holdersNewHolders - c.HOLDER_INCREMENT_STEP;
  if (newTotalHolders <= 0)
    newTotalHolders = c.MAX_HOLDERS_PER_BOOSTER;

  await prisma.settings.update({
    where: {
      ownerTgID: userID,
    },
    data: {
      holdersNewHolders: newTotalHolders,
    }
  });
  return await showBooster(ctx, 'holders');
}



/* Rank booster settings */

const rankParallelWalletsKeyboard = {
  inline_keyboard: [
    [
      {
        text: `10`,
        callback_data: `data-settings-parallelRank-10`,
      },
      {
        text: `15`,
        callback_data: `data-settings-parallelRank-15`,
      },
      {
        text: `20`,
        callback_data: `data-settings-parallelRank-20`,
      },
    ],
/*
    [
      {
        text: `1`,
        callback_data: `data-settings-parallelRank-1`,
      },
    ],
*/
    [
      {
        text: `${c.icons.backArrow} Back`,
        callback_data: `data-boosterShow-rank`
      }
    ]
  ],
}


export async function showRankParallelSettings(ctx: any) {
  h.answerCbQuerySafe(ctx);
  const userID = String(ctx.from.id);
  const settings = await userManager.getOrCreateSettingsFor(userID);

  await h.tryEditOrReply(ctx, `${c.icons.people} Number of wallets ${c.icons.people}

How many market-makers to run in parallel.
The more - the faster the rank will increase.

${c.icons.people} Current: ${settings.rankParallelWallets}`, {
    reply_markup: rankParallelWalletsKeyboard,
  });
}


export async function setRankParallelSettings(ctx: any, parallelWallets: number | string) {
  if (isNaN(parallelWallets as number)) {
    throw Error(`parallelWallets is NaN: ${parallelWallets}`);
  }

  h.answerCbQuerySafe(ctx);
  const userID = String(ctx.from.id);
  await prisma.settings.update({
    where: {
      ownerTgID: userID,
    },
    data: {
      rankParallelWallets: Number(parallelWallets),
    }
  });
  return await showRankParallelSettings(ctx);
}


const changeMakerFrequencyKeyboard = {
  inline_keyboard: [
    [
      {
        text: `20`,
        callback_data: `data-settings-makers-20`,
      },
      {
        text: `30`,
        callback_data: `data-settings-makers-30`,
      },
      {
        text: `40`,
        callback_data: `data-settings-makers-40`,
      },
    ],
/*
    [
      {
        text: `8`,
        callback_data: `data-settings-makers-8`,
      },
    ],
    */
    [
      {
        text: `${c.icons.backArrow} Back`,
        callback_data: `data-boosterShow-rank`
      }
    ]
  ],
}

export async function showChangeMakerFreqSettings(ctx: any) {
  h.answerCbQuerySafe(ctx);
  const userID = String(ctx.from.id);
  const settings = await userManager.getOrCreateSettingsFor(userID);

  await h.tryEditOrReply(ctx, `${c.icons.clockAntique} Fresh wallet interval ${c.icons.clockAntique}

How often to change market makers?
How many buys a market-maker makes, before it is replaced by a new unique one.
The lower this number - the more unique market makers you'll get, but the slower the overall transaction speed be.

${c.icons.clockAntique} Current: ${settings.rankRotateEveryNTx}`, {
    reply_markup: changeMakerFrequencyKeyboard,
  });
}


export async function setChangeMakerFreqSettings(ctx: any, changeEveryNBuys: number | string) {
  if (isNaN(changeEveryNBuys as number)) {
    throw Error(`changeEveryNBuys is NaN: ${changeEveryNBuys}`);
  }

  h.answerCbQuerySafe(ctx);
  const userID = String(ctx.from.id);
  await prisma.settings.update({
    where: {
      ownerTgID: userID,
    },
    data: {
      rankRotateEveryNTx: Number(changeEveryNBuys),
    }
  });
  return await showChangeMakerFreqSettings(ctx);
}