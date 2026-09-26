# World permission review for the selected Trader

The first live Runtime acceptance enrolled IDKit, accepted the Agents OIDC
callback, and consumed fresh IDKit continuity to link the second provider.
Opening EQLTY's existing delegated-wallet limits then returned
`WORLD_TRADER_REQUIRED`: the owner has valid Traders in both EQLTY and Floor,
while Runtime supplied only `mode`.

## Correction within the approved integration

Use the selected desk's server-provided team to pass its stable Trader
`agentId` through the sheet and local delegation proxy. The API retains its
protected instance and registry validation. A missing or ambiguous selection
must not choose a Trader implicitly.

Selecting a global first Trader would bind the wrong authority. Adding a
separate picker would duplicate the existing desk selection. Passing the
selected stable ID preserves the intended flow and the server boundary.

The desk wallet response also exposes the existing read-only World grant
view. Runtime displays effective approval only when the active grant matches
the selected agent, delegated wallet and chain. Its displayed spend cap must
not exceed the World grant. An unapproved legacy wallet remains visible for
balances, reduction/revocation and recovery; buying waits for approval.
Completion polling observes approval/revision changes even when the cap is
unchanged. The backend signing and pre-broadcast checks remain authoritative.

## Validation

- Two valid Traders: explicit selection works; absent/foreign selection fails.
- Proxy preserves a valid stable ID and rejects malformed input.
- Legacy or mismatched agent/wallet/chain grants cannot enable buying.
- World disabled preserves the previous behavior; recovery remains available.
- Same-cap approval updates the UI and reflects the grant's effective cap.
- Repeat the authorized live review after deployment; obtain approval for
  exact new permissions before saving. No trade is required for this check.
