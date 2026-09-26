/**
 * The desk scene: Sparky's look for each voice state, and the line under him.
 */

import { describe, expect, it } from "vitest";

import { coreState, DEFAULT_STARTERS, whisper } from "../app/desks/stage";

describe("coreState", () => {
  it("follows the voice, and thinks while a reply is on its way", () => {
    expect(coreState("listening", false)).toBe("listening");
    expect(coreState("speaking", true)).toBe("speaking");
    expect(coreState("transcribing", false)).toBe("thinking");
    expect(coreState("idle", true)).toBe("thinking");
    expect(coreState("idle", false)).toBe("idle");
  });

  it("says the promise when nothing is happening", () => {
    expect(whisper("idle")).toBe("They draft. You approve.");
    expect(whisper("listening")).toBe("Listening");
  });

  it("has first questions for a desk that publishes none", () => {
    expect(DEFAULT_STARTERS.map((s) => s.text)).toContain("What does this desk do?");
  });
});
