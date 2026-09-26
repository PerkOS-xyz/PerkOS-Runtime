import { encodeFunctionData, keccak256, stringToHex, type Hex, type PublicClient } from "viem";
import { resolverAbi } from "./abi.js";
import { parseDeskIdentity } from "./discovery.js";
import { dnsName, instanceName, seatName } from "./names.js";
import { verifyDeskIdentity, type DeskIdentity } from "./reader.js";

export interface EvidenceQuote {
  chainId: number; requestId: string; quotedAt: string; validUntil: string;
  tokenIn: string; tokenOut: string; amountIn: string; amountOut: string;
}
export interface EvidencePacket {
  version: "1";
  type: "perkos-task-result";
  templateId: string;
  decisionId: string;
  taskId: string;
  role: string;
  agentId: string;
  completedAt: string;
  response: string;
  quotes: EvidenceQuote[];
  identity: DeskIdentity;
}
export interface EvidenceEnvelope { packet: EvidencePacket; hash: Hex; transactionHash: Hex | null; blockNumber: string | null }
const id = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
const hex = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
const address = (v: unknown) => typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v);

/** Versioned, deterministic JSON. No floating market amounts or locale-dependent sorting. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(",")}]`;
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJSON((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  throw new Error("ENS_EVIDENCE_INVALID");
}
export const evidenceHash = (packet: EvidencePacket): Hex => keccak256(stringToHex(canonicalJSON(packet)));
/** A portable content address; retrieval is supplied by the viewer, never an ENS-controlled server URL. */
export const evidenceRecord = (hash: Hex) => `perkos-evidence:1:${hash}`;

export function parseEvidence(value: unknown): EvidenceEnvelope {
  if (!value || typeof value !== "object") throw new Error("ENS_EVIDENCE_INVALID");
  const e = value as EvidenceEnvelope, p = e.packet;
  if (!p || p.version !== "1" || p.type !== "perkos-task-result" || ![p.templateId, p.decisionId, p.taskId, p.role, p.agentId].every(id) ||
      !date(p.completedAt) || typeof p.response !== "string" || !p.response.trim() || new TextEncoder().encode(p.response).length > 64_000 ||
      !Array.isArray(p.quotes) || p.quotes.length > 3 || !hex(e.hash) || (e.transactionHash !== null && !hex(e.transactionHash)) ||
      (e.blockNumber !== null && !/^[0-9]{1,20}$/.test(e.blockNumber))) throw new Error("ENS_EVIDENCE_INVALID");
  const identity = parseDeskIdentity(p.identity);
  const seat = identity.seats.find((s) => s.id === p.role);
  if (!seat?.writes || seat.agentId !== p.agentId) throw new Error("ENS_EVIDENCE_SEAT_MISMATCH");
  for (const q of p.quotes) {
    if (!Number.isSafeInteger(q.chainId) || q.chainId < 1 || typeof q.requestId !== "string" || q.requestId.length > 256 ||
        !date(q.quotedAt) || !date(q.validUntil) || Date.parse(q.validUntil) < Date.parse(q.quotedAt) ||
        !address(q.tokenIn) || !address(q.tokenOut) || !/^\d{1,78}$/.test(q.amountIn) || !/^\d{1,78}$/.test(q.amountOut)) throw new Error("ENS_EVIDENCE_INVALID");
  }
  if (canonicalJSON(p).length > 100_000 || evidenceHash(p) !== e.hash) throw new Error("ENS_EVIDENCE_HASH_MISMATCH");
  return e;
}

/** Exported packets can be verified without an account or PerkOS's private database. */
export async function verifyEvidence(client: PublicClient, input: unknown) {
  const e = parseEvidence(input), { packet: p } = e;
  const quoteStatus = p.quotes.length === 0 ? "unavailable" : p.quotes.some((q) => Date.parse(q.validUntil) <= Date.now()) ? "stale" : "within-window";
  if (!e.transactionHash) return { integrity: true, publication: "unpublished" as const, quoteStatus, issues: [] as string[] };
  const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash: e.transactionHash }), client.getTransaction({ hash: e.transactionHash })]);
  const seat = p.identity.seats.find((s) => s.id === p.role)!;
  const name = seatName(p.role, instanceName(p.identity.label, p.identity.parentName));
  const expected = encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsName(name), seat.writes!, evidenceRecord(e.hash)] });
  const issues: string[] = [];
  if (await client.getChainId() !== p.identity.chainId || tx.chainId !== p.identity.chainId || receipt.status !== "success" ||
      tx.from.toLowerCase() !== seat.wallet.toLowerCase() || tx.to?.toLowerCase() !== seat.resolver.toLowerCase() || tx.input !== expected || tx.value !== 0n ||
      (e.blockNumber !== null && e.blockNumber !== String(receipt.blockNumber))) issues.push("transaction-mismatch");
  if ((await client.getBlock({ blockNumber: receipt.blockNumber })).hash !== receipt.blockHash) issues.push("receipt-reorg");
  if (issues.length) return { integrity: true, publication: "invalid" as const, quoteStatus, issues };
  try {
    const historical = await verifyDeskIdentity(client, p.identity, receipt.blockNumber);
    if (!historical.verified) issues.push("historical-identity-mismatch");
  } catch { return { integrity: true, publication: "history-unavailable" as const, quoteStatus, issues: ["archive-read-required"] }; }
  return { integrity: true, publication: issues.length ? "invalid" as const : "verified" as const, quoteStatus, issues };
}
