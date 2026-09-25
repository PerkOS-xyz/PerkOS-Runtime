/**
 * Human-readable name for a wallet: ENS on Ethereum mainnet, then Basename
 * (reverse record on the Base L2 Resolver under 80002105.reverse).
 *
 * Resolved on the server with viem. RPCs default to the chains' public
 * endpoints; ETH_RPC_URL and BASE_RPC_URL override them.
 */

import { createPublicClient, encodePacked, http, keccak256, namehash, type Address } from "viem";
import { base, mainnet } from "viem/chains";

const BASE_L2_RESOLVER: Address = "0xC6d566A56A1aFf6508b41f6c90ff131615583BCD";
const BASE_REVERSE_NODE = namehash("80002105.reverse");
const L2_NAME_ABI = [
  {
    inputs: [{ name: "node", type: "bytes32" }],
    name: "name",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
const CACHE_MS = 60 * 60_000;
const RPC_TIMEOUT_MS = 8_000;

export interface WalletName {
  name: string | null;
  source: "ens" | "basename" | null;
}

export interface NameLookups {
  ens: (address: Address) => Promise<string | null>;
  basename: (address: Address) => Promise<string | null>;
}

function baseReverseNode(address: string) {
  const label = keccak256(encodePacked(["string"], [address.toLowerCase().slice(2)]));
  return keccak256(encodePacked(["bytes32", "bytes32"], [BASE_REVERSE_NODE, label]));
}

export function viemLookups(): NameLookups {
  const mainnetClient = createPublicClient({
    chain: mainnet,
    transport: http(process.env.ETH_RPC_URL || undefined, { timeout: RPC_TIMEOUT_MS }),
  });
  const baseClient = createPublicClient({
    chain: base,
    transport: http(process.env.BASE_RPC_URL || undefined, { timeout: RPC_TIMEOUT_MS }),
  });
  return {
    ens: (address) => mainnetClient.getEnsName({ address }).catch(() => null),
    basename: async (address) => {
      const raw = await baseClient
        .readContract({ address: BASE_L2_RESOLVER, abi: L2_NAME_ABI, functionName: "name", args: [baseReverseNode(address)] })
        .catch(() => "");
      return raw && raw.endsWith(".base.eth") ? raw : null;
    },
  };
}

export class NameResolver {
  private readonly cache = new Map<string, { at: number; value: WalletName }>();

  constructor(
    private readonly lookups: () => NameLookups = viemLookups,
    private readonly now: () => number = Date.now,
  ) {}

  async resolve(address: string): Promise<WalletName> {
    const key = address.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < CACHE_MS) return hit.value;
    const lookups = this.lookups();
    const ens = await lookups.ens(key as Address).catch(() => null);
    const value: WalletName = ens
      ? { name: ens, source: "ens" }
      : await lookups
          .basename(key as Address)
          .then((b): WalletName => (b ? { name: b, source: "basename" } : { name: null, source: null }))
          .catch((): WalletName => ({ name: null, source: null }));
    this.cache.set(key, { at: this.now(), value });
    return value;
  }
}

export const names = new NameResolver();
