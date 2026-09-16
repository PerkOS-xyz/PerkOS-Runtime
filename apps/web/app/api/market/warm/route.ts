import { marketScan } from "../../../lib/scan";
import { cachedNews, newsFor } from "../../../lib/news";
import { assetProfile, cachedProfile } from "../../../lib/profile";

// POST /api/market/warm -> precalienta en segundo plano el scan (rango de 30
// dias), las noticias (15 min) y los perfiles de valuacion (24 h) de todos los
// activos operables, de a 3, para que una pregunta abierta tenga todo listo.
// Responde de inmediato; el trabajo sigue en el servidor. Idempotente.
let running = false;
let last: { at: string; scanned: number; news: number; profiles: number; ms: number } | null = null;

async function warm() {
  const t0 = Date.now();
  const scan = await marketScan();
  let news = 0, profiles = 0;
  const rows = [...scan.rows];
  const worker = async () => {
    for (let r = rows.shift(); r; r = rows.shift()) {
      if (!(await cachedNews(r.ticker))) { const n = await newsFor(r.ticker, r.name).catch(() => null); if (n && !("error" in n)) news += 1; }
      if (!(await cachedProfile(r.ticker))) { const p = await assetProfile(r.ticker, r.name).catch(() => undefined); if (p) profiles += 1; }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  last = { at: new Date().toISOString(), scanned: scan.rows.length, news, profiles, ms: Date.now() - t0 };
}

export async function POST() {
  if (running) return Response.json({ started: false, running: true, last });
  running = true;
  void warm().catch((e) => console.warn("[warm]", (e as Error).message)).finally(() => { running = false; });
  return Response.json({ started: true, last });
}

export async function GET() {
  return Response.json({ running, last });
}
