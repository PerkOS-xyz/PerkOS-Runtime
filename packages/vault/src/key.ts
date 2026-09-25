/**
 * The vault key comes from a wallet signature over a fixed message.
 *
 * personal_sign is deterministic for a regular (EOA) wallet, so signing the
 * same message again on another computer yields the same key. The signature
 * must be verified by the caller before a key is derived from it.
 */

import { createHash } from "node:crypto";

export const vaultKeyMessage = (wallet: string) =>
  `PerkOS knowledge key\nWallet: ${wallet.toLowerCase()}\n\nThis signature unlocks your encrypted conversations and knowledge on this computer. It moves no funds and approves nothing.`;

/** 32-byte key: SHA-256 over a domain tag, the wallet and the signature. */
export function deriveVaultKey(wallet: string, signature: string): Buffer {
  return createHash("sha256").update(`perkos-vault-v1|${wallet.toLowerCase()}|${signature.toLowerCase()}`).digest();
}
