import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homePath } from "./home";

// Automatizaciones de Bankr (DCA, stop loss, limit, comandos programados).
// Las crea y gestiona el agente de Bankr por lenguaje natural (Agent API);
// el endpoint /user/automation es de sesion web, no de API key. Ejecutan
// desde la wallet Bankr de la persona. Floor redacta, la persona aprueba con
// Hold to create, y Floor guarda un registro local de lo que pidio.
const BASE = "https://api.bankr.bot";
const key = () => { const k = process.env.BANKR_API_KEY?.trim(); return k && k.startsWith("bk_") ? k : null; };

export type AutoKind = "dca" | "stop" | "limit" | "schedule";
export type AutomationSpec = { kind: AutoKind; asset?: string; amountUsd?: number; interval?: string; price?: number; text: string };
export type AutomationRecord = AutomationSpec & { id: string; prompt: string; createdAt: string; status: "active" | "paused" | "cancelled"; reply?: string; jobId?: string };
export type PromptResult = { ok: true; text: string; jobId: string; threadId?: string } | { ok: false; error: string; detail: string };

export function bankrAutomationConfigured(): boolean { return key() !== null; }

/** Un prompt al agente de Bankr, con el poll del job. */
export async function bankrPrompt(prompt: string, timeoutMs = 90_000, threadId?: string): Promise<PromptResult> {
  const k = key(); if (!k) return { ok: false, error: "bankr_key", detail: "No Bankr key on this install" };
  const start = await fetch(`${BASE}/agent/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-API-Key": k },
    body: JSON.stringify(threadId ? { prompt, threadId } : { prompt }), signal: AbortSignal.timeout(20_000)
  }).then(async (r) => ({ status: r.status, j: (await r.json().catch(() => ({}))) as Record<string, unknown> })).catch((e) => ({ status: 0, j: { error: String(e) } as Record<string, unknown> }));
  const jobId = String(start.j.jobId ?? "");
  if (!jobId) return { ok: false, error: String(start.j.error ?? `bankr_${start.status}`), detail: String(start.j.message ?? start.j.error ?? start.status) };
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2500));
    const raw = await fetch(`${BASE}/agent/job/${jobId}`, { headers: { "X-API-Key": k }, signal: AbortSignal.timeout(15_000) }).then((r) => r.text()).catch(() => "");
    const j = parseLoose(raw);
    const status = String(j.status ?? "");
    if (status === "completed") return { ok: true, text: String(j.response ?? j.result ?? "").trim(), jobId, threadId: typeof j.threadId === "string" ? j.threadId : undefined };
    if (status === "failed" || status === "cancelled") return { ok: false, error: "bankr_job_failed", detail: String(j.error ?? j.response ?? status) };
  }
  return { ok: false, error: "bankr_timeout", detail: `Bankr did not answer in ${Math.round(timeoutMs / 1000)} s` };
}

// El job de Bankr a veces devuelve saltos de linea sin escapar dentro del JSON.
function parseLoose(raw: string): Record<string, unknown> {
  try { return JSON.parse(raw) as Record<string, unknown>; } catch { /* fall through */ }
  try {
    const fixed = raw.split("").map((ch) => {
      const c = ch.charCodeAt(0);
      if (ch === "\n") return "\\n";
      if (ch === "\r") return "";
      if (ch === "\t") return "\\t";
      return c < 32 ? " " : ch;
    }).join("");
    return JSON.parse(fixed) as Record<string, unknown>;
  } catch { return {}; }
}

/** El prompt que Bankr entiende para cada tipo (docs.bankr.bot/agent-api, automations). */
export function automationPrompt(d: AutomationSpec): string {
  const asset = (d.asset ?? "").replace(/c$/i, "").toUpperCase();
  const usd = d.amountUsd ?? 5;
  if (d.kind === "dca") return `DCA $${usd} into ${asset} tokenized stock on Base ${d.interval ?? "every week"}`;
  if (d.kind === "stop") return `Set a stop loss for my ${asset} tokenized stock on Base at $${d.price ?? 0}`;
  if (d.kind === "limit") return `Set a limit order to buy $${usd} of ${asset} tokenized stock on Base if the price drops to $${d.price ?? 0}`;
  return d.text;
}

/** Lo que la persona describio en una frase: "dca $5 into nvda every week", "stop loss tsla at 380". */
export function parseAutomation(text: string): AutomationSpec | null {
  const t = text.trim().toLowerCase();
  const amount = t.match(/\$\s?(\d+(?:\.\d+)?)/) ?? t.match(/(\d+(?:\.\d+)?)\s*(?:usd|usdc|dollars?|bucks)/);
  const amountUsd = amount ? Number(amount[1]) : undefined;
  const price = t.match(/(?:at|to|below|under|reaches?)\s+\$?\s?(\d+(?:\.\d+)?)/);
  const interval = t.match(/\b(every\s+(?:day|week|month|monday|tuesday|wednesday|thursday|friday|hour|\d+\s*(?:hours?|days?|weeks?))|daily|weekly|monthly|hourly)\b/);
  const asset = t.match(/\b(?:into|of|buy|my|for|sell)\s+\$?([a-z]{1,10})\b(?!\s*(?:usd|usdc|dollars?))/);
  const rawAsset = asset ? asset[1] : undefined;
  const skip = new Set(["the", "a", "my", "tokenized", "stock", "into", "every", "week", "day", "month"]);
  const a = rawAsset && !skip.has(rawAsset) ? rawAsset.toUpperCase() : undefined;
  if (/\bdca\b|dollar cost|recurring|every|daily|weekly|monthly/.test(t)) return { kind: "dca", asset: a, amountUsd, interval: interval ? interval[1].replace(/^daily$/, "every day").replace(/^weekly$/, "every week").replace(/^monthly$/, "every month").replace(/^hourly$/, "every hour") : "every week", text };
  if (/stop\s*loss|stop\b/.test(t)) return { kind: "stop", asset: a, price: price ? Number(price[1]) : undefined, text };
  if (/limit|if .*drops|when .*(?:hits|reaches|drops)|below|under/.test(t)) return { kind: "limit", asset: a, amountUsd, price: price ? Number(price[1]) : undefined, text };
  return null;
}

/** Registro local (~/.perkos-xyz/automations.json): lo que Floor pidio, con la respuesta de Bankr. */
const file = () => homePath("automations.json");
export async function listLocalAutomations(): Promise<AutomationRecord[]> {
  try { return JSON.parse(await readFile(file(), "utf8")) as AutomationRecord[]; } catch { return []; }
}
export async function saveLocalAutomation(rec: AutomationRecord): Promise<void> {
  const all = (await listLocalAutomations()).filter((r) => r.id !== rec.id);
  all.unshift(rec);
  await mkdir(homePath(), { recursive: true, mode: 0o700 });
  await writeFile(file(), JSON.stringify(all.slice(0, 200), null, 2), { mode: 0o600 });
}
export async function setLocalStatus(id: string, status: AutomationRecord["status"]): Promise<AutomationRecord | null> {
  const all = await listLocalAutomations();
  const rec = all.find((r) => r.id === id); if (!rec) return null;
  rec.status = status;
  await writeFile(file(), JSON.stringify(all, null, 2), { mode: 0o600 });
  return rec;
}

export async function createAutomation(prompt: string) { return bankrPrompt(prompt, 120_000); }
export async function listRemoteAutomations() { return bankrPrompt("List my active automations with their id, type, asset, amount and schedule.", 90_000); }
export async function automationAction(action: "pause" | "resume" | "cancel", what: string) { return bankrPrompt(`${action} my ${what} automation`, 90_000); }
