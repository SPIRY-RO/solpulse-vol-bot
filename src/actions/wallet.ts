import * as solana from "@solana/web3.js";
import bs58 from "bs58";
import { Context } from "telegraf";

import { answerCbQuerySafe, debug, keypairFrom, tryEditOrReply, tryReply } from "../helpers";
import { DEF_MESSAGE_OPTS, envConf } from "../config";
import { prisma, userManager, web3Connection } from "..";
import * as c from "../const";
import { workMenuBackButton } from "../commands/start";
import RaydiumSwap from "../classes/RaydiumSwap";
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

  const workKP = keypairFrom(user.workWalletPK);

  const balanceLamps = await web3Connection.getBalance(workKP.publicKey);
  const balanceSol = balanceLamps / solana.LAMPORTS_PER_SOL;
  answerCbQuerySafe(ctx);

  await tryEditOrReply(
    ctx,
    `
${c.icons.cashBankHouse} Balance: <b>${
      balanceSol < c.RESERVED_BOOSTER_BALANCE_SOL ? "empty" : `${balanceSol.toFixed(4)} SOL`
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

  const workWalletKP = keypairFrom(user.workWalletPK);
  const balanceLamps = await web3Connection.getBalance(workWalletKP.publicKey);
  const balanceSol = balanceLamps / solana.LAMPORTS_PER_SOL;

  const raySwap = new RaydiumSwap(workWalletKP, new solana.PublicKey(c.WSOL_MINT_ADDR));

  const ulampsPerCU = c.DEFAULT_uLAMPS_PER_CU;
  const priorityFeeLamps = (ulampsPerCU * c.DEFAULT_NUM_OF_CU_PER_TX) / 10 ** 6;
  const rentExemptionLamp = await raySwap.tryGetRentExemptionFee(null);
  debug(`Lamports needed to keep acc rent-exempt: ${rentExemptionLamp}`);
  const magicNumber = 1.1; // makes my maths actually work
  const resBalance_normalTx = (priorityFeeLamps + rentExemptionLamp + c.DEFAULT_SOLANA_FEE_IN_LAMPS) * magicNumber;
  const resBalance_forJitoBundle = resBalance_normalTx + jitoTip.chanceOf99;
  const freeBalance = Number((balanceLamps - resBalance_forJitoBundle).toFixed());
  debug(`Reserved SOL: ${(balanceLamps - freeBalance) / solana.LAMPORTS_PER_SOL}`);
  debug(`Available balance after all fees & rent: ${freeBalance}`);

  if (balanceSol < 0.001 || freeBalance <= 0) {
    await tryReply(ctx, `Not enough funds to withdraw`);
    return;
  }

  const transferTx = await raySwap.getSolTransferTx(
    null,
    new solana.PublicKey(user.withdrawWalletAddr),
    freeBalance,
    ulampsPerCU
  );

  tryReply(ctx, `Funds detected. Beginning transfer... Waiting time: 20-60 seconds`);
  const success = await makeAndSendJitoBundle([transferTx], workWalletKP);
  if (success) {
    await tryReply(ctx, `Withdrawal successful! Withdrew ${freeBalance / solana.LAMPORTS_PER_SOL} SOL`);
  } else {
    await tryReply(ctx, `Failed to withdraw funds; try again. If this error keeps repeating, contact our team.`);
  }
  return;
}
