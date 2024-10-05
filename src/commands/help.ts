import { DEF_MESSAGE_OPTS } from "../config";
import { tryReply } from "../helpers";


export async function showHelpMessage(ctx: any) {
  const helpMessage = `
/start - set token address
/menu - main menu
/help - show this text
`;

  return await tryReply(ctx, helpMessage, {
    ...DEF_MESSAGE_OPTS
  });
}