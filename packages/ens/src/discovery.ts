import { isAddress, type PublicClient } from "viem";
import { ENS_SEPOLIA } from "./deployment.js";
import { instanceName, normalizedName, seatName, agentRegistrationKey } from "./names.js";
import { readText, verifyDeskIdentity, type DeskIdentity } from "./reader.js";

export const DESK_MANIFEST_KEY = "perkos-desk";
/** Self-contained on-chain manifest. No arbitrary URLs are fetched or executed. */
export function deskManifestRecord(identity: DeskIdentity): string {
  return JSON.stringify({ version: "1", type: "perkos-desk", identity });
}

export function parseDeskIdentity(value: unknown): DeskIdentity {
  if (!value || typeof value !== "object") throw new Error("ENS_MANIFEST_INVALID");
  const d = value as DeskIdentity;
  if (d.chainId !== ENS_SEPOLIA.chainId || ![d.owner, d.registry, d.parentRegistry].every((a) => typeof a === "string" && isAddress(a)) ||
      (d.resolver !== undefined && !isAddress(d.resolver)) || !Array.isArray(d.seats) || d.seats.length < 1 || d.seats.length > 16) throw new Error("ENS_MANIFEST_INVALID");
  const name = instanceName(d.label, d.parentName);
  if (new Set(d.seats.map((s) => s.id)).size !== d.seats.length || new Set(d.seats.map((s) => s.agentId)).size !== d.seats.length) throw new Error("ENS_MANIFEST_INVALID");
  const seats = d.seats.map((s) => {
    seatName(s.id, name); agentRegistrationKey(s.registrationId);
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(s.agentId) || !isAddress(s.wallet) || !isAddress(s.resolver) ||
        (s.writes !== null && (typeof s.writes !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(s.writes)))) throw new Error("ENS_MANIFEST_INVALID");
    return { id: s.id, agentId: s.agentId, wallet: s.wallet, resolver: s.resolver, registrationId: s.registrationId, writes: s.writes };
  });
  return { chainId: d.chainId, owner: d.owner, registry: d.registry, parentRegistry: d.parentRegistry, parentName: normalizedName(d.parentName), label: d.label, seats,
    ...(d.resolver ? { resolver: d.resolver } : {}) };
}

export async function discoverDesk(client: PublicClient, name: string) {
  const normalized = normalizedName(name);
  const block = await client.getBlockNumber({ cacheTime: 0 });
  const record = await readText(client, normalized, DESK_MANIFEST_KEY, block);
  if (!record || new TextEncoder().encode(record).length > 24_000) throw new Error("ENS_MANIFEST_INVALID");
  const manifest = JSON.parse(record) as { version?: unknown; type?: unknown; identity?: unknown };
  if (manifest.version !== "1" || manifest.type !== "perkos-desk") throw new Error("ENS_MANIFEST_INVALID");
  const identity = parseDeskIdentity(manifest.identity);
  if (instanceName(identity.label, identity.parentName) !== normalized) throw new Error("ENS_MANIFEST_NAME_MISMATCH");
  const verification = await verifyDeskIdentity(client, identity, block);
  return { identity, verification };
}
