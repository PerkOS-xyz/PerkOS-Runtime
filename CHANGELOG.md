# Changelog

All notable changes to the PerkOS desktop app. Versions follow [Semantic Versioning](https://semver.org); the version lives in `apps/desktop/package.json` and shows in Settings › About with the git short SHA of the build.

## [0.3.0] - 2026-09-16

### Changed
- The app is PerkOS; Floor is its first desk. Package names, bundle id (`xyz.perkos.app`), window title, sign-in message and environment variables (`PERKOS_*`) follow. The desk keeps its identity: template `floor-desk`, "PerkOS Floor Desk", knowledge under `floor/`.
- Home folder is `~/.perkos-xyz`. An existing `~/.perkos-floor` is renamed on first start, and the Chromium profile "PerkOS Floor" becomes "PerkOS", so settings, session and vault carry over.
- Logs are `~/.perkos-xyz/logs/perkos-app.log` and `perkos-debug.log`; in development `apps/web/.perkos-debug.log`.

## [0.2.0] - 2026-09-16

### Added
- PerkOS.app for macOS (Apple Silicon) with a DMG installer, Developer ID signature, hardened runtime and optional notarization (`npm run package:mac --prefix apps/desktop`).
- Sparky as the voice of PerkOS: head with glow and eyes replaces the sphere, agents address `@Sparky`, xAI voice `leo` by default with a selector in Settings.
- Quality view in History: turn log with flags, dated outlooks and their one-month review.
- Desk knowledge in three layers: bundled notes, PerkOS Knowledge (public tier, valuation profiles per asset) and the local vault; numbered facts with citations in every turn.
- 30-day Chainlink range, valuation profile and 24 h news per asset, pre-warmed on boot.
- Screens proposal: shell vs desk, header with the desk identity at the centre and the `PerkOS + Base` lockup (official Base assets), centred sheets, master-detail Notes and History, Portfolio KPIs, side Settings.
- 1Claw row in Settings with the link state and an Edit rails action.
- Responsive stage: compact, narrow and short-window layouts; the split becomes one column under 700 px.

### Changed
- Desk template named "PerkOS Floor Desk" (r5).
- Product copy without a domain for 1Claw; the Trader's limits live at 1Claw as agent guardrails.

## [0.1.0] - 2026-09-15

### Added
- Electron shell over the Next.js canvas: Privy login, PerkOS session, xAI chat and voice, desk of four agents (Scout, Risk, Trader, Auditor) on Base, Uniswap draft with Bankr second quote, 1Claw spend rail, knowledge Map, History and dock.
