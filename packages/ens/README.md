# @perkos/ens

Keyless ENS V2 primitives for PerkOS desk identities on Sepolia. Builds DNS names with ENS normalization, isolates deployment constants and ABI definitions, reads through Universal Resolver V2, and verifies canonical parent/child pointers and ERC-8004/ENSIP-25 associations at one block.

`parseIdentityDescriptor` validates the public seat declaration from a desk. It does not accept signer, chain or contract addresses. `verifyDeskIdentity` verifies a provisioned instance; it throws on RPC errors and never falls back to cached verification. `writeGranted` is separate from identity validity. Metadata verification currently supports bounded JSON data URIs created by this integration; it never fetches arbitrary agent URLs from a server.

The package does not hold keys, create wallets, publish transactions, or grant application access based on a name. Registry token transfer does not transfer API ownership, child tokens, agent wallets, resolver administration, or private memory.

Version 0.2.1 accepts any non-empty ENSIP-25 attestation; writers still use the recommended `"1"`. Each checked seat includes `ensip25.key`, `ensip25.value` and `ensip25.claimedName` read at the verification block. Consumers must use the verification result, not the presence of these diagnostic fields, to claim a valid identity. ENSIP-25 is a draft: https://docs.ens.domains/ensip/25/.

ENS beta addresses/ABIs are pinned to contracts-v2 deployment commit `71a3b7339dbc55ab47667abdfe8303bac4f4c24e`. Review them when changing deployment versions. API consumers use a packed, pinned artifact; runtime paths never point to another local checkout.

Version 0.2 adds resumable same-owner branch movement, on-chain desk discovery and portable task evidence verification. `prepareDeskMove` and `nextMoveStep` produce unsigned calls and never restore revoked grants. `verifyEvidence` checks the exact agent-signed transaction and historical identity separately from current permissions and quote freshness. Public-chain activation with real Dynamic wallets remains an acceptance step.
