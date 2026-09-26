import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, type PublicClient } from "viem";
import { agentMetadataUri, dnsName, ENS_SEPOLIA, textProfileAbi, verifyDeskIdentity, type DeskIdentity } from "../src/index.js";

const parent = "0x1111111111111111111111111111111111111111";
const registry = "0x2222222222222222222222222222222222222222";
const owner = "0x3333333333333333333333333333333333333333";
const wallet = "0x4444444444444444444444444444444444444444";
const resolver = "0x5555555555555555555555555555555555555555";
const name = "scout.desk.example.eth";
const key = "agent-registration[0x0001000003aa36a7148004a818bfb912233c491871b3d84c89a494bd9e][42]";
const identity: DeskIdentity = { chainId: 11155111, parentName: "example.eth", parentRegistry: parent, label: "desk", registry, owner,
  seats: [{ id: "scout", agentId: "scout-id", wallet, resolver, registrationId: "42", writes: null }] };

function clientFor(value: string, claim = name, rpcError = false) {
  const readContract = vi.fn(async ({ functionName, args, blockNumber }: { functionName: string; args?: unknown[]; blockNumber: bigint }) => {
    expect(blockNumber).toBe(123n);
    switch (functionName) {
      case "ROOT_REGISTRY": return ENS_SEPOLIA.rootRegistry;
      case "findCanonicalRegistry": return args?.[0] === dnsName("example.eth") ? parent : registry;
      case "getParent": return [parent, "desk"];
      case "getSubregistry": case "findParentRegistry": return registry;
      case "findExactOwner": return owner;
      case "verifyContract": return args?.[0] === registry ? ENS_SEPOLIA.userRegistryImpl : ENS_SEPOLIA.permissionedResolverImpl;
      case "getResolver": return resolver;
      case "ownerOf": return wallet;
      case "tokenURI": return agentMetadataUri(claim, "Scout");
      case "resolve": {
        if (rpcError) throw new Error("RPC unavailable");
        expect(args?.[0]).toBe(dnsName(name));
        const request = decodeFunctionData({ abi: textProfileAbi, data: args?.[1] as `0x${string}` });
        expect(request.functionName).toBe("text");
        expect(request.args?.[1]).toBe(key);
        return [encodeFunctionResult({ abi: textProfileAbi, functionName: "text", result: value }), resolver];
      }
      default: throw new Error(`Unexpected call: ${functionName}`);
    }
  });
  return { readContract, getChainId: async () => 11155111, getBlockNumber: async () => 123n } as unknown as PublicClient;
}

describe("ENSIP-25 registry-to-ENS verification", () => {
  it.each(["1", "true", "0", "attested", " "])("accepts non-empty attestation %j and returns the values read onchain", async (value) => {
    const result = await verifyDeskIdentity(clientFor(value), identity);
    expect(result.verified).toBe(true);
    expect(result.seats[0]?.ensip25).toEqual({ key, value, claimedName: name });
    expect(result.seats[0]?.writeGranted).toBe(false);
  });
  it("rejects an absent or revoked (empty) record", async () => {
    const result = await verifyDeskIdentity(clientFor(""), identity);
    expect(result.verified).toBe(false);
    expect(result.seats[0]?.issues).toContain("attestation-missing");
  });
  it("rejects a mismatched registry declaration even with a non-empty record", async () => {
    const result = await verifyDeskIdentity(clientFor("attested", "other.example.eth"), identity);
    expect(result.verified).toBe(false);
    expect(result.seats[0]?.issues).toContain("registration-name-mismatch");
  });
  it("does not claim verification when the ENS read fails", async () => {
    await expect(verifyDeskIdentity(clientFor("1", name, true), identity)).rejects.toThrow("RPC unavailable");
  });
});
