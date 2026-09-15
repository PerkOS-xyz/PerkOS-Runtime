import { isXaiConnected } from "../../../lib/xaiOAuth";
import { loadSettings } from "../../../lib/settingsStore";

// Que LLM esta conectado en esta maquina. Independiente de la sesion de Privy:
// el logout del wallet no toca esto (como cualquier app de AI).
export async function GET() {
  const s = await loadSettings();
  const connected = s.provider === "xai-oauth" ? await isXaiConnected() : Boolean(s.apiKey);
  return Response.json({ provider: s.provider, model: s.model, connected });
}
