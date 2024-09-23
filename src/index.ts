import * as solana from "@solana/web3.js";
import { Telegraf, Scenes, session } from "telegraf";
import { PrismaClient } from "@prisma/client";
import bs58 from "bs58";

import { envConf } from "./config";
import { showHelpMessage } from "./commands/help";
import { answerCbQuerySafe } from "./helpers";
import { TestCalcAmounts, TestMisc, TestRankBoostWorkflow } from "./test";
import { PoolMaster } from "./classes/PoolMaster";
import BotAdminManager from "./classes/BotAdminManager";
import { showUserBoosters } from "./actions/boosters-show-all";
import { showBooster } from "./actions/booster-show";
import {
  referIfNeeded_thenShowStart, refreshWorkMenu, showWelcomeMessage as showWelcomeMessage,
  showWorkMenu,
} from "./commands/start";
import { showReferralMenu } from "./actions/referrals-menu";
import { wizardReferralsClaim, wizardReferralsClaim_name } from "./scenes/referrals-claim";
import { rentBot, showRentOptions } from "./actions/rent-bot";
import { showWallet, withdrawFunds } from "./actions/wallet";
import { wizardWalletSet, wizardWalletSet_name } from "./scenes/wallet-set";
import { createAndStartBooster } from "./actions/booster-start";
import {
  holderSettingsDecrease, holderSettingsIncrease, setDurationSettings, setSpeedSettings, showDurationSettings,
  showSpeedSettings,
} from "./actions/settings";
import { wizardSetAddr, wizardSetAddr_name } from "./scenes/set-active-address";
import { registerCommands } from "./commands/register_commands";
import { stopBooster } from "./actions/booster-stop";
import { runJitoTipMetricUpdater } from "./utils/jito-tip-deamon";
import JitoStatusChecker from "./classes/JitoStatusChecker";

export const prisma = new PrismaClient();
export const telegraf = new Telegraf(envConf.TG_BOT_TOKEN);
export const web3Connection = new solana.Connection(envConf.HTTP_RPC_URL, { commitment: "confirmed" });
export const poolMaster_ = new PoolMaster();
export const userManager = new BotAdminManager();
export const statusChecker = new JitoStatusChecker();
console.log(`\nBooster bot starting up`);
//PkToAddress();
//TestMisc();
//TestCalcAmounts();
//jupiterJitoTest();
//TestRankBoostWorkflow();

//console.log(bs58.encode(solana.Keypair.generate().secretKey));

const stage = new Scenes.Stage([wizardReferralsClaim, wizardWalletSet, wizardSetAddr]);

telegraf.use(session());
telegraf.use(stage.middleware());

/* Good place for calling & testing functions you want to test in isolation */

// has to be before telegraf.start()
telegraf.hears(/^\/start[ =](.+)$/, (ctx) => referIfNeeded_thenShowStart(ctx, ctx.match[1]));

telegraf.start(showWelcomeMessage);
telegraf.help(showHelpMessage);
telegraf.command("menu", showWorkMenu);
telegraf.command(["boosters", "my_boosters", "my_boosts"], showUserBoosters);
//telegraf.command(["stop_boost", "stop_booster"], stopBooster);

/* Admin commands */
//telegraf.command("stop_all", stopAllBoosters_admin);
telegraf.command("register_commands", registerCommands);

telegraf.action("my_boosters", showUserBoosters);
telegraf.action("welcome_message", showWelcomeMessage);
telegraf.action("work_menu", showWorkMenu);
telegraf.action("work_menu_refresh", refreshWorkMenu);
telegraf.action("referrals", showReferralMenu);
telegraf.action("show_rent", showRentOptions);
telegraf.action("wallet", showWallet);
telegraf.action("withdraw", withdrawFunds);

telegraf.action("settings_speed", showSpeedSettings);
telegraf.action("settings_duration", showDurationSettings);
telegraf.action("settings_holders_inc", holderSettingsIncrease);
telegraf.action("settings_holders_dec", holderSettingsDecrease);

/* Wizards */

telegraf.action("token_address_wizard", async (ctx: any) => {
  ctx.scene.enter(wizardSetAddr_name, {});
});
telegraf.action("withdrawal_wallet", async (ctx: any) => {
  ctx.scene.enter(wizardWalletSet_name, {});
});
telegraf.action("referrals_claim", async (ctx: any) => {
  ctx.scene.enter(wizardReferralsClaim_name, {});
});

telegraf.action(/\bdata(-\w+)+\b/g, (ctx: any) => {
  const string = ctx.match[0];
  const args = string.split("-");
  const actionName = args[1];
  if (actionName === "setEntry") {
    const senderId = args[2];
    //setTimezoneCommand_forcedSender(ctx, senderId);
  } else if (actionName === "boosterShow") {
    const boosterType = args[2];
    const boosterID = args[3];
    showBooster(ctx, boosterType, boosterID);
  } else if (actionName === "boosterRefresh") {
    const boosterType = args[2];
    const boosterID = args[3];
    const refreshOnly = true;
    showBooster(ctx, boosterType, boosterID, refreshOnly);
  } else if (actionName === "boosterStart") {
    const boosterType = args[2];
    return createAndStartBooster(ctx, boosterType);
  } else if (actionName === "boosterStop") {
    const boosterType = args[2];
    const boosterID = args[3];
    return stopBooster(ctx, boosterType, boosterID);
  } else if (actionName === "settings") {
    const setting = args[2];
    const settingValue = args[3];
    if (setting == "speed") {
      setSpeedSettings(ctx, settingValue);
    } else if (setting == "duration") {
      setDurationSettings(ctx, settingValue);
    } else {
      return answerCbQuerySafe(ctx, `Unknown type of setting: ${setting}! 👎`);
    }
  } else if (actionName === "rent") {
    const duration = args[2];
    rentBot(ctx, duration);
    /*ctx.scene.enter(wizardSetTzLocation_name, {
      senderId: senderId,
    });*/
  } else {
    return answerCbQuerySafe(ctx, `Unknown action: ${actionName}! 👎`);
  }

  //console.log(`Action name: ${actionName}`);
  return answerCbQuerySafe(ctx);
});

process.once("SIGINT", () => telegraf.stop("SIGINT"));
process.once("SIGTERM", () => telegraf.stop("SIGTERM"));

telegraf.launch();

runJitoTipMetricUpdater();
statusChecker.run();
//adjustDatabaseValues();
async function adjustDatabaseValues() {
  const desiredParallelRankWallets = 15;
  await prisma.settings.updateMany({
    data: {
      rankParallelWallets: desiredParallelRankWallets,
    }
  });
  console.log(`Database values adjusted as requested`);
}