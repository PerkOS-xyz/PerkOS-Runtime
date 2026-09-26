/** ENS Sepolia beta deployment, contracts-v2 commit 71a3b7339dbc55ab47667abdfe8303bac4f4c24e. */
export const ENS_SEPOLIA = {
  chainId: 11155111,
  rootRegistry: "0x9703dbd26dab89504490994138cf2c575251a9ce",
  ethRegistry: "0x657ea849311d3d5823348dded7c2aaafb3ede09e",
  ethRegistrar: "0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca",
  userRegistryImpl: "0xa80338aaa8d23831cea25e858d1774534abb0263",
  permissionedResolverImpl: "0x14f09fd05d4585759e54844dc9b00147131cf243",
  factory: "0x9e726eb570beb6bceb495ab8cda7df517d4e841c",
  universalResolver: "0x5d25c1d6acbb71b7a28aa7899618a3412a8303e3",
  universalHelper: "0x33f571aa8a160a21b877cf6e0fb8806692b97df5",
  identityRegistry: "0x8004a818bfb912233c491871b3d84c89a494bd9e",
} as const;

const admin = (role: bigint) => role << 128n;
export const REGISTRY_ROLES = {
  register: 1n,
  setParent: 1n << 8n,
  renew: 1n << 16n,
  setSubregistry: 1n << 20n,
  setResolver: 1n << 24n,
  transfer: (1n << 28n) << 128n,
} as const;
export const TEXT_ROLE = 1n << 4n;
export const TEXT_ADMIN = admin(TEXT_ROLE);
/** Only the operator may relink names; agents never receive this role. */
export const LINK_ROLE = 1n << 28n;
export const PARENT_ROLES = REGISTRY_ROLES.setParent | admin(REGISTRY_ROLES.setParent);
/** Provisioning may register and renew entries, never override their resolver or child pointers. */
export const PROVISIONER_ROLES = REGISTRY_ROLES.register | REGISTRY_ROLES.renew | PARENT_ROLES;
export const DESK_OWNER_ROLES = REGISTRY_ROLES.setSubregistry | REGISTRY_ROLES.setResolver | REGISTRY_ROLES.renew | REGISTRY_ROLES.transfer;
export const SEAT_OWNER_ROLES = REGISTRY_ROLES.setResolver;
