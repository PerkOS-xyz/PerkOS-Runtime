import type { DeskIdentityDescriptor } from "./descriptor.js";
import type { DeskIdentity } from "./reader.js";

/** Verification is deliberately absent: the client reads the public chain. */
export interface IdentityStatus {
  state: "disabled" | "absent" | "provisioning" | "pending" | "reconciliation" | "ready" | "failed";
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
  { action: "revoke"; role: string; requestId: string };
