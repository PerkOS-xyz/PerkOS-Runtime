import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { getPerkosIdToken, perkosRequest, PerkosApiError, PERKOS_API_URL } from "./perkosApi";
import { ensureHome, HOME_DIR } from "./home";

/** External Floor guest — Grok Bot. No ECS. Same /task bus as Hermes. */

export const GUEST_INVITE_FILE = join(HOME_DIR, "guest-invite.md");

export function guestAgentName(wallet: string): string {
  const tail = wallet.toLowerCase().replace(/^0x/, "").slice(-8);
  return `fgrok-${tail}`;
}

async function token(wallet: string): Promise<string> {
  const t = await getPerkosIdToken(wallet);
  if (!t) throw new PerkosApiError(401, "PERKOS_SESSION", "Sign in to PerkOS first");
  return t.idToken;
}

export type GuestInvite = {
  agentId: string;
  agentName: string;
  status: string;
  inviteFile: string;
  prompt?: string;
  /** False when the copy is missing the key: the bot cannot connect with it. */
  complete?: boolean;
};

/**
 * The paste the owner hands to their bot. Six lines, and every one of them is
 * load bearing: the id is what lets the bot call the platform heartbeat, and
 * that heartbeat is the only thing that turns the guest from invited into
 * ready. A copy without the id opens a socket and never lights the seat.
 */
function shortInvite(agentName: string, agentId: string, invitePrompt = "", relayKey = ""): string {
  const key = relayKey || keyFromPrompt(invitePrompt);
  return [
    "github.com/PerkOS-xyz/PerkOS-Grok-Plugin",
    `PERKOS_AGENT_NAME=${agentName}`,
    agentId ? `PERKOS_AGENT_ID=${agentId}` : "",
    key ? `PERKOS_RELAY_KEY=${key}` : "",
    "PERKOS_RELAY_URL=wss://transport.perkos.xyz/a2a",
    `PERKOS_API_URL=${PERKOS_API_URL}`
  ].filter(Boolean).join("\n");
}

function inviteComplete(prompt: string): boolean {
  return prompt.includes("PERKOS_RELAY_KEY=") && prompt.includes("PERKOS_AGENT_ID=");
}

export async function readGuestInvitePrompt(): Promise<string> {
  try {
    return (await readFile(GUEST_INVITE_FILE, "utf8")).trim();
  } catch {
    return "";
  }
}

async function savePrompt(prompt: string): Promise<string> {
  ensureHome();
  if (prompt.trim()) await writeFile(GUEST_INVITE_FILE, `${prompt.trim()}\n`, { mode: 0o600 });
  return prompt.trim();
}

/**
 * The platform returns the credential inside the onboarding prompt it builds
 * (`relayApiKey = rk_…`), not as a field of its own. Reading `relayApiKey` off
 * the response is why earlier invites came out without a key, and a key is the
 * whole point of the paste.
 */
function keyFromPrompt(prompt: string): string {
  return (
    prompt.match(/relayApiKey\s*=\s*(\S+)/)?.[1] ||
    prompt.match(/PERKOS_RELAY_(?:API_)?KEY\s*=\s*(\S+)/)?.[1] ||
    prompt.match(/\brk_[A-Za-z0-9]{16,}\b/)?.[0] ||
    ""
  ).trim();
}

async function relayKey(wallet: string, agentId: string): Promise<string> {
  try {
    const idToken = await token(wallet);
    const r = await perkosRequest<{ relayApiKey?: string; invitePrompt?: string | null; hasKey?: boolean }>(
      `/agents/${encodeURIComponent(agentId)}/relay-key`,
      { idToken, timeoutMs: 12_000 }
    );
    return String(r.relayApiKey ?? "").trim() || keyFromPrompt(String(r.invitePrompt ?? ""));
  } catch {
    return "";
  }
}

type InviteApi = { ok?: boolean; agentId: string; agentName: string; invitePrompt?: string };
type AgentRow = { id?: string; name?: string; status?: string; deployMode?: string };

export async function inviteFloorGuest(wallet: string): Promise<GuestInvite> {
  const idToken = await token(wallet);
  const name = guestAgentName(wallet);
  const note = "Invited Grok Bot on this Floor desk. Draft work: research, names, challenges, extra angles. Never spend, never sign, never 1Claw. House Risk owns VERDICT.";
  try {
    const r = await perkosRequest<InviteApi>("/agents/invite", {
      idToken,
      method: "POST",
      body: JSON.stringify({ name, runtimeKind: "custom", note }),
      timeoutMs: 25_000
    });
    // The invite response does not always carry the key, and a copy without it
    // is useless to the bot, so ask for it rather than shipping a short paste.
    const key = keyFromPrompt(r.invitePrompt ?? "") || (await relayKey(wallet, r.agentId));
    const prompt = await savePrompt(shortInvite(r.agentName || name, r.agentId, r.invitePrompt ?? "", key));
    return { agentId: r.agentId, agentName: r.agentName || name, status: "invited", inviteFile: GUEST_INVITE_FILE, prompt, complete: inviteComplete(prompt) };
  } catch (e) {
    if (e instanceof PerkosApiError && e.status === 409) {
      const listed = await perkosRequest<{ agents?: AgentRow[] }>("/agents", { idToken, timeoutMs: 15_000 });
      const hit = (listed.agents ?? []).find((a) => a.name === name);
      if (hit?.id) {
        const key = await relayKey(wallet, hit.id);
        const prompt = await savePrompt(shortInvite(name, hit.id, "", key));
        return { agentId: hit.id, agentName: name, status: String(hit.status ?? "invited"), inviteFile: GUEST_INVITE_FILE, prompt, complete: inviteComplete(prompt) };
      }
    }
    throw e;
  }
}

export async function guestStatus(wallet: string, agentId: string): Promise<{ status: string; name?: string }> {
  const idToken = await token(wallet);
  const r = await perkosRequest<{ status?: string; name?: string }>(`/agents/${encodeURIComponent(agentId)}`, { idToken, timeoutMs: 12_000 });
  return { status: String(r.status ?? "unknown"), name: typeof r.name === "string" ? r.name : undefined };
}

export async function askGuest(wallet: string, agentId: string, prompt: string, timeoutMs = 40_000, signal?: AbortSignal): Promise<{ ok: boolean; reply: string; detail?: string; ms: number }> {
  const idToken = await token(wallet);
  const t0 = Date.now();
  try {
    const r = await perkosRequest<{ ok?: boolean; reply?: string; detail?: string }>(`/agents/${encodeURIComponent(agentId)}/task`, {
      idToken,
      method: "POST",
      body: JSON.stringify({ prompt, timeoutMs }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs + 5_000)]) : AbortSignal.timeout(timeoutMs + 5_000)
    });
    const reply = String(r.reply ?? "").trim();
    return { ok: Boolean(r.ok ?? reply), reply, detail: r.detail, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, reply: "", detail: (e as Error).message, ms: Date.now() - t0 };
  }
}
