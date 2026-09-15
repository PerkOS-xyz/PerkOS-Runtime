import { pollXaiDeviceLogin, saveXaiTokens, XAI_DEFAULT_MODEL } from "../../../../lib/xaiOAuth";
import { loadSettings, saveSettings } from "../../../../lib/settingsStore";

type Body = { deviceCode?: string; intervalMs?: number };

// Paso 2: un intento de canje por llamada. El cliente repite cada intervalMs.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const deviceCode = body.deviceCode?.trim() ?? "";
  if (!deviceCode) return Response.json({ error: "deviceCode" }, { status: 400 });
  try {
    const r = await pollXaiDeviceLogin(deviceCode, Number(body.intervalMs) || 5000);
    if (r.status === "ok") {
      await saveXaiTokens(r.tokens);
      const cur = await loadSettings();
      const model = cur.model.startsWith("grok-") ? cur.model : XAI_DEFAULT_MODEL;
      await saveSettings({ ...cur, provider: "xai-oauth", model, onboarded: true });
      return Response.json({ status: "ok" });
    }
    return Response.json(r);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
