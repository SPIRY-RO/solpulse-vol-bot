import * as solana from '@solana/web3.js';
import { Context } from "telegraf";

import * as c from '../const';
import { answerCbQuerySafe, createDeepLink, tryEditOrReply, tryReply } from '../helpers';
import { DEF_MESSAGE_OPTS } from '../config';
import { prisma, userManager } from '..';
import { REFERRAL_FEE_PERC } from '../const';


export async function showReferralMenu(ctx: Context) {
  answerCbQuerySafe(ctx);
  const senderID_str = String(ctx.from?.id);

  const user = await userManager.getOrCreateUser(senderID_str);
  const referralLink = createDeepLink(`r-${senderID_str}`);
  const referrals = await prisma.user.findMany({
    where: {
      referredByTgID: senderID_str,
    }
  });

  let text = `${c.icons.handshake} Referrals ${c.icons.handshake}

Get a share of profit from every time your referral rents our bot!
Get them to start the bot via your link once, and bot will generate revenue for you every time they pay rent!

${c.icons.cashFaceTongue} Current referral share: ${REFERRAL_FEE_PERC}%
(from every time users unlock the bot)

${c.icons.salute} Your referrals: ${referrals.length}

${c.icons.chainLink} Your referral link:
${referralLink}

${c.icons.cashBankHouse} All-time rewards: ${user.totalRefRewards} SOL
(delivered straight into your in-bot wallet)
`

  await tryEditOrReply(ctx, text, {
    reply_markup: {
      inline_keyboard: [
        [{
          text: `${c.icons.backArrow} Back`,
          callback_data: `work_menu`,
        }],
      ]
    },
    ...DEF_MESSAGE_OPTS
  });
  return;
}

