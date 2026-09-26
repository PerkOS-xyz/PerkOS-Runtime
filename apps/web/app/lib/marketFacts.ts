/**
 * Market facts for Sparky's prompt while a desk is open: which assets the desk
 * trades, and the prices of the ones the question is about. Sparky cites these
 * and says so when a price is missing; it never guesses one.
 */

import type { DeskAsset, DeskMarket, DeskSeries } from "@perkos/desk-contract";

const MAX_ASKED = 5;

// Lowercase words that are also tickers or company names, too common to mean the stock.
const COMMON = new Set(
  "the and for are all any can now new one two big buy sell own low high good best real open well life love safe next play home main free fast cash gold hope blue star rock bull bear moon snow coin more most much very just some what when where which about with from into over under than then that this they them your ours their here there have been being does done make made take like want need help show tell give keep last next week year today stock stocks share shares price prices market desk".split(
    " ",
  ),
);
// First words of company names that say nothing on their own.
const GENERIC = new Set(
  "american bank general united first global international national applied advanced digital energy capital group holdings technologies systems the".split(" "),
);

/** "Apple • Robinhood Token" is "Apple". */
const shortName = (name: string) => name.split(" • ")[0]?.trim() ?? name;

/** The assets a question is about: $TICKER or TICKER in capitals, a ticker or a company name in plain words. */
export function askedAbout(question: string, assets: DeskAsset[]): DeskAsset[] {
  const byTicker = new Map(assets.map((a) => [a.ticker.toUpperCase(), a]));
  const byName = new Map<string, DeskAsset>();
  for (const a of assets) {
    const first = shortName(a.name).split(/\s+/)[0]?.toLowerCase() ?? "";
    if (first.length >= 4 && !GENERIC.has(first) && !byName.has(first)) byName.set(first, a);
  }
  const found = new Map<string, DeskAsset>();
  for (const raw of question.split(/[^\p{L}\p{N}$.]+/u)) {
    const word = raw.replace(/[.]+$/, "");
    if (!word) continue;
    const dollar = word.startsWith("$");
    const bare = dollar ? word.slice(1) : word;
    const caps = bare.length >= 2 && bare === bare.toUpperCase() && /\p{L}/u.test(bare);
    const lower = bare.toLowerCase();
    const hit =
      ((dollar || caps) && byTicker.get(bare.toUpperCase())) ||
      (lower.length >= 3 && !COMMON.has(lower) && byTicker.get(bare.toUpperCase())) ||
      (!COMMON.has(lower) && byName.get(lower));
    if (hit) found.set(hit.ticker, hit);
    if (found.size >= MAX_ASKED) break;
  }
  return [...found.values()];
}

const num = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: v < 1 ? 4 : 2 });
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;

/** What the series says, in one line: the desk's own sentence when it has one, else its range. */
function seriesLine(s: DeskSeries, quote: string): string {
  if (s.line) return s.line;
  if (s.low !== undefined && s.high !== undefined) {
    const span = s.days ? `${s.days}-day` : "recent";
    const change = s.changePct === undefined ? "" : `, ${signed(s.changePct)} over it`;
    return `${span} range ${num(s.low)} to ${num(s.high)} ${quote}${change} (${s.source})`;
  }
  const first = s.points[0];
  const last = s.points[s.points.length - 1];
  if (!first || !last || first === last) return "";
  const values = s.points.map((p) => p.value);
  const hours = Math.max(1, Math.round((Date.parse(last.at) - Date.parse(first.at)) / 3_600_000));
  const span = hours >= 36 ? `${Math.round(hours / 24)}-day` : `${hours}-hour`;
  const change = s.change24hPct === null ? "" : `, ${signed(s.change24hPct)} in 24h`;
  return `${span} range ${num(Math.min(...values))} to ${num(Math.max(...values))} ${quote}${change} (${s.source})`;
}

const MOST_ACTIVE = 8;

/**
 * When the question names no asset, the desk's busiest tradeable assets, so a
 * question like "what should I buy?" is answered from this desk's own market:
 * most traded first, then the biggest moves.
 */
export function mostActive(assets: DeskAsset[], limit = MOST_ACTIVE): DeskAsset[] {
  return assets
    .filter((a) => a.tradeable === true && a.priceUsd !== null)
    .sort(
      (a, b) =>
        (b.volume24hUsd ?? -1) - (a.volume24hUsd ?? -1) ||
        Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0) ||
        a.ticker.localeCompare(b.ticker),
    )
    .slice(0, limit);
}

/** The facts block for the prompt, or "" when there is no market. */
export function marketFacts(deskName: string, market: DeskMarket | null, question: string, series: DeskSeries[] = []): string {
  if (!market) return "";
  const asked = askedAbout(question, market.assets);
  const shown = asked.length ? asked : mostActive(market.assets);
  const lines = shown.map((a) => {
    const price = a.priceUsd === null ? "no price right now" : `${num(a.priceUsd)} ${market.quoteSymbol}${a.priceAt ? ` at ${clock(a.priceAt)}` : ""}`;
    const change = a.change24hPct === null ? "" : `, ${a.change24hPct >= 0 ? "+" : ""}${a.change24hPct.toFixed(2)}% in 24h`;
    const trade = a.tradeable === true ? "tradeable" : a.tradeable === false ? "not tradeable now" : "tradeability unknown";
    const s = series.find((x) => x.ticker.toUpperCase() === a.ticker.toUpperCase());
    const history = s ? seriesLine(s, market.quoteSymbol) : "";
    return `- ${a.ticker} (${shortName(a.name)}): ${price}${change}, ${trade}.${history ? ` ${history}.` : ""}`.replace(/\.\.$/, ".");
  });
  return [
    `Market of ${deskName} on ${market.chain}, priced in ${market.quoteSymbol}, observed ${clock(market.observedAt)}.`,
    `Assets on this desk (${market.assets.length}): ${market.assets.map((a) => a.ticker).join(", ")}.`,
    lines.length
      ? asked.length
        ? `Prices of what the person asked about:\n${lines.join("\n")}`
        : `Most active on this desk now:\n${lines.join("\n")}`
      : "",
    "Use only these prices. If a price is not listed here, say you do not have it; never guess one.",
    "Talk only about the assets on this desk. Never suggest ETFs, funds or tickers that are not in its list, and never tell the person to ask a teammate by name.",
  ]
    .filter(Boolean)
    .join("\n");
}
