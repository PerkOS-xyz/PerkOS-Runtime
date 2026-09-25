/**
 * Choosing who answers. The rule under test is that the person's choice wins
 * and that a fallback is always reported: a silent one turns the choice on the
 * landing into decoration.
 */

import { describe, expect, it } from "vitest";

import { AiRegistry } from "../src/registry.ts";
import type { AiProvider, ProviderHealth } from "../src/types.ts";

const provider = (id: string, health: ProviderHealth): AiProvider => ({
  id,
  label: id,
  health: async () => health,
  models: async () => [],
  // eslint-disable-next-line require-yield
  chat: async function* () {
    throw new Error("not used here");
  },
});

const up = (id: string) => provider(id, { ok: true, detail: `${id} is answering.` });
const down = (id: string, detail: string) => provider(id, { ok: false, detail });
const broken = (id: string): AiProvider => ({ ...up(id), health: async () => Promise.reject(new Error("boom")) });

describe("choosing who answers", () => {
  it("takes the one the person chose", async () => {
    const pick = await new AiRegistry([up("local"), up("xai")]).pick("xai");
    expect(pick.provider.id).toBe("xai");
    expect(pick.fellBack).toBe(false);
  });

  it("falls back, and says why", async () => {
    const registry = new AiRegistry([down("local", "No model is running on this machine."), up("xai")]);
    const pick = await registry.pick("local");
    expect(pick.provider.id).toBe("xai");
    expect(pick.fellBack).toBe(true);
    expect(pick.reason).toContain("No model is running");
  });

  it("refuses rather than answering from nowhere", async () => {
    const registry = new AiRegistry([down("local", "nothing here"), down("xai", "not connected")]);
    await expect(registry.pick("local")).rejects.toMatchObject({ code: "AI_NONE_AVAILABLE" });
  });

  it("treats a provider that throws as one that cannot answer", async () => {
    const pick = await new AiRegistry([broken("local"), up("perkos")]).pick("local");
    expect(pick.provider.id).toBe("perkos");
    expect(pick.fellBack).toBe(true);
  });

  it("says plainly when the stored choice is not a provider it knows", async () => {
    await expect(new AiRegistry([up("local")]).pick("gone")).rejects.toMatchObject({ code: "AI_UNKNOWN_PROVIDER" });
  });

  it("reports every provider for the landing to draw", async () => {
    const all = await new AiRegistry([up("local"), down("xai", "not connected")]).healthAll();
    expect(all.map((x) => [x.id, x.health.ok])).toEqual([
      ["local", true],
      ["xai", false],
    ]);
  });
});
