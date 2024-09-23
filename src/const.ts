import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { envConf } from "./config";

//export const CHANGE_WALLET_EVERY_N_BUYS = envConf.TEST_MODE ? 5 : 10;
//export const CHANGE_WALLET_EVERY_N_BUYS = 999999999; // unused; debug; do not change wallet
export const MIN_BALANCE_SOL = 0.015;
export const MIN_PUPPET_BALANCE_SOL = 0.005;
export const RESERVED_BOOSTER_BALANCE_SOL = 0.004;

export const REFERRAL_FEE_PERC = 20;
export const MIN_REF_CLAIM_AMOUNT_SOL = envConf.TEST_MODE ? 0.001 : 0.01;

export const NEW_BOOSTER_BALANCE_CHECK_INTERVAL = envConf.TEST_MODE ? 5 * 1000 : 30 * 1000;
export const NEW_BOOSTER_BALANCE_CHECK_HARD_TIMEOUT = 4 * 60 * 60 * 1000;
export const NEW_BOOSTER_MIN_ACCEPTED_BALANCE_SOL = envConf.TEST_MODE ? 0.05 : 0.25;
export const SAVED_BOOSTER_START_DELAY = envConf.TEST_MODE ? 2 * 1000 : 30 * 1000;

export const BOOSTER_TOP_GEAR = 5;
export const MAX_HOLDERS_PER_BOOSTER = 5000;
export const HOLDER_INCREMENT_STEP = 250;

export const POOL_UPDATE_INTERVAL = 1200 * 1000;
export const POOL_DATA_LARGE_URL = "https://api.raydium.io/v2/sdk/liquidity/mainnet.json";

export const JUPITER_API_URL = 'http://169.197.85.114:7676'; // self-hosted
//export const JUPITER_API_URL = 'https://quote-api.jup.ag/v6'; // public

export const JITO_BUNDLE_CHECK_TIMEOUT = 15 * 1000;
export const JITO_STATUS_CHECK_INTERVAL = 3 * 1000; 
export const BALANCE_CHANGE_CHECK_TIMEOUT = 15 * 1000;
export const JITO_BUNDLE_TIMEOUT = 20 * 1000;
//export const JITO_MAX_BUNDLES_PER_SEC_RATE_LIMIT = 5; // for regular keys
export const JITO_MAX_BUNDLES_PER_SEC_RATE_LIMIT = 50; // for our special key
export const JITO_MAX_BUNDLE_IDS_PER_STATUS_CHECK = 5;

export const SOCIALS = {
  name: "SolPulse Volume Bot",
  telegram: "",
};


export const WSOL_MINT_ADDR = "So11111111111111111111111111111111111111112";
export const DEFAULT_SOLANA_FEE_IN_LAMPS = 15001;
export const SWAP_PRIORITY_FEE_IN_LAMPS = 15001;
export const SWAP_SLIPPAGE_PERCENT = 15;
// total gas = cu * price1cu
export const DEFAULT_uLAMPS_PER_CU = 50000; // lamports per compute-unit; default Solana value
export const DEFAULT_NUM_OF_CU_PER_TX = 200000; // compute units per transaction; default Solana value

export const RENT_HOUR_TO_PRICE_MAP: any = {
  // hours : amount of SOL
  "1": 0.5,
  "3": 1.5,
  "6": 3,
  "12": 5,
  "24": 7,
  [String(7 * 24)]: 12,
  [String(30 * 24)]: 25,
};

export const icons = {
  green: "🟢",
  red: "🔴",
  white: "⚪️",
  black: "⚫️",
  globe: "🌐",
  rocket: "🚀",
  lock: "🔐",
  lightning: "⚡️",
  hourglassFull: "⏳",
  hourglassEmpty: "⌛️",
  clockRed: "⏰",
  clockAntique: "🕰",
  diskette: "💾",
  tool: "🛠",
  key: "🔑",
  keyAntique: "🗝",
  moonPlanet: "🪐",
  moonYellow: "🌕",
  moonWhite: "🪙",
  chainLink: "🔗",
  chartUpRed: "📈",
  chartBars: "📊",
  alienHappy: "👾",
  flame: "🔥",
  tractor: "🚜",
  truck: "🚛",
  car: "🚙",
  copcar: "🚓",
  racecar: "🏎",
  shield: "🛡️",
  plane: "✈️",
  questionRed: "❓",
  questionWhite: "❔",
  cup: "🏆",
  goblet: "🏆",
  people: "👫",
  peopleGrayFaceless: "🫂",
  lifebuoy: "🛟",
  ape: "🦧",
  bot: "🤖",
  bag: "🎒",
  attention: "⚠️",
  warning: "⚠️",
  greenSquare: "🟩",
  check: "✅",
  cross: "❌",
  backArrow: "↪️",
  rightArrow: "➡️",
  leftArrow: "⬅️",
  diagonalUpArrow: "↗️",
  diagonalDownArrow: "↘️",
  chevronLeft: "◀️",
  chevronRight: "▶️",
  circularArrow: "🔄",
  refresh: "🔄",
  arrowDoubledown: "⏬️",
  write: "📝",
  read: "📖",
  sprout: "🌱",
  lighting: "⚡",
  book: "📖",
  plus: "➕",
  minus: "➖",
  cashBanknote: "💵",
  cashBag: "💰",
  cashBankHouse: "🏦",
  cashDiamond: "💎",
  cashFaceTongue: "🤑",
  strongArm: "💪",
  anger: "🤬",
  salute: "🫡",
  thumbUp: "👍",
  thumbDown: "👎",
  handshake: "🤝",
  fingersCrossed: "🫰",
};

export const cars = {
  "1": icons.tractor,
  "2": icons.truck,
  "3": icons.car,
  "4": icons.racecar,
  "5": `${icons.racecar}${icons.copcar}${icons.copcar}${icons.copcar}`,
};
