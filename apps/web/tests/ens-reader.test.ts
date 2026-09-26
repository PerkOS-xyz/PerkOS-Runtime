import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, multicall3Abi, parseAbi } from "viem";
import { ensReader } from "../app/lib/ensReader";

afterEach(() => vi.unstubAllGlobals());

describe("public ENS reads", () => {
  it("uses the second provider when the first is rate limited", async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return Response.json({ jsonrpc: "2.0", id: body.id, ...(url.includes("publicnode")
        ? { error: { code: -32005, message: "Rate limit exceeded" } }
        : { result: "0xaa36a7" }) });
    });
    vi.stubGlobal("fetch", fetcher);
    expect(await ensReader.getChainId()).toBe(11155111);
    expect(fetcher.mock.calls.map(([url]) => new URL(url).hostname)).toEqual([
      "ethereum-sepolia-rpc.publicnode.com", "rpc.sepolia.ethpandaops.io",
    ]);
  });

  it("rejects an outage instead of reusing a previous positive read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await expect(ensReader.getChainId()).rejects.toThrow();
  });

  it("groups contract reads while retaining the requested historical block", async () => {
    const abi = parseAbi(["function value() view returns (uint256)"]);
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.method).toBe("eth_call");
      expect(body.params[1]).toBe("0xb3de39");
      const decoded = decodeFunctionData({ abi: multicall3Abi, data: body.params[0].data });
      expect(decoded.functionName).toBe("aggregate3");
      expect(decoded.args?.[0]).toHaveLength(2);
      const returnData = encodeFunctionResult({ abi, functionName: "value", result: 25n });
      return Response.json({ jsonrpc: "2.0", id: body.id, result: encodeFunctionResult({
        abi: multicall3Abi, functionName: "aggregate3", result: [
          { success: true, returnData }, { success: true, returnData },
        ],
      }) });
    });
    vi.stubGlobal("fetch", fetcher);
    const values = await Promise.all([
      ensReader.readContract({ address: "0x0000000000000000000000000000000000000001", abi, functionName: "value", blockNumber: 11787833n }),
      ensReader.readContract({ address: "0x0000000000000000000000000000000000000002", abi, functionName: "value", blockNumber: 11787833n }),
    ]);
    expect(values).toEqual([25n, 25n]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
