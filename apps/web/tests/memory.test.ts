/**
 * Sparky's memory: where exchanges are kept and what Sparky may recall.
 */

import { describe, expect, it } from "vitest";

import { recallScopes, scopeFor } from "../app/lib/memory";

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
