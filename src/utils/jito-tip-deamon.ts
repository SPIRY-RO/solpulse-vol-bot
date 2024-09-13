import * as solana from "@solana/web3.js";
import axios from "axios";

import * as h from "../helpers";

const JITO_TIP_STAT_CHECK_INTERVAL = 25 * 1000;
const TIP_STATS_API_URL = "http://bundles-api-rest.jito.wtf/api/v1/bundles/tip_floor";
const OVER_99_INCREMENT_FACTOR = 1.15;



export const jitoTip: TipMetrics = {
  chanceOf25_inSol: 0,
  chanceOf50_inSol: 0,
  chanceOf75_inSol: 0,
  chanceOf95_inSol: 0,
  chanceOf99_inSol: 0,
  chanceOfOver99_inSol: 0,

  chanceOf25: 0,
  chanceOf50: 0,
  chanceOf75: 0,
  chanceOf95: 0,
  chanceOf99: 0,
  chanceOfOver99: 0,
};


async function fetchTipFloorData(): Promise<void> {
  try {
    const response = await axios.get(TIP_STATS_API_URL);
    const data = response.data[0];

    jitoTip.chanceOf25_inSol = data.landed_tips_25th_percentile;
    jitoTip.chanceOf50_inSol = data.landed_tips_50th_percentile;
    jitoTip.chanceOf75_inSol = data.landed_tips_75th_percentile;
    jitoTip.chanceOf95_inSol = data.landed_tips_95th_percentile;
    jitoTip.chanceOf99_inSol = data.landed_tips_99th_percentile;
    jitoTip.chanceOfOver99_inSol = Number(data.landed_tips_99th_percentile) * OVER_99_INCREMENT_FACTOR;

    jitoTip.chanceOf25 = Math.round(jitoTip.chanceOf25_inSol * solana.LAMPORTS_PER_SOL);
    jitoTip.chanceOf50 = Math.round(jitoTip.chanceOf50_inSol * solana.LAMPORTS_PER_SOL);
    jitoTip.chanceOf75 = Math.round(jitoTip.chanceOf75_inSol * solana.LAMPORTS_PER_SOL);
    jitoTip.chanceOf95 = Math.round(jitoTip.chanceOf95_inSol * solana.LAMPORTS_PER_SOL);
    jitoTip.chanceOf99 = Math.round(jitoTip.chanceOf99_inSol * solana.LAMPORTS_PER_SOL);
    jitoTip.chanceOfOver99 = Math.round(jitoTip.chanceOfOver99_inSol * solana.LAMPORTS_PER_SOL);
  } catch (error) {
    console.error("Error fetching tip floor data:", error);
  }
}

export async function runJitoTipMetricUpdater() {
  while (true) {
    await fetchTipFloorData();
    await h.sleep(JITO_TIP_STAT_CHECK_INTERVAL);
  }
}

export async function waitForJitoTipMetrics() {
  const timeout = 10 * 1000;
  const timeoutAt = Date.now() + timeout;
  while (Date.now() < timeoutAt) {
    if (jitoTip.chanceOf99 != 0)
      return true;
    await h.sleep(250);
  }
  console.warn(`Jito tip metrics are still not fetched after ${timeout / 1000}s`);
  return false;
}

export type TipMetrics = {
  chanceOf25_inSol: number;
  chanceOf50_inSol: number;
  chanceOf75_inSol: number;
  chanceOf95_inSol: number;
  chanceOf99_inSol: number;
  chanceOfOver99_inSol: number,

  chanceOf25: number;
  chanceOf50: number;
  chanceOf75: number;
  chanceOf95: number;
  chanceOf99: number;
  chanceOfOver99: number;
};