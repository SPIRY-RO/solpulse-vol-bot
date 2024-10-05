import { Context, Scenes } from "telegraf";

import { prisma, telegraf, userManager } from "..";
import { DEF_MESSAGE_OPTS } from "../config";
import {
  answerCbQuerySafe, cancelWizardGeneric,
  isSolAddrValid,
  tryEditOrReply, tryReply
} from "../helpers";
import * as sh from "../utils/solana_helpers";
import { showWelcomeMessage, showWorkMenu } from "../commands/start";


export const wizardSetAddr_name = "wizard-set-active-address";
export const wizardSetAddr = new Scenes.WizardScene(
  wizardSetAddr_name,
  firstStep,
  finalStep,
);
wizardSetAddr.command('cancel', cancelWizardGeneric);
wizardSetAddr.action('welcome_message', async (ctx) => {
  ctx.scene.leave();
  return showWelcomeMessage(ctx);
});


async function firstStep(ctx: any) {
  answerCbQuerySafe(ctx);
  const text = `Enter the contract address of the token you want to boost below`;
  await tryEditOrReply(ctx, text, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: `Back`,
            callback_data: `welcome_message`,
          }
        ],
      ]
    },
    ...DEF_MESSAGE_OPTS
  });
  return ctx.wizard.next();
}


async function finalStep(ctx: any) {
  const textInput = ctx.message?.text;
  const cbInput = ctx.callbackQuery?.data;

  if (!isSolAddrValid(textInput)) {
    await tryReply(ctx, `Invalid token address supplied; ${textInput}; try again or do /cancel`);
    return;
  } else if (!await sh.canTokenBeTraded(textInput)) {
    await tryReply(ctx, `Token can't be traded: <code>${textInput}</code>.`,
      { ...DEF_MESSAGE_OPTS });
    return ctx.scene.leave();
  }

  const tokenAddr = textInput;
  const userSettings = await userManager.getOrCreateSettingsFor(ctx.from.id);

  await prisma.settings.update({
    where: { internalID: userSettings.internalID },
    data: { selectedTokenAddr: tokenAddr },
  });

  ctx.scene.leave();
  return await showWorkMenu(ctx);
}
