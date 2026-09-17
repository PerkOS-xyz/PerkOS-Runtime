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
  | { kind: "listen" | "wake" | "sleep" | "invite" | "stop" | "settings" | "docs" | "market" | "portfolio" | "map" | "history" | "approve" | "cancel" | "summarize" | "advise" | "chat" | "automations" | "fees" }
  | { kind: "launch"; name?: string; symbol?: string; pair?: string; recipient?: string; vesting?: "on" | "off"; feesIn?: "quote"; degen?: boolean }
  | { kind: "automate"; text: string }
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
  // "$5of Amazon" (dictado sin espacio) tambien: el conector puede pegarse al numero.
  const after = t.match(/(?:\b|(?<=\d))(?:of|de|my|mi|mis)\s+(?:my\s+|mis?\s+)?([A-Za-z][A-Za-z0-9.]{0,24})/i)?.[1];
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

/** "launch Floor Desk (FLOOR) paired with NVDA", "launch a token paired with tesla",
 *  "lanza un token FLOOR emparejado con nvidia". null si no es un launch. */
export function parseLaunchIntent(text: string): Extract<Intent, { kind: "launch" }> | null {
  const t = text.trim();
  if (!/\b(launch|deploy|create|lanza(?:r)?|crea(?:r)?|despliega)\b/i.test(t)) return null;
  if (!(/\b(token|coin|memecoin)\b/i.test(t) || /\$[A-Za-z]{2,}/.test(t) || /\(\s*\$?[A-Za-z0-9]{2,}\s*\)/.test(t))) return null;
  const pair = t.match(/\b(?:paired?\s+(?:with|to)|pair(?:ed)?\s+against|against|backed by|on top of|quoted in|emparejad[oa]\s+con|contra|con la acci[oó]n(?: de)?)\s+(?:the\s+|el\s+|la\s+)?\$?([A-Za-z][A-Za-z0-9.]{0,24})/i)?.[1];
  // A quien pagan las fees: "fees to @handle", "fees to alice.eth", "fees to 0x…", "fees to farcaster:dwr", "paid to".
  const recipient = t.match(/\b(?:fees?|earnings|comisiones)\s+(?:go(?:ing)?\s+|paid\s+|pay\s+|payable\s+)?(?:to|for|a|para)\s+((?:x|twitter|farcaster|fc|ens|wallet):\s*@?[A-Za-z0-9_.-]+|@[A-Za-z0-9_]{1,15}|0x[0-9a-fA-F]{40}|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.eth)\b/i)?.[1];
  const vesting: "on" | "off" | undefined = /\b(no|without|sin)\s+vesting\b/i.test(t) ? "off" : /\b(with|con)\s+vesting\b/i.test(t) ? "on" : undefined;
  const feesIn = /\bquote[- ]only\b|\bfees? (only )?in (the )?quote\b/i.test(t) ? "quote" as const : undefined;
  const degen = /\bdegen(?: mode)?\b/i.test(t);
  const quoted = t.match(/["“']([^"”']{2,60})["”']/)?.[1];
  const paren = t.match(/\(\s*\$?([A-Za-z][A-Za-z0-9]{0,19})\s*\)/)?.[1];
  const dollar = t.match(/\$([A-Za-z][A-Za-z0-9]{1,19})\b/)?.[1];
  const caps = t.match(/\b([A-Z][A-Z0-9]{1,9})\b/g)?.filter((w) => !/^(DCA|USD|USDC|ETH|NVDA|TSLA|META|AAPL|AMZN|GOOGL|MSFT|COIN|HOOD|MSTR|PLTR|SPY|QQQ|GME)$/.test(w) && w.toLowerCase() !== (pair ?? "").toLowerCase())?.[0];
  const symbol = (paren ?? dollar ?? caps)?.toUpperCase();
  // El nombre: lo entrecomillado, o las palabras entre el verbo y "(SYM)" / "paired".
  const between = t.match(/\b(?:launch|deploy|create|lanza(?:r)?|crea(?:r)?|despliega)\b\s+(?:a\s+|an\s+|the\s+|un\s+|una\s+)?(?:new\s+|nuevo\s+)?(?:degen\s+)?(?:token\s+|coin\s+|memecoin\s+)?(?:called\s+|named\s+|llamad[oa]\s+)?([^()"“”,]+?)\s*(?:\(|\$[A-Za-z]|paired?\b|pair\b|against\b|backed\b|on top\b|quoted\b|emparejad|contra\b|con la acci|,|\bfees?\b|\bwith\b|\bno vesting\b|$)/i)?.[1]?.trim();
  const cleaned = between?.replace(/\$[A-Za-z0-9]+/g, "").replace(/\s+(token|coin)$/i, "").trim();
  const name = quoted ?? (cleaned && !/^(token|coin|a token|new token)$/i.test(cleaned) && !/^(paired?|pair|against|backed|on top|emparejad|contra|con la)\b/i.test(cleaned) && cleaned.length >= 2 ? cleaned : undefined);
  return { kind: "launch", name: name?.slice(0, 60), symbol: symbol?.slice(0, 20), pair, recipient, vesting, feesIn, degen: degen || undefined };
}

export function parseIntent(raw: string): Intent {
  const t = norm(raw);
  if (!t) return { kind: "chat" };
  if (/\bhey (perkos|sparky)\b/.test(t) || t === "perkos" || t === "sparky" || t === "hey perk os") return { kind: "listen" };
  if (t === "stop" || t === "para" || t === "basta") return { kind: "stop" };
  if (/\bsettings\b/.test(t) || /\bconfig/.test(t) || /\bajustes\b/.test(t)) return { kind: "settings" };
  // Pregunta abierta de inversion: la mesa escanea el mercado y recomienda.
  if (/\b(what|which|que|qué|cual|cuál)\b.*\b(buy|invest|pick|comprar|invertir|conviene)\b|\b(worth buying|opportunit|oportunidad|best (stock|pick|buy)|take profit|ganancia|in a month|this month|para (un|1|el) mes|next month|one month|30 days)\b|\b(recommend|recomienda|recomiendas|advise|aconseja)\b/.test(t) && !/\$\s*\d|\d+\s*(usd|usdc|dollars?)/.test(t)) return { kind: "advise" };
  if (/\bwake\b/.test(t) || /\bdespiert/.test(t)) return { kind: "wake" };
  // Dormir al equipo es explicito; "stop" solo corta voz y escucha.
  if (/\b(sleep|hibernate|rest)\b.*\b(team|desk|agents|everyone)\b|\b(team|desk|agents)\b.*\b(sleep|hibernate)\b|\bduerm[ea]n?\b|\bhibern/.test(t)) return { kind: "sleep" };
  if (/\binvite\b/.test(t) || /\binvita\b/.test(t)) return { kind: "invite" };
  if (/^(approve|approved|go ahead|do it|sign it|confirm|aprueba|aprobado|dale|confirma)\b/.test(t)) return { kind: "approve" };
  if (/^(cancel|cancela|discard|descarta|never mind|forget it)\b/.test(t)) return { kind: "cancel" };
  if (/\b(summari[sz]e|recap|wrap up|resume|resumen|resumir)\b/.test(t) && /\b(today|the day|day|session|hoy|el d[ií]a|la sesi[oó]n|what we learned|lo que aprendimos)\b/.test(t)) return { kind: "summarize" };
  // Automatizaciones (Bankr): recurrentes, stop loss, limit. Antes que la orden simple:
  // "buy $5 of nvda every week" es un DCA, no una compra.
  if (/\b(dca|dollar cost|recurring|every (day|week|month|monday|tuesday|wednesday|thursday|friday|hour|\d+)|daily|weekly|monthly|hourly|stop\s*loss|limit order|automate|automatiza|cada (d[ií]a|semana|mes))\b/.test(t) && !/\b(automations|my automations|mis automatizaciones)\b/.test(t)) return { kind: "automate", text: raw.trim() };
  if (/\b(automations|automatizaciones|scheduled orders|my dcas?|my rules)\b/.test(t)) return { kind: "automations" };
  // Fees del creador (launches): ver y reclamar.
  if (/\b(claim|collect|cobra(?:r)?|reclama(?:r)?)\b.*\b(fees?|earnings|comisiones)\b|\b(my|mis)\s+(fees?|earnings|creator fees|comisiones)\b|^(fees|earnings)$|\b(what (did|have) i earn(ed)?|cu[aá]nto (gan[eé]|he ganado))\b/.test(t)) return { kind: "fees" };
  const launch = parseLaunchIntent(raw);
  if (launch) return launch;
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
