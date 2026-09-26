# World ID in Runtime

Runtime now includes both the **Best IDKit Use Case** journey and the **Best Use
of World ID for Agents** journey. Backend activation is controlled by API's
`WORLD_ENABLED` flag, which defaults off.

## Use

Open **Settings → World ID**. Connect IDKit using the phone QR, or connect World
ID in the external browser. These enrollments are independent; connecting one
does not silently enroll the other or grant an agent access. When adding the
second method, Runtime first verifies that candidate, then asks for fresh
confirmation using the method already connected. API binds that confirmation
to the exact candidate before adding it to the account.

Open the Trader's delegated access from its wallet panel. Its external page
requests a fresh check from the same enrolled human before granting or expanding
permissions. IDKit uses the saved session for continuity; Agents uses fresh OIDC
authentication. The API binds the result to the actual Trader, wallet, chains
and per-order cap, consumes it once, and checks it before signing transactions.
Reducing or revoking rights does not require another proof.

World returns to **`https://api.perkos.xyz/world/oidc/callback`**. Electron opens
the browser and queries the authenticated request status; no World client
secret, provider token or PKCE verifier belongs in Electron or its renderer.

## Code and checks

| Responsibility | File |
| --- | --- |
| Sanitized World client and response validation | `packages/perkos-client/src/world.ts` |
| Authenticated local proxy | `apps/web/app/api/world/[...path]/route.ts` |
| Enrollment settings UI | `apps/web/app/world/WorldPanel.tsx` |
| IDKit bridge and bounded, cancellable polling | `apps/web/app/world/flow.ts` |
| Guidance from delegated wallet panels | `apps/web/app/world/WorldDelegationNote.tsx` |
| Core API, callback and delegated execution | PerkOS-API `docs/WORLD.md` |

SDK/proxy/polling tests run with `npm test`. Use `npm run typecheck`,
`npm run typecheck -w @perkos/runtime-web` and
`npm run build -w @perkos/runtime-web` to validate the actual Next build and
IDKit bundle. Both `@perkos/ens` consumers use workspace version `0.2.1`, so a
fresh install does not attempt to fetch the unpublished `0.2.0` package.

This release pins the tested World sandbox. Automated and browser-fixture
tests are separate from live World verification. The standalone lab's prior
phone/Agents evidence is in Obsidian; the deployed Runtime/API journey must be
tested separately. A different person's real phone proof remains a distinct
manual check.

The first protected action is delegated wallet authority. The limit is per
order, not the standalone lab's cumulative budget. ENS, Bankr launches and
owner-signed vault strategy transactions do not gain World coverage from this
change. A strategy's local `humanProofHash` is not a World verification receipt.
