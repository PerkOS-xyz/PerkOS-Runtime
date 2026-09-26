import { encodeFunctionData, type PublicClient } from "viem";
import { resolverAbi } from "./abi.js";
import { TEXT_ROLE } from "./deployment.js";
import { dnsName, instanceName, seatName, textResource } from "./names.js";
import { verifyDeskIdentity, type DeskIdentity } from "./reader.js";
import type { EnsCall } from "./provision.js";

/** Inputs contain no user-chosen destination, key, signer, chain or raw calldata. */
export async function recordCall(client: PublicClient, identity: DeskIdentity, role: string, value: string): Promise<EnsCall> {
  const seat = identity.seats.find((s) => s.id === role);
  if (!seat?.writes) throw new Error("ENS_SEAT_READ_ONLY");
  if (new TextEncoder().encode(value).length > 1024) throw new Error("ENS_RECORD_TOO_LARGE");
  const verified = await verifyDeskIdentity(client, identity);
  if (!verified.verified) throw new Error("ENS_IDENTITY_CHANGED");
  if (!verified.seats.find((s) => s.id === role)?.writeGranted) throw new Error("ENS_WRITE_REVOKED");
  return { to: seat.resolver, value: 0n, data: encodeFunctionData({ abi: resolverAbi, functionName: "setText",
    args: [dnsName(seatName(seat.id, instanceName(identity.label, identity.parentName))), seat.writes, value] }) };
}

export async function revokeCall(client: PublicClient, identity: DeskIdentity, role: string): Promise<EnsCall> {
  const seat = identity.seats.find((s) => s.id === role);
  if (!seat?.writes) throw new Error("ENS_SEAT_READ_ONLY");
  if (!(await verifyDeskIdentity(client, identity)).verified) throw new Error("ENS_IDENTITY_CHANGED");
  return { to: seat.resolver, value: 0n, data: encodeFunctionData({ abi: resolverAbi, functionName: "revokeRoles", args: [textResource(seat.writes), TEXT_ROLE, seat.wallet] }) };
}
