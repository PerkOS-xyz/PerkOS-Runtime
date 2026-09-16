// Router de intencion del Floor: lo que la persona dice o escribe se
// clasifica ANTES de ir al chat. EN y ES. Nada ejecuta solo: buy/sell
// terminan en "Hold to approve". Si nada matchea, es conversacion.

export type Command =
  | "listen"
  | "wake"
  | "invite"
  | "docs"
  | "market"
  | "stop"
  | "settings"
  | "unknown";

export type Intent =
  | { kind: "listen" | "wake" | "sleep" | "invite" | "stop" | "settings" | "docs" | "market" | "portfolio" | "map" | "history" | "approve" | "cancel" | "summarize" | "chat" }
  | { kind: "analyze" | "quote"; asset?: string }
  | { kind: "buy"; asset?: string; amountUsd: number }
  | { kind: "sell"; asset?: string; amountUsd?: number; amountToken?: number; fraction?: number };

const norm = (raw: string) => raw.trim().toLowerCase().replace(/[^a-z0-9 áéíóúñ$.,]/g, " ").replace(/\s+/g, " ");

// Palabras que nunca son un activo.
const STOP = /^(usd|usdc|dollars?|bucks|d[oó]lares|worth|shares?|acciones?|stock|stocks?|tokens?|on|en|base|the|el|la|los|las|un|una|my|mi|mis|some|a|an|of|de|for|por|now|ahora|today|hoy|please|right|it|this|that|market|mercado|portfolio|portafolio|price|precio)$/i;

function assetAfter(t: string, verbs: RegExp): string | undefined {
  const m = t.match(verbs);
  if (!m) return undefined;
  const rest = t.slice((m.index ?? 0) + m[0].length);
  // "of/de X", "X", "my X"
  const w = rest.match(/^\s*(?:(?:of|de|my|mi|mis|the|el|la|a|el token|the stock)\s+)*([a-z][a-z0-9.]{0,24})/i)?.[1];
  return w && !STOP.test(w) ? w : undefined;
}

/** "buy $5 of Apple", "compra 10 dolares de nvidia", "sell half my NVDAc",
 *  "vende todo mi AAPL", "sell 0.01 NVDA". null si no es una orden. */
export function parseTradeIntent(text: string): Extract<Intent, { kind: "buy" | "sell" }> | null {
  const t = text.trim();
  const sideM = t.match(/\b(buy|purchase|compra(?:r)?|sell|vende(?:r)?|vend[eé]|liquida(?:r)?)\b/i);
  if (!sideM) return null;
  const side: "buy" | "sell" = /^(sell|vend|liquid)/i.test(sideM[1]) ? "sell" : "buy";
  const num = (v?: string) => (v ? Number(v.replace(",", ".")) : undefined);
  const usd = t.match(/\$\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:usd|usdc|dollars?|bucks|d[oó]lares)/i);
  const amountUsd = num(usd?.[1] ?? usd?.[2]);
  const frac = /\b(all|everything|todo|toda|todas)\b/i.test(t) ? 1 : /\b(half|mitad)\b/i.test(t) ? 0.5 : /\b(quarter|cuarto)\b/i.test(t) ? 0.25 : undefined;
  const after = t.match(/\b(?:of|de|my|mi|mis)\s+(?:my\s+|mis?\s+)?([A-Za-z][A-Za-z0-9.]{0,24})/i)?.[1];
  let asset = after && !STOP.test(after) ? after : undefined;
  if (!asset) {
    const afterVerb = t.slice((sideM.index ?? 0) + sideM[0].length).match(/^\s+([A-Za-z][A-Za-z0-9.]{0,24})/)?.[1];
    if (afterVerb && !STOP.test(afterVerb)) asset = afterVerb;
  }
  if (!asset) {
    const tick = t.match(/\b([A-Z]{2,6}c?)\b/)?.[1];
    if (tick && !/^(USD|USDC|BUY|SELL)$/i.test(tick)) asset = tick;
  }
  const tok = !usd ? t.match(/\b(\d+(?:[.,]\d+)?)\s+(?:shares?\s+(?:of\s+)?|acciones\s+de\s+)?([A-Za-z][A-Za-z0-9]{0,24})/i) : null;
  const amountToken = side === "sell" && tok && !STOP.test(tok[2]) ? num(tok[1]) : undefined;
  if (side === "sell" && amountToken !== undefined && !asset) asset = tok?.[2];
  if (!asset && amountUsd === undefined && frac === undefined && amountToken === undefined) return null;
  if (side === "buy") return { kind: "buy", asset, amountUsd: Math.min(100, amountUsd && amountUsd > 0 ? amountUsd : 5) };
  if (frac !== undefined) return { kind: "sell", asset, fraction: frac };
  if (amountToken !== undefined) return { kind: "sell", asset, amountToken };
  if (amountUsd !== undefined) return { kind: "sell", asset, amountUsd: Math.min(100, amountUsd) };
  return { kind: "sell", asset, fraction: 1 };
}

export function parseIntent(raw: string): Intent {
  const t = norm(raw);
  if (!t) return { kind: "chat" };
  if (/\bhey perkos\b/.test(t) || t === "perkos" || t === "hey perk os") return { kind: "listen" };
  if (t === "stop" || t === "para" || t === "basta") return { kind: "stop" };
  if (/\bsettings\b/.test(t) || /\bconfig/.test(t) || /\bajustes\b/.test(t)) return { kind: "settings" };
  if (/\bwake\b/.test(t) || /\bdespiert/.test(t)) return { kind: "wake" };
  // Dormir al equipo es explicito; "stop" solo corta voz y escucha.
  if (/\b(sleep|hibernate|rest)\b.*\b(team|desk|agents|everyone)\b|\b(team|desk|agents)\b.*\b(sleep|hibernate)\b|\bduerm[ea]n?\b|\bhibern/.test(t)) return { kind: "sleep" };
  if (/\binvite\b/.test(t) || /\binvita\b/.test(t)) return { kind: "invite" };
  if (/^(approve|approved|go ahead|do it|sign it|confirm|aprueba|aprobado|dale|confirma)\b/.test(t)) return { kind: "approve" };
  if (/^(cancel|cancela|discard|descarta|never mind|forget it)\b/.test(t)) return { kind: "cancel" };
  if (/\b(summari[sz]e|recap|wrap up|resume|resumen|resumir)\b/.test(t) && /\b(today|the day|day|session|hoy|el d[ií]a|la sesi[oó]n|what we learned|lo que aprendimos)\b/.test(t)) return { kind: "summarize" };
  const trade = parseTradeIntent(raw);
  if (trade) return trade;
  if (/\b(portfolio|portafolio|holdings|positions|posiciones|what do i (hold|own)|que tengo|qué tengo|mis acciones)\b/.test(t)) return { kind: "portfolio" };
  if (/\b(show|open|see|ver|muestra|abre)\b.*\b(map|graph|mapa|grafo|the team)\b|^(map|mapa|team map|desk map)$/.test(t)) return { kind: "map" };
  if (/\b(history|decisions|past (turns|trades|decisions)|historial|decisiones|historico|histórico)\b/.test(t)) return { kind: "history" };
  // Tolerante a typos frecuentes al dictar/teclear: anayze, analize, analyse, analisa.
  const analyzeVerb = /\b(ana(?:l|ly|lyz|liz|lys|y)[sz]?e?|analiza|analizar|analisa|analisis|análisis|research|investiga|look into|check|revisa|mira)\b/;
  if (analyzeVerb.test(t)) return { kind: "analyze", asset: assetAfter(t, analyzeVerb) };
  const quoteVerb = /\b(price of|precio de|how much is|how much for|cu[aá]nto (?:est[aá]|vale|cuesta)|quote for|cotiza)\b/;
  if (quoteVerb.test(t)) return { kind: "quote", asset: assetAfter(t, quoteVerb) };
  if (/\b(market|mercado|what can (we|i) trade|que puedo operar|qué puedo operar|tokenized stocks|stocks on base)\b/.test(t)) return { kind: "market" };
  if (/\bdocument/.test(t) || /\bnotes\b/.test(t) || /\bnotas\b/.test(t)) return { kind: "docs" };
  return { kind: "chat" };
}

/** Compat con la escena vieja: los comandos del canvas. */
export function parseCommand(raw: string): Command {
  const i = parseIntent(raw);
  switch (i.kind) {
    case "listen": case "wake": case "invite": case "docs": case "market": case "stop": case "settings":
      return i.kind;
    default:
      return "unknown";
  }
}
