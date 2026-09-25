/**
 * Sentence splitting for speech while a reply streams in.
 */

import { describe, expect, it } from "vitest";

import { SentenceSplitter } from "../app/voice/sentences";

describe("SentenceSplitter", () => {
  it("emits a sentence once it is followed by whitespace", () => {
    const s = new SentenceSplitter();
    expect(s.push("Hi! I am Spar")).toEqual(["Hi!"]);
    expect(s.push("ky. Which desk")).toEqual(["I am Sparky."]);
    expect(s.push(" do you want?")).toEqual([]);
    expect(s.flush()).toEqual(["Which desk do you want?"]);
  });

  it("does not cut decimals or tickers with dots", () => {
    const s = new SentenceSplitter();
    expect(s.push("NVDA is at 224.27 today. BRK.B too.")).toEqual(["NVDA is at 224.27 today."]);
    expect(s.flush()).toEqual(["BRK.B too."]);
  });

  it("treats a line break as the end of a sentence", () => {
    const s = new SentenceSplitter();
    expect(s.push("First line\nSecond")).toEqual(["First line"]);
    expect(s.flush()).toEqual(["Second"]);
  });
});
