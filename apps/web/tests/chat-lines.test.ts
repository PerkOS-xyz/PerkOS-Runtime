/**
 * The lines of a desk conversation: each reply written into its own line
 * while several arrive at once, what the model gets back, and how the team's
 * lines are drawn.
 */

import { describe, expect, it } from "vitest";

import { appendPiece, dropIfEmpty, modelHistory, newMessageId, type Message } from "../app/chat/messages";
import { agentLabel, factFor, lineParts, missedLine } from "../app/turn/mentions";

const ID = "20260926-143200-ab12";
const facts = ["[F1] NVDA (NVIDIA): 181.20 USDG at 14:30, +1.20% in 24h, tradeable."];

describe("the team's lines as the chat draws them", () => {
  it("makes chips of the desk's @mentions and leaves other @words alone", () => {
    expect(lineParts("@Trader @Auditor NVDA holds [F1]. Mail julio@perkos.xyz or @nobody.")).toEqual([
      { mention: "@Trader", role: "trader" },
      { text: " " },
      { mention: "@Auditor", role: "auditor" },
      { text: " NVDA holds " },
      { fact: 1 },
      { text: ". Mail julio@perkos.xyz or @nobody." },
    ]);
    expect(lineParts("@Sparky Entry: 50 USDG.")[0]).toEqual({ mention: "@Sparky", role: "sparky" });
    expect(lineParts("@Hooks read it", ["hooks"])[0]).toEqual({ mention: "@Hooks", role: "hooks" });
    expect(lineParts("plain")).toEqual([{ text: "plain" }]);
  });

  it("finds the fact a tag points at", () => {
    expect(factFor(facts, 1)).toBe("NVDA (NVIDIA): 181.20 USDG at 14:30, +1.20% in 24h, tradeable.");
    expect(factFor(facts, 2)).toBeUndefined();
    expect(factFor(undefined, 1)).toBeUndefined();
  });

  it("labels an agent as running on PerkOS, and a missing answer in one short line", () => {
    expect(agentLabel("Scout")).toBe("Scout · PerkOS");
    expect(missedLine("Auditor", "model failed")).toBe("Auditor did not answer: model failed");
  });
});

describe("the conversation's lines", () => {
  const list = (): Message[] => [
    { id: "a", role: "user", content: "How is NVDA doing today?" },
    { id: "b", role: "team", kind: "principal", who: "sparky", content: "@Scout @Risk How is NVDA doing today?", turnId: ID },
    { id: "c", role: "assistant", content: "", tone: "warm" },
    { id: "d", role: "user", content: "What time is it?" },
    { id: "e", role: "assistant", content: "", tone: "to-you" },
  ];

  it("writes each reply into its own line while others arrive after it", () => {
    let l = appendPiece(list(), "c", "The team is on it.");
    l = appendPiece(l, "e", "It is 14:32.");
    l = [...l, { id: "f", role: "team", kind: "agent", who: "scout", content: "@Trader NVDA holds.", turnId: ID }];
    l = appendPiece(l, "c", " First read: steady.");
    expect(l.find((m) => m.id === "c")?.content).toBe("The team is on it. First read: steady.");
    expect(l.find((m) => m.id === "e")?.content).toBe("It is 14:32.");
    expect(appendPiece(l, "nope", "x")).toBe(l);
  });

  it("drops a reply that ended empty, but keeps one that carries the turn's checklist", () => {
    expect(dropIfEmpty(list(), "c").map((m) => m.id)).toEqual(["a", "b", "d", "e"]);
    const withWork: Message[] = [{ id: "s", role: "assistant", content: "", tone: "summary", work: { line: "Worked 71 s · 9 steps", steps: [] } }];
    expect(dropIfEmpty(withWork, "s")).toBe(withWork);
    const said = appendPiece(list(), "c", "Hi");
    expect(dropIfEmpty(said, "c")).toBe(said);
  });

  it("gives the model the person and Sparky only, never the team's lines", () => {
    const l = appendPiece(list(), "c", "The team is on it.");
    expect(modelHistory(l)).toEqual([
      { role: "user", content: "How is NVDA doing today?" },
      { role: "assistant", content: "The team is on it." },
      { role: "user", content: "What time is it?" },
    ]);
  });

  it("gives every line its own id", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newMessageId()));
    expect(ids.size).toBe(200);
  });
});
