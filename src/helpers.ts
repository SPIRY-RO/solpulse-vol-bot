import * as solana from '@solana/web3.js';
import { Wallet } from '@coral-xyz/anchor';
import bs58 from 'bs58';
import { Context } from "telegraf";
import { WizardSessionData, WizardContext } from "telegraf/typings/scenes";
//import { Post } from "@prisma/client";

import { telegraf, prisma, userManager, web3Connection } from ".";
import { envConf } from "./config";
import { ChatPermissions } from "telegraf/typings/core/types/typegram";
import * as c from './const';


export type Argument = {
  value: string;
  placeholder: string;
};

export function unwrapCommandArguments(
  ctx: any,
  args: Argument[],
  dontWarnOnFail?: boolean,
) {
  if (!args) {
    return;
  }

  // Get an array of arguments between the marking character which is " ". for example /setup "test" "test3"
  // @ts-ignore
  const msgArguments: string[] = ctx.message?.text.split(" ");


  //console.log(msgArguments.length);
  //console.log(args.length + 1);

  // Check if the length of the unwrapped arguments is the same as the expected arguments
  if (msgArguments.length !== args.length + 1) {
    if (!dontWarnOnFail) {
      ctx.reply(
        `⚠️ There was an error processing your command. 
Please check command tutorial and check again.

📍 *Tutorial*: /${ctx.command} <${args.map((arg) => arg.value).join("> <")}> 
✅ *Example usage*: /${ctx.command} ${args.map((arg) => arg.placeholder).join(" ")}
`,
        {
          parse_mode: "Markdown",
        }
      );
    }
    return null;
  }

  // Create an object, where the key is the argument name and the value is the argument value
  return args.reduce((acc: any, arg, index) => {
    acc[arg.value] = msgArguments[index + 1];
    return acc;
  }, {});
}


export async function sleep(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}



export function escapeHTML(unsafeString: string | null) {
  if (unsafeString === null)
    return '';
  return unsafeString.replace(/[&<"']/g, function (m) {
    switch (m) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '"':
        return '&quot;';
      default:
        return '&#039;';
    }
  });
};


export async function answerCbQuerySafe(
  ctx: Context | WizardContext<WizardSessionData>,
  queryText?: string
) {
  try {
    if (queryText)
      return await ctx.answerCbQuery(queryText);
    else
      return await ctx.answerCbQuery();
  } catch {

  };
}


export async function tryReply(ctx: any, text: string, params?: {}) {
  const senderId = ctx.update?.callback_query?.from?.id || ctx.update?.message?.from?.id;
  /*
  console.dir(ctx, {depth: 4});
  console.log(`===============================`);
  console.dir(ctx.message, {depth: 6});
  */
  try {
    return await ctx.reply(text, params);
  } catch (e: any) {
    if (envConf.DEBUG_MODE) {
      //console.warn(`Failed to do ctx.reply() for ${senderId}; ${e}`);
    }
  }
}

export async function tryEditOrReply(ctx: any, text: string, params?: {}) {
  const senderId = ctx.update?.callback_query?.from?.id || ctx.update?.message?.from?.id;
  const prevMessageID = ctx.callbackQuery?.message?.message_id;
  if (prevMessageID) {
    try {
      return await ctx.editMessageText(text, params);
    } catch (e: any) {
      if (envConf.DEBUG_MODE) {
        //console.warn(`Failed to edit message for sender '${senderId}'; message '${prevMessageID}'; ${e}`);
      }
    }
  }
  try {
    return await ctx.reply(text, params);
  } catch (e: any) {
    if (envConf.DEBUG_MODE) {
      //console.warn(`Failed to do ctx.reply() for ${senderId}' ${e}`);
    }
  }
}

export async function tryEdit(ctx: any, text: string, params?: {}) {
  const senderId = ctx.update?.callback_query?.from?.id || ctx.update?.message?.from?.id;
  const prevMessageID = ctx.callbackQuery?.message?.message_id;
  if (prevMessageID) {
    try {
      return await ctx.editMessageText(text, params);
    } catch (e: any) {
      if (envConf.DEBUG_MODE) {
        //console.warn(`Failed to edit message for sender '${senderId}'; message '${prevMessageID}'; ${e}`);
      }
    }
  }
}

export async function trySend(chatId: number | string, text: string, params: {} = {}) {
  try {
    return await telegraf.telegram.sendMessage(chatId, text, params);
  } catch (e: any) {
    if (envConf.DEBUG_MODE) {
      //console.warn(`Failed to send message to '${chatId}'; message; ${e}`);
    }
  }
}



const LOCKED_PERMISSIONS: ChatPermissions = {
  can_send_messages: false,
  can_send_audios: false,
  can_send_photos: false,
  can_send_videos: false,
  can_send_documents: false,
  can_send_voice_notes: false, // voice messages
  can_send_video_notes: false, // video messages
  can_send_other_messages: false, // GIFs & stickers
  can_add_web_page_previews: false,
};

const UNLOCKED_PERMISSIONS = (() => {
  const unlockedPermissions: ChatPermissions = {}
  for (const [permission, _] of Object.entries(LOCKED_PERMISSIONS)) {
    //@ts-ignore
    unlockedPermissions[permission] = true
  }
  return unlockedPermissions;
})();

export async function lockChat(chatId: string | number) {
  try {
    //@ts-ignore
    const oldPermissions = (await telegraf.telegram.getChat(chatId))?.permissions;
    const newPermissions = {
      ...oldPermissions,
      ...LOCKED_PERMISSIONS,
    };

    await telegraf.telegram.setChatPermissions(chatId, newPermissions, {
      use_independent_chat_permissions: true,
    });
    return true;
  } catch (e: any) {
    console.error(`Error when locking chat '${chatId}': ${e}`);
    return false;
  }
}

export async function unlockChat(chatId: string | number) {
  try {
    //@ts-ignore
    const oldPermissions = (await telegraf.telegram.getChat(chatId))?.permissions;
    const newPermissions = {
      ...oldPermissions,
      ...UNLOCKED_PERMISSIONS,
    };

    await telegraf.telegram.setChatPermissions(chatId, newPermissions, {
      use_independent_chat_permissions: true,
    });

    return true;
  } catch (e: any) {
    console.error(`Error when unlocking chat '${chatId}': ${e}`);
    return false;
  }
}

export async function isChatLocked(chatId: string | number) {
  //@ts-ignore
  const permissions: ChatPermissions = (await telegraf.telegram.getChat(chatId))?.permissions;
  if (!permissions) {
    console.warn(`Failed to retrieve permissions for chat '${chatId}'`);
    return false;
  } else if (permissions.can_send_messages === false) {
    return true;
  } else {
    return false;
  }
}

export async function cancelWizardGeneric(ctx: any) {
  answerCbQuerySafe(ctx);
  await tryReply(ctx, 'Operation cancelled.');
  return ctx.scene.leave();
}


export function getFormattedLocation(location: string) {
  let formatted = '';
  if (location)
    formatted = `They also say they are from <i>${location}</i>`
  return formatted;
}


/*
export async function isUserKnown(userID: number) {
  if (!userID)
    return false;
  const userEntry = await prisma.user.findUnique({
    where: {
      tgID: userID.toString(),
    },
  });
  return (!!userEntry);
}
*/


const ANIMALS = [
  '🐢', '🦕', '🦖', '🦎', '🦉', '🐴', '🦄', '🐡', '🦑', '🦧',
  '🐏', '🐖', '🐈', '🐁', '🐀', '🐕', '🦙', '🐓',
]
export function getRandomAnimalEmoji() {
  const index = Math.floor(Math.random() * (ANIMALS.length - 1));
  return ANIMALS[index];
}


export function debug(string: any, object?: any) {
  if (envConf.DEBUG_MODE) {
    console.log(string);
    if (object !== undefined)
      console.dir(object, { depth: 10 });
  }
}

export function isSolAddrValid(address: string): boolean {
  try {
    new solana.PublicKey(address);
    return true;
  } catch (error) {
    return false;
  }
}

export function isSolPrivkeyValid(privateKey: string): boolean {
  try {
    solana.Keypair.fromSecretKey(Uint8Array.from(bs58.decode(privateKey)));
    return true;
  } catch (error) {
    return false;
  }
}


export function keypairFrom(privateKey: string | Uint8Array) {
  if (privateKey instanceof Uint8Array)
    return solana.Keypair.fromSecretKey(privateKey);
  else
    return solana.Keypair.fromSecretKey(Uint8Array.from(bs58.decode(privateKey)));
}

export function walletFrom(privateKey: string) {
  return new Wallet(solana.Keypair.fromSecretKey(Uint8Array.from(bs58.decode(privateKey))));
}

export function pubkeyFrom(privateKey: string | Uint8Array) {
  if (privateKey instanceof Uint8Array)
    return solana.Keypair.fromSecretKey(privateKey).publicKey;
  else
    return solana.Keypair.fromSecretKey(Uint8Array.from(bs58.decode(privateKey))).publicKey;
}

export function getNewRandWallet() {
  const rndKeypair = solana.Keypair.generate();
  return new Wallet(rndKeypair);
}

export function getNewRandPK() {
  const rndKeypair = solana.Keypair.generate();
  return bs58.encode(rndKeypair.secretKey);
}


export function createDeepLink(params: string) {
  return `https://t.me/${telegraf.botInfo?.username}?start=${params}`;
}

export function getRandomDelayBetweenTx() {
  return (Number((Math.random() * envConf.MAX_DELAY_BETWEEN_TX_SEC).toPrecision(4))) * 1000;
}

export function getExpiryTsHoursFromNow(hoursUntilExpiration: number | string) {
  //@ts-ignore
  const msTillExpiration = hoursUntilExpiration * 60 * 60 * 1000;
  return Number((Date.now() + msTillExpiration).toFixed());
}


export function timingNotationToSeconds(notation: string) {
  let totalTime = 0;
  if (!notation) {
    console.log(`Missing adequate notation; got this instead: '${notation}'`)
    return 0
  }
  const regex = /(?<timing1>[0-9]{0,4}[d|h|m|s])[' ']*(?<timing2>[0-9]{0,4}[d|h|m|s])?/;
  const found = notation.match(regex);
  if (!found?.groups)
    return totalTime
  for (const [key, value] of Object.entries(found?.groups)) {
    if (!value)
      continue
    const unit = value.slice(-1)
    const figure = Number(value.slice(0, -1))
    if (unit == 's')
      totalTime += figure
    else if (unit == 'm')
      totalTime += figure * 60
    else if (unit == 'h')
      totalTime += figure * 3600
    else if (unit == 'd')
      totalTime += figure * 3600 * 24
  }
  return totalTime
}


export function secondsToTimingNotation(seconds: number | string, omitSecondsInOutput?: boolean) {
  seconds = Number(seconds);
  if (seconds < 1)
    return 'expired'

  const days = Math.floor(seconds / (3600 * 24))
  seconds = seconds % (3600 * 24)
  const hours = Math.floor(seconds / 3600)
  seconds = seconds % 3600
  const minutes = Math.floor(seconds / 60)
  seconds = seconds % 60

  let notation = (days ? `${days}d ` : '') + (hours ? `${hours}h ` : '') + (minutes ? `${minutes}m` : '')
  if (!notation && omitSecondsInOutput)
    notation = `0m`
  else if (!notation)
    notation = `${seconds}s`

  return notation
}


export function getRandomNumber(min: number = 25, max: number = 75, precision = 4) {
  return Number((Math.random() * (max - min) + min).toPrecision(precision));
}

export function getShortAddr(address: string | solana.PublicKey) {
  if (typeof (address) === "string")
    address = new solana.PublicKey(address);
  address = address.toBase58();
  return `${address.slice(0, 4)}..${address.slice(-4)}`;
}

export function getCarFor(speed: number | string) {
  speed = String(speed);
  //@ts-ignore
  return c.cars[speed];
}

export async function getUserProfileLinkFrom(userID: number | string) {
  const userData = await telegraf.telegram.getChat(userID) as any;
  let displayName = escapeHTML(userData.first_name + ' ' + (userData.last_name || ''));
  if (userData.username)
    displayName = '@' + userData.username;
  return `<a href=\"tg://user?id=${userID}\">${displayName}</a>`;
}

export function incrementByPercent(number: number, percentage: number): number {
  return Math.round(number + (number * percentage) / 100);
}

export function roundDown(value: number, decimals = 0) {
  return Math.trunc(value * 10 ** decimals) / 10 ** decimals;
}