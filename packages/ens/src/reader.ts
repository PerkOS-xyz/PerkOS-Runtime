import { decodeFunctionResult, encodeFunctionData, isAddress, namehash, type Address, type PublicClient } from "viem";
import { factoryAbi, helperAbi, identityRegistryAbi, registryAbi, resolverAbi, textProfileAbi, universalAbi } from "./abi.js";
import { ENS_SEPOLIA, TEXT_ROLE } from "./deployment.js";
import { agentRegistrationKey, dnsName, instanceName, normalizedName, seatName, textResource } from "./names.js";

export interface SeatIdentity {
  id: string;
  agentId: string;
  wallet: Address;
  resolver: Address;
  registrationId: string;
  writes: string | null;
}
export interface DeskIdentity {
  chainId: number;
  parentName: string;
  parentRegistry: Address;
  label: string;
  registry: Address;
  owner: Address;
  seats: SeatIdentity[];
  resolver?: Address;
}
export interface SeatVerification {
  id: string;
  name: string;
  verified: boolean;
  writeGranted: boolean;
  issues: string[];
  /** Values actually read at DeskVerification.blockNumber, never inferred from a manifest. */
  ensip25?: { key: string; value: string; claimedName: string | null };
}
export interface DeskVerification {
  name: string;
  blockNumber: string;
  verified: boolean;
  issues: string[];
  seats: SeatVerification[];
}
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Bounded data URIs only. Do not fetch an arbitrary agent URI on a server. */
export function claimedEnsName(uri: string): string | null {
  if (uri.length > 16_384 || !uri.startsWith("data:application/json;base64,")) return null;
  try {
    const raw = atob(uri.slice("data:application/json;base64,".length));
    const body: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, (c) => c.charCodeAt(0))));
    if (!body || typeof body !== "object" || !("services" in body) || !Array.isArray(body.services)) return null;
    const entries = body.services.filter((s: unknown): s is { name: string; endpoint: string } =>
      Boolean(s && typeof s === "object" && "name" in s && s.name === "ENS" && "endpoint" in s && typeof s.endpoint === "string"));
    // A conflicting declaration cannot silently choose whichever service is first.
    if (entries.length !== 1) return null;
    return normalizedName(entries[0]!.endpoint);
  } catch { return null; }
}

export function agentMetadataUri(name: string, title: string): string {
  const metadata = { type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1", name: title.slice(0, 120),
    description: "A publicly verifiable PerkOS desk seat", services: [{ name: "ENS", endpoint: normalizedName(name) }], active: true };
  const bytes = new TextEncoder().encode(JSON.stringify(metadata));
  return `data:application/json;base64,${btoa(String.fromCharCode(...bytes))}`;
}

/** ENSIP-5 is encoded inside resolve(); PermissionedResolver has no standalone text() getter. */
export async function readText(client: PublicClient, name: string, key: string, blockNumber?: bigint): Promise<string> {
  const normalized = normalizedName(name);
  const data = encodeFunctionData({ abi: textProfileAbi, functionName: "text", args: [namehash(normalized), key] });
  const [result] = await client.readContract({ address: ENS_SEPOLIA.universalResolver, abi: universalAbi,
    functionName: "resolve", args: [dnsName(normalized), data], ...(blockNumber === undefined ? {} : { blockNumber }) });
  return decodeFunctionResult({ abi: textProfileAbi, functionName: "text", data: result });
}

/**
 * Verify at a single observed block. Transport errors throw, never reuse a previous
 * positive result. The only trusted navigation endpoints are the pinned ENS contracts.
 */
export async function verifyDeskIdentity(client: PublicClient, input: DeskIdentity, atBlock?: bigint): Promise<DeskVerification> {
  if (input.chainId !== ENS_SEPOLIA.chainId || await client.getChainId() !== ENS_SEPOLIA.chainId) throw new Error("ENS_CHAIN_MISMATCH");
  if (![input.parentRegistry, input.registry, input.owner].every((address) => isAddress(address)) || input.seats.length > 16 || input.seats.length < 1) throw new Error("ENS_IDENTITY_INVALID");
  if (new Set(input.seats.map((s) => s.id)).size !== input.seats.length || new Set(input.seats.map((s) => s.resolver.toLowerCase())).size !== input.seats.length) throw new Error("ENS_SEATS_NOT_ISOLATED");
  const name = instanceName(input.label, input.parentName);
  const blockNumber = atBlock ?? await client.getBlockNumber({ cacheTime: 0 });
  const at = { blockNumber };
  const helper = { address: ENS_SEPOLIA.universalHelper, abi: helperAbi, ...at } as const;
  const [root, parentCanonical, deskCanonical, parent, forward, owner] = await Promise.all([
    client.readContract({ ...helper, functionName: "ROOT_REGISTRY" }),
    client.readContract({ ...helper, functionName: "findCanonicalRegistry", args: [dnsName(input.parentName)] }),
    client.readContract({ ...helper, functionName: "findCanonicalRegistry", args: [dnsName(name)] }),
    client.readContract({ address: input.registry, abi: registryAbi, functionName: "getParent", ...at }),
    client.readContract({ address: input.parentRegistry, abi: registryAbi, functionName: "getSubregistry", args: [input.label], ...at }),
    client.readContract({ ...helper, functionName: "findExactOwner", args: [dnsName(name)] }),
  ]);
  const issues: string[] = [];
  const registryImplementation = await client.readContract({ address: ENS_SEPOLIA.factory, abi: factoryAbi, functionName: "verifyContract", args: [input.registry], ...at });
  if (!same(registryImplementation, ENS_SEPOLIA.userRegistryImpl)) issues.push("registry-implementation");
  if (!same(root, ENS_SEPOLIA.rootRegistry)) issues.push("deployment");
  if (!same(parentCanonical, input.parentRegistry)) issues.push("parent-not-canonical");
  if (!same(deskCanonical, input.registry)) issues.push("desk-not-canonical");
  if (!same(parent[0], input.parentRegistry) || parent[1] !== input.label || !same(forward, input.registry)) issues.push("pointer-mismatch");
  if (!same(owner, input.owner)) issues.push("owner-changed");
  // Do not trust child records while an ancestor is invalid.
  if (issues.length) return { name, blockNumber: String(blockNumber), verified: false, issues, seats: [] };
  const seats = await Promise.all(input.seats.map(async (seat): Promise<SeatVerification> => {
    const seatFqn = seatName(seat.id, name);
    const failures: string[] = [];
    if (!isAddress(seat.wallet) || !isAddress(seat.resolver)) throw new Error("ENS_SEAT_INVALID");
    const registrationKey = agentRegistrationKey(seat.registrationId);
    const registrationId = BigInt(seat.registrationId);
    const implementation = await client.readContract({ address: ENS_SEPOLIA.factory, abi: factoryAbi, functionName: "verifyContract", args: [seat.resolver], ...at });
    if (!same(implementation, ENS_SEPOLIA.permissionedResolverImpl)) failures.push("resolver-implementation");
    const [seatParent, seatOwner, resolver, registrationOwner, metadata, backlink, writeGranted] = await Promise.all([
      client.readContract({ ...helper, functionName: "findParentRegistry", args: [dnsName(seatFqn)] }),
      client.readContract({ ...helper, functionName: "findExactOwner", args: [dnsName(seatFqn)] }),
      client.readContract({ address: input.registry, abi: registryAbi, functionName: "getResolver", args: [seat.id], ...at }),
      client.readContract({ address: ENS_SEPOLIA.identityRegistry, abi: identityRegistryAbi, functionName: "ownerOf", args: [registrationId], ...at }),
      client.readContract({ address: ENS_SEPOLIA.identityRegistry, abi: identityRegistryAbi, functionName: "tokenURI", args: [registrationId], ...at }),
      readText(client, seatFqn, registrationKey, blockNumber),
      seat.writes === null ? Promise.resolve(false) : client.readContract({ address: seat.resolver, abi: resolverAbi,
        functionName: "hasRoles", args: [textResource(seat.writes), TEXT_ROLE, seat.wallet], ...at }),
    ]);
    if (!same(seatParent, input.registry)) failures.push("parent-mismatch");
    if (!same(seatOwner, input.owner)) failures.push("owner-changed");
    if (!same(resolver, seat.resolver)) failures.push("resolver-changed");
    if (!same(registrationOwner, seat.wallet)) failures.push("agent-wallet-changed");
    const claimedName = claimedEnsName(metadata);
    if (claimedName !== seatFqn) failures.push("registration-name-mismatch");
    // ENSIP-25 recommends writing "1", but verification accepts every non-empty value.
    if (backlink.length === 0) failures.push("attestation-missing");
    // Identity validity and permission revocation are distinct states.
    return { id: seat.id, name: seatFqn, verified: failures.length === 0, writeGranted, issues: failures,
      ensip25: { key: registrationKey, value: backlink, claimedName } };
  }));
  return { name, blockNumber: String(blockNumber), verified: seats.every((s) => s.verified), issues, seats };
}
