import * as solana from '@solana/web3.js';
import { Context } from "telegraf";
import { Booster as BoosterPrisma } from "@prisma/client";

import { prisma, userManager } from '..';
import BoosterBase, { BoosterType } from "../classes/boosters/base";
import BoosterVolume from "../classes/boosters/volume";
import BoosterRank from "../classes/boosters/rank";
import * as h from '../helpers';
import * as c from '../const';
import { showBooster } from "./booster-show";
import BoosterHolders from '../classes/boosters/holder';


export async function createAndStartBooster(ctx: Context, type: BoosterType) {
  const userID = String(ctx.from!.id);
  const user = await userManager.getOrCreateUser(userID);
  const settings = await userManager.getOrCreateSettingsFor(userID);
  //const balance = await userManager.getWorkWalletBalanceFor(user);
  const balance = await userManager.getBalFromAllAssociatedWallets_inSol(user);
  if (balance < c.MIN_BOOSTER_BALANCE_SOL) {
    h.tryEditOrReply(ctx, `Balance is too small: ${balance} SOL; booster will not start. You need to deposit some funds.`, getBackKeyboardFor(type));
  }

  const activeBoosterOfSameType = BoosterBase.getActiveBoosterFor(settings.selectedTokenAddr, type, userID);
  let existingDbEntry_OtherOfSameType: BoosterPrisma | null = null;
  if (activeBoosterOfSameType) {
    existingDbEntry_OtherOfSameType = await prisma.booster.findFirst({
      where: {
        tokenAddress: activeBoosterOfSameType.tokenAddr.toBase58(),
        ownerTgID: userID,
        NOT: {
          internalID: {
            equals: activeBoosterOfSameType.internalID || '',
          }
        }
      }
    });
  }
  const existingDbEntry_isActive = (
    existingDbEntry_OtherOfSameType && BoosterBase.getActiveByID(existingDbEntry_OtherOfSameType.internalID)
  );

  if (existingDbEntry_OtherOfSameType && !existingDbEntry_isActive) {
    await prisma.booster.delete({ where: { internalID: existingDbEntry_OtherOfSameType.internalID } });
    h.debug(`found and removed old inactive booster DB entry for ${h.getShortAddr(existingDbEntry_OtherOfSameType.tokenAddress)}:${existingDbEntry_OtherOfSameType.type}, user '${userID}'`);
  }
  if (activeBoosterOfSameType || existingDbEntry_isActive) {
    await h.tryEditOrReply(ctx, `There's already an active booster for ${settings.selectedTokenAddr}|${type} from you. If you've just stopped it, try again in a minute or two`, getBackKeyboardFor(type));
    return;
  } else if (Date.now() > user.rentExpiresAt) {
    await h.tryEditOrReply(ctx, `Your rental time of the bot has expired. You can extend it from the main menu`, getBackKeyboardFor(type));
    return;
  }

  let newBooster: BoosterBase | null = null;
  try {
    h.answerCbQuerySafe(ctx, `Starting booster, please wait...`);
    if (type === "volume") {
      newBooster = new BoosterVolume(
        h.keypairFrom(user.workWalletPrivKey), userID, new solana.PublicKey(settings.selectedTokenAddr), settings
      );
    } else if (type === "rank") {
      newBooster = new BoosterRank(
        h.keypairFrom(user.workWalletPrivKey), userID, new solana.PublicKey(settings.selectedTokenAddr), settings
      );
    } else if (type === "holders") {
      newBooster = new BoosterHolders(
        h.keypairFrom(user.workWalletPrivKey), userID, new solana.PublicKey(settings.selectedTokenAddr), settings
      );
    } else {
      throw new Error(`Unreachable code reached`);
    }
    newBooster.start();
    await h.sleep(3000);
    return await showBooster(ctx, type, newBooster.internalID!, true);
  } catch (e: any) {
    await h.tryEditOrReply(ctx, `Failed to start the booster; technical details:\n${String(e)}`, getBackKeyboardFor(type));
    return;
  }
  return newBooster;
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