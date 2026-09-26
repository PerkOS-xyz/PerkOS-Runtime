import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { portraitFor, portraitSrc } from "../app/team/agentPortraits";

const PUBLIC = join(__dirname, "..", "public");

describe("agent portraits", () => {
  it("gives each seated role its own head", () => {
    const roles = ["scout", "risk", "trader", "auditor", "hooks", "quote", "treasury"];
    const heads = roles.map(portraitFor);
    expect(new Set(heads).size).toBe(roles.length);
    expect(portraitFor("Scout")).toBe(portraitFor("scout"));
  });

  it("keeps the same spare head for a role it does not know", () => {
    expect(portraitFor("researcher")).toBe(portraitFor("researcher"));
    expect(portraitFor("researcher")).toMatch(/^agent-(orbit|cat|cloud|leaf|sprout|bubblegum)$/);
  });

  it("points at a file the app serves", () => {
    for (const role of ["scout", "risk", "trader", "auditor", "hooks", "quote", "treasury", "researcher", "", "x"]) {
      expect(existsSync(join(PUBLIC, portraitSrc(role)))).toBe(true);
    }
  });
});
