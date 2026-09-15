import { randomBytes } from "node:crypto";

type Row = { address: string; message: string; exp: number };

const store = new Map<string, Row>();

export function issueNonce(address: string) {
  const nonce = randomBytes(16).toString("hex");
  const issued = new Date().toISOString();
  const message = [
    "PerkOS Floor wants to sign you in.",
    "",
    `Wallet: ${address}`,
    `Nonce: ${nonce}`,
    `Issued: ${issued}`
  ].join("\n");
  store.set(nonce, { address: address.toLowerCase(), message, exp: Date.now() + 5 * 60 * 1000 });
  return { nonce, message, expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
}

export function takeNonce(nonce: string, address: string) {
  const row = store.get(nonce);
  if (!row) return null;
  store.delete(nonce);
  if (row.exp < Date.now()) return null;
  if (row.address !== address.toLowerCase()) return null;
  return row;
}
