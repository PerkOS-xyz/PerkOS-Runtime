import { isXaiConnected } from "../../../lib/xaiOAuth";
import { loadSettings } from "../../../lib/settingsStore";

// Como voice_client_config.py de Hermes: el server dice que voz hay disponible
// segun el LLM conectado del usuario. Nunca baja credenciales al renderer.
export async function GET() {
  const s = await loadSettings();
  const connected = s.provider === "xai-oauth" && (await isXaiConnected());
  return Response.json({
    provider: s.provider,
    model: s.model,
    stt: connected ? "xai" : "none",
    // TTS de xAI se intenta con el bearer del usuario; si 403, el cliente cae a system.
    tts: connected ? "xai" : "system"
  });
}
