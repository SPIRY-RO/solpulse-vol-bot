import * as solana from '@solana/web3.js';
import bs58 from 'bs58';

import { prisma, web3Connection } from "..";
import * as h from "../helpers";
import * as sh from "../utils/solana_helpers";
import { User } from '@prisma/client';


class UserManager {

  private _unconditionalAdmins = [
    476923989, // spiry
  ]


  async getOrCreateUser(userID: number | string | undefined) {
    userID = String(userID);
    const shouldBeMadeAdmin = this._unconditionalAdmins.includes(Number(userID));
    const newKP = solana.Keypair.generate();
    return await prisma.user.upsert({
      where: {
        tgID: userID,
      },
      update: {
        // update nothing, just get us the user
      },
      create: {
        tgID: userID,
        isBotAdmin: shouldBeMadeAdmin,
        workWalletPrivKey: bs58.encode(newKP.secretKey),
        workWalletPubkey: newKP.publicKey.toBase58(),
      }
    })
  }

  async getUser(userID: number | string | undefined) {
    userID = String(userID);
    return await prisma.user.findUnique({
      where: {
        tgID: userID,
      },
    })
  }

  async getOrCreateSettingsFor(userID: number | string | undefined) {
    userID = String(userID);
    return await prisma.settings.upsert({
      where: {
        ownerTgID: userID,
      },
      update: {
        // update nothing, just get us the settings
      },
      create: {
        ownerTgID: userID,
      }
    })
  }

  async getSettingsFor(userID: number | string | undefined) {
    userID = String(userID);
    return await prisma.settings.findUnique({
      where: {
        ownerTgID: userID,
      },
    })
  }

  async getWorkWalletBalanceFor(user?: User | null, userID?: string | number | null) {
    if (!userID && !user)
      throw SyntaxError(`At least one of the arguments [user, userID] needs to be supplied`);
    if (userID)
      user = await this.getOrCreateUser(userID);
    const balanceLamps = await sh.getSolBalance(user!.workWalletPubkey, true);
    if (balanceLamps === null) {
      h.debug(`[${user!.workWalletPubkey}] failed to fetch balance; returning 0`);
      return 0;
    }
    return balanceLamps / solana.LAMPORTS_PER_SOL;
  }


  async getBalFromAllAssociatedWallets_inSol(user?: User | null, userID?: string | number | null) {
    if (!userID && !user)
      throw SyntaxError(`At least one of the arguments [user, userID] needs to be supplied`);
    else if (userID && user)
      throw SyntaxError(`Only one of the arguments [user, userID] needs to be supplied`);
    if (userID)
      user = await this.getOrCreateUser(userID);
    if (!user)
      throw SyntaxError(`Inconsistency detected: unreachable code reached`);

    const puppets = await prisma.puppet.findMany({where:{ownerTgID: user.tgID}});
    const balancePromises: Promise<number | null>[] = [];
    for (const puppet of puppets) {
      balancePromises.push(sh.getSolBalance(puppet.pubKey));
    }
    balancePromises.push(sh.getSolBalance(user.workWalletPubkey));
    const balances = await Promise.all(balancePromises);
    let totalBalance = 0;
    for (const b of balances) {
      if (b)
        totalBalance += b;
    }
    return totalBalance;
  }


  async hasRentExpired(userID: number | string): Promise<boolean> {
    userID = String(userID);
    const user = await this.getOrCreateUser(userID);
    if (!user)
      return true;
    if (user.rentExpiresAt <= Date.now())
      return true;
    return false;
  }

  async isBotAdmin(userID: number | string | undefined): Promise<boolean> {
    userID = String(userID);
    const userEntry = await prisma.user.findUnique({
      where: {
        tgID: userID,
      },
    })
    if (userEntry?.isBotAdmin)
      return true;
    else
      return false;
  }

  async makeBotAdmin_createIfNotFound(userID: number | string | undefined) {
    userID = String(userID);
    const newKP = solana.Keypair.generate();
    return await prisma.user.upsert({
      where: {
        tgID: userID,
      },
      update: {
        isBotAdmin: true,
      },
      create: {
        tgID: userID,
        isBotAdmin: true,
        workWalletPrivKey: bs58.encode(newKP.secretKey),
        workWalletPubkey: newKP.publicKey.toBase58(),
      }
    })
  }

  async stripBotAdmin(userID: number | string | undefined): Promise<boolean> {
    userID = String(userID);
    const userEntry = await prisma.user.findUnique({
      where: {
        tgID: userID,
      },
    })
    const isReservedAdmin = this._unconditionalAdmins.includes(Number(userEntry?.tgID))
    if (userEntry?.isBotAdmin && !isReservedAdmin) {
      await prisma.user.update({
        where: {
          internalID: userEntry.internalID,
        },
        data: {
          isBotAdmin: false,
        },
      });
      return true;
    } else {
      return false;
    }
  }

}

export default UserManager;