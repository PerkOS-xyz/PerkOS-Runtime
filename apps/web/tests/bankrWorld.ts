/**
 * Bankr, Robinhood Chain and PerkOS as the launch route tests see them: one
 * stubbed fetch that answers each address the routes call, with state a test
 * can change. Nothing reaches the real ones.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, vi } from "vitest";

import { KEY, ME, POOL, QUOTES, TOKEN, TX, WALLET } from "./bankrFixtures";

export const HOST = { host: "127.0.0.1:3100" };
export const get = (path: string) => new Request(`http://127.0.0.1:3100${path}`, { headers: HOST });
export const post = (path: string, body: unknown) =>
  new Request(`http://127.0.0.1:3100${path}`, { method: "POST", headers: { ...HOST, "content-type": "application/json" }, body: JSON.stringify(body) });

export const ENOUGH = "0x2386f26fc10000"; // 0.01 ETH
const GAS_PRICE = "0x1a616b0";

export interface World {
  balance: string;
  quotes: unknown;
  simulate: (body: Record<string, unknown>) => Response;
  deploy: (body: Record<string, unknown>) => Response | Promise<Response>;
  launches: unknown[];
  records: Record<string, unknown>;
  fees: Record<string, unknown>;
}

export const simulated = () =>
  Response.json({
    success: true,
    simulated: true,
    tokenAddress: TOKEN,
    poolId: POOL,
    chain: "robinhood",
    feeDistribution: { creator: { address: WALLET, bps: 9500 }, protocol: { address: "0x" + "a".repeat(40), bps: 500 } },
  });

const fresh = (): World => ({
  balance: ENOUGH,
  quotes: QUOTES,
  simulate: simulated,
  deploy: () => Response.json({ success: true, tokenAddress: TOKEN, poolId: POOL, txHash: TX, chain: "robinhood", feeDistribution: {} }, { status: 201 }),
  launches: [],
  records: {},
  fees: {},
});

/** What the stub answers, and every call it got. */
export const bankr: { world: World; calls: Array<{ url: string; init?: RequestInit }> } = { world: fresh(), calls: [] };

export function stubWorld(): void {
  bankr.world = fresh();
  bankr.calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      bankr.calls.push({ url: input, ...(init ? { init } : {}) });
      const world = bankr.world;
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (input === "https://rpc.mainnet.chain.robinhood.com") {
        const { method } = JSON.parse(String(init?.body)) as { method: string };
        return Response.json({ jsonrpc: "2.0", id: 1, result: method === "eth_getBalance" ? world.balance : GAS_PRICE });
      }
      if (input === "https://api.bankr.bot/token-launches/quote-tokens?chain=robinhood") return Response.json(world.quotes);
      if (input === "https://api.bankr.bot/token-launches") return Response.json({ launches: world.launches });
      if (input === "https://api.bankr.bot/wallet/me") {
        return headers["x-api-key"] === KEY ? Response.json(ME) : Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (input === "https://api.bankr.bot/token-launches/deploy") {
        expect(headers["x-api-key"]).toBe(KEY);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return body.simulateOnly === true ? world.simulate(body) : world.deploy(body);
      }
      const record = input.match(/^https:\/\/api\.bankr\.bot\/token-launches\/(0x[0-9a-f]{40})$/);
      if (record) {
        const found = world.records[record[1]!];
        return found ? Response.json({ launch: found }) : Response.json({ error: "Not found" }, { status: 404 });
      }
      const fees = input.match(/^https:\/\/api\.bankr\.bot\/public\/doppler\/creator-fees\/(0x[0-9a-f]{40})\?days=30$/);
      if (fees) return Response.json(world.fees[fees[1]!] ?? { address: fees[1], tokens: [] });
      if (input === "https://api.perkos.xyz/files/launch-logo") {
        expect(headers.authorization).toBe("Bearer access-1");
        return Response.json({ url: "https://firebasestorage.googleapis.com/v0/b/b/o/avatars%2Fx%2Flaunch-logo-1.png?alt=media", bytes: 10 });
      }
      return new Response("not mocked", { status: 404 });
    }),
  );
}

/** The bodies Bankr's deploy endpoint got, simulations and launches alike. */
export const deployCalls = () =>
  bankr.calls.filter((c) => c.url === "https://api.bankr.bot/token-launches/deploy").map((c) => JSON.parse(String(c.init?.body)) as Record<string, unknown>);

export async function signIn(wallet = WALLET): Promise<void> {
  await writeFile(
    join(process.env.PERKOS_HOME!, "session.json"),
    JSON.stringify({ wallet, accessToken: "access-1", refreshToken: "refresh-1", expiresAt: Date.now() + 600_000, refreshExpiresAt: Date.now() + 86_400_000 }),
  );
}
