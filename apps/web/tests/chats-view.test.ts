/**
 * Saved chats in the view: thread ids, the chat commands, the drawer's sections and its words.
 */

import { isChatId } from "@perkos/vault";
import { describe, expect, it } from "vitest";

import { chatCommand, chatWhen, escapeIsMine, groupChats, groupNames, keptLines, LOST_SAVE_CAPTION, newChatCaption, newChatId, savable, type ChatRow } from "../app/chat/chatsView";

const row = (id: string, extra: Partial<ChatRow> = {}): ChatRow => ({
  id,
  scope: "home",
  title: id,
  group: "",
  pinned: false,
  createdAt: "2026-09-26T10:00:00.000Z",
  updatedAt: "2026-09-26T10:00:00.000Z",
  count: 2,
  preview: "",
  ...extra
});

describe("newChatId", () => {
  it("makes ids the server accepts", () => {
    expect(isChatId(newChatId())).toBe(true);
    expect(isChatId(newChatId(0, () => 0))).toBe(true);
    expect(isChatId(newChatId(Date.UTC(2100, 0, 1), () => 0.999999999))).toBe(true);
    expect(newChatId(1_000, () => 0.5)).toBe(`c-${(1_000).toString(36)}-${Math.floor(0.5 * 36 ** 6).toString(36)}`);
  });
});

describe("chatCommand", () => {
  it("knows the short phrases for a new chat and the saved ones, in English and Spanish", () => {
    for (const t of ["new chat", "New chat.", "  NEW   CHAT!  ", "Start a new chat", "nuevo chat", "¡Nuevo chat!", "Nueva conversación", "Sparky, new chat please"]) {
      expect(chatCommand(t)).toBe("new");
    }
    for (const t of ["show my chats", "Show my chats?", "my chats", "mis chats", "Muéstrame mis chats", "hey Sparky show my chats"]) {
      expect(chatCommand(t)).toBe("list");
    }
  });

  it("leaves anything longer or different for Sparky", () => {
    for (const t of ["what is a new chat", "new chat about NVDA", "chats", "show me my chats from yesterday", "new", "", "¿qué es un nuevo chat?"]) {
      expect(chatCommand(t)).toBeNull();
    }
  });
});

describe("groupChats", () => {
  const list = [
    row("c-pinned-one", { pinned: true, group: "Research" }),
    row("c-recent-one", { title: "NVDA plan" }),
    row("c-research-2", { group: "research" }),
    row("c-alpha-one1", { group: "Alpha" }),
    row("c-older-one1", { preview: "about the budget" })
  ];

  it("puts Pinned first, then each group by name, then the rest under Chats", () => {
    const sections = groupChats(list);
    expect(sections.map((s) => s.label)).toEqual(["Pinned", "Alpha", "research", "Chats"]);
    expect(sections.map((s) => s.chats.map((c) => c.id))).toEqual([["c-pinned-one"], ["c-alpha-one1"], ["c-research-2"], ["c-recent-one", "c-older-one1"]]);
    expect(new Set(sections.map((s) => s.key)).size).toBe(sections.length);
  });

  it("keeps only what matches a search, and no empty sections", () => {
    expect(groupChats(list, "budget").map((s) => [s.label, s.chats.map((c) => c.id)])).toEqual([["Chats", ["c-older-one1"]]]);
    expect(groupChats(list, "RESEARCH").map((s) => s.label)).toEqual(["Pinned", "research"]);
    expect(groupChats(list, "nothing like this")).toEqual([]);
    expect(groupChats([])).toEqual([]);
  });

  it("offers the groups in use, once each", () => {
    expect(groupNames(list)).toEqual(["Alpha", "Research", "research"]);
  });
});

describe("savable", () => {
  it("keeps only turns with words", () => {
    expect(savable([{ role: "user", content: "hi" }, { role: "assistant", content: " " }])).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("chatWhen", () => {
  const now = new Date(2026, 8, 26, 15, 30);
  it("says the time today, Yesterday, the weekday this week, or the date", () => {
    expect(chatWhen(new Date(2026, 8, 26, 9, 5).toISOString(), now)).toBe("9:05 AM");
    expect(chatWhen(new Date(2026, 8, 25, 22, 0).toISOString(), now)).toBe("Yesterday");
    expect(chatWhen(new Date(2026, 8, 22, 12, 0).toISOString(), now)).toBe("Tue");
    expect(chatWhen(new Date(2026, 7, 3, 12, 0).toISOString(), now)).toBe("Aug 3");
    expect(chatWhen(new Date(2025, 11, 31, 12, 0).toISOString(), now)).toBe("Dec 31, 2025");
    expect(chatWhen("not a date", now)).toBe("");
  });
});

describe("newChatCaption", () => {
  it("says where the last conversation went", () => {
    expect(newChatCaption("saved")).toBe("New chat. The last one is saved in Chats.");
    expect(newChatCaption("unsaved")).toMatch(/turn on memory/);
    expect(newChatCaption("empty")).toMatch(/new chat/);
    for (const o of ["saved", "unsaved", "empty"] as const) expect(newChatCaption(o)).not.toContain("\u2014");
  });
});

describe("escapeIsMine", () => {
  const inside = { id: "inside" } as unknown as Element;
  const outside = { id: "outside" } as unknown as Element;
  const root = { contains: (node: Node | null) => (node as unknown) === inside };

  it("is the drawer's only while focus is inside it", () => {
    expect(escapeIsMine(root, inside)).toBe(true);
    expect(escapeIsMine(root, outside)).toBe(false);
    expect(escapeIsMine(root, null)).toBe(false);
    expect(escapeIsMine(null, inside)).toBe(false);
  });
});

describe("a New chat whose save failed", () => {
  it("says so plainly", () => {
    expect(LOST_SAVE_CAPTION).toBe("New chat. The last one could not be saved in Chats.");
  });
});

describe("keptLines", () => {
  it("keeps the person's and Sparky's text only, so reopening a chat gives the same thread", () => {
    const screen = [
      { id: "a", role: "user", content: "What should I buy this month?" },
      { id: "b", role: "team", content: "@Scout @Risk What should I buy this month?" },
      { id: "c", role: "assistant", content: "The team leans to NVDA.", tone: "summary" },
      { id: "d", role: "assistant", content: "  " },
    ];
    const kept = keptLines(screen);
    expect(kept).toEqual([
      { role: "user", content: "What should I buy this month?" },
      { role: "assistant", content: "The team leans to NVDA." },
    ]);
    // What a reopened chat puts back on screen, with new ids, keeps the same signature.
    const reopened = kept.map((m, i) => ({ ...m, id: `x${i}` }));
    expect(JSON.stringify(keptLines(reopened))).toBe(JSON.stringify(kept));
  });
});
