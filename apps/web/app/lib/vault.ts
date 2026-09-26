/**
 * The person's vault key on this machine. It comes from a wallet signature
 * over a fixed message, verified here, and is kept with the device secret
 * (see @perkos/vault KeyStore).
 */

import { KeyStore, vaultKeyMessage } from "@perkos/vault";
import { createPublicClient, http, verifyMessage } from "viem";
import { base } from "viem/chains";

import { homeDir } from "./home";
import { sessions } from "./session";

export const vaultKeys = new KeyStore(homeDir);

/** The signed-in wallet, lowercase, or null. */
export async function sessionWallet(): Promise<string | null> {
  const s = await sessions.current().catch(() => null);
  return s?.wallet ?? null;
}

/** True when `signature` is the wallet's signature over the vault message (a regular wallet or a smart wallet on Base). */
export async function verifyVaultSignature(wallet: string, signature: string): Promise<boolean> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet) || !/^0x[0-9a-fA-F]+$/.test(signature)) return false;
  const args = { address: wallet as `0x${string}`, message: vaultKeyMessage(wallet), signature: signature as `0x${string}` };
  if (await verifyMessage(args).catch(() => false)) return true;
  const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || undefined, { timeout: 8_000 }) });
  return client.verifyMessage(args).catch(() => false);
}
