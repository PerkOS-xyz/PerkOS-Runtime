# World ID: desktop integration

The user authorized integrating both **Best IDKit Use Case** and **Best Use of
World ID for Agents**. Runtime owns the human-facing enrollment journey; API
owns identity verification and the agent's execution authorization.

## Approved behavior

- Settings shows World status and independent enrollment for IDKit and Agents
  OIDC, using the current authenticated PerkOS owner.
- IDKit presents a QR/link from the pinned SDK, requires presence, waits within
  a bounded cancellable interval and submits the complete result to API. Only
  the server's verified response changes enrollment status.
- Agents opens the external browser. The fixed API callback records a validated
  result; Electron learns it through authenticated polling. No client secret,
  PKCE verifier, provider device code or World signing key enters the renderer.
- Granting or expanding Trader delegation opens the existing external page,
  which requests fresh approval from the same enrolled human before expanding
  Dynamic permissions. The server checks authorization again before signing.
- Decreasing and revoking permissions do not require another World proof.

The chosen API-backed flow reuses the current Electron authentication and
external navigation behavior. An Electron-only verifier would put authority in
the client; embedding the standalone lab would retain synthetic accounts and
single-process persistence. The API-backed flow carries the already-tested
protocol into the real account and agent boundaries.

## Integration contract

The authenticated SDK calls `/world/status`, creates an enrollment request,
reads/polls/cancels it and submits IDKit proof. Next route handlers proxy these
operations through the existing server-held PerkOS session. Callback:
`https://api.perkos.xyz/world/oidc/callback`.

Identity enrollment is independent for IDKit and OIDC. The feature flag is
server-owned and defaults off. The initial implementation is explicitly sandbox;
it does not claim production biometric assurance. ENS discovery, Bankr launch
and owner-signed strategy rails retain their existing scope.

## Validation plan

Test SDK/proxy authentication and response handling, stale/cancelled UI flows,
bounded polling and confirmation based on server status. Compile the actual
Next app to verify IDKit/WASM bundling. Run all Runtime tests and typechecks,
inspect the rendered settings flow, then document live-provider and deployment
checks independently from mocked tests.

Backend design lives in PerkOS-API
`docs/plans/2026-09-27-world-runtime-design.md`. Research and prior live sandbox
evidence remain in Obsidian `WorldId-Preparacion-Integracion-Runtime-2026-09-27.md`.
