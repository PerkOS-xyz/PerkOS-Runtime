export type Command =
  | "listen"
  | "wake"
  | "invite"
  | "docs"
  | "market"
  | "stop"
  | "settings"
  | "unknown";

export function parseCommand(raw: string): Command {
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 áéíóúñ]/g, " ")
    .replace(/\s+/g, " ");
  if (!t) return "unknown";
  if (/\bhey perkos\b/.test(t) || t === "perkos" || t === "hey perk os") return "listen";
  if (/\bwake\b/.test(t) || /\bdespiert/.test(t)) return "wake";
  if (/\binvite\b/.test(t) || /\binvita\b/.test(t)) return "invite";
  if (/\bdocument/.test(t) || /\banalyze\b/.test(t) || /\banalis/.test(t)) return "docs";
  if (/\bmarket\b/.test(t) || /\bnvda\b/.test(t) || /\bmercado\b/.test(t)) return "market";
  if (t === "stop" || t === "para") return "stop";
  if (/\bsettings\b/.test(t) || /\bconfig/.test(t) || /\bajustes\b/.test(t)) return "settings";
  return "unknown";
}
