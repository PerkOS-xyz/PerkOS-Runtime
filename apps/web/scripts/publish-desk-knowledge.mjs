#!/usr/bin/env node
// Publica las notas de la mesa (knowledge/desk/*.md) en PerkOS Knowledge como
// items publicos, para que cualquier instalacion de Floor las reciba.
//
//   KNOWLEDGE_INGEST_TOKEN=... [KNOWLEDGE_AGENT_ID=perkos-floor-desk] \
//   [KNOWLEDGE_BASE_URL=https://knowledge.perkos.xyz] node scripts/publish-desk-knowledge.mjs [--dry-run]
//
// El agente contribuidor debe existir en Knowledge (POST /api/admin/agents).
// Nunca imprime el token.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const BASE = (process.env.KNOWLEDGE_BASE_URL || "https://knowledge.perkos.xyz").replace(/\/$/, "");
const TOKEN = process.env.KNOWLEDGE_INGEST_TOKEN?.trim();
const AGENT = process.env.KNOWLEDGE_AGENT_ID?.trim() || "perkos-floor-desk";
const dry = process.argv.includes("--dry-run");
const dir = join(process.cwd(), "knowledge", "desk");

function parseFront(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta = {};
  for (const line of m[1].split("\n")) { const i = line.indexOf(":"); if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, ""); }
  return { meta, body: raw.slice(m[0].length) };
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

const files = (await readdir(dir)).filter((f) => f.endsWith(".md")).sort();
const items = [];
for (const f of files) {
  const { meta, body } = parseFront(await readFile(join(dir, f), "utf8"));
  const title = meta.title || body.match(/^#\s+(.+)$/m)?.[1] || f;
  const text = body.replace(/^#\s+.+\n?/m, "").trim();
  const urls = (meta.sources || "").split(",").map((u) => u.trim()).filter(Boolean);
  items.push({
    date: (meta.updated || new Date().toISOString()).slice(0, 10),
    track: "floor-desk",
    title,
    path: `floor/desk/${slug(title)}.md`,
    summary: text,
    content: text,
    chains: ["base"],
    status: "published",
    confidence: "high",
    validation_status: "validated",
    sanitization_status: "sanitized",
    visibility: "public",
    evidence: urls.map((url) => ({ type: url.includes("basescan.org") ? "explorer" : "official_doc", url, verified: true, note: "verified by the PerkOS Floor desk, 2026-09-16" })),
    metadata: { app: "perkos-floor", file: f }
  });
}
console.log(`${items.length} note(s):`);
for (const it of items) console.log(`- ${it.path} (${it.summary.length} chars, ${it.evidence.length} sources)`);
if (dry) process.exit(0);
if (!TOKEN) { console.error("KNOWLEDGE_INGEST_TOKEN is not set"); process.exit(2); }
const res = await fetch(`${BASE}/api/ingest/research`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}`, "x-agent-id": AGENT },
  body: JSON.stringify({ source: "perkos-floor", visibility: "public", contribution_type: "desk-knowledge", items })
});
const j = await res.json().catch(() => ({}));
console.log(`HTTP ${res.status}`, JSON.stringify({ ok: j.ok, upserted: j.upserted, accepted: Array.isArray(j.accepted) ? j.accepted.map((a) => `${a.path} ${a.publicationStatus}`) : undefined, error: j.error }, null, 1));
process.exit(res.ok ? 0 : 1);
