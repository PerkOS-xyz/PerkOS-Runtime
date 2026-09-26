/**
 * Whether what the person said is a task for the desk's team, and which kind.
 *
 * Plain chat stays with Sparky and never wakes the team, so the rule is
 * deliberately narrow: a starter the desk marked, a question about an asset
 * the desk trades, an open "what should I buy" question, or an explicit
 * request to analyze. English and Spanish. Anything else is plain chat, and
 * so is a follow-up about what the team said, or thanks for it, whatever
 * words it uses: those are the likeliest lines right after a turn.
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

/** Buying or putting money in. */
const BUY = /\b(buy|buying|invest|investing|get into|put (?:my )?money|compro|comprar|compraria|invierto|invertir|invertiria|inversion)\b/;
/** The market in general, when no asset is named. */
const MARKET = /\b(market|markets|stock|stocks|shares|equity|equities|ticker|tickers|portfolio|mercado|mercados|accion|acciones|valores|cartera)\b/;
/** A horizon, which makes advice only beside a buying, market or pick word: "What happened this week?" is chat. */
const HORIZON = /\b(this month|this week|next month|next week|in a month|one month|30 days|este mes|esta semana|el proximo mes|la proxima semana|en un mes|para el mes|para un mes|30 dias)\b/;
/** Asking for a pick, which is advice only about the market or buying: "Can you recommend a good book?" is chat. */
const RECOMMEND =
  /\b(recommend|recommendation|recommendations|suggest|suggestion|suggestions|advise|advice|pick|picks|bet|bets|recomienda|recomiendas|recomiendame|recomendarias|recomendacion|recomendaciones|aconseja|aconsejas|aconsejame|sugiere|sugieres|sugiereme|sugerencia|sugerencias|elijo|elegir|escojo|escoger|apuesta|apuestas)\b/;
const OPPORTUNITY = /\b(opportunit\w*|oportunidad\w*)\b/;
/** An open question about what to buy or where to put money. */
const ADVISE = [
  // "Which stock should I buy?", "What would you invest in?", "What to buy this month"
  /\b(what|which)\b.*\b(should|would|to|worth|shall|do you)\b.*\b(buy|buying|invest|get into)\b/,
  // "Should I buy now?", "¿Debería invertir?"
  /\b(should i|shall i|deberia|debo|me conviene)\b.*\b(buy|invest|comprar|invertir)\b/,
  // "¿Qué compro?", "¿Qué acción me conviene comprar este mes?"; not "¿Qué puedo comprar aquí?"
  /\b(que|cual|cuales)\b.*\b(compro|invierto|compraria|invertiria)\b/,
  /\b(que|cual|cuales)\b.*\b(conviene|deberia|debo|recomiendas|recomendarias|vale la pena)\b.*\b(comprar|invertir)\b/,
  /\b(worth buying|best (?:stock|stocks|pick|picks|buy|buys|bet|bets)|top (?:picks?|stocks?))\b/,
  /\bmejor(?:es)? (?:accion|acciones|compra|compras|inversion)\b/,
];
/** The short open asks, which are advice on a desk: "What do you recommend?", "¿Qué me recomiendas?". */
const OPEN_ASK = [
  /^(?:(?:so|and|ok|okay|then|well|now|i wonder|i was wondering)\s+)?(?:what|which)\s+(?:(?:one|ones|stock|stocks)\s+)?(?:(?:do|would|can|could|should)\s+you|you\s+(?:would|d))\s+(?:recommend|suggest|advise|pick)(?:\s+(?:me|now|today|then|here))?$/,
  /^(?:(?:y|entonces|bueno|ok|ahora)\s+)?(?:que|cual|cuales)\s+(?:me\s+)?(?:recomiendas|recomendarias|sugieres|sugeririas|aconsejas|aconsejarias)(?:\s+(?:hoy|ahora|entonces))?$/,
  /^(?:any|some|got any)\s+(?:recommendations?|suggestions?|picks?|ideas?|opportunit\w*)(?:\s+(?:for me|today|now|right now))?$/,
  /^(?:tienes\s+)?(?:alguna|algunas)\s+(?:recomendacion\w*|sugerencia\w*|oportunidad\w*|idea\w*)(?:\s+(?:hoy|ahora|para mi))?$/,
];

/** What the person asks about a named asset that makes it a desk task. */
const ASSET_ASK = [
  /\b(price|prices|cost|costs|worth|value|trading|trade|move|moving|moved|up|down|doing|trend|range|compare|compared|vs|versus|cheaper|cheap|expensive|pricier|better|buy|sell|hold|should|analy[sz]e|research|check|look|outlook|news|chart|today|now|performance|perform|rally|drop|dip|pick|bet|risky|safe|overvalued|undervalued|opportunity|happen|happened|happening|close|closed|yesterday)\b/,
  /\b(precio|cuesta|vale|cotiza|sube|subio|baja|bajo|como va|como esta|compar\w*|barat\w*|caro|cara|caros|mejor|compr\w*|vend\w*|analiza\w*|revisa|mira|hoy|ahora|rendimiento|paso|cierre|cerro|ayer)\b/,
];

/** A request to analyze, which is a task on its own. The verbs: */
const ANALYZE_VERB = /\b(analy[sz]e|analy[sz]ing|anali[sz]e|analiza\w*|analisa\w*|investigate|investiga|investigar|investigame|look into|dig into)\b/;
/** "Research" is a verb only at the head of a request: "Research the market", "Can you research Tesla?". */
const RESEARCH_VERB = /(?:^|\b(?:please|pls|can you|could you|would you|will you|you to|go|now|then|and|also)\s+)research\b/;
/** And the nouns, which ask for a new one only in a request: "Give me an analysis of NVDA", not "Thanks for the analysis". */
const ANALYSIS_NEW = /\b(?:an?|another|new|fresh|quick|full|short|brief|deep|un|una|otro|otra|nuevo|nueva)\s+(?:\w+\s+)?(?:analysis|analisis|research|breakdown|rundown|deep dive)\b/;
const ANALYSIS_OF = /\b(?:analysis|analisis|research|breakdown|rundown|deep dive)\s+(?:of|on|for|about|de|del|sobre|para)\b/;
const ANALYSIS_HEAD = /^(?:(?:an?|another|new|quick|full|short|brief|deep|un|una|otro|otra|nuevo|nueva)\s+)*(?:analysis|analisis|research|breakdown|rundown|deep dive)\b/;
const REQUEST =
  /\b(give|get|want|need|like|run|do|make|send|start|dame|quiero|necesito|haz|hazme|haga|hagan|manda|mandame|prepara|preparame|can you|could you|would you|please|por favor|puedes|podrias)\b/;

/** A request to check or look, which is a task when it is about the market. */
const CHECK = /\b(check|revisa|revisar|mira|mirar)\b/;
const CHECK_MARKET = /\b(market|markets|stock|stocks|shares|price|prices|chart|charts|mercado|mercados|accion|acciones|precio|precios|grafica)\b/;

// A question about what was already said, which Sparky answers from the chat:
// "What did Scout recommend?", "What was the top pick?", "¿Qué recomendó
// Scout?". It holds for every kind of turn, so a follow-up never wakes the team.

/** Someone on the desk, or the person and Sparky: who a question about the past is about. */
const TEAM = /\b(scout|risk|trader|auditor|sparky|team|desk|agent|agents|you|we|equipo|mesa|agente|agentes|tu|nosotros)\b/;
/** What the team produced. */
const OUTPUT =
  /\b(analysis|analyses|research|report|pick|picks|recommendation|recommendations|suggestion|suggestions|answer|answers|summary|verdict|record|outlook|thesis|advice|plan|analisis|investigacion|recomendacion|recomendaciones|sugerencia|sugerencias|respuesta|respuestas|resumen|veredicto|informe|reporte|consejo)\b/;
/** A past tense that recalls something once it is about the team or its work. */
const PAST = /\b(did|didnt|was|were|happened|fue|fueron|era|eran|hizo|hicieron)\b/;
/** A verb that reports what was said: "recommended", "recomendó". */
const SAID =
  /\b(recommended|suggested|said|told|advised|flagged|concluded|mentioned|proposed|recomendo|recomendaron|recomendaste|sugirio|sugirieron|sugeriste|dijo|dijeron|dijiste|aconsejo|aconsejaron|aconsejaste|menciono|mencionaron|propuso|concluyo|hiciste)\b/;
/** Asking Sparky to go back over something: "Explain the analysis", "Resúmeme". */
const RECALL_VERB = /\b(explain|summari[sz]e|recap|remind me|repeat|go over|explica|explicame|explicalo|resume|resumeme|resumelo|recuerdame|repite|repiteme)\b/;
/** Past tenses that do not look back: "I was wondering", "If you were me". */
const NOT_PAST = /\b(?:i (?:was|were) (?:wondering|thinking|hoping)|(?:if|si) (?:you|i|we|tu|yo) (?:were|was|had|fueras|fuera|tuvieras|tuviera)|me preguntaba|estaba pensando)\b/g;

function recalls(t: string, asset: boolean): boolean {
  const s = t.replace(NOT_PAST, " ");
  const about = TEAM.test(s) || OUTPUT.test(s);
  if (PAST.test(s) && about) return true;
  return (SAID.test(s) || RECALL_VERB.test(s)) && (about || !asset);
}

/** Thanks and praise for what the team did, which is chat: "Great analysis!", "Gracias por el análisis". */
const THANKS = /\b(thanks|thank you|thank u|thx|cheers|appreciate it|gracias|agradezco)\b/;
const PRAISE = [
  /^(?:that s |that was |what a |such a |very |really )?(?:an? )?(?:great|nice|good|awesome|amazing|excellent|solid|smart|helpful|interesting|cool)\s+(?:analysis|research|work|job|report|summary|answer|read|recap|breakdown|pick|picks|call|calls)\b/,
  /\b(?:love|loved|like|liked|me encanto|me gusto)\b.*\b(?:analysis|research|work|answer|summary|report|pick|analisis|trabajo|respuesta|resumen|informe)\b/,
  /^(?:que |muy )?(?:buen|buena|gran|excelente|genial)\s+(?:analisis|trabajo|investigacion|informe|resumen|respuesta|eleccion|recomendacion)\b/,
  /^(?:el |la |tu |su )?(?:analisis|trabajo|informe|resumen|respuesta)\s+(?:esta |estuvo |fue )?(?:genial|excelente|perfecto|buenisimo|increible|muy bueno|muy buena)\b/,
  /^(?:well done|bien hecho)\b/,
];
const praises = (t: string) => THANKS.test(t) || PRAISE.some((re) => re.test(t));

/** Sparky named at the start or the end: "Hey Sparky, ...", "..., Sparky". */
const VOCATIVE = /^(?:(?:hey|hi|hello|ok|okay|hola|oye)\s+)?sparky\b[\s,]*|[\s,]*\bsparky$/g;
/** Where one sentence ends and the next begins. A dot inside a number or a ticker is not an end. */
const SENTENCE_END = /[!?¡¿;\n]+|\.(?=\s|$)/;

/** Tickers when the market is not loaded: $NVDA, or NVDA in capitals. */
const LOOSE_TICKER = /(?:\$[A-Za-z]{1,6}\b|\b[A-Z]{2,5}\b)/;
const NOT_TICKERS = new Set(["USD", "USDC", "USDG", "OK", "AI", "PM", "AM", "ETF", "CEO", "API", "FAQ", "USA", "EU", "UK"]);

function namesAsset(text: string, assets: DeskAsset[] | undefined): boolean {
  if (assets?.length) return askedAbout(text, assets).length > 0;
  const m = text.match(new RegExp(LOOSE_TICKER.source, "g")) ?? [];
  return m.some((w) => !NOT_TICKERS.has(w.replace("$", "").toUpperCase()));
}

function advises(t: string): boolean {
  if (ADVISE.some((re) => re.test(t)) || OPEN_ASK.some((re) => re.test(t))) return true;
  const money = BUY.test(t) || MARKET.test(t);
  if ((RECOMMEND.test(t) || OPPORTUNITY.test(t)) && (money || HORIZON.test(t))) return true;
  return HORIZON.test(t) && money;
}

function analyzes(t: string): boolean {
  if (ANALYZE_VERB.test(t) || RESEARCH_VERB.test(t)) return true;
  return (ANALYSIS_NEW.test(t) || ANALYSIS_OF.test(t)) && (REQUEST.test(t) || ANALYSIS_HEAD.test(t));
}

/** What the person said, one sentence at a time, without the clauses that only thank or praise. */
function sentences(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(SENTENCE_END)) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (!praises(norm(sentence))) {
      out.push(sentence);
      continue;
    }
    // "Thanks, now analyze Tesla" keeps the task; "Nice research, thanks" keeps nothing.
    const rest = sentence.split(/,(?!\d)/).filter((c) => {
      const n = norm(c);
      return n && !praises(n);
    });
    if (rest.length) out.push(rest.join(","));
  }
  return out;
}

/** The kind of turn one sentence asks for, or null for plain chat. */
function sentenceKind(text: string, ctx: ClassifyContext): TurnKind | null {
  const t = norm(text).replace(VOCATIVE, "").trim();
  if (!t) return null;
  const asset = namesAsset(text, ctx.assets);
  if (recalls(t, asset)) return null;
  const amount = AMOUNT.test(t);
  if (amount && TRADE_VERB.test(t) && asset && ctx.manifest?.turns.order) return "order";
  if (!asset && !amount && advises(t)) return "advise";
  if (asset && ASSET_ASK.some((re) => re.test(t))) return "analyze";
  if (analyzes(t)) return "analyze";
  if (CHECK.test(t) && (asset || CHECK_MARKET.test(t))) return "analyze";
  return null;
}

/** The kind of turn the desk would run for this text, or null for plain chat: the first sentence that asks for one decides. */
function kindOf(text: string, ctx: ClassifyContext): TurnKind | null {
  for (const sentence of sentences(text)) {
    const kind = sentenceKind(sentence, ctx);
    if (kind) return kind;
  }
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
