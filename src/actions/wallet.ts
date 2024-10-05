import * as solana from "@solana/web3.js";
import bs58 from "bs58";
import { Context } from "telegraf";

import { answerCbQuerySafe, debug, keypairFrom, tryEditOrReply, tryReply } from "../helpers";
import { DEF_MESSAGE_OPTS, envConf } from "../config";
import { prisma, userManager, web3Connection } from "..";
import * as c from "../const";
import * as h from "../helpers";
import * as sh from "../utils/solana_helpers";
import { workMenuBackButton } from "../commands/start";
import { makeAndSendJitoBundle } from "../utils/jito";
import { jitoTip } from "../utils/jito-tip-deamons";

const keyboard = {
  inline_keyboard: [
    [{ text: `${c.icons.arrowDoubledown} Withdraw all funds`, callback_data: `withdraw` }],
    [{ text: `${c.icons.write} Set withdrawal wallet`, callback_data: `withdrawal_wallet` }],
    [workMenuBackButton, { text: `${c.icons.refresh} Refresh`, callback_data: `wallet` }],
  ],
};

export async function showWallet(ctx: Context) {
  const user = await userManager.getOrCreateUser(ctx.from?.id);
  const workKP = keypairFrom(user.workWalletPrivKey);
  h.debug(`[${h.getShortAddr(workKP.publicKey)}] user ${user.tgID} requested wallet overview`);

  const balanceLamps = await web3Connection.getBalance(workKP.publicKey);
  const balanceSol = balanceLamps / solana.LAMPORTS_PER_SOL;
  answerCbQuerySafe(ctx);

  await tryEditOrReply(
    ctx,
    `
${c.icons.cashBankHouse} Balance: <b>${
      balanceSol < c.MIN_BOOSTER_BALANCE_SOL ? "empty" : `${balanceSol.toFixed(4)} SOL`
    }</b>

${c.icons.cashBanknote} Address:
<code>${workKP.publicKey.toBase58()}</code>
${c.icons.lock} Private key:
<code>${bs58.encode(workKP.secretKey)}</code>

${c.icons.arrowDoubledown} Withdrawal wallet:
${user.withdrawWalletAddr ? `<code>${user.withdrawWalletAddr}</code>` : "<i>unset</i>"}
`,
    {
      reply_markup: keyboard,
      ...DEF_MESSAGE_OPTS,
    }
  );
}

export async function withdrawFunds(ctx: Context) {
  answerCbQuerySafe(ctx);
  const user = await userManager.getOrCreateUser(ctx.from?.id);
  const workWalletKP = keypairFrom(user.workWalletPrivKey);
  h.debug(`[${h.getShortAddr(workWalletKP.publicKey)}] user ${user.tgID} requested withdrawal`);

  const balanceSol = await sh.getSolBalance(workWalletKP.publicKey);
  if (balanceSol === null) {
    h.debug(`[${h.getShortAddr(workWalletKP.publicKey)}] failed to fetch balance`);
    await h.tryEditOrReply(ctx, `Failed to fetch balance, likely due to network error; please, try again, it'll work after a few tries`);
    return;
  }
  const availableBalance = balanceSol - 0.003;
  if (availableBalance <= 0) {
    h.debug(`[${h.getShortAddr(workWalletKP.publicKey)}] not enough funds to withdraw`);
    await h.tryEditOrReply(ctx, `Not enough funds to withdraw`);
    return;
  }

  tryReply(ctx, `Funds detected. Beginning transfer... Waiting time: 20-60 seconds`);
  const txHash = await sh.sendAllSol(workWalletKP, new solana.PublicKey(user.withdrawWalletAddr));
  const success = !!txHash;
  if (success) {
    await tryReply(ctx, `Withdrawal successful! Withdrew ${availableBalance} SOL`);
  } else {
    await tryReply(ctx, `Failed to withdraw funds; try again. If this error keeps repeating, contact our team.`);
  }
  return;
}
