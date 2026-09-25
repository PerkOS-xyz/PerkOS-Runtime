/** The person's Anthropic API key, kept in <home>/anthropic.json (0600). Never sent to the window. */

import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ensureHome, homeDir } from "./home";

const file = () => join(homeDir(), "anthropic.json");

export const anthropicKey = {
  async load(): Promise<string | null> {
    try {
      const { apiKey } = JSON.parse(await readFile(file(), "utf8")) as { apiKey?: unknown };
      return typeof apiKey === "string" && apiKey ? apiKey : null;
    } catch {
      return null;
    }
  },
  async save(apiKey: string): Promise<void> {
    await ensureHome();
    await writeFile(file(), JSON.stringify({ apiKey }), { mode: 0o600 });
  },
  async clear(): Promise<void> {
    await rm(file(), { force: true });
  },
};
