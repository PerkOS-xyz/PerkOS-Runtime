/**
 * Desk agents' avatars: a fixed look per house role, and states that change
 * the eyes and the ring but never who the agent is.
 */

import { describe, expect, it } from "vitest";

import { AGENT_STATES, DESK_IDENTITIES, resolveIdentity, roleConfig } from "../app/team/avatarIdentity";

describe("the house team", () => {
  it("has four agents that differ in head, visor and pattern", () => {
    const team = ["scout", "risk", "trader", "auditor"].map((r) => DESK_IDENTITIES[r]!);
    for (const part of ["head", "visor", "pattern"] as const) {
      expect(new Set(team.map((t) => t[part])).size).toBe(4);
    }
  });

  it("never looks like Sparky: no round head with the oval visor", () => {
    for (const id of Object.values(DESK_IDENTITIES)) {
      expect((id.head === "head-01" || id.head === "head-03") && id.visor === "visor-01" && id.modules === "module-01").toBe(false);
    }
  });

  it("keeps an agent's own identity first, then the house one, then a plain one in the role's accent", () => {
    const own = { ...DESK_IDENTITIES.risk!, head: "head-02" as const };
    expect(resolveIdentity({ role: "risk", avatarIdentity: own })).toBe(own);
    expect(resolveIdentity({ role: "scout" })).toBe(DESK_IDENTITIES.scout);
    expect(resolveIdentity({ role: "analyst" }).accent).toBe(roleConfig("analyst").accent);
    expect(roleConfig("").label).toBe("Agent");
  });

  it("gives a role it does not know its own name and a look of its own that is never Sparky's", () => {
    expect(roleConfig("hooks").label).toBe("Hooks");
    expect(roleConfig("launch-hook").label).toBe("Launch Hook");
    expect(resolveIdentity({ role: "hooks" })).toEqual(resolveIdentity({ role: "hooks" }));
    const looks = ["hooks", "quote", "treasury", "route", "depth", "auction"].map((role) => resolveIdentity({ role }));
    for (const id of looks) {
      expect((id.head === "head-01" || id.head === "head-03") && id.visor === "visor-01" && id.modules === "module-01").toBe(false);
      expect(id.accent).toBe(roleConfig("agent").accent);
    }
    expect(new Set(looks.map((id) => [id.head, id.visor, id.modules, id.pattern, id.secondaryDetail].join(":"))).size).toBe(looks.length);
  });
});

describe("states", () => {
  it("sleeps without losing the identity", () => {
    expect(AGENT_STATES.hibernating).toEqual({ expression: "sleepy", ring: null, mode: "hibernating" });
    expect(AGENT_STATES.success.expression).toBe("success");
  });
});
