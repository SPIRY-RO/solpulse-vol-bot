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
        text: `${c.icons.tractor} Extremely Slow`,
        callback_data: `data-settings-speed-0`,
      },
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
      {
        text: `12 Hours`,
        callback_data: `data-settings-duration-43200`,
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
  await h.tryReply(ctx, `Duration changed`);
  await h.sleep(1500);
  return await showDurationSettings(ctx);
}



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

