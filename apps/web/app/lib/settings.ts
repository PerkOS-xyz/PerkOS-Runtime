/** Local settings in <home>/settings.json (0600). */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ensureHome, homeDir } from "./home";

export interface ModelChoice {
  /** Provider id, for example `local`. */
  provider: string;
  model: string;
}

export interface Settings {
  model?: ModelChoice;
}

export class SettingsStore {
  constructor(private readonly dir: () => string = homeDir) {}

  private file() {
    return join(this.dir(), "settings.json");
  }

  async load(): Promise<Settings> {
    try {
      const s = JSON.parse(await readFile(this.file(), "utf8")) as Settings;
      return s && typeof s === "object" ? s : {};
    } catch {
      return {};
    }
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.load()), ...patch };
    await ensureHome();
    await writeFile(this.file(), JSON.stringify(next, null, 2), { mode: 0o600 });
    return next;
  }
}

export const settings = new SettingsStore();
