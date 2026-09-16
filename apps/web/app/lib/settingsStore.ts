import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Como Hermes: la suscripcion de xAI es un proveedor propio ("xai-oauth"),
// no un modo de auth de "xai". Los demas quedan "coming soon" en el wizard.
export type Provider = "xai-oauth" | "xai" | "openai" | "anthropic" | "local";

export type Effort = "low" | "medium" | "high";

export type Settings = {
  provider: Provider;
  model: string;
  // Responses API reasoning.effort. "low" para conversacion hablada: grok-4.6
  // sin tope piensa 20-70 s por turno (medido 2026-09-15). Hermes Desktop lo
  // expone en el chip ("Grok 4.6 · Med").
  effort: Effort;
  apiKey: string;   // solo para proveedores por key (coming soon)
  baseUrl: string;  // solo para "local" (coming soon)
  onboarded: boolean;
  wallet: string;
  // Template fleet elegido en el wizard (project_templates de PerkOS, kind
  // fleet). Hoy solo floor-desk; el paso "Choose your team" muestra una card
  // por template publicado.
  fleetTemplateId: string;
  // Voz de Floor (xAI TTS voice_id). Sparky habla con "rex"; las voces validas
  // se probaron contra /v1/tts el 2026-09-16 (mika y valentin no existen).
  voice: Voice;
};

import { DEFAULT_VOICE, isVoice, type Voice } from "./voices";
import { HOME_DIR } from "./home";
export { VOICES, DEFAULT_VOICE, isVoice, type Voice } from "./voices";

export const DEFAULT_FLEET_TEMPLATE = "floor-desk";

const dir = HOME_DIR;
const file = join(dir, "settings.json");

export const DEFAULT_MODELS: Record<Provider, string> = {
  "xai-oauth": "grok-4.6",
  xai: "grok-4.6",
  openai: "gpt-4o-mini",
  anthropic: "claude-sonnet-4-5",
  local: "llama3.1"
};

const PROVIDERS: Provider[] = ["xai-oauth", "xai", "openai", "anthropic", "local"];

function providerOf(v: unknown): Provider {
  return PROVIDERS.includes(v as Provider) ? (v as Provider) : "xai-oauth";
}

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = JSON.parse(await readFile(file, "utf8")) as Partial<Settings>;
    const provider = providerOf(raw.provider);
    let model = typeof raw.model === "string" && raw.model ? raw.model : DEFAULT_MODELS[provider];
    // Auto-cura: al cambiar de proveedor puede quedar un modelo ajeno guardado
    // (p.ej. gpt-4o-mini con xai-oauth). Como Hermes (models_validate: xai-oauth -> grok-*).
    if (provider === "xai-oauth" || provider === "xai") {
      if (!model.startsWith("grok-")) model = DEFAULT_MODELS[provider];
    }
    const effort: Effort = raw.effort === "medium" || raw.effort === "high" ? raw.effort : "low";
    return {
      provider,
      model,
      effort,
      apiKey: typeof raw.apiKey === "string" ? raw.apiKey : "",
      baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : "",
      onboarded: Boolean(raw.onboarded),
      wallet: typeof raw.wallet === "string" ? raw.wallet : "",
      fleetTemplateId: typeof raw.fleetTemplateId === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(raw.fleetTemplateId) ? raw.fleetTemplateId : DEFAULT_FLEET_TEMPLATE,
      voice: isVoice(raw.voice) ? raw.voice : DEFAULT_VOICE
    };
  } catch {
    return { provider: "xai-oauth", model: DEFAULT_MODELS["xai-oauth"], effort: "low", apiKey: "", baseUrl: "", onboarded: false, wallet: "", fleetTemplateId: DEFAULT_FLEET_TEMPLATE, voice: DEFAULT_VOICE };
  }
}

export async function saveSettings(next: Settings): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify(next)}\n`, { mode: 0o600 });
}

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length < 8) return "••••";
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

export function maskWallet(addr: string): string {
  if (!addr || addr.length < 10) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function publicSettings(s: Settings) {
  return {
    provider: s.provider,
    model: s.model,
    effort: s.effort,
    hasKey: Boolean(s.apiKey),
    masked: maskKey(s.apiKey),
    baseUrl: s.baseUrl,
    onboarded: s.onboarded,
    wallet: maskWallet(s.wallet),
    voice: s.voice
  };
}
