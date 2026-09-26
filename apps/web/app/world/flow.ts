import { readWorldRequest, readWorldStatus, worldTerminal, type WorldRequest, type WorldStatus } from "@perkos/client";

export class WorldFlowError extends Error { constructor(readonly code: string) { super(code); } }
export async function worldFetch(path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(`/api/world/${path}`, { method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(50_000)]) : AbortSignal.timeout(50_000), cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new WorldFlowError(res.status === 404 ? "WORLD_UNAVAILABLE" : typeof data.error === "string" ? data.error : "WORLD_REQUEST_FAILED");
  return data;
}
export const worldStatus = async (signal?: AbortSignal): Promise<WorldStatus> => readWorldStatus(await worldFetch("status", undefined, signal));
export const worldRequest = async (path: string, body?: unknown, signal?: AbortSignal): Promise<WorldRequest> => readWorldRequest(await worldFetch(path, body, signal));

/** The deadline also bounds a provider call that never settles. Late completion has no effects. */
export async function bounded<T>(work: Promise<T>, signal: AbortSignal, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const stop = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new WorldFlowError("cancelled"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => reject(new WorldFlowError("timeout")), Math.max(0, timeout));
  });
  try { return await Promise.race([work, stop]); }
  finally { clearTimeout(timer); if (abort) signal.removeEventListener("abort", abort); }
}

export interface ProofBridge { connectorURI: string; pollOnce(): Promise<unknown> }
export async function waitForIdkit(bridge: Pick<ProofBridge, "pollOnce">, { signal, timeout = 120_000, interval = 1000, onStatus = () => {} }: {
  signal: AbortSignal; timeout?: number; interval?: number; onStatus?: (status: string) => void;
}): Promise<unknown> {
  const deadline = Date.now() + timeout;
  while (true) {
    if (signal.aborted) throw new WorldFlowError("cancelled");
    const left = deadline - Date.now();
    if (left <= 0) throw new WorldFlowError("timeout");
    const status = await bounded(Promise.resolve().then(() => bridge.pollOnce()), signal, left) as { type?: string; result?: unknown; error?: unknown } | null;
    if (!status || !["waiting_for_connection", "awaiting_confirmation", "confirmed", "failed"].includes(status.type ?? "")) throw new WorldFlowError("invalid_bridge_status");
    onStatus(status.type!);
    if (status.type === "confirmed") { if (!status.result || typeof status.result !== "object") throw new WorldFlowError("missing_bridge_result"); return status.result; }
    if (status.type === "failed") throw new WorldFlowError("provider_rejected");
    await bounded(new Promise<void>((resolve) => setTimeout(resolve, interval)), signal, deadline - Date.now());
  }
}

/** Keep the server's signed context and signal; sessions intentionally have no action. */
export async function createWorldBridge(request: WorldRequest): Promise<ProofBridge> {
  if (!request.appId || !request.rpContext || !request.signal || request.provider !== "idkit") throw new WorldFlowError("WORLD_SHAPE");
  const { IDKit, CredentialRequest } = await import("@worldcoin/idkit-core");
  const config = { app_id: request.appId, rp_context: request.rpContext, environment: "sandbox" as const, require_user_presence: true,
    action_description: request.purpose === "enroll" ? "Connect your identity to PerkOS Runtime" : "Approve this PerkOS permission change" };
  const builder = request.sessionId ? IDKit.proveSession(request.sessionId, config) : IDKit.createSession(config);
  return builder.constraints(CredentialRequest("selfie", { signal: request.signal }));
}

export async function waitForWorld(request: WorldRequest, signal: AbortSignal, poll: (id: string, signal: AbortSignal) => Promise<WorldRequest>, interval = 2000): Promise<WorldRequest> {
  const deadline = Math.min(request.expiresAt * 1000, Date.now() + 5 * 60_000);
  while (true) {
    if (signal.aborted) throw new WorldFlowError("cancelled");
    const left = deadline - Date.now();
    if (left <= 0) throw new WorldFlowError("timeout");
    const current = await bounded(poll(request.id, signal), signal, left);
    if (current.id !== request.id || current.provider !== request.provider || current.purpose !== request.purpose) throw new WorldFlowError("WORLD_REQUEST_MISMATCH");
    if (worldTerminal(current.status)) return current;
    await bounded(new Promise<void>((resolve) => setTimeout(resolve, interval)), signal, deadline - Date.now());
  }
}

export function requireEnrollmentCompletion(request: WorldRequest, completed: WorldRequest): void {
  if (completed.id !== request.id || completed.provider !== request.provider || completed.purpose !== "enroll" || request.purpose !== "enroll") throw new WorldFlowError("WORLD_REQUEST_MISMATCH");
  if (completed.status !== "enrolled") throw new WorldFlowError(completed.status);
}

export function worldMessage(error: unknown): string {
  const code = error instanceof WorldFlowError ? error.code : "WORLD_REQUEST_FAILED";
  if (code === "cancelled") return "Verification was cancelled. No new permission was approved.";
  if (code === "timeout" || code === "expired") return "This verification timed out. Start again for a new code.";
  if (code === "denied" || code === "provider_rejected") return "World verification was declined. You can start again.";
  if (code === "stale") return "The account or permission changed. Start a new verification.";
  if (/ENROLLED|enrolled/i.test(code)) return "This provider is already connected. Refresh the status.";
  return "World could not complete this verification. Retry, or refresh the status before starting again.";
}
