import { describe, expect, it } from "vitest";
import { agentMetadataUri, agentRegistrationKey, assertIdentityRoster, claimedEnsName, dnsName, instanceName, parseIdentityDescriptor, registryAddress, seatName } from "../src/index.js";

describe("identity input boundaries", () => {
  it("covers the complete seven-agent team and refuses omissions, extras or duplicate agent bindings", () => {
    const roles = ["scout", "risk", "trader", "auditor", "hooks", "quote", "treasury"];
    const descriptor = parseIdentityDescriptor({ version: "1", deskId: "eqlty", seats: roles.map((id) => ({ id, label: id, context: id, writes: null })) });
    const agents = roles.map((role) => ({ role, agentId: `real-${role}` }));
    expect(() => assertIdentityRoster(descriptor, roles.toReversed(), agents.toReversed())).not.toThrow();
    expect(() => assertIdentityRoster(descriptor, roles.slice(0, 4), agents)).toThrow("ENS_TEAM_MISMATCH");
    expect(() => assertIdentityRoster(descriptor, roles, agents.slice(0, 4))).toThrow("ENS_TEAM_MISMATCH");
    expect(() => assertIdentityRoster(descriptor, roles, [...agents, { role: "other", agentId: "extra" }])).toThrow();
    expect(() => assertIdentityRoster(descriptor, roles, agents.map((a) => ({ ...a, agentId: "same" })))).toThrow();
    expect(() => assertIdentityRoster(descriptor, roles, agents.map((a) => ({ role: a.role })))).toThrow();
  });
  it("normalizes the same name before DNS encoding and rejects inserted labels", () => {
    expect(dnsName("SCOUT.Example.eth")).toBe(dnsName("scout.example.eth"));
    expect(() => instanceName("mine.someone-else", "example.eth")).toThrow();
    expect(() => seatName("scout.risk", "example.eth")).toThrow();
    expect(() => dnsName("scout..eth")).toThrow();
  });
  it("matches the published ERC-7930 vector and refuses malformed chains or addresses", () => {
    expect(registryAddress(1, "0x8004a169fb4a3325136eb29fa0ceb6d2e539a432")).toBe("0x000100000101148004a169fb4a3325136eb29fa0ceb6d2e539a432");
    for (const chain of [-1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => registryAddress(chain, "0x" + "a".repeat(40))).toThrow();
    expect(() => registryAddress(1, "0x" + "g".repeat(40))).toThrow();
    for (const id of ["", "-1", "01", "1]", String(1n << 256n)]) expect(() => agentRegistrationKey(id)).toThrow();
  });
  it("round trips bounded agent metadata and refuses ambiguous or remote metadata", () => {
    expect(claimedEnsName(agentMetadataUri("Scout.example.eth", "Scout"))).toBe("scout.example.eth");
    expect(claimedEnsName("https://example.com/private-service")).toBeNull();
    const ambiguous = { services: [{ name: "ENS", endpoint: "a.eth" }, { name: "ENS", endpoint: "b.eth" }] };
    expect(claimedEnsName("data:application/json;base64," + btoa(JSON.stringify(ambiguous)))).toBeNull();
    expect(claimedEnsName("data:application/json;base64,invalid!")).toBeNull();
  });
  it("does not let a desk inject chain/signing fields or administrative keys", () => {
    const descriptor = { version: "1", deskId: "eqlty", seats: [{ id: "scout", label: "Scout", context: "Public sources", writes: "scout-source" }] };
    expect(parseIdentityDescriptor(descriptor)).toEqual(descriptor);
    expect(() => parseIdentityDescriptor({ ...descriptor, operator: "0x123" })).toThrow();
    expect(() => parseIdentityDescriptor({ ...descriptor, seats: [...descriptor.seats, ...descriptor.seats] })).toThrow();
    expect(() => parseIdentityDescriptor({ ...descriptor, seats: [{ ...descriptor.seats[0], writes: "agent-context" }] })).toThrow();
    expect(parseIdentityDescriptor({ ...descriptor, seats: [{ ...descriptor.seats[0], writes: null }] }).seats[0]?.writes).toBeNull();
  });
});
