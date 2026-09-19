import { guard } from "../../lib/guard";
import { DEFAULT_MODELS, loadSettings, publicSettings, saveSettings, type Effort, type Provider, type Settings, isVoice } from "../../lib/settingsStore";
import { displayName } from "../../lib/displayName";

const PROVIDERS: Provider[] = ["xai-oauth", "xai", "openai", "anthropic", "local"];

export async function GET() {
  const s = await loadSettings();
  return Response.json({
    ...publicSettings(s),
    name: await displayName(s.wallet),
    // Set by the Electron shell (apps/desktop/main.cjs); "dev" when the web app runs alone.
    version: process.env.PERKOS_APP_VERSION?.trim() || "dev",
    build: process.env.PERKOS_APP_BUILD?.trim() || ""
  });
}

export async function POST(req: Request) {
  const denied = guard(req);
  if (denied) return denied;
  const body = (await req.json()) as Partial<Settings> & { finish?: boolean };
  const cur = await loadSettings();
  const provider = PROVIDERS.includes(body.provider as Provider) ? (body.provider as Provider) : cur.provider;
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : provider === cur.provider ? cur.model : DEFAULT_MODELS[provider];
  const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : cur.apiKey;
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : cur.baseUrl;
  // Solo una direccion valida, y solo desde la ventana (guard): es el destinatario de cada swap.
  const wallet = typeof body.wallet === "string" && /^0x[a-fA-F0-9]{40}$/.test(body.wallet.trim()) ? body.wallet.trim() : cur.wallet;
  const onboarded = body.finish === true ? true : cur.onboarded;
  const effort: Effort = body.effort === "low" || body.effort === "medium" || body.effort === "high" ? body.effort : cur.effort;
  const fleetTemplateId =
    typeof body.fleetTemplateId === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(body.fleetTemplateId) ? body.fleetTemplateId : cur.fleetTemplateId;
  const voice = isVoice(body.voice) ? body.voice : cur.voice;
  // The guest identity is minted by the invite route, so carry it through
  // untouched: a settings save must never orphan an invited bot.
  const next: Settings = { provider, model, effort, apiKey, baseUrl, wallet, onboarded, fleetTemplateId, guestAgentId: cur.guestAgentId, guestName: cur.guestName, voice };
  await saveSettings(next);
  return Response.json(publicSettings(next));
}
