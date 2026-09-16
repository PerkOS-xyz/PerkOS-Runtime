// Voces de Floor (xAI TTS voice_id). Sin dependencias de Node: lo importan el
// store de settings (servidor) y el panel de Settings (cliente). Las voces se
// probaron una por una contra /v1/tts el 2026-09-16; mika y valentin no existen.
// Sparky es un hombre joven: leo por defecto (rex suena mayor).
export const VOICES = ["leo", "rex", "sal", "gork", "eve", "ara", "una"] as const;
export type Voice = (typeof VOICES)[number];
export const DEFAULT_VOICE: Voice = "leo";
export const VOICE_LABEL: Record<Voice, string> = { rex: "Rex", leo: "Leo", sal: "Sal", gork: "Gork", eve: "Eve", ara: "Ara", una: "Una" };
export const isVoice = (v: unknown): v is Voice => typeof v === "string" && (VOICES as readonly string[]).includes(v);
