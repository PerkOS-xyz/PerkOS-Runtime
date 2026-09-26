import type { DeskIdentityDescriptor } from "./descriptor.js";
import type { DeskIdentity } from "./reader.js";

export interface EnsActivity {
  id: string;
  step: string;
  from: string;
  hash: string | null;
  block: string | null;
  at: number;
  state: "signing" | "pending" | "confirmed" | "reverted" | "cancelled" | "reconciliation";
}
/** Verification is deliberately absent: the client reads the public chain. */
export interface IdentityStatus {
  activity?: EnsActivity[];
  state: "disabled" | "absent" | "provisioning" | "pending" | "reconciliation" | "ready" | "failed" | "moving";
  migration?: { from: string; to: string; requestId: string } | null;
  moveParents?: string[];
  descriptor: DeskIdentityDescriptor | null;
  identity: DeskIdentity | null;
  parentName: string | null;
  operator: string | null;
  step: string | null;
  transactionHash: string | null;
  message: string | null;
  lastOperation: { requestId: string; success: boolean } | null;
}
export type IdentityAction = { action: "advance" } |
  { action: "record"; role: string; value: string; requestId: string } |
  { action: "revoke"; role: string; requestId: string } |
  { action: "move"; parentName: string; label: string; requestId: string; previewHash: string } |
  { action: "publish"; taskId: string; decisionId: string; response: string; expectedHash: string; requestId: string };
