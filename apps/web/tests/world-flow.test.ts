import { afterEach, describe, expect, it, vi } from "vitest";
import { cancelWorldRequests, createWorldBridge, finishWorldEnrollment, requireEnrollmentCompletion, waitForIdkit, waitForWorld, WorldFlowError } from "../app/world/flow";
import type { WorldProvider, WorldRequest } from "@perkos/client";

const mocks = vi.hoisted(() => ({ createSession: vi.fn(), proveSession: vi.fn(), CredentialRequest: vi.fn((credential, options) => ({ credential, options })) }));
vi.mock("@worldcoin/idkit-core", () => ({ IDKit: { createSession: mocks.createSession, proveSession: mocks.proveSession }, CredentialRequest: mocks.CredentialRequest }));
const input: WorldRequest = { id: "request-1", provider: "idkit", status: "pending", purpose: "enroll", expiresAt: 2_000_000_000,
  appId: "app_demo", signal: "exact-request-signal", rpContext: { rp_id: "rp_demo", nonce: "nonce", signature: "signed", created_at: 100, expires_at: 200 } };
afterEach(() => vi.clearAllMocks());
describe("World enrollment flow", () => {
  it("constructs a v4 session with selfie, bound signal and requested presence; continuity proves the same session", async () => {
    const bridge = { connectorURI: "https://world.org/connect", pollOnce: vi.fn() };
    const constraints = vi.fn(async () => bridge);
    mocks.createSession.mockReturnValue({ constraints }); mocks.proveSession.mockReturnValue({ constraints });
    expect(await createWorldBridge(input)).toBe(bridge);
    expect(mocks.createSession).toHaveBeenCalledWith({ app_id: input.appId, rp_context: input.rpContext, environment: "sandbox", require_user_presence: true, action_description: "Connect your identity to PerkOS Runtime" });
    expect(mocks.CredentialRequest).toHaveBeenCalledWith("selfie", { signal: input.signal });
    expect(mocks.createSession.mock.calls[0]?.[0]).not.toHaveProperty("action");
    const sessionId = `session_${"a".repeat(128)}` as const;
    await createWorldBridge({ ...input, sessionId, purpose: "delegation" });
    expect(mocks.proveSession).toHaveBeenCalledWith(sessionId, expect.objectContaining({ require_user_presence: true }));
  });
  it("preserves the provider proof object, and only returns it after confirmed", async () => {
    const result = { proof: "opaque", responses: ["exact"] };
    const pollOnce = vi.fn().mockResolvedValueOnce({ type: "waiting_for_connection" }).mockResolvedValueOnce({ type: "confirmed", result });
    expect(await waitForIdkit({ pollOnce }, { signal: new AbortController().signal, interval: 1 })).toBe(result);
  });
  it("bounds a hung bridge poll and rejects late confirmation", async () => {
    let done: (result: unknown) => void = () => {};
    const work = waitForIdkit({ pollOnce: () => new Promise((resolve) => { done = resolve; }) }, { signal: new AbortController().signal, timeout: 10 });
    await expect(work).rejects.toMatchObject({ code: "timeout" });
    done({ type: "confirmed", result: { proof: "late" } });
  });
  it("cancels an active bridge without waiting for its network call", async () => {
    const abort = new AbortController();
    const work = waitForIdkit({ pollOnce: () => new Promise(() => {}) }, { signal: abort.signal });
    abort.abort();
    await expect(work).rejects.toMatchObject({ code: "cancelled" });
  });
  it("refuses malformed bridge success and provider rejection", async () => {
    for (const status of [{ type: "confirmed" }, { type: "connected" }, { type: "failed", error: "secret provider detail" }]) {
      await expect(waitForIdkit({ pollOnce: async () => status }, { signal: new AbortController().signal })).rejects.toBeInstanceOf(WorldFlowError);
    }
  });
  it("OIDC waits for backend completion and rejects a result from another request", async () => {
    const request = { ...input, provider: "oidc" as const };
    const poll = vi.fn().mockResolvedValueOnce(request).mockResolvedValueOnce({ ...request, status: "enrolled" });
    expect((await waitForWorld(request, new AbortController().signal, poll, 1)).status).toBe("enrolled");
    await expect(waitForWorld(request, new AbortController().signal, async () => ({ ...request, id: "other", status: "enrolled" }), 1)).rejects.toMatchObject({ code: "WORLD_REQUEST_MISMATCH" });
  });
  it("does not treat a consent, proof receipt or different provider as enrollment", () => {
    for (const status of ["pending", "awaiting_link_approval", "approved", "denied", "cancelled"] as const) expect(() => requireEnrollmentCompletion(input, { ...input, status })).toThrow();
    expect(() => requireEnrollmentCompletion(input, { ...input, provider: "oidc", status: "enrolled" })).toThrow();
    expect(() => requireEnrollmentCompletion(input, { ...input, status: "enrolled" })).not.toThrow();
  });
});

describe("additional World provider pairing", () => {
  const candidate: WorldRequest = { ...input, provider: "oidc" };
  const proved: WorldRequest = { ...candidate, status: "awaiting_link_approval" };
  const link: WorldRequest = { ...input, id: "link-1", purpose: "link-provider", sessionId: `session_${"a".repeat(128)}` };
  const fixture = () => ({
    status: vi.fn(async () => ({ enabled: true, environment: "sandbox" as const, providers: { idkit: true, oidc: true }, enrolled: { idkit: true, oidc: false } })),
    startLink: vi.fn(async (_provider: WorldProvider, _candidateId: string): Promise<WorldRequest> => link),
    confirm: vi.fn(async (_request: WorldRequest): Promise<WorldRequest> => ({ ...link, status: "consumed" })),
    read: vi.fn(async (_id: string): Promise<WorldRequest> => ({ ...candidate, status: "enrolled" })),
    cancel: vi.fn(async (_id: string) => ({})),
    onLink: vi.fn((_request: WorldRequest) => undefined),
  });
  it("does not require pairing for a first provider that the API enrolled", async () => {
    const steps = fixture();
    expect((await finishWorldEnrollment(candidate, { ...candidate, status: "enrolled" }, new AbortController().signal, steps)).status).toBe("enrolled");
    expect(steps.status).not.toHaveBeenCalled(); expect(steps.startLink).not.toHaveBeenCalled();
  });
  it("uses the already enrolled provider, then reads the original candidate before reporting connected", async () => {
    const steps = fixture();
    expect((await finishWorldEnrollment(candidate, proved, new AbortController().signal, steps)).status).toBe("enrolled");
    expect(steps.startLink).toHaveBeenCalledWith("idkit", candidate.id);
    expect(steps.confirm).toHaveBeenCalledWith(link);
    expect(steps.read).toHaveBeenCalledWith(candidate.id);
    expect(steps.onLink).toHaveBeenCalledWith(link);
  });
  it("cannot connect the second method without an available existing factor", async () => {
    const steps = fixture(); steps.status.mockResolvedValueOnce({ enabled: true, environment: "sandbox", providers: { idkit: true, oidc: true }, enrolled: { idkit: false, oidc: false } });
    await expect(finishWorldEnrollment(candidate, proved, new AbortController().signal, steps)).rejects.toMatchObject({ code: "link_approval_required" });
    expect(steps.startLink).not.toHaveBeenCalled(); expect(steps.read).not.toHaveBeenCalled();
  });
  it("refuses an IDKit link that would create a new session instead of proving the existing human", async () => {
    const steps = fixture(); steps.startLink.mockResolvedValueOnce({ ...link, sessionId: undefined });
    await expect(finishWorldEnrollment(candidate, proved, new AbortController().signal, steps)).rejects.toMatchObject({ code: "link_approval_required" });
    expect(steps.confirm).not.toHaveBeenCalled();
  });
  it("does not call a consumed approval connected until the candidate is enrolled", async () => {
    const steps = fixture(); steps.read.mockResolvedValueOnce(proved);
    await expect(finishWorldEnrollment(candidate, proved, new AbortController().signal, steps)).rejects.toMatchObject({ code: "awaiting_link_approval" });
  });
  it("rejects approval for another request even when its status is consumed", async () => {
    const steps = fixture(); steps.confirm.mockResolvedValueOnce({ ...link, id: "wrong-link", status: "consumed" });
    await expect(finishWorldEnrollment(candidate, proved, new AbortController().signal, steps)).rejects.toMatchObject({ code: "WORLD_REQUEST_MISMATCH" });
    expect(steps.read).not.toHaveBeenCalled();
  });
  it("cancellation ignores a late successful factor and cancels the candidate before its companion", async () => {
    const controller = new AbortController(), steps = fixture();
    const ids = [candidate.id];
    steps.onLink.mockImplementation((request: WorldRequest) => { ids.push(request.id); });
    steps.confirm.mockImplementation(async () => { controller.abort(); return { ...link, status: "consumed" }; });
    await expect(finishWorldEnrollment(candidate, proved, controller.signal, steps)).rejects.toMatchObject({ code: "cancelled" });
    expect(steps.read).not.toHaveBeenCalled();
    const cancelled: string[] = [];
    await cancelWorldRequests(ids, async (id) => { cancelled.push(id); return { ...(id === candidate.id ? candidate : link), status: "cancelled" }; });
    expect(cancelled).toEqual([candidate.id, link.id]);
  });
  it("cleans up a linking request created after cancellation", async () => {
    const controller = new AbortController(), steps = fixture();
    steps.startLink.mockImplementation(async () => { controller.abort(); return link; });
    await expect(finishWorldEnrollment(candidate, proved, controller.signal, steps)).rejects.toMatchObject({ code: "cancelled" });
    expect(steps.cancel.mock.calls).toEqual([[candidate.id], [link.id]]);
    expect(steps.confirm).not.toHaveBeenCalled();
  });
});
