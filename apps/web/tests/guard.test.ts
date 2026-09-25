/**
 * Access check for the local API.
 */

import { describe, expect, it } from "vitest";

import { guard } from "../app/lib/guard";

const req = (headers: Record<string, string>, method = "GET") =>
  new Request("http://127.0.0.1:3100/api/anything", { method, headers });

describe("local API guard", () => {
  it("allows same-origin requests on loopback", () => {
    expect(guard(req({ host: "127.0.0.1:3100", "sec-fetch-site": "same-origin" }))).toBeNull();
  });

  it("rejects a non-loopback host", async () => {
    const res = guard(req({ host: "evil.example" }));
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ reason: "host" });
  });

  it("rejects cross-site requests", async () => {
    const res = guard(req({ host: "localhost:3100", "sec-fetch-site": "cross-site" }));
    expect(await res?.json()).toMatchObject({ reason: "origin" });
  });

  it("rejects text/plain writes", async () => {
    const res = guard(req({ host: "localhost", "content-type": "text/plain" }, "POST"));
    expect(await res?.json()).toMatchObject({ reason: "content-type" });
  });
});
