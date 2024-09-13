import { Context } from "telegraf";
import { Booster as BoosterPrisma } from "@prisma/client";

import { prisma, userManager } from '..';
import Booster, { BOOSTER_TYPES_TYPE } from '../classes/Booster';
import * as h from '../helpers';
import * as c from '../const';
import { showBooster } from "./booster-show";


export async function createAndStartBooster(ctx: Context, type: BOOSTER_TYPES_TYPE) {
  const userID = ctx.from?.id;
  const user = await userManager.getOrCreateUser(userID);
  const settings = await userManager.getOrCreateSettingsFor(userID);
  const balance = await userManager.getWorkWalletBalanceFor(user);
  if (balance < c.RESERVED_BOOSTER_BALANCE_SOL) {
    h.tryEditOrReply(ctx, `Balance is too small: ${balance} SOL; booster will not start. You need to deposit some funds.`, getBackKeyboardFor(type));
  }

  const activeBoosterData_sameType = await Booster.getActiveBoosterDataFor(settings.selectedTokenAddr, type, userID);
  const isSameBoosterReallyActive = (
    activeBoosterData_sameType && !!Booster.getActiveBoosterBy(activeBoosterData_sameType.internalID)
  );
  const activeBoosterData_other = await prisma.booster.findFirst({
    where: {
      ownerTgID: String(userID),
      isActive: true,
      NOT: {
        internalID: {
          equals: activeBoosterData_sameType?.internalID,
        }
      }
    }
  });
  const isOtherBoosterReallyActive = (
    activeBoosterData_sameType && !!Booster.getActiveBoosterBy(activeBoosterData_sameType.internalID)
  );

  if (activeBoosterData_sameType && isSameBoosterReallyActive) {
    await h.tryEditOrReply(ctx, `There's already an active booster for ${settings.selectedTokenAddr}|${type} from you. If you've just stopped it, try again in a minute or two`, getBackKeyboardFor(type));
    return;
  } else if (activeBoosterData_other && isOtherBoosterReallyActive) {
    await h.tryEditOrReply(ctx, `You have another active booster <code>${settings.selectedTokenAddr}</code>|${type}. Please, stop it first`, getBackKeyboardFor(type));
    return;
  } else if (Date.now() > user.rentExpiresAt) {
    await h.tryEditOrReply(ctx, `Your rental time of the bot has expired. You can extend it from the main menu`, getBackKeyboardFor(type));
    return;
  } else if (activeBoosterData_sameType || activeBoosterData_other) {
    await ensureInactiveBoostersAreProperlyMarked(
      activeBoosterData_sameType, isSameBoosterReallyActive,
      activeBoosterData_other, isOtherBoosterReallyActive
    );
  }

  let newBooster = null;
  try {
    h.answerCbQuerySafe(ctx, `Starting booster, please wait...`);
    newBooster = new Booster(type, settings.selectedTokenAddr, user);
    newBooster.start();
    await h.sleep(3000);
    return await showBooster(ctx, type);
  } catch (e: any) {
    await h.tryEditOrReply(ctx, `Failed to start the booster; technical details:\n${String(e)}`, getBackKeyboardFor(type));
    return;
  }
  return newBooster;
}



async function ensureInactiveBoostersAreProperlyMarked(
  activeBoosterData_sameType: BoosterPrisma | null, sameTypeIsReallyActive: boolean | null,
  activeBoosterData_other: BoosterPrisma | null, otherTypeIsReallyActive: boolean | null,
) {
  if (activeBoosterData_sameType && !sameTypeIsReallyActive) {
    await prisma.booster.update({
      where: { internalID: activeBoosterData_sameType.internalID },
      data: { isActive: false }
    });
    console.warn(`Inactive booster ${activeBoosterData_sameType.tokenAddress}|${activeBoosterData_sameType.type} that is still marked as active in DB found & properly marked as inactive`);
  }
  if (activeBoosterData_other && !otherTypeIsReallyActive) {
    await prisma.booster.update({
      where: { internalID: activeBoosterData_other.internalID },
      data: { isActive: false }
    });
    console.warn(`Inactive booster ${activeBoosterData_other.tokenAddress}|${activeBoosterData_other.type} that is still marked as active in DB found & properly marked as inactive`);
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