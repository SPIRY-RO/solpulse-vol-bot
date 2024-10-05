import { Context } from "telegraf";

import { prisma, userManager } from "..";
import BoosterBase from "../classes/boosters/base";
import { DEF_MESSAGE_OPTS } from "../config";
import { answerCbQuerySafe, tryEditOrReply, tryReply } from "../helpers";
import { workMenuBackButton, workMenuBackButtonKeyboard } from "../commands/start";


export async function showUserBoosters(ctx: Context) {
  answerCbQuerySafe(ctx);
  return;

/*
  const user = await userManager.getOrCreateUser(ctx.from?.id);
  const boosters = await prisma.booster.findMany({where: {
    ownerTgID: user.tgID, isActive: true,
  }})
  if (boosters.length === 0) {
    tryEditOrReply(ctx, `You have no active boosters`, {reply_markup: workMenuBackButtonKeyboard});
    return;
  }

  const boostersKeyboard = [];
  let boostersText = 'Your active boosters';
  for (const boosterData of boosters) {
    const booster = Booster.getActiveBoosterBy(boosterData.internalID)
    if (!booster) continue;
    boostersKeyboard.push([{
      text: `${booster.shortName}`,
      callback_data: `data-showBooster-${booster.internalID}`,
    }]);
  }
  boostersKeyboard.push([workMenuBackButton]);

  return await tryEditOrReply(ctx, boostersText, {
    reply_markup: { inline_keyboard: boostersKeyboard },
    ...DEF_MESSAGE_OPTS
  });
  */
}

