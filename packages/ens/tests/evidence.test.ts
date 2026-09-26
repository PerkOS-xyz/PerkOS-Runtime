import { describe, expect, it } from "vitest";
import { canonicalJSON, evidenceHash, parseEvidence, verifyEvidence, type EvidencePacket } from "../src/index.js";
import type { PublicClient } from "viem";

const address = `0x${"1".repeat(40)}` as const;
const packet: EvidencePacket = { version: "1", type: "perkos-task-result", templateId: "eqlty-desk", decisionId: "turn-1", taskId: "task-1", role: "scout", agentId: "agent-1", completedAt: "2026-09-26T01:00:00Z", response: "Exact delivered answer.", quotes: [],
  identity: { chainId: 11155111, owner: address, registry: address, parentRegistry: address, parentName: "example.eth", label: "desk", seats: [{ id: "scout", agentId: "agent-1", wallet: address, resolver: address, registrationId: "7", writes: "scout-source" }] } };
const envelope = () => ({ packet: structuredClone(packet), hash: evidenceHash(packet), transactionHash: null, blockNumber: null });

describe("portable evidence boundaries", () => {
  it("hashes canonical keys in the same order across serialization and rejects edited content", () => {
    expect(canonicalJSON({ z: "x", a: [2, 1] })).toBe(canonicalJSON({ a: [2, 1], z: "x" }));
    const e = envelope();
    expect(parseEvidence(JSON.parse(JSON.stringify(e))).hash).toBe(e.hash);
    e.packet.response = "Owner replacement";
    expect(() => parseEvidence(e)).toThrow("ENS_EVIDENCE_HASH_MISMATCH");
  });
  it("rejects role substitution and a Trader without a publication key", () => {
    const e = envelope(); e.packet.agentId = "other-agent"; e.hash = evidenceHash(e.packet);
    expect(() => parseEvidence(e)).toThrow("ENS_EVIDENCE_SEAT_MISMATCH");
    const trader = envelope(); trader.packet.identity.seats[0]!.writes = null; trader.hash = evidenceHash(trader.packet);
    expect(() => parseEvidence(trader)).toThrow("ENS_EVIDENCE_SEAT_MISMATCH");
  });
  it("does not label a matching hash as a published transaction", async () => {
    expect(await verifyEvidence({} as PublicClient, envelope())).toMatchObject({ integrity: true, publication: "unpublished", quoteStatus: "unavailable" });
  });
  it("rejects unbounded or ambiguous quote sources", () => {
    const e = envelope(); e.packet.quotes = [{ chainId: 4663, requestId: "complete-request", quotedAt: "2026-09-26T01:00:00Z", validUntil: "2026-09-25T01:00:00Z", tokenIn: address, tokenOut: address, amountIn: "1", amountOut: "2" }]; e.hash = evidenceHash(e.packet);
    expect(() => parseEvidence(e)).toThrow("ENS_EVIDENCE_INVALID");
  });
});
