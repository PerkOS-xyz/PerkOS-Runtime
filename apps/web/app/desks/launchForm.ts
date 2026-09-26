/**
 * The launch card without a browser: when the person's words ask for a token
 * launch, what the card's form holds and sends, which pairs it shows as
 * chips, and what an answer to a launch means. Tested on its own.
 */

import type { LaunchPair } from "../lib/bankrLaunch";
import type { FeesTo } from "../lib/launchChecks";
import type { LaunchReceipt } from "../lib/launchDraft";
import { LAUNCH_UNCONFIRMED } from "./launch";

/** What the person asked for in the chat: maybe a pair, a name and a symbol. */
export interface LaunchSeed {
  pair?: string;
  name?: string;
  symbol?: string;
}

const norm = (raw: string) =>
  raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[¿¡]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const VERB =
  "(?:launch|deploy|create|mint|make|start|issue|spin up|lanza|lanzar|lanzame|lancemos|lanzamos|crea|crear|creame|creemos|despliega|desplegar|despliegame|emite|emitir|saca|sacar|haz|hazme)";
const TOKEN = "(?:token|coin|memecoin|moneda)";
/** The verb, then the token within three words: "launch a new token", "lanza un token", "create my own coin". */
const ASK = new RegExp(`\\b${VERB}\\b(?:\\s+[\\w$'-]+){0,3}?\\s+${TOKEN}s?\\b`);
/** A question about launching, which Sparky answers: "How do I launch a token?", "¿Cómo lanzo un token?". */
const QUESTION = /^(?:(?:hey|ok|okay|oye)\s+)?(?:sparky\s+)?(?:how|what|why|when|where|who|which|como|que|por que|porque|cuando|donde|quien|cual|cuanto|cuanta)\b/;
const PAIR = /\b(?:paired with|pair it with|pair with|pair to|quoted in|against|with|emparejad[oa] con|en par con|contra|con)\s+\$?([a-z0-9]{2,12})\b/g;
/** Words after "with" that are not a pair: "with vesting", "con mi wallet". */
const NOT_PAIRS = new Set([
  "a", "an", "the", "my", "it", "its", "no", "some", "vesting", "fees", "fee", "logo", "name", "symbol", "ticker", "robinhood", "base", "bankr",
  "un", "una", "el", "la", "los", "las", "mi", "su", "sin", "nombre", "simbolo", "comisiones",
]);
const DOLLAR = /\$([a-z][a-z0-9]{0,11})\b/;
const NAMED = /\b(?:called|named|llamad[oa]|que se llame)\s+(?:"([^"]{1,100})"|“([^”]{1,100})”|([A-Za-z0-9][A-Za-z0-9 .'-]{0,40}?))(?=\s+(?:with|paired|and|symbol|ticker|on|con|y|simbolo|símbolo|en)\b|[,.;!?]|$)/i;
const SYMBOL_WORD = /\b(?:symbol|ticker|s[ií]mbolo)\s+\$?([A-Za-z0-9]{1,20})\b/i;

/**
 * Whether the person asks to launch a token, and what they said about it. A
 * question about launching stays with Sparky. English and Spanish.
 */
export function launchIntent(text: string): LaunchSeed | null {
  const t = norm(text);
  if (!t || QUESTION.test(t) || !ASK.test(t)) return null;
  const seed: LaunchSeed = {};
  const named = text.match(NAMED);
  const name = (named?.[1] ?? named?.[2] ?? named?.[3] ?? "").trim();
  if (name) seed.name = name.slice(0, 100);
  const symbol = text.match(SYMBOL_WORD)?.[1];
  if (symbol) seed.symbol = cleanSymbol(symbol);
  // "with symbol OWL paired with AAPL": the first word after a pairing word that can be a pair.
  const said = [...t.matchAll(PAIR)].map((m) => m[1]!).find((w) => !NOT_PAIRS.has(w) && w !== seed.symbol?.toLowerCase());
  const pair = said ?? t.match(DOLLAR)?.[1];
  if (pair && pair !== seed.symbol?.toLowerCase()) seed.pair = pair;
  return seed;
}

export interface LaunchForm {
  name: string;
  symbol: string;
  /** The pair's symbol as the chips show it, or what the person typed. */
  pair: string;
  feesTo: FeesTo;
  description: string;
  /** The logo's https address once it is hosted. */
  image: string;
  vesting: boolean;
  quoteOnlyFees: boolean;
}

export const cleanSymbol = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 20);

/** What Bankr would pick when the symbol is left out: the first four letters or digits of the name. */
export const suggestSymbol = (name: string) => cleanSymbol(name).slice(0, 4);

export function seedForm(seed: LaunchSeed = {}): LaunchForm {
  const name = seed.name?.trim() ?? "";
  return {
    name,
    symbol: seed.symbol ? cleanSymbol(seed.symbol) : name ? suggestSymbol(name) : "",
    pair: seed.pair?.trim() ?? "",
    feesTo: "wallet",
    description: "",
    image: "",
    vesting: true,
    quoteOnlyFees: false,
  };
}

/** The body the draft route gets, and with the pair's address, the deploy route. */
export const launchBody = (f: LaunchForm, pairAddress?: string) => ({
  name: f.name.trim(),
  symbol: cleanSymbol(f.symbol),
  pair: pairAddress ?? f.pair.trim(),
  feesTo: f.feesTo,
  description: f.description.trim(),
  image: f.image,
  vesting: f.vesting,
  quoteOnlyFees: f.quoteOnlyFees,
});

/** One string per launch the form describes: a check is good only for the form it checked. */
export const formKey = (f: LaunchForm) => JSON.stringify(launchBody(f));

/** One drafted launch, whatever its checks said: what the team's verdict is about. */
export const draftKey = (d: { name: string; symbol: string; pair: { address: string }; feesTo: string; vesting: boolean; quoteOnlyFees: boolean; description: string; image: string }) =>
  JSON.stringify([d.name, d.symbol, d.pair.address.toLowerCase(), d.feesTo, d.vesting, d.quoteOnlyFees, d.description, d.image]);

/** The form has what a check needs. */
export const formReady = (f: LaunchForm) => f.name.trim() !== "" && cleanSymbol(f.symbol) !== "" && f.pair.trim() !== "";

/**
 * The pairs as chips: the first stocks in Bankr's order, then WETH, and the
 * one picked even when it is further down. A search shows what matches.
 */
export function pairChips(pairs: readonly LaunchPair[], query: string, picked: string, max = 11): LaunchPair[] {
  const q = query.trim().replace(/^\$/, "").toLowerCase();
  if (q) return pairs.filter((p) => p.symbol.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)).slice(0, 24);
  const stocks = pairs.filter((p) => p.kind === "stock").slice(0, max);
  const weth = pairs.filter((p) => p.kind === "major");
  const chosen = pairs.find((p) => p.symbol.toLowerCase() === picked.toLowerCase());
  const shown = [...stocks, ...weth];
  return chosen && !shown.includes(chosen) ? [chosen, ...shown] : shown;
}

export type LaunchOutcome =
  | { kind: "live"; receipt: LaunchReceipt }
  /** Nothing went out. */
  | { kind: "refused"; message: string }
  /** No clear answer: it may be on chain. */
  | { kind: "unconfirmed"; message: string };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {});

export function isLaunchReceipt(r: unknown): r is LaunchReceipt {
  const o = obj(r);
  const links = obj(o.links);
  return (
    typeof o.tokenAddress === "string" &&
    ADDRESS.test(o.tokenAddress) &&
    typeof o.name === "string" &&
    typeof o.symbol === "string" &&
    typeof o.pairedSymbol === "string" &&
    typeof o.deployer === "string" &&
    typeof links.uniswap === "string" &&
    typeof links.bankr === "string" &&
    typeof links.explorer === "string"
  );
}

export function isLaunchOutcome(o: unknown): o is LaunchOutcome {
  const x = obj(o);
  if (x.kind === "live") return isLaunchReceipt(x.receipt);
  return (x.kind === "refused" || x.kind === "unconfirmed") && typeof x.message === "string";
}

/** What the deploy route's answer means. Only `sent: false` reads as nothing sent; anything unclear may be on chain. */
export function launchOutcome(status: number, body: unknown): LaunchOutcome {
  const b = obj(body);
  if (status === 201 && isLaunchReceipt(b.receipt)) return { kind: "live", receipt: b.receipt };
  const message = typeof b.message === "string" && b.message.trim() ? b.message.trim() : "";
  if (b.sent === false) return { kind: "refused", message: message || "Bankr refused the launch. Nothing was sent." };
  return { kind: "unconfirmed", message: status === 201 ? LAUNCH_UNCONFIRMED : message || LAUNCH_UNCONFIRMED };
}

/** Sends the launch the person held for, and reads the answer. A failed request leaves it in doubt. */
export async function sendLaunch(body: ReturnType<typeof launchBody>, http: typeof fetch = (...a) => fetch(...a)): Promise<LaunchOutcome> {
  const res = await http("/api/launch/deploy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return launchOutcome(res.status, await res.json().catch(() => ({})));
}
