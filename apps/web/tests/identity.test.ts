/**
 * Wallet names: ENS first, then Basename, cached per address.
 */

import { describe, expect, it, vi } from "vitest";

import { NameResolver, type NameLookups } from "../app/lib/identity";

const ADDRESS = "0xAbC0000000000000000000000000000000000001";

function lookups(over: Partial<NameLookups>): () => NameLookups {
  const l: NameLookups = { ens: async () => null, basename: async () => null, ...over };
  return () => l;
}

describe("NameResolver", () => {
  it("prefers the ENS name", async () => {
    const basename = vi.fn(async () => "julio.base.eth");
    const r = new NameResolver(lookups({ ens: async () => "julio.eth", basename }));
    expect(await r.resolve(ADDRESS)).toEqual({ name: "julio.eth", source: "ens" });
    expect(basename).not.toHaveBeenCalled();
  });

  it("falls back to the Basename, then to no name", async () => {
    expect(await new NameResolver(lookups({ basename: async () => "julio.base.eth" })).resolve(ADDRESS)).toEqual({
      name: "julio.base.eth",
      source: "basename",
    });
    expect(await new NameResolver(lookups({})).resolve(ADDRESS)).toEqual({ name: null, source: null });
  });

  it("treats a failed lookup as no name", async () => {
    const r = new NameResolver(lookups({ ens: async () => Promise.reject(new Error("rpc down")), basename: async () => Promise.reject(new Error("rpc down")) }));
    expect(await r.resolve(ADDRESS)).toEqual({ name: null, source: null });
  });

  it("caches per address for an hour", async () => {
    let now = 0;
    const ens = vi.fn(async () => "julio.eth");
    const r = new NameResolver(lookups({ ens }), () => now);
    await r.resolve(ADDRESS);
    await r.resolve(ADDRESS.toLowerCase());
    expect(ens).toHaveBeenCalledTimes(1);
    now = 60 * 60_000 + 1;
    await r.resolve(ADDRESS);
    expect(ens).toHaveBeenCalledTimes(2);
  });
});
