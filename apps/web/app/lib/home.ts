import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Local data folder. PERKOS_HOME moves it (tests, second profile). */
export function homeDir(): string {
  return process.env.PERKOS_HOME?.trim() || join(homedir(), ".perkos-runtime");
}

export async function ensureHome(): Promise<string> {
  const dir = homeDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}
