import { guard } from "../../../lib/guard";
import { loadSettings } from "../../../lib/settingsStore";
import { getXaiAccessToken, XAI_OAUTH_BASE_URL, XAI_ORIGINATOR, XAI_USER_AGENT } from "../../../lib/xaiOAuth";

// POST /api/launch/names { about, pair } -> { options: [{ name, symbol, about }] }
// Paso 2 del launch guiado: con una linea de la persona sobre el token, Sparky (Grok) propone
// tres nombre + simbolo + About cortos, listos para la tarjeta. Sin streaming.
export const runtime = "nodejs";

type Option = { name: string; symbol: string; about: string };

function extractText(j: unknown): string {
  const o = j as { output_text?: unknown; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
  if (typeof o.output_text === "string") return o.output_text;
  const parts: string[] = [];
  for (const item of o.output ?? []) for (const c of item.content ?? []) if (typeof c.text === "string") parts.push(c.text);
  return parts.join("\n");
}

function parseOptions(text: string): Option[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]) as Array<Record<string, unknown>>;
    return arr
      .map((x) => ({ name: String(x.name ?? "").trim().slice(0, 40), symbol: String(x.symbol ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8), about: String(x.about ?? "").trim().slice(0, 200) }))
      .filter((x) => x.name && x.symbol.length >= 2)
      .slice(0, 3);
  } catch { return []; }
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { about?: unknown; pair?: unknown };
  const about = typeof body.about === "string" ? body.about.trim().slice(0, 400) : "";
  const pair = typeof body.pair === "string" ? body.pair.trim().slice(0, 12) : "";
  if (!about) return Response.json({ error: "about_required", detail: "Say in one line what the token is about" }, { status: 400 });
  const token = await getXaiAccessToken().catch(() => null);
  if (!token) return Response.json({ error: "llm_not_connected" }, { status: 401 });
  const s = await loadSettings();
  const instructions = `You name tokens for a PerkOS desk. The person will launch a new token on Base${pair ? `, paired with ${pair}` : ""}, through Bankr. From their one line description, propose exactly three options as a JSON array and nothing else: [{"name": "...", "symbol": "...", "about": "..."}]. Rules: name of one to three words, memorable, no "coin" or "token" unless it fits; symbol of three to six capital letters, not an existing major ticker (not NVDA, TSLA, AAPL, BTC, ETH, USDC, WETH, BNKR); about of one sentence under 140 characters, plain English, no hype words like "revolutionary", no emojis, no em dashes. Make the three options different in tone: one straight, one playful, one short.`;
  const r = await fetch(`${XAI_OAUTH_BASE_URL}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json", "User-Agent": XAI_USER_AGENT, originator: XAI_ORIGINATOR },
    body: JSON.stringify({ model: s.model, instructions, input: [{ role: "user", content: `The token: ${about}` }], reasoning: { effort: "low" }, stream: false }),
    signal: AbortSignal.timeout(40_000)
  });
  if (!r.ok) return Response.json({ error: "llm_failed", detail: `xAI ${r.status}` }, { status: 502 });
  const j = (await r.json().catch(() => ({}))) as unknown;
  const options = parseOptions(extractText(j));
  if (!options.length) return Response.json({ error: "no_options", detail: "Sparky could not come up with names. Type them on the card." }, { status: 502 });
  return Response.json({ options });
}
