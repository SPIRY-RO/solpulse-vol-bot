import axios from 'axios';

import * as h from '../helpers';
import * as c from '../const';
import { envConf } from '../config';


export type BundleStatus = {
  result: boolean | null,
  firstCheckedAt: number,
}

class JitoStatusChecker {
  private _bundleStatuses: { [key: string]: BundleStatus } = {}


  async waitForResult(bundleID: string) {
    this._bundleStatuses[bundleID] = { result: null, firstCheckedAt: Date.now() };
    while (this._bundleStatuses[bundleID].result === null) {
      await h.sleep(1000);
    }
    const result = this._bundleStatuses[bundleID].result;
    //console.log(`before deletion`);
    //console.log(this._bundleStatuses);
    delete this._bundleStatuses[bundleID];
    //console.log(`after deletion`);
    //console.log(this._bundleStatuses);
    return result;
  }


  async run() {
    h.debug(`Checking new bundle results every ${c.JITO_STATUS_CHECK_INTERVAL / 1000}s`);
    while (true) {
      await this._checkAllBundles();
      await h.sleep(c.JITO_STATUS_CHECK_INTERVAL);
    }
  }


  private async _checkAllBundles() {
    /*
    console.log('------')
    console.log(this._bundleStatuses);
    console.log('------')
    */
    const bundleIDs: string[] = [];
    for (const [bundleID, bundleStats] of Object.entries(this._bundleStatuses)) {
      if (bundleStats.result === null) {
        if (this._isBundleTooOld(bundleStats)) {
          this._bundleStatuses[bundleID].result = false;
          h.debug(`[bundle:${bundleID}] check timed out after ${c.JITO_BUNDLE_CHECK_TIMEOUT / 1000}s`);
          continue;
        } else {
          bundleIDs.push(bundleID);
        }
      }
    }
    if (bundleIDs.length === 0)
      return;
    const statuses = await JitoStatusChecker.getBundleStatuses(bundleIDs);
    /*
    console.log(`\nstatuses:`)
    console.log(statuses);
    console.log(`\n\n`);
    */
    if (!statuses || statuses.length === 0)
      return;
    //console.log(`\nBundle statuses:`);
    for (let i = 0; i < bundleIDs.length; i++) {
      this._processBundleResponse(statuses[i]);
    }
  }


  private _processBundleResponse(response: any) {
    const bundleID = response?.bundle_id;
    if (response?.confirmation_status) {
      this._bundleStatuses[bundleID].result = true;
    } else if (bundleID !== undefined) {
      h.debug(`[bundle:${bundleID}] unfinalized result: ${JSON.stringify(response)}`);
    }
    return false;
  }

  private _isBundleTooOld(bundleStats: BundleStatus) {
    return (Date.now() > bundleStats.firstCheckedAt + c.JITO_BUNDLE_CHECK_TIMEOUT);
  }



  /**
   * Endpoint used for checking bundle statuses only takes max of 5 bundle IDs at a time.
   * This wrapper makes retrieving status for more than 5 bundles at a time seamless
  */
  static async getBundleStatuses(bundleIDs: string[]) {
    let idsProcessed = 0;
    let chunkOfIDs: string[] = [];
    const promises: Promise<any>[] = [];
    for (const id of bundleIDs) {
      chunkOfIDs.push(id);
      idsProcessed += 1;
      if ((idsProcessed % c.JITO_MAX_BUNDLE_IDS_PER_STATUS_CHECK) === 0) {
        promises.push(JitoStatusChecker._getBundleStatuses(chunkOfIDs));
        chunkOfIDs = [];
        await h.sleep(200);
      }
    }
    if (chunkOfIDs.length !== 0) {
      promises.push(JitoStatusChecker._getBundleStatuses(chunkOfIDs));
    }

    const resolvedPromises = await Promise.all(promises);
    /*
    console.log(`\nresolved promises:`);
    console.log(resolvedPromises);
    console.log('');
    */
    const formattedResults: any[] = [];
    for (const bundleStatuses of resolvedPromises) {
      if (!bundleStatuses)
        continue;
      for (const status of bundleStatuses) {
        if (status)
          formattedResults.push(status);
      }
    }
    return formattedResults;
  }


  static async _getBundleStatuses(bundleIDs: string[]) {
    if (bundleIDs.length > c.JITO_MAX_BUNDLE_IDS_PER_STATUS_CHECK)
      throw new Error(`This endpoint only supports ${c.JITO_BUNDLE_CHECK_TIMEOUT} bundle IDs per check`);
    else if (bundleIDs.length === 0)
      return null;
    try {
      const response = await axios({
        method: "POST",
        url: `https://${envConf.BLOCK_ENGINE_URL}/api/v1/bundles`,
        headers: {
          "Content-Type": "application/json",
        },
        data: {
          jsonrpc: "2.0",
          id: 1,
          method: "getBundleStatuses",
          params: [
            bundleIDs,
          ],
        },
      });

      return response.data?.result?.value;
      //return response.data;
    } catch (e: any) {
      console.error(`Error while getting bundle statuses: ${String(e)}`);
      if (e.response) {
        // The request was made and the server responded with a non-2xx status code
        console.error(e.response.data);
        console.error(e.response.status);
        console.error(e.response.headers);
      } else {
        console.trace(e);
      }
      return null;
    }
  }

}


export default JitoStatusChecker;