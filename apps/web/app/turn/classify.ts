/**
 * Whether what the person said is a task for the desk's team, and which kind.
 *
 * Plain chat stays with Sparky and never wakes the team, so the rule is
 * deliberately narrow: a starter the desk marked, a question about an asset
 * the desk trades, an open "what should I buy" question, or an explicit
 * request to analyze. English and Spanish. Anything else is plain chat.
 *
 * Only a kind the desk runs (its manifest's turns) is ever returned. No model
 * is asked: the same words always route the same way.
 */

import type { DeskAsset, DeskManifest, DeskStarter } from "@perkos/desk-contract";

import { askedAbout } from "../lib/marketFacts";
import type { TurnKind } from "../lib/turnRecord";

export interface ClassifyContext {
  manifest: Pick<DeskManifest, "turns" | "starters"> | null;
  /** The desk's market, to tell a named asset from a word. */
  assets?: DeskAsset[];
  /** The starter the person tapped, when they tapped one. */
  starter?: DeskStarter | null;
}

/** Lowercase, without accents or punctuation, so "¿Qué?" reads as "que". */
const norm = (raw: string) =>
  raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9$.,%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** An amount of money: a trade, not a question. */
const AMOUNT = /\$\s*\d|\b\d+(?:[.,]\d+)?\s*(?:usd|usdc|usdg|dollars?|dolares|bucks)\b/;
const TRADE_VERB = /\b(buy|purchase|sell|compra|comprar|vende|vender|vendo|compro|liquida|liquidar)\b/;

/** An open question about what to buy or where to put money. */
const ADVISE = [
  /\b(what|which)\b.*\b(buy|invest|pick|get into)\b/,
  /\b(worth buying|opportunit\w*|best (stock|stocks|pick|picks|buy|bet)|top picks?|in a month|this month|this week|next month|one month|30 days)\b/,
  /\b(recommend|recommendation|recommendations|suggest|advise me)\b/,
  /\b(que|cual|cuales)\b.*\b(compro|comprar|compraria|invierto|invertir|conviene|elijo|elegir)\b/,
  /\b(recomienda|recomiendas|recomiendame|aconseja|aconsejas|aconsejame|sugiere|sugieres|sugiereme)\b/,
  /\b(este mes|esta semana|para el mes|para un mes|el proximo mes|en un mes|30 dias|oportunidad|oportunidades)\b/,
  /\bmejor(es)? (accion|acciones|opcion|opciones|compra)\b/,
];
/** What the person asks about a named asset that makes it a desk task. */
const ASSET_ASK = [
  /\b(price|prices|cost|costs|worth|value|trading|trade|move|moving|moved|up|down|doing|trend|range|compare|compared|vs|versus|cheaper|cheap|expensive|pricier|better|buy|sell|hold|should|analy[sz]e|research|check|look|outlook|news|chart|today|now|performance|perform|rally|drop|dip)\b/,
  /\b(precio|cuesta|vale|cotiza|sube|subio|baja|bajo|como va|como esta|compar\w*|barat\w*|caro|cara|caros|mejor|compr\w*|vend\w*|analiza\w*|revisa|mira|hoy|ahora|rendimiento)\b/,
];
/** A request to analyze, which is a task on its own. */
const ANALYZE_ALONE = /\b(ana(?:l|ly|lyz|liz|lys|y)[sz]?e?|analys[ie]s|analiza|analizar|analisa|analisis|research|investiga|investigar|look into)\b/;
/** A question about what was already said, which Sparky answers from the chat: "What did the analysis say?" */
const RECALL = /\b(what did|what was|what were|explain|summari[sz]e|que dijo|que dijeron|cual fue|explica|explicame|resume|resumeme)\b/;
/** A request to check or look, which is a task when it is about the market. */
const CHECK = /\b(check|revisa|revisar|mira|mirar)\b/;
const MARKET_WORDS = /\b(market|markets|stock|stocks|shares|price|prices|chart|mercado|accion|acciones|precio|precios|desk|mesa)\b/;

/** Tickers when the market is not loaded: $NVDA, or NVDA in capitals. */
const LOOSE_TICKER = /(?:\$[A-Za-z]{1,6}\b|\b[A-Z]{2,5}\b)/;
const NOT_TICKERS = new Set(["USD", "USDC", "USDG", "OK", "AI", "PM", "AM", "ETF", "CEO", "API", "FAQ", "USA", "EU", "UK"]);

function namesAsset(text: string, assets: DeskAsset[] | undefined): boolean {
  if (assets?.length) return askedAbout(text, assets).length > 0;
  const m = text.match(new RegExp(LOOSE_TICKER.source, "g")) ?? [];
  return m.some((w) => !NOT_TICKERS.has(w.replace("$", "").toUpperCase()));
}

/** The kind of turn the desk would run for this text, or null for plain chat. */
function kindOf(text: string, ctx: ClassifyContext): TurnKind | null {
  const t = norm(text);
  if (!t) return null;
  const asset = namesAsset(text, ctx.assets);
  const amount = AMOUNT.test(t);
  if (amount && TRADE_VERB.test(t) && asset && ctx.manifest?.turns.order) return "order";
  if (!asset && !amount && ADVISE.some((re) => re.test(t))) return "advise";
  if (asset && ASSET_ASK.some((re) => re.test(t))) return "analyze";
  if (ANALYZE_ALONE.test(t) && !RECALL.test(t)) return "analyze";
  if (CHECK.test(t) && (asset || MARKET_WORDS.test(t))) return "analyze";
  return null;
}

const same = (a: string, b: string) => norm(a) === norm(b);

export function turnKindFor(text: string, ctx: ClassifyContext): TurnKind | null {
  const manifest = ctx.manifest;
  if (!manifest) return null;
  const runs = (kind: TurnKind | null | undefined): TurnKind | null => (kind && manifest.turns[kind] ? kind : null);
  // A starter says for itself what it runs. Once a desk marks its starters, one it leaves unmarked is
  // plain chat; a desk that marks none yet has its starters read like anything else the person says.
  const starter = ctx.starter ?? manifest.starters.find((s) => same(s.text, text));
  const marks = manifest.starters.some((s) => s.turn);
  if (starter?.turn) return runs(starter.turn);
  if (starter && marks) return null;
  const kind = kindOf(text, ctx);
  if (kind === "order" && !manifest.turns.order) return runs("analyze");
  return runs(kind);
}
