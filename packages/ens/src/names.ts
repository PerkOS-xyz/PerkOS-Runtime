import { getAddress, isAddress, keccak256, stringToHex, toHex, type Hex } from "viem";
import { normalize, packetToBytes } from "viem/ens";
import { ENS_SEPOLIA } from "./deployment.js";

export function normalizedName(value: string): string {
  if (!value || value.length > 1024) throw new Error("Invalid ENS name");
  return normalize(value);
}
export function dnsName(name: string): Hex {
  return toHex(packetToBytes(normalizedName(name)));
}
export function instanceName(label: string, parent: string): string {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) throw new Error("Invalid instance label");
  return normalizedName(`${label}.${parent}`);
}
export function seatName(label: string, desk: string): string {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(label)) throw new Error("Invalid seat label");
  return normalizedName(`${label}.${desk}`);
}
export function registryAddress(chainId: number, address: string): Hex {
  if (!Number.isSafeInteger(chainId) || chainId < 1 || !isAddress(address)) throw new Error("Invalid registry address");
  let chain = chainId.toString(16);
  if (chain.length % 2) chain = `0${chain}`;
  return `0x00010000${(chain.length / 2).toString(16).padStart(2, "0")}${chain}14${getAddress(address).slice(2).toLowerCase()}`;
}
export function agentRegistrationKey(agentId: string | bigint): string {
  const id = String(agentId);
  if (!/^(0|[1-9][0-9]*)$/.test(id) || BigInt(id) >= 1n << 256n) throw new Error("Invalid ERC-8004 agent ID");
  return `agent-registration[${registryAddress(ENS_SEPOLIA.chainId, ENS_SEPOLIA.identityRegistry)}][${id}]`;
}
export const textResource = (key: string): bigint => BigInt(keccak256(stringToHex(key)));
