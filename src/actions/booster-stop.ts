import { Context } from "telegraf";
import { Booster as BoosterPrisma } from "@prisma/client";

import { prisma, userManager } from '..';
import BoosterBase, {BoosterType} from "../classes/boosters/base";
import * as h from '../helpers';
import * as c from '../const';
import { showBooster } from "./booster-show";


export async function stopBooster(ctx: Context, type: BoosterType, boosterID: string) {
  const userID = ctx.from?.id;
  const user = await userManager.getOrCreateUser(userID);

  const activeBooster = BoosterBase.getActiveByID(boosterID);
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
    await h.sleep(2500);
    return await showBooster(ctx, activeBooster.type, type);
  } catch (e: any) {
    await h.tryEditOrReply(ctx, `Failed to stop the booster; technical details:\n${String(e)}`, getBackKeyboardFor(type));
    return;
  }
}



function getBackKeyboardFor(type: BoosterType) {
  return {
    reply_markup: {
      inline_keyboard: [[{
        text: `${c.icons.backArrow} Back`,
        callback_data: `data-boosterShow-${type}`,
      }]]
    }
  }
}