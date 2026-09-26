import { encodeFunctionData, namehash, zeroAddress, type Address, type PublicClient } from "viem";
import { factoryAbi, helperAbi, identityRegistryAbi, registryAbi, resolverAbi } from "./abi.js";
import { DESK_OWNER_ROLES, ENS_SEPOLIA, LINK_ROLE, REGISTRY_ROLES, TEXT_ROLE } from "./deployment.js";
import { DESK_MANIFEST_KEY, deskManifestRecord } from "./discovery.js";
import { dnsName, instanceName, normalizedName, seatName, textResource } from "./names.js";
import { claimedEnsName, readText, verifyDeskIdentity, type DeskIdentity } from "./reader.js";
import type { ProvisionStep } from "./provision.js";

export interface DeskMove {
  source: DeskIdentity;
  target: DeskIdentity;
  parentOwner: Address;
  expiry: string;
  records: Array<{ role: string | null; resolver: Address; recordId: string }>;
  agents: Array<{ id: string; oldURI: string; newURI: string; writeGranted: boolean }>;
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const fail = (code: string): never => { throw new Error(code); };
const full = (d: DeskIdentity) => instanceName(d.label, d.parentName);
const call = (id: string, to: Address, data: `0x${string}`): ProvisionStep => ({ id: `move:${id}`, to, data, value: 0n, signer: { kind: "operator" } });

/** Preserve all existing metadata; update only its unique ENS service. */
function renamedURI(uri: string, oldName: string, newName: string): string {
  if (claimedEnsName(uri) !== oldName) return fail("ENS_REGISTRATION_CHANGED");
  const bytes = Uint8Array.from(atob(uri.split(",")[1]!), (c) => c.charCodeAt(0));
  const body = JSON.parse(new TextDecoder().decode(bytes)) as { services: Array<{ name: string; endpoint: string }> };
  body.services.find((s) => s.name === "ENS")!.endpoint = newName;
  return `data:application/json;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(body))))}`;
}

async function parents(client: PublicClient, source: DeskIdentity, target: DeskIdentity, operator: Address) {
  const helper = { address: ENS_SEPOLIA.universalHelper, abi: helperAbi } as const;
  const [sourceCanonical, targetCanonical, sourceOwner, targetOwner, sourceId, destinationImpl] = await Promise.all([
    client.readContract({ ...helper, functionName: "findCanonicalRegistry", args: [dnsName(source.parentName)] }),
    client.readContract({ ...helper, functionName: "findCanonicalRegistry", args: [dnsName(target.parentName)] }),
    client.readContract({ ...helper, functionName: "findExactOwner", args: [dnsName(source.parentName)] }),
    client.readContract({ ...helper, functionName: "findExactOwner", args: [dnsName(target.parentName)] }),
    client.readContract({ address: source.parentRegistry, abi: registryAbi, functionName: "findTokenId", args: [source.label] }),
    client.readContract({ address: ENS_SEPOLIA.factory, abi: factoryAbi, functionName: "verifyContract", args: [target.parentRegistry] }),
  ]);
  if (!same(sourceCanonical, source.parentRegistry) || !same(targetCanonical, target.parentRegistry)) return fail("ENS_PARENT_NOT_READY");
  if (same(sourceOwner, zeroAddress) || !same(sourceOwner, targetOwner)) return fail("ENS_PARENT_OWNER_MISMATCH");
  if (!same(destinationImpl, ENS_SEPOLIA.userRegistryImpl)) return fail("ENS_REGISTRY_IMPLEMENTATION");
  const permissions = await Promise.all([
    client.readContract({ address: target.parentRegistry, abi: registryAbi, functionName: "hasRootRoles", args: [REGISTRY_ROLES.register, operator] }),
    client.readContract({ address: source.parentRegistry, abi: registryAbi, functionName: "hasRoles", args: [sourceId, REGISTRY_ROLES.setSubregistry, operator] }),
    client.readContract({ address: source.registry, abi: registryAbi, functionName: "hasRootRoles", args: [REGISTRY_ROLES.setParent, operator] }),
  ]);
  if (!permissions.every(Boolean)) return fail("ENS_MOVE_AUTHORITY_REQUIRED");
  return { parentOwner: sourceOwner, sourceId };
}

/** A read-only preview. Nothing is reserved or signed until the API durably accepts it. */
export async function prepareDeskMove(client: PublicClient, source: DeskIdentity, operator: Address, parentName: string, label: string): Promise<DeskMove> {
  if (!(await verifyDeskIdentity(client, source)).verified) return fail("ENS_IDENTITY_CHANGED");
  if (!source.resolver) return fail("ENS_FIXED_IDENTITY");
  parentName = normalizedName(parentName);
  const nextName = instanceName(label, parentName);
  if (nextName === full(source) || parentName === full(source) || parentName.endsWith(`.${full(source)}`)) return fail("ENS_MOVE_CYCLE");
  const parentRegistry = await client.readContract({ address: ENS_SEPOLIA.universalHelper, abi: helperAbi, functionName: "findCanonicalRegistry", args: [dnsName(parentName)] });
  if (same(parentRegistry, zeroAddress) || same(parentRegistry, source.registry)) return fail("ENS_MOVE_CYCLE");
  const target = { ...source, parentName, parentRegistry, label };
  const { parentOwner } = await parents(client, source, target, operator);
  if (!same(await client.readContract({ address: parentRegistry, abi: registryAbi, functionName: "findOwner", args: [label] }), zeroAddress)) return fail("ENS_DESTINATION_OCCUPIED");
  const container = await client.readContract({ address: ENS_SEPOLIA.universalHelper, abi: helperAbi, functionName: "findParentRegistry", args: [dnsName(parentName)] });
  const [parentExpiry, deskExpiry, block] = await Promise.all([
    client.readContract({ address: container, abi: registryAbi, functionName: "findExpiry", args: [parentName.split(".")[0]!] }),
    client.readContract({ address: source.parentRegistry, abi: registryAbi, functionName: "findExpiry", args: [source.label] }), client.getBlock(),
  ]);
  const expiry = parentExpiry < deskExpiry ? parentExpiry : deskExpiry;
  if (expiry <= block.timestamp + 3600n) return fail("ENS_PARENT_EXPIRED");
  const records: DeskMove["records"] = [];
  for (const item of [{ role: null, resolver: source.resolver }, ...source.seats.map((s) => ({ role: s.id, resolver: s.resolver }))]) {
    const oldName = item.role ? seatName(item.role, full(source)) : full(source);
    const newName = item.role ? seatName(item.role, full(target)) : full(target);
    const [recordId, occupied, canLink] = await Promise.all([
      client.readContract({ address: item.resolver, abi: resolverAbi, functionName: "getRecordId", args: [namehash(oldName)] }),
      client.readContract({ address: item.resolver, abi: resolverAbi, functionName: "getRecordId", args: [namehash(newName)] }),
      client.readContract({ address: item.resolver, abi: resolverAbi, functionName: "hasRoles", args: [0n, LINK_ROLE, operator] }),
    ]);
    if (!canLink || !recordId) return fail("ENS_FIXED_IDENTITY");
    if (occupied && occupied !== recordId) return fail("ENS_DESTINATION_RECORD_OCCUPIED");
    records.push({ ...item, recordId: String(recordId) });
  }
  const agents = await Promise.all(source.seats.map(async (seat) => {
    const oldURI = await client.readContract({ address: ENS_SEPOLIA.identityRegistry, abi: identityRegistryAbi, functionName: "tokenURI", args: [BigInt(seat.registrationId)] });
    const writeGranted = seat.writes ? await client.readContract({ address: seat.resolver, abi: resolverAbi, functionName: "hasRoles", args: [textResource(seat.writes), TEXT_ROLE, seat.wallet] }) : false;
    return { id: seat.id, oldURI, newURI: renamedURI(oldURI, seatName(seat.id, full(source)), seatName(seat.id, full(target))), writeGranted };
  }));
  return { source, target, parentOwner, expiry: String(expiry), records, agents };
}

/** Resumable from chain state; never provision, create wallets, register agents, or grant roles. */
export async function nextMoveStep(client: PublicClient, operator: Address, move: DeskMove): Promise<ProvisionStep | { done: DeskIdentity }> {
  if (await client.getChainId() !== ENS_SEPOLIA.chainId) return fail("ENS_CHAIN_MISMATCH");
  const { source, target } = move;
  const { parentOwner, sourceId } = await parents(client, source, target, operator);
  if (!same(parentOwner, move.parentOwner)) return fail("ENS_PARENT_OWNER_MISMATCH");
  if (BigInt(move.expiry) <= (await client.getBlock()).timestamp) return fail("ENS_PARENT_EXPIRED");
  const sourceOwner = await client.readContract({ address: source.parentRegistry, abi: registryAbi, functionName: "findOwner", args: [source.label] });
  if (!same(sourceOwner, source.owner)) return fail("ENS_OWNER_CHANGED");
  // Check stable assets and captured permissions even halfway through a migration.
  for (const seat of source.seats) {
    const snapshot = move.agents.find((s) => s.id === seat.id)!;
    const [owner, resolver, agentOwner, grant] = await Promise.all([
      client.readContract({ address: source.registry, abi: registryAbi, functionName: "findOwner", args: [seat.id] }),
      client.readContract({ address: source.registry, abi: registryAbi, functionName: "getResolver", args: [seat.id] }),
      client.readContract({ address: ENS_SEPOLIA.identityRegistry, abi: identityRegistryAbi, functionName: "ownerOf", args: [BigInt(seat.registrationId)] }),
      seat.writes ? client.readContract({ address: seat.resolver, abi: resolverAbi, functionName: "hasRoles", args: [textResource(seat.writes), TEXT_ROLE, seat.wallet] }) : Promise.resolve(false),
    ]);
    if (!same(owner, source.owner) || !same(resolver, seat.resolver) || !same(agentOwner, seat.wallet) || grant !== snapshot.writeGranted) return fail("ENS_MOVE_BINDINGS_CHANGED");
  }
  const [back, backLabel] = await client.readContract({ address: source.registry, abi: registryAbi, functionName: "getParent" });
  const atSource = same(back, source.parentRegistry) && backLabel === source.label;
  const atTarget = same(back, target.parentRegistry) && backLabel === target.label;
  if (!atSource && !atTarget) return fail("ENS_PARENT_CHANGED");
  const currentSource = await client.readContract({ address: source.parentRegistry, abi: registryAbi, functionName: "getSubregistry", args: [source.label] });
  if (!same(currentSource, source.registry) && !(atTarget && same(currentSource, zeroAddress))) return fail("ENS_CHILD_CHANGED");
  const destinationOwner = await client.readContract({ address: target.parentRegistry, abi: registryAbi, functionName: "findOwner", args: [target.label] });
  if (same(destinationOwner, zeroAddress)) {
    if (!atSource) return fail("ENS_CHILD_CHANGED");
    return call("mount", target.parentRegistry, encodeFunctionData({ abi: registryAbi, functionName: "register", args: [target.label, target.owner, target.registry, target.resolver!, DESK_OWNER_ROLES, BigInt(move.expiry)] }));
  }
  const [child, resolver, sourceChild] = await Promise.all([
    client.readContract({ address: target.parentRegistry, abi: registryAbi, functionName: "getSubregistry", args: [target.label] }),
    client.readContract({ address: target.parentRegistry, abi: registryAbi, functionName: "getResolver", args: [target.label] }),
    client.readContract({ address: source.parentRegistry, abi: registryAbi, functionName: "getSubregistry", args: [source.label] }),
  ]);
  if (!same(destinationOwner, source.owner) || !same(child, source.registry) || !same(resolver, target.resolver!)) return fail("ENS_DESTINATION_CHANGED");
  if (!same(sourceChild, source.registry) && !(atTarget && same(sourceChild, zeroAddress))) return fail("ENS_CHILD_CHANGED");
  if (atSource) return call("parent", source.registry, encodeFunctionData({ abi: registryAbi, functionName: "setParent", args: [target.parentRegistry, target.label] }));
  for (const record of move.records) {
    const name = record.role ? seatName(record.role, full(target)) : full(target);
    const current = await client.readContract({ address: record.resolver, abi: resolverAbi, functionName: "getRecordId", args: [namehash(name)] });
    if (current && current !== BigInt(record.recordId)) return fail("ENS_DESTINATION_RECORD_OCCUPIED");
    if (!current) return call(`link:${record.role ?? "desk"}`, record.resolver, encodeFunctionData({ abi: resolverAbi, functionName: "linkToRecord", args: [dnsName(name), BigInt(record.recordId)] }));
  }
  for (const seat of target.seats) {
    const snapshot = move.agents.find((s) => s.id === seat.id)!;
    const uri = await client.readContract({ address: ENS_SEPOLIA.identityRegistry, abi: identityRegistryAbi, functionName: "tokenURI", args: [BigInt(seat.registrationId)] });
    if (uri === snapshot.newURI) continue;
    if (uri !== snapshot.oldURI) return fail("ENS_REGISTRATION_CHANGED");
    return { ...call(`metadata:${seat.id}`, ENS_SEPOLIA.identityRegistry, encodeFunctionData({ abi: identityRegistryAbi, functionName: "setAgentURI", args: [BigInt(seat.registrationId), snapshot.newURI] })), signer: { kind: "agent", agentId: seat.agentId, wallet: seat.wallet } };
  }
  const manifest = deskManifestRecord(target);
  if (await readText(client, full(target), DESK_MANIFEST_KEY) !== manifest) return call("manifest", target.resolver!, encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsName(full(target)), DESK_MANIFEST_KEY, manifest] }));
  if (!(await verifyDeskIdentity(client, target)).verified) return fail("ENS_VERIFICATION_FAILED");
  if (!same(sourceChild, zeroAddress)) return call("detach", source.parentRegistry, encodeFunctionData({ abi: registryAbi, functionName: "setSubregistry", args: [sourceId, zeroAddress] }));
  return { done: target };
}
