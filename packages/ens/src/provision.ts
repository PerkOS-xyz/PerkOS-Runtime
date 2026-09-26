import { decodeEventLog, encodeFunctionData, keccak256, stringToHex, zeroAddress, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { factoryAbi, helperAbi, identityRegistryAbi, registryAbi, resolverAbi } from "./abi.js";
import { DESK_OWNER_ROLES, ENS_SEPOLIA, PARENT_ROLES, PROVISIONER_ROLES, SEAT_OWNER_ROLES, TEXT_ADMIN, TEXT_ROLE } from "./deployment.js";
import { agentRegistrationKey, dnsName, instanceName, seatName, textResource } from "./names.js";
import { agentMetadataUri, readText, verifyDeskIdentity, type DeskIdentity } from "./reader.js";

export interface ProvisionSeat { id: string; label: string; agentId: string; wallet: Address; context: string; writes: string | null }
export interface ProvisionSpec {
  parentName: string; parentRegistry: Address; label: string; owner: Address; seats: ProvisionSeat[];
}
export interface ProvisionProgress {
  registry?: Address;
  seats: Record<string, { resolver?: Address; registrationId?: string; funded?: boolean }>;
}
export interface EnsCall { to: Address; data: Hex; value: bigint }
export interface ProvisionStep extends EnsCall {
  id: string;
  signer: { kind: "operator" } | { kind: "agent"; agentId: string; wallet: Address };
  result?: { kind: "registry"; address: Address } | { kind: "resolver"; seat: string; address: Address } |
    { kind: "registration"; seat: string; wallet: Address; uri: string } | { kind: "funding"; seat: string };
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const fail = (code: string): never => { throw new Error(code); };
const operatorSigner = { kind: "operator" } as const;
const SALT = (name: string, kind: string) => BigInt(keccak256(stringToHex(`perkos-ens-v1:${name}:${kind}`)));

/**
 * One idempotent, unsigned step. The caller durably claims it BEFORE signing,
 * persists its hash, and applies the actual receipt. No wallet or key lives here.
 */
export async function nextProvisionStep(client: PublicClient, operator: Address, spec: ProvisionSpec, progress: ProvisionProgress): Promise<ProvisionStep | { done: DeskIdentity }> {
  if (await client.getChainId() !== ENS_SEPOLIA.chainId) return fail("ENS_CHAIN_MISMATCH");
  const name = instanceName(spec.label, spec.parentName);
  if (!spec.seats.length || spec.seats.length > 16 || new Set(spec.seats.map((s) => s.id)).size !== spec.seats.length) return fail("ENS_SEATS_INVALID");
  const parent = await client.readContract({ address: ENS_SEPOLIA.universalHelper, abi: helperAbi, functionName: "findCanonicalRegistry", args: [dnsName(spec.parentName)] });
  if (!same(parent, spec.parentRegistry)) return fail("ENS_PARENT_NOT_READY");
  const call = (id: string, to: Address, data: Hex): ProvisionStep => ({ id, to, data, value: 0n, signer: operatorSigner });
  const proxy = async (kind: "registry" | "resolver", seat?: string): Promise<ProvisionStep> => {
    const implementation = kind === "registry" ? ENS_SEPOLIA.userRegistryImpl : ENS_SEPOLIA.permissionedResolverImpl;
    const grants = [{ account: operator, roleBitmap: kind === "registry" ? PROVISIONER_ROLES : TEXT_ROLE | TEXT_ADMIN }];
    const data = kind === "registry" ? encodeFunctionData({ abi: registryAbi, functionName: "initialize", args: [grants] }) :
      encodeFunctionData({ abi: resolverAbi, functionName: "initialize", args: [grants, []] });
    const salt = SALT(name, seat ? `resolver:${seat}` : "registry");
    const simulated = await client.simulateContract({ account: operator, address: ENS_SEPOLIA.factory, abi: factoryAbi, functionName: "deployProxy", args: [implementation, salt, data] });
    return { ...call(seat ? `resolver:${seat}` : "registry", ENS_SEPOLIA.factory, encodeFunctionData({ abi: factoryAbi, functionName: "deployProxy", args: [implementation, salt, data] })),
      result: kind === "registry" ? { kind, address: simulated.result } : { kind, seat: seat!, address: simulated.result } };
  };
  if (!progress.registry) return proxy("registry");
  const registry = progress.registry;
  const implementation = await client.readContract({ address: ENS_SEPOLIA.factory, abi: factoryAbi, functionName: "verifyContract", args: [registry] });
  if (!same(implementation, ENS_SEPOLIA.userRegistryImpl)) return fail("ENS_REGISTRY_IMPLEMENTATION");
  const owner = await client.readContract({ address: spec.parentRegistry, abi: registryAbi, functionName: "findOwner", args: [spec.label] });
  if (same(owner, zeroAddress)) {
    const parentContainer = await client.readContract({ address: ENS_SEPOLIA.universalHelper, abi: helperAbi, functionName: "findParentRegistry", args: [dnsName(spec.parentName)] });
    const expiry = await client.readContract({ address: parentContainer, abi: registryAbi, functionName: "findExpiry", args: [spec.parentName.split(".")[0]!] });
    if (expiry <= (await client.getBlock()).timestamp) return fail("ENS_PARENT_EXPIRED");
    return call("desk-entry", spec.parentRegistry, encodeFunctionData({ abi: registryAbi, functionName: "register", args: [spec.label, spec.owner, registry, zeroAddress, DESK_OWNER_ROLES, expiry] }));
  }
  if (!same(owner, spec.owner)) return fail("ENS_OWNER_CHANGED");
  const child = await client.readContract({ address: spec.parentRegistry, abi: registryAbi, functionName: "getSubregistry", args: [spec.label] });
  if (!same(child, registry)) return fail("ENS_CHILD_CHANGED");
  const [back, label] = await client.readContract({ address: registry, abi: registryAbi, functionName: "getParent" });
  if (same(back, zeroAddress)) return call("desk-parent", registry, encodeFunctionData({ abi: registryAbi, functionName: "setParent", args: [spec.parentRegistry, spec.label] }));
  if (!same(back, spec.parentRegistry) || label !== spec.label) return fail("ENS_PARENT_CHANGED");
  const canonical = await client.readContract({ address: ENS_SEPOLIA.universalHelper, abi: helperAbi, functionName: "findCanonicalRegistry", args: [dnsName(name)] });
  if (!same(canonical, registry)) return fail("ENS_NOT_CANONICAL");
  const expiry = await client.readContract({ address: spec.parentRegistry, abi: registryAbi, functionName: "findExpiry", args: [spec.label] });
  for (const seat of spec.seats) {
    const fqn = seatName(seat.id, name);
    const saved = progress.seats[seat.id] ?? {};
    if (!saved.resolver) return proxy("resolver", seat.id);
    const resolver = saved.resolver;
    const resolverImplementation = await client.readContract({ address: ENS_SEPOLIA.factory, abi: factoryAbi, functionName: "verifyContract", args: [resolver] });
    if (!same(resolverImplementation, ENS_SEPOLIA.permissionedResolverImpl)) return fail("ENS_RESOLVER_IMPLEMENTATION");
    const seatOwner = await client.readContract({ address: registry, abi: registryAbi, functionName: "findOwner", args: [seat.id] });
    if (same(seatOwner, zeroAddress)) return call(`seat:${seat.id}`, registry, encodeFunctionData({ abi: registryAbi, functionName: "register", args: [seat.id, spec.owner, zeroAddress, resolver, SEAT_OWNER_ROLES, expiry] }));
    if (!same(seatOwner, spec.owner)) return fail("ENS_SEAT_OWNER_CHANGED");
    const actualResolver = await client.readContract({ address: registry, abi: registryAbi, functionName: "getResolver", args: [seat.id] });
    if (!same(actualResolver, resolver)) return fail("ENS_RESOLVER_CHANGED");
    if (!saved.registrationId) {
      // Once per identity, bounded testnet sponsorship. A spent top-up is not repeated.
      if (await client.getBalance({ address: seat.wallet }) < 100_000_000_000_000n) {
        if (saved.funded) return fail("ENS_AGENT_GAS_REQUIRED");
        return { id: `fund:${seat.id}`, to: seat.wallet, data: "0x", value: 1_000_000_000_000_000n, signer: operatorSigner, result: { kind: "funding", seat: seat.id } };
      }
      const uri = agentMetadataUri(fqn, seat.label);
      return { ...call(`registration:${seat.id}`, ENS_SEPOLIA.identityRegistry, encodeFunctionData({ abi: identityRegistryAbi, functionName: "register", args: [uri] })),
        signer: { kind: "agent", agentId: seat.agentId, wallet: seat.wallet }, result: { kind: "registration", seat: seat.id, wallet: seat.wallet, uri } };
    }
    for (const [key, value] of [["agent-context", seat.context], [agentRegistrationKey(saved.registrationId), "1"]] as const) {
      if (await readText(client, fqn, key) !== value) return call(`text:${seat.id}:${key}`, resolver, encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsName(fqn), key, value] }));
    }
    if (seat.writes && !await client.readContract({ address: resolver, abi: resolverAbi, functionName: "hasRoles", args: [textResource(seat.writes), TEXT_ROLE, seat.wallet] })) {
      const setter = encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: ["0x00", seat.writes, ""] });
      return call(`grant:${seat.id}`, resolver, encodeFunctionData({ abi: resolverAbi, functionName: "grantSetterRoles", args: [setter, seat.wallet] }));
    }
  }
  if (await client.readContract({ address: registry, abi: registryAbi, functionName: "hasRootRoles", args: [PARENT_ROLES, operator] })) {
    return call("lock-parent", registry, encodeFunctionData({ abi: registryAbi, functionName: "revokeRootRoles", args: [PARENT_ROLES, operator] }));
  }
  const identity: DeskIdentity = { chainId: ENS_SEPOLIA.chainId, parentName: spec.parentName, parentRegistry: spec.parentRegistry,
    label: spec.label, registry, owner: spec.owner, seats: spec.seats.map((seat) => ({ id: seat.id, agentId: seat.agentId, wallet: seat.wallet,
      resolver: progress.seats[seat.id]!.resolver!, registrationId: progress.seats[seat.id]!.registrationId!, writes: seat.writes })) };
  if (!(await verifyDeskIdentity(client, identity)).verified) return fail("ENS_VERIFICATION_FAILED");
  return { done: identity };
}

/** Only the mined receipt determines the ERC-8004 ID; simulation can race another registration. */
export function applyProvisionReceipt(progress: ProvisionProgress, step: ProvisionStep, receipt: TransactionReceipt): ProvisionProgress {
  if (receipt.status !== "success" || !same(receipt.to ?? "", step.to)) return fail("ENS_RECEIPT_INVALID");
  const next = structuredClone(progress);
  const result = step.result;
  if (!result) return next;
  if (result.kind === "registry") { next.registry = result.address; return next; }
  const seat = next.seats[result.seat] ??= {};
  if (result.kind === "resolver") seat.resolver = result.address;
  else if (result.kind === "funding") seat.funded = true;
  else {
    const ids = receipt.logs.flatMap((log) => {
      if (!same(log.address, ENS_SEPOLIA.identityRegistry)) return [];
      try {
        const decoded = decodeEventLog({ abi: identityRegistryAbi, eventName: "Registered", data: log.data, topics: log.topics });
        return same(decoded.args.owner, result.wallet) && decoded.args.agentURI === result.uri ? [decoded.args.agentId] : [];
      } catch { return []; }
    });
    if (ids.length !== 1) return fail("ENS_REGISTRATION_RECEIPT_INVALID");
    seat.registrationId = String(ids[0]);
  }
  return next;
}
