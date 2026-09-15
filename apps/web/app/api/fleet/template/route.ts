import { loadSettings } from "../../../lib/settingsStore";
import { deskTemplate } from "../../../lib/fleet";
import { PerkosApiError } from "../../../lib/perkosApi";

// GET /api/fleet/template?lang=es -> la card del desk (nombre, descripcion,
// agentes con su duty). 404 template_unpublished hasta que Admin lo publique.
export async function GET(req: Request) {
  const lang = new URL(req.url).searchParams.get("lang") || "en";
  try {
    const s = await loadSettings();
    if (!s.wallet) return Response.json({ error: "perkos_session_required" }, { status: 401 });
    return Response.json(await deskTemplate(s.wallet, lang));
  } catch (e) {
    if (e instanceof PerkosApiError) {
      if (e.status === 404) return Response.json({ error: "template_unpublished", detail: e.message }, { status: 404 });
      if (e.status === 401) return Response.json({ error: "perkos_session_required", detail: e.message }, { status: 401 });
      return Response.json({ error: e.code ?? "template_failed", detail: e.message }, { status: e.status });
    }
    return Response.json({ error: "template_failed", detail: (e as Error).message }, { status: 502 });
  }
}
