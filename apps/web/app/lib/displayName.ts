import { createPublicClient, http } from "viem";
import { base, mainnet } from "viem/chains";

const l2 = createPublicClient({ chain: base, transport: http() });
const l1 = createPublicClient({ chain: mainnet, transport: http() });

export async function displayName(addr: string): Promise<string> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) return "";
  const a = addr as `0x${string}`;
  for (const c of [l2, l1]) {
    try {
      const ens = await c.getEnsName({ address: a });
      if (ens) return ens;
    } catch {
      /* next */
    }
  }
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
