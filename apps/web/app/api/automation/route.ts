import { guard } from "../../lib/guard";
import { loadSettings } from "../../lib/settingsStore";
import { automationAction, automationPrompt, bankrAutomationConfigured, createAutomation, listLocalAutomations, listRemoteAutomations, parseAutomation, saveLocalAutomation, setLocalStatus, type AutomationRecord } from "../../lib/bankrAutomation";
import { writeNote, appendJournal } from "../../lib/kb";

// GET  /api/automation?remote=1 -> { configured, local[], remote? }
// POST /api/automation { action: "draft", text }            -> AutomationDraft (nada se envia)
// POST /api/automation { action: "create", draft }          -> record (tras Hold to create)
// POST /api/automation { action: "pause"|"resume"|"cancel", id } -> record
// Las automatizaciones viven en Bankr (DCA, stop, limit) y corren desde la
// wallet Bankr de la persona; Floor redacta el prompt, la persona aprueba, y
// Floor guarda el registro local + la nota.
export async function GET(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const local = await listLocalAutomations();
  if (!bankrAutomationConfigured()) return Response.json({ configured: false, local });
  const wantRemote = new URL(req.url).searchParams.get("remote") === "1";
  const remote = wantRemote ? await listRemoteAutomations() : null;
  return Response.json({ configured: true, local, remote: remote ? (remote.ok ? { text: remote.text } : { error: remote.error, detail: remote.detail }) : undefined });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; text?: unknown; draft?: unknown; id?: unknown };
  const action = typeof body.action === "string" ? body.action : "";
  const s = await loadSettings();
  const desk = s.fleetTemplateId || "floor-desk";
  if (!/^0x[0-9a-fA-F]{40}$/.test(s.wallet)) return Response.json({ error: "wallet_required" }, { status: 401 });
  if (!bankrAutomationConfigured()) return Response.json({ error: "bankr_key", detail: "Add a Bankr API key in Settings" }, { status: 412 });

  if (action === "draft") {
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 300) : "";
    if (!text) return Response.json({ error: "text" }, { status: 400 });
    const spec = parseAutomation(text);
    if (!spec) return Response.json({ error: "not_an_automation", detail: "Say a DCA, a stop loss or a limit order, with the asset and the amount" }, { status: 422 });
    if (!spec.asset) return Response.json({ error: "asset", detail: "Which tokenized stock? For example NVDA, TSLA or META" }, { status: 422 });
    const prompt = automationPrompt(spec);
    const draft: AutomationRecord = { ...spec, id: `auto-${Date.now()}`, prompt, createdAt: new Date().toISOString(), status: "active" };
    return Response.json(draft);
  }

  if (action === "create") {
    const d = body.draft as Partial<AutomationRecord> | undefined;
    if (!d || typeof d.prompt !== "string" || !d.prompt.trim() || typeof d.id !== "string") return Response.json({ error: "bad_draft" }, { status: 400 });
    const rec: AutomationRecord = { id: d.id.slice(0, 40), kind: d.kind ?? "schedule", asset: d.asset, amountUsd: d.amountUsd, interval: d.interval, price: d.price, text: String(d.text ?? d.prompt).slice(0, 300), prompt: d.prompt.trim().slice(0, 400), createdAt: new Date().toISOString(), status: "active" };
    const r = await createAutomation(rec.prompt);
    if (!r.ok) return Response.json({ error: r.error, detail: r.detail }, { status: 502 });
    rec.reply = r.text.slice(0, 1200); rec.jobId = r.jobId;
    // Bankr contesta en prosa; si dice que no pudo, el registro queda como pausado para que se vea.
    if (/\b(can't|cannot|unable|not able|insufficient|failed|error)\b/i.test(r.text) && !/\b(created|set up|scheduled|active|will)\b/i.test(r.text)) rec.status = "paused";
    await saveLocalAutomation(rec);
    const title = `${rec.kind.toUpperCase()} ${rec.asset ?? ""}`.trim();
    await writeNote({ desk, kind: "automation", title: `${title} ${rec.id.slice(-6)}`, body: `- Asked: ${rec.text}\n- Prompt to Bankr: ${rec.prompt}\n- Bankr said: ${rec.reply}\n- Status: ${rec.status}\n- Created: ${rec.createdAt}`, ticker: rec.asset }).catch(() => undefined);
    await appendJournal(desk, `Automation ${rec.status}: ${rec.prompt}`).catch(() => undefined);
    return Response.json(rec);
  }

  if (action === "pause" || action === "resume" || action === "cancel") {
    const id = typeof body.id === "string" ? body.id : "";
    const cur = (await listLocalAutomations()).find((r) => r.id === id);
    if (!cur) return Response.json({ error: "not_found" }, { status: 404 });
    const what = `${cur.kind === "dca" ? "DCA" : cur.kind === "stop" ? "stop loss" : cur.kind === "limit" ? "limit order" : "scheduled"} ${cur.asset ?? ""}`.trim();
    const r = await automationAction(action, what);
    if (!r.ok) return Response.json({ error: r.error, detail: r.detail }, { status: 502 });
    const rec = await setLocalStatus(id, action === "cancel" ? "cancelled" : action === "pause" ? "paused" : "active");
    await appendJournal(desk, `Automation ${action}: ${what}. Bankr said: ${r.text.slice(0, 300)}`).catch(() => undefined);
    return Response.json({ ...rec, reply: r.text.slice(0, 1200) });
  }

  return Response.json({ error: "action" }, { status: 400 });
}
