import * as raySDK from '@raydium-io/raydium-sdk';
import fs from 'fs';
import path from 'path';

import * as h from "../helpers"
import { envConf } from '../config';

const API_ENDPOINT = envConf.POOL_API_ENDPOINT;


export class PoolMaster {
  private _cachedPools: { [x: string]: PoolData } = {};


  async getFormattedPoolFor(tokenMintA: string, tokenMintB?: string) {
    const rawPoolData = await this.getRawPoolFor(tokenMintA, tokenMintB);
    if (!rawPoolData) return null;
    return raySDK.jsonInfo2PoolKeys(rawPoolData) as raySDK.LiquidityPoolKeys;
  }

  async getRawPoolFor(tokenMintA: string, tokenMintB?: string) {
    if (tokenMintB && (tokenMintA === raySDK.WSOL.mint || tokenMintB === raySDK.WSOL.mint)) {
      if (tokenMintA === raySDK.WSOL.mint) {
        tokenMintA = tokenMintB;
      }
      tokenMintB = undefined;
    }
    if (!h.isSolAddrValid(tokenMintA)) {
      throw Error(`Invalid Solana address supplied: '${tokenMintA}'`);
    } else if (tokenMintB && !h.isSolAddrValid(tokenMintB)) {
      throw Error(`Invalid Solana address supplied: '${tokenMintB}'`);
    }

    if (tokenMintB) {
      const poolData = this._fetchPoolFor(tokenMintA, tokenMintB);
      return poolData;
    }

    if (!this._cachedPools[tokenMintA]) {
      const poolData = await this._fetchPoolFor(tokenMintA);
      if (!poolData) return null;
      this._cachedPools[tokenMintA] = poolData;
    }
    return this._cachedPools[tokenMintA];
  }


  private async _fetchPoolFor(tokenMintA: string, tokenMintB?: string) {
    let url = `${API_ENDPOINT}?tokenA=${tokenMintA}&authKey=${envConf.POOL_API_KEY}`;
    if (tokenMintB)
      url += `&tokenB=${tokenMintB}`;
    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (response.ok) {
        const responseJSON = await response.json();
        return responseJSON.pool as PoolData;
      } else {
        console.error(`[pools] Error fetching pool data: ${response.status} - ${response.statusText}`);
        return null;
      }
    } catch (e: any) {
      console.error(`[pools] Error fetching pool data: ${e}`);
      return null;
    }
  }




  private _loadTestPoolData() {
    const liquidityFile = "../test_pool_data.json";
    let liquidityJson;
    liquidityJson = JSON.parse(fs.readFileSync(path.join(__dirname, liquidityFile), 'utf-8'));
    const allPoolKeysJson = [...(liquidityJson?.official ?? []), ...(liquidityJson?.unOfficial ?? [])]
    const allPools = allPoolKeysJson as PoolData[];
  }
}



export interface PoolData {
  id: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  lpDecimals: number;
  version: number;
  programId: string;
  authority: string;
  openOrders: string;
  targetOrders: string;
  baseVault: string;
  quoteVault: string;
  withdrawQueue: string;
  lpVault: string;
  marketVersion: number;
  marketProgramId: string;
  marketId: string;
  marketAuthority: string;
  marketBaseVault: string;
  marketQuoteVault: string;
  marketBids: string;
  marketAsks: string;
  marketEventQueue: string;
  lookupTableAccount: string;
}

