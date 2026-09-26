import { createPublicClient, fallback, http } from "viem";
import { sepolia } from "viem/chains";

/** Batch read-only calls at their requested block; a public RPC outage never implies verification. */
export const ensReader = createPublicClient({
  chain: sepolia,
  batch: { multicall: { batchSize: 8192 } },
  transport: fallback([
    http("https://ethereum-sepolia-rpc.publicnode.com", { timeout: 15_000, retryCount: 0 }),
    http("https://rpc.sepolia.ethpandaops.io", { timeout: 15_000, retryCount: 0 }),
  ], { retryCount: 1, retryDelay: 1000 }),
  cacheTime: 0,
});
