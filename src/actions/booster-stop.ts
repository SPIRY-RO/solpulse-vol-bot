import { Context } from "telegraf";
import { Booster as BoosterPrisma } from "@prisma/client";

import { prisma, userManager } from '..';
import Booster, { BOOSTER_TYPES_TYPE } from '../classes/Booster';
import * as h from '../helpers';
import * as c from '../const';
import { showBooster } from "./booster-show";


export async function stopBooster(ctx: Context, type: BOOSTER_TYPES_TYPE, boosterID: string) {
  const userID = ctx.from?.id;
  const user = await userManager.getOrCreateUser(userID);

  const activeBooster = Booster.getActiveBoosterBy(boosterID);
  if (!activeBooster) {
    await h.tryEditOrReply(ctx, `Couldn't find the booster you're trying to stop. Go back and try again`, getBackKeyboardFor(type));
    return;
  }
  if (user.tgID != activeBooster.ownerTgID) {
    await h.tryEditOrReply(ctx, `You are not the owner of this booster`, getBackKeyboardFor(type));
    return;
  }

  try {
    h.answerCbQuerySafe(ctx, `Stopping booster, please wait...`);
    activeBooster.askToStop();
    await h.sleep(4500);
    return await showBooster(ctx, activeBooster.type, type);
  } catch (e: any) {
    await h.tryEditOrReply(ctx, `Failed to stop the booster; technical details:\n${String(e)}`, getBackKeyboardFor(type));
    return;
  }
}
function getBackKeyboardFor(type: BOOSTER_TYPES_TYPE) {
  return {
    reply_markup: {
      inline_keyboard: [[{
        text: `${c.icons.backArrow} Back`,
        callback_data: `data-boosterShow-${type}`,
      }]]
    }
  }
}