/**
 * Model sources and the saved choice.
 */

import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AiRegistry, type AiProvider, type ProviderHealth } from "@perkos/ai";

import { listSources, validateChoice } from "../app/lib/models";
import { SettingsStore } from "../app/lib/settings";

function provider(id: string, health: ProviderHealth, models: string[]): AiProvider {
  return {
    id,
    label: id.toUpperCase(),
    health: async () => health,
    models: async () => models.map((m) => ({ id: m })),
    chat: async function* () {},
  };
}

const up = provider("local", { ok: true, detail: "Ollama is answering." }, ["llama3.2", "qwen2.5"]);
const down = provider("cloud", { ok: false, detail: "No key set." }, ["gpt-x"]);

describe("model sources", () => {
  it("lists each source with its models, and none for a source that is down", async () => {
    expect(await listSources(new AiRegistry([up, down]))).toEqual([
      { id: "local", label: "LOCAL", ok: true, detail: "Ollama is answering.", models: ["llama3.2", "qwen2.5"] },
      { id: "cloud", label: "CLOUD", ok: false, detail: "No key set.", models: [] },
    ]);
  });
});

describe("model choice", () => {
  const registry = new AiRegistry([up, down]);

  it("accepts a model the source offers", async () => {
    expect(await validateChoice(registry, { provider: "local", model: "qwen2.5" })).toEqual({ provider: "local", model: "qwen2.5" });
  });

  it("rejects an unknown source, a source that is down, and a model it does not offer", async () => {
    expect(await validateChoice(registry, { provider: "nope", model: "x" })).toHaveProperty("error");
    expect(await validateChoice(registry, { provider: "cloud", model: "gpt-x" })).toEqual({ error: "No key set." });
    expect(await validateChoice(registry, { provider: "local", model: "missing" })).toHaveProperty("error");
  });
});

describe("settings store", () => {
  it("merges updates and writes with owner-only permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "perkos-runtime-"));
    const store = new SettingsStore(() => dir);
    expect(await store.load()).toEqual({});
    await store.update({ model: { provider: "local", model: "llama3.2" } });
    expect((await stat(join(dir, "settings.json"))).mode & 0o777).toBe(0o600);
    expect(await store.load()).toEqual({ model: { provider: "local", model: "llama3.2" } });
  });
});
