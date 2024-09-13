import * as solana from '@solana/web3.js';
import { Context, Scenes } from "telegraf";

import { prisma, telegraf, userManager, web3Connection } from "..";
import { DEF_MESSAGE_OPTS, envConf } from "../config";
import * as c from "../const";
import * as h from "../helpers";
import { showWorkMenu, workMenuBackButtonKeyboard } from '../commands/start';


export const wizardWalletSet_name = "wizard-set-withdrawal-wallet";

export const wizardWalletSet = new Scenes.WizardScene(
  wizardWalletSet_name,
  firstStep,
  finalStep,
);
wizardWalletSet.command('cancel', h.cancelWizardGeneric);
wizardWalletSet.action('work_menu', async (ctx) => {
  ctx.scene.leave();
  return showWorkMenu(ctx);
});


async function firstStep(ctx: any) {
  h.answerCbQuerySafe(ctx);
  const user = await userManager.getOrCreateUser(ctx.from?.id);

  const text = `Send me the address you'd like to withdraw your remaining SOL to`;
  await h.tryEditOrReply(ctx, text, {
    reply_markup: workMenuBackButtonKeyboard, ...DEF_MESSAGE_OPTS
  });
  return ctx.wizard.next();
}


async function finalStep(ctx: any) {
  const textInput = ctx.message?.text;
  const cbInput = ctx.callbackQuery?.data;
  const user = await userManager.getOrCreateUser(ctx.from?.id);

  if (!h.isSolAddrValid(textInput)) {
    await h.tryEditOrReply(ctx, `Invalid address supplied; ${textInput}; try again with another address or do /cancel`, { reply_markup: workMenuBackButtonKeyboard });
    return;
  }

  try {
    await prisma.user.update({
      where: { internalID: user.internalID },
      data: { withdrawWalletAddr: textInput },
    })

    await h.tryEditOrReply(ctx, `Withdrawal address added successfully`, {reply_markup: workMenuBackButtonKeyboard});
    return ctx.scene.leave();

  } catch (e: any) {
    console.error(`Error in ${wizardWalletSet_name}, 2nd step: ${e}`);
    console.trace(e);
    await h.tryEditOrReply(ctx, `Failed to add withdrawal wallet; try again`, {reply_markup: workMenuBackButtonKeyboard});
    return ctx.scene.leave();
  }
}
