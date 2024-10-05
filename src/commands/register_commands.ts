import { Context } from "telegraf";

import { telegraf, userManager } from "..";
import { tryReply } from "../helpers";



export async function registerCommands(ctx: Context) {
  const user = await userManager.getOrCreateUser(ctx.from?.id);
  if (!user.isBotAdmin) return;

  await telegraf.telegram.setMyCommands([
    {
      command: 'start',
      description: 'Pick token address',
    },
    {
      command: 'menu',
      description: 'Main menu',
    },
    {
      command: 'help',
      description: 'Show command help',
    },
  ]);

  return await tryReply(ctx, `Commands registered.`);
}

