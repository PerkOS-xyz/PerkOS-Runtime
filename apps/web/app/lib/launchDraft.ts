/**
 * A launch request as the draft and deploy routes read it, what they answer,
 * and what both need before they ask Bankr anything: a signed-in wallet, a
 * Bankr key and the Bankr wallet behind it.
 */

import { bankrMe, type BankrMe } from "./bankr";
import { bankrKey } from "./bankrKey";
import type { LaunchPair, LaunchParams, LaunchPreview } from "./bankrLaunch";
import { NAME_MAX, type FeesTo, type LaunchCheck } from "./launchChecks";
import { sessionWallet } from "./vault";

export interface LaunchInput {
  name: string;
  symbol: string;
  /** A ticker, a company name or an address: what the pool is quoted in. */
  pair: string;
  feesTo: FeesTo;
  description: string;
  image: string;
  vesting: boolean;
  quoteOnlyFees: boolean;
}

/** What POST /api/launch/draft answers. */
export interface DraftAnswer {
  draft: Omit<LaunchInput, "pair"> & { pair: LaunchPair; feeRecipient: string };
  checks: LaunchCheck[];
  /** Every check passed and Bankr's simulation did too: the hold may launch it. */
  ready: boolean;
  preview: LaunchPreview | null;
  /** Why Bankr's simulation failed, when it ran and failed. */
  simError?: string;
  /** The Bankr wallet that deploys and pays the gas. */
  deployer: string;
  limits: { launches24h: number; simulations24h: number };
}

export const DESCRIPTION_MAX = 500;
const IMAGE = /^(?:https:\/\/\S{1,490}|ipfs:\/\/[A-Za-z0-9]{10,100}(?:\/\S{0,200})?)$/;

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function readLaunchInput(body: unknown): { ok: true; input: LaunchInput } | { ok: false; message: string } {
  const b = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const name = text(b.name).replace(/\s+/g, " ");
  const symbol = text(b.symbol).replace(/^\$/, "").toUpperCase();
  const pair = text(b.pair).slice(0, 64);
  const description = text(b.description);
  const image = text(b.image);
  if (name.length > NAME_MAX) return { ok: false, message: `Keep the name to ${NAME_MAX} characters.` };
  if (description.length > DESCRIPTION_MAX) return { ok: false, message: `Keep the description to ${DESCRIPTION_MAX} characters.` };
  if (image && !IMAGE.test(image)) return { ok: false, message: "The logo must be an https address." };
  return {
    ok: true,
    input: {
      name,
      symbol,
      pair,
      feesTo: b.feesTo === "bankr" ? "bankr" : "wallet",
      description,
      image,
      vesting: b.vesting !== false,
      quoteOnlyFees: b.quoteOnlyFees === true,
    },
  };
}

export const launchParams = (input: LaunchInput, pair: LaunchPair, feeRecipient: string): LaunchParams => ({
  name: input.name,
  symbol: input.symbol,
  pair,
  feeRecipient,
  ...(input.description ? { description: input.description } : {}),
  ...(input.image ? { image: input.image } : {}),
  vesting: input.vesting,
  quoteOnlyFees: input.quoteOnlyFees,
});

export const KEY_NEEDED = "Add your Bankr API key in Settings. It needs Bankr's Token Launch API turned on, with read-write access.";

type Refused = { ok: false; response: Response };

/** The signed-in wallet and the Bankr key, or the answer that says which is missing. */
export async function launchAccess(): Promise<{ ok: true; wallet: string; key: string } | Refused> {
  const wallet = await sessionWallet();
  if (!wallet) return { ok: false, response: Response.json({ error: "signed_out", message: "Sign in to PerkOS first." }, { status: 401 }) };
  const key = await bankrKey.load();
  if (!key) return { ok: false, response: Response.json({ error: "bankr_key", message: KEY_NEEDED }, { status: 412 }) };
  return { ok: true, wallet, key };
}

/** The Bankr wallet behind the key, or the answer that says why it could not be read. */
export async function launchWallet(key: string): Promise<{ ok: true; me: BankrMe } | Refused> {
  const me = await bankrMe(key);
  if (me.ok) return { ok: true, me: me.data };
  if (me.status === 401) {
    return { ok: false, response: Response.json({ error: "bankr_rejected", message: "Bankr did not accept the key in Settings. Add it again." }, { status: 412 }) };
  }
  if (me.status === 403) {
    return { ok: false, response: Response.json({ error: "bankr_rejected", message: `Bankr refused the key in Settings: ${me.message}` }, { status: 412 }) };
  }
  return { ok: false, response: Response.json({ error: "bankr_unreachable", message: "Could not reach Bankr. Try again." }, { status: 502 }) };
}
