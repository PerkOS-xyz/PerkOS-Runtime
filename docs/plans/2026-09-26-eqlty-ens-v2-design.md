# EQLTY: a desk with verifiable ENS V2 identities

Status: working design for implementation. Julio asked to bring the validated ENS V2 use case into PerkOS Runtime, using EQLTY-Desk first. Identity, parent/child pointers, permission isolation, verification and revocation are the first flow. A question about including complete team transfer is pending; no approval of that extra scope is assumed.

## The experience

A person opens their EQLTY desk and can create its public identity once its four real agents exist. Runtime shows the instance name and each seat's name, wallet, registration and verification state. It only says verified after reading Sepolia and checking both registry pointers and the ERC-8004/ENSIP-25 association. An API response alone never produces a verified badge.

The tree is `<seat>.<instance>.perkosruntime.eth`. The parent name and the canonical Runtime subregistry are deployment configuration, verified before writes. Each desk instance gets an immutable, unique label; it is not simply `eqlty` or a mutable owner's wallet. The example name `ensv2-review-20260926.eth` remains a test fixture. Nothing registers the production parent merely by opening Runtime.

Scout can publish a bounded `scout-source` record, Risk `risk-verdict`, and Auditor `auditor-evidence`. Trader has no ENS write permission. The person can inspect and revoke these grants. ENS publishes explicit, public identity and evidence; private chats, prompts, wallet credentials and portfolio data are not automatically copied to records. Trading still runs on the desk's market chain with its existing approval rules.

## Approaches considered

1. Shared ENS capability in Runtime/API, with a declarative identity descriptor supplied by each desk. Recommended: reuses the proven hierarchy and allows future desks to adopt it without implementing signing.
2. ENS implementation inside EQLTY-Desk. Fewer initial boundaries, but duplicates infrastructure for later desks and changes a service that currently holds no keys.
3. Display pre-existing ENS names only. Useful for a viewer, but does not satisfy the requested node creation, scoped permissions or revocation flow.

## Boundaries

- EQLTY-Desk adds a versioned identity descriptor endpoint, separate from the strict existing manifest. It declares seat IDs, public role descriptions and their write keys. It cannot choose a signer, parent registry or arbitrary destination contract.
- A keyless ENS library supplies verified Sepolia deployment metadata, normalized names, minimal ABIs, calldata, pointer inspection, record reading and verification. Runtime consumes it; API signing remains in the API. Distribution to the API must be reproducible and pinned, with no dependency on another checkout's absolute path.
- PerkOS API attaches identity to the existing authenticated desk instance and real fleet agents. It provisions contracts and records using a configured operator server wallet, and writes seat records with that agent's own Dynamic server wallet. The trading delegation path must not select the identity signer.
- Runtime adds an identity view within the desk. The creation/status API is authenticated. Blockchain reads used to verify identity require no PerkOS credentials. Errors, disabled configuration, missing agents and incomplete provisioning remain visible states.

## On-chain model

The Runtime registry contains the desk entry, and a desk registry contains the seat entries. Every mounted subregistry sets `setParent(parentRegistry,label)`; its parent sets the matching `setSubregistry` or passes it to `register`. After receipts, `getParent`, `getSubregistry`, `findCanonicalName` and `findCanonicalRegistry` must agree. A leaf does not require its own subregistry unless it will host children.

Every seat uses a separate PermissionedResolver. A grant for a key is contract-wide across names, so distinct keys on a shared resolver do not constitute isolation by seat. The API validates chain, canonical name, current resolver, exact key, signer and zero native value before signing. It never accepts arbitrary calldata or destination addresses from the client.

ERC-8004 registration must yield the actual ID, with metadata declaring the seat's ENS name. The ENS owner/operator writes the matching ENSIP-25 backlink. Verification starts from registry/ID, checks the declared name and reads the backlink from the canonical hierarchy. A nonempty hardcoded `agent-registration[...][42]` is insufficient.

The operator's permanent registry roles should be limited to provisioning/renewal requirements. Parent setters may be revoked after the hierarchy is established. The prototype's ALL_ROLES fixture is not the production permission template. Resolver administration and who can revoke must be explicit and observable; do not claim a fully autonomous or emancipated team while the operator retains relevant powers.

## Provisioning and writes

Identity creation is a resumable workflow, not a single long HTTP request assumed to succeed. Persist instance ID, immutable label, configuration version, expected owner, real agent wallet bindings, deterministic deployment inputs, transaction hashes and completed steps. Confirm receipts and on-chain postconditions before advancing. Retry confirmed steps idempotently; an ambiguous broadcast/signing timeout needs reconciliation and must not issue a replacement blindly.

An authenticated owner must own the matching fleet instance and agents. Each write rechecks the current on-chain owner, canonical ancestry, resolver and relevant role. If the name has moved, expired or been detached, the API refuses privileged writes until the instance is reconciled. A previous owner's database row must not retain authority after a transfer. Rate and size limits bound public record costs; explicit record publication must not silently upload private conversation text.

Public deployment configuration requires a funded operator wallet and a registered, mounted parent. Configuration reads expose only public addresses and readiness. Missing configuration fails closed; opening a desk never creates a wallet or charges gas implicitly.

## Compatibility and failure states

Keep the current market/manifest/trading contracts compatible. Use a distinct descriptor version and optional identity capability rather than adding a required field to strict manifests. Old desks return no identity capability and keep working.

Distinguish not configured, not created, provisioning, ready but unverified, verified, revoked, owner changed and network error. RPC failure cannot turn a stale positive result into current verification. Parent/child mismatch, alias mismatch and ancestor expiry invalidate the hierarchy. Persisted token IDs are reread before role and transfer operations because role changes regenerate IDs.

## Complete transfer is a separate acceptance criterion

Transferring the desk token preserves its pointers and transfers the token's roles. It does not transfer child tokens, resolver root administration, ERC-8004 identities, Dynamic delegation, Firestore ownership or encrypted vault material. A complete team transfer needs a controller/ownership model and an off-chain handoff protocol. The first identity view must not present a raw `unsafeTransfer` as delivery of the team.

## Validation

Reuse the proven Sepolia fork fixture, with separate test names and public Anvil accounts only. Extend it to exercise the production library/provisioner rather than a parallel reimplementation. Validate canonical pointers, separate resolvers, full ENSIP-25 round trips, wrong chain/ID/name, revoked writes, owner change and expired ancestry.

Test API authorization, ownership mismatch, agent signer selection, arbitrary destination rejection, resumable steps and ambiguous transaction handling. Test descriptor compatibility and Runtime state handling. Run relevant typechecks and existing suites. Verify the UI in a browser. Final public Sepolia validation uses the configured real wallets and produces public receipts; it is distinct from fork evidence.

## Sources

- Local evidence: `/Users/osx/Projects/PerkOS/PerkOS-App/ENS-V2-Validation-2026-09-26/` — 60 checks and 38 local transactions.
- Obsidian: `Hackathons/ETH Tokyo 26/ENS-V2/06-ENSIP-25-26-Agents.md`, `07-Use-Case-Brainstorm.md`, `08-Plan-Integracion.md`, `09-Arquitectura-y-Codigo.md`.
- Corrections to that research: `REVIEW.md` and `POINTERS.md` in the evidence directory.
