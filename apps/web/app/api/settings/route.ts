import { DEFAULT_MODELS, loadSettings, publicSettings, saveSettings, type Effort, type Provider, type Settings, isVoice } from "../../lib/settingsStore";
import { displayName } from "../../lib/displayName";

const PROVIDERS: Provider[] = ["xai-oauth", "xai", "openai", "anthropic", "local"];

export async function GET() {
  const s = await loadSettings();
  return Response.json({ ...publicSettings(s), name: await displayName(s.wallet) });
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Settings> & { finish?: boolean };
  const cur = await loadSettings();
  const provider = PROVIDERS.includes(body.provider as Provider) ? (body.provider as Provider) : cur.provider;
  const model =
    typeof body.model === "string" && body.model.trim()
      ? body.model.trim()
      : provider === cur.provider ? cur.model : DEFAULT_MODELS[provider];
  const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : cur.apiKey;
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : cur.baseUrl;
  const wallet = typeof body.wallet === "string" ? body.wallet.trim() : cur.wallet;
  const onboarded = body.finish === true ? true : cur.onboarded;
  const effort: Effort = body.effort === "low" || body.effort === "medium" || body.effort === "high" ? body.effort : cur.effort;
  const fleetTemplateId =
    typeof body.fleetTemplateId === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(body.fleetTemplateId) ? body.fleetTemplateId : cur.fleetTemplateId;
  const voice = isVoice(body.voice) ? body.voice : cur.voice;
  const next: Settings = { provider, model, effort, apiKey, baseUrl, wallet, onboarded, fleetTemplateId, voice };
  await saveSettings(next);
  return Response.json(publicSettings(next));
}
