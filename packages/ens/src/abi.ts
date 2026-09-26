import { parseAbi } from "viem";

export const registryAbi = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants)",
  "function register(string label, address owner, address registry, address resolver, uint256 roleBitmap, uint64 expiry) returns (uint256)",
  "function findTokenId(string label) view returns (uint256)",
  "function findOwner(string label) view returns (address)",
  "function findExpiry(string label) view returns (uint64)",
  "function getSubregistry(string label) view returns (address)",
  "function getResolver(string label) view returns (address)",
  "function getParent() view returns (address parent, string label)",
  "function setParent(address parent, string label)",
  "function setSubregistry(uint256 anyId, address registry)",
  "function setResolver(uint256 anyId, address resolver)",
  "function hasRootRoles(uint256 roleBitmap, address account) view returns (bool)",
  "function revokeRootRoles(uint256 roleBitmap, address account)",
]);
export const resolverAbi = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)",
  "function setText(bytes name, string key, string value)",
  "function grantSetterRoles(bytes data, address account) returns (bool)",
  "function revokeRoles(uint256 resource, uint256 roleBitmap, address account)",
  "function hasRoles(uint256 resource, uint256 roleBitmap, address account) view returns (bool)",
]);
export const textProfileAbi = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);
export const universalAbi = parseAbi([
  "function ROOT_REGISTRY() view returns (address)",
  "function findResolver(bytes name) view returns (address resolver, bytes32 node, uint256 offset)",
  "function resolve(bytes name, bytes data) view returns (bytes result, address resolver)",
]);
export const helperAbi = parseAbi([
  "function ROOT_REGISTRY() view returns (address)",
  "function findCanonicalName(address registry) view returns (bytes)",
  "function findCanonicalRegistry(bytes name) view returns (address)",
  "function findExactRegistry(bytes name) view returns (address)",
  "function findParentRegistry(bytes name) view returns (address)",
  "function findExactOwner(bytes name) view returns (address)",
]);
export const factoryAbi = parseAbi([
  "function deployProxy(address implementation, uint256 salt, bytes data) returns (address)",
  "function verifyContract(address proxy) view returns (address implementation)",
]);
export const identityRegistryAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
  "function tokenURI(uint256 agentId) view returns (string)",
  "function ownerOf(uint256 agentId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);
