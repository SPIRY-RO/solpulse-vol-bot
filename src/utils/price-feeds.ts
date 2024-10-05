import axios from "axios";

import * as h from '../helpers';

export let solanaUsdPrice = 150;
export let ethereumUsdPrice = 2600;

export async function initSolanaPriceFeedDaemon() {
  while (true) {
    try {
      const request = await axios.get("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd");
      solanaUsdPrice = request.data.solana.usd;
      h.debug(`[price_feeds::solana] Received latest rate -> $${solanaUsdPrice.toFixed(2)} [SOL/USD]`);

      // Save this within sol-unit-price in the Global class
    } catch (e: any) {
      console.error(
        `[price_feeds::solana] Error fetching price: ${e.message}. Last value was: $${solanaUsdPrice.toFixed(
          2
        )} [SOL/USD]`
      );
    } finally {
      await h.sleep(60 * 1000);
    }
  }
}

export async function initAllPriceFeeds() {
  await Promise.all([initSolanaPriceFeedDaemon()]);
}
