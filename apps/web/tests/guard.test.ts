/**
 * The door to the local API. What matters is that a page open somewhere else
 * on the machine cannot reach it, and that the app's own window can.
 */

import { describe, expect, it } from "vitest";

import { guard } from "../app/lib/guard";

const req = (headers: Record<string, string>, method = "GET") =>
  new Request("http://127.0.0.1:3100/api/anything", { method, headers });

describe("the door to the local API", () => {
  it("lets the app's own window through", () => {
    expect(guard(req({ host: "127.0.0.1:3100", "sec-fetch-site": "same-origin" }))).toBeNull();
  });

  it("turns away a host that is not this machine", async () => {
    const res = guard(req({ host: "evil.example" }));
    expect(res?.status).toBe(403);
    expect(await res?.json()).toMatchObject({ reason: "host" });
  });

  it("turns away another site", async () => {
    const res = guard(req({ host: "localhost:3100", "sec-fetch-site": "cross-site" }));
    expect(await res?.json()).toMatchObject({ reason: "origin" });
  });

  it("turns away a write that a form could send without asking", async () => {
    const res = guard(req({ host: "localhost", "content-type": "text/plain" }, "POST"));
    expect(await res?.json()).toMatchObject({ reason: "content-type" });
  });
});
