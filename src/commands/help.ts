import { DEF_MESSAGE_OPTS } from "../config";
import { tryReply } from "../helpers";


export async function showHelpMessage(ctx: any) {
  const helpMessage = `
/start - Start Menu
/menu - Main Menu
/help - Commands List
`;

  return await tryReply(ctx, helpMessage, {
    ...DEF_MESSAGE_OPTS
  });
}