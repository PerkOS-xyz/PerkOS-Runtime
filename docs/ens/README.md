# ENS V2 in the EQLTY desk

The implementation lives in Runtime (`@perkos/ens`, client, identity view), PerkOS-API (ownership, Dynamic signing and durable operations), and EQLTY-Desk (`GET /identity`). It is an opt-in integration: no public deployment was performed during this review.

## Complete team

The current published starter has seven roles: Scout, Risk, Trader, Auditor, Hooks, Quote and Treasury. Four turn participants are not the complete fleet. Runtime lists the descriptor's entire roster. API requires the descriptor, published template and instantiated team to have exactly matching role sets and distinct agent IDs; an old four-agent instance must be updated through the existing instantiate flow first.

Each role receives `<role>.<immutable-instance>.<configured-parent>`, a separate resolver, its own Dynamic server wallet binding and an ERC-8004 registration whose ENS service matches the ENSIP-25 backlink. Trader receives no ENS write grant. Other roles receive only their declared evidence key. These identities grant no trading authorization.

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
