# ENS V2 in the EQLTY desk

The implementation lives in Runtime (`@perkos/ens`, client, identity view), PerkOS-API (ownership, Dynamic signing and durable operations), and EQLTY-Desk (`GET /identity`). It is an opt-in integration: no public deployment was performed during this review.

## Complete team

The current published starter has seven roles: Scout, Risk, Trader, Auditor, Hooks, Quote and Treasury. Analyze/advise currently use Scout, Risk, Quote, Trader and Auditor; launch uses Scout, Risk, Hooks, Treasury and Auditor. Not every role runs in every turn. Runtime lists the descriptor's entire roster. API requires the descriptor, published template and instantiated team to have exactly matching role sets and distinct agent IDs; an old four-agent instance must be updated through the existing instantiate flow first.

Each role receives `<role>.<desk-label>.<active-parent>`, a separate resolver, its own Dynamic server wallet binding and an ERC-8004 registration whose ENS service matches the ENSIP-25 backlink. Trader receives no ENS write grant. Other roles receive only their declared evidence key. These identities grant no trading authorization.

## Ownership and recovery

API derives the owner from the authenticated session. It checks the protected fleet instance, wallet workspace and protected global agent registry; a client-editable workspace row alone is insufficient. Creation and every privileged operation recheck agent bindings. Writes verify current chain ownership, canonical ancestor links, resolver, ERC-8004 ownership and the exact grant.

The API's operator provisions and administers resolver text permissions; the owner controls desk/seat tokens and can repoint relevant entries. This is a managed identity system. Transferring a desk token does not transfer the whole team, provider wallets, child tokens, resolver administration, ERC-8004 ownership or private data.

An explicit Create/Resume action advances one persisted operation at a time. It saves the intended signer, nonce, destination, calldata and amount before signing, locks the signer across API processes, then persists the hash and validates the receipt. Unknown broadcast outcomes retain the lock. Administrators reconcile a matching on-chain transaction or a mined zero-value self-transfer consuming the same nonce; elapsed time alone never unlocks a signer. Record request IDs cannot be reused. A ready identity never re-enters provisioning, so revoked grants are not restored by Resume.

## Configuration and activation

See PerkOS-API `docs/ENS-V2.md`. Register and canonically mount the intended parent first, configure a dedicated Dynamic operator server-wallet UID and its public address, fund it with Sepolia ETH, and enable the feature. The operator must hold the needed register role in the parent registry. Runtime displays its address before creation. GET requests never create wallets or issue transactions. Each new agent can receive one bounded 0.001 Sepolia ETH top-up during creation if needed; later funding is an explicit operator responsibility.

For public activation, deploy the matching API and EQLTY-Desk changes, update the actual team to all seven agents, then use Runtime with the configured real parent. Preserve the correct name for that integration. The local fixture uses `ensv2-review-20260926.eth` and public Anvil accounts; those are not production credentials.

## Validation and limits

The production planner and reader passed 21 checks with 61 local transactions on an isolated Sepolia fork. The test provisions all seven roles, validates both pointers and every ENSIP-25 association, publishes from all six permitted wallets, rejects Scout in Risk's resolver, refuses Trader, revokes Scout and rejects a detached subtree. See `eqlty-seven-agent-fork-2026-09-26.json` for addresses, block, checks and hashes. These hashes belong to the local fork and are not public receipts.

Runtime's full suite passed 589 tests before the four additional identity bridge tests; EQLTY passed 196. API passed 1,530 tests across its full suite and the two sandbox-blocked socket suites rerun outside the sandbox, with two existing skips; focused ENS tests were extended afterward. The final focused runs passed 26 ENS API tests and nine Runtime ENS/identity-bridge tests, including the four additional bridge tests. Typechecks cover Runtime root/web, API and EQLTY.

The browser review uses an isolated profile, a simulated localhost API and disabled writes. It verifies all seven rows and refuses to enable publication merely because a server labels a non-public fork identity ready. The on-chain test uses unlocked Anvil accounts; Dynamic MPC signing and the actual public parent/wallet setup still require a public Sepolia acceptance run.

## Reproduction

From Runtime: `npm ci`, `npm test`, `npm run typecheck`, `npm run typecheck -w @perkos/runtime-web`. Build the SDK with `npm run build -w @perkos/ens`, then run `node scripts/ens/run-fork.mjs` with Foundry's Anvil installed. The runner permits only its own localhost fork and stops it afterward. Optional `ENS_REVIEW_BLOCK` pins a block; `ENS_REVIEW_UPSTREAM` supplies a Sepolia archive RPC. No keys are required.

`@perkos/ens` is not published. API consumes a checked-in tarball produced with `npm pack -w @perkos/ens --pack-destination <API>/vendor`; refresh the API lockfile after repacking. Runtime uses its workspace source build. Both repositories must be reviewed together.

## Research

Based on Obsidian `Hackathons/ETH Tokyo 26/ENS-V2/06-ENSIP-25-26-Agents.md`, `07-Use-Case-Brainstorm.md`, `08-Plan-Integracion.md`, and `09-Arquitectura-y-Codigo.md`. Earlier contract review and corrections are in `ENS-V2-Validation-2026-09-26/REVIEW.md` and `POINTERS.md` in the parent workspace. The separate-resolver requirement and incomplete team-transfer semantics are deliberate corrections to the initial research.

## Mobile branches and task evidence (0.2.0)

New identities publish a self-contained `perkos-desk` manifest in a separate desk resolver. The public `/ens` page discovers it through Universal Resolver V2 and checks every declared seat. It fetches no ENS-controlled HTTP URL and grants no app access.

New mobile registries retain parent-setting authority; each resolver gives only the operator the root linking role. `prepareDeskMove` previews a same-owner parent move, and `nextMoveStep` mounts the destination, changes `setParent`, relinks the eight record bundles, updates seven ERC-8004 ENS services with their own wallets, updates the manifest, and detaches the original child pointer. The registry, seat tokens, wallets, IDs and grants remain unchanged. Fixed legacy identities are refused. Moving an individual seat or transferring team ownership is not implemented.

History → ENS evidence selects an actual reply with an API-captured task digest. The owner reviews its whole public packet, then explicitly publishes its content hash with that agent's wallet. Trader remains read-only. The API stores no private response body until publication is requested; task receipt metadata and quote snapshots stay protected. Failed capture leaves the response usable but unavailable for ENS publication. Old turns without task receipts cannot be retroactively attributed.

The packet includes the decision/task binding, response, identity snapshot and full quote references. The two-minute quote window is informational, not a trade authorization. A stale quote can be preserved as historical evidence but is labelled stale. Exported JSON verifies without a PerkOS account: content hash, actual transaction sender/to/calldata, canonical receipt and identity at the publication block. Archive RPC failure is reported as unverified history. The successful publication stays attached to its task after a move; mutable ENS records point to the latest packet, while exported packets keep earlier receipts.

Identity and History show persisted ENS activity: named step, signer, signing/pending/confirmed/reverted/reconciliation state, transaction link and mined block. The UI never labels a submitted hash as a confirmed operation. The recent 128 transactions survive reopening the sheet; completed move plans are archived server-side.

Latest contract run: **41 checks, 88 local sends**, including one negative-test transaction rolled back by an Anvil snapshot. This adds movement/restart, unchanged revoked grants, occupied destination, missing authority, mid-move permission drift, independent discovery, packet tampering, wrong signer, stale quotes and historical verification after revocation/movement. See `eqlty-mobile-evidence-fork-2026-09-27.json`. No public Sepolia transaction or Dynamic MPC acceptance is claimed.

Visual review used the actual React components with a clearly labelled, read-only localhost API fixture. Pending/confirmed steps and explorer links were visible at desktop and 360 px without horizontal overflow or console errors. The fixture route is not included in the app.
