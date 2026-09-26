/**
 * Sparky's memory: where exchanges are kept and what Sparky may recall.
 */

import { describe, expect, it } from "vitest";

import { journalEntry, recallScopes, scopeFor } from "../app/lib/memory";

describe("scopeFor", () => {
  it("keeps an exchange with the open desk, or with the person", () => {
    expect(scopeFor("eqlty-desk")).toBe("eqlty-desk");
    expect(scopeFor(undefined)).toBe("user");
    expect(scopeFor("../outside")).toBe("user");
  });
});

describe("recallScopes", () => {
  it("recalls every desk from the general chat", () => {
    expect(recallScopes(undefined, ["eqlty-desk", "base-desk", "Bad Id"])).toEqual(["user", "eqlty-desk", "base-desk"]);
  });

  it("recalls only the open desk inside a desk", () => {
    expect(recallScopes("eqlty-desk", ["eqlty-desk", "base-desk"])).toEqual(["user", "eqlty-desk"]);
  });
});

describe("journalEntry", () => {
  it("stamps the exchange with the local time", () => {
    const at = new Date(2026, 8, 26, 9, 5);
    expect(journalEntry(" What is my budget? ", "500 USDG a month.\n", at)).toBe(
      "[09:05] Person: What is my budget?\nSparky: 500 USDG a month.",
    );
  });

  it("caps long turns", () => {
    const entry = journalEntry("q".repeat(3000), "a".repeat(3000));
    expect(entry).toContain("q".repeat(2000));
    expect(entry).not.toContain("q".repeat(2001));
    expect(entry).not.toContain("a".repeat(2001));
  });
});
