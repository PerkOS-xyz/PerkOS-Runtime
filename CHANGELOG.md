# Changelog

All notable changes to the PerkOS desktop app. Versions follow [Semantic Versioning](https://semver.org); the version lives in `apps/desktop/package.json` and shows in Settings › About with the git short SHA of the build.

## [0.5.4] - 2026-09-17

### Added
- Share on X for a launched token, on the Launch card and on the chat card once the token is live: the token, its pair, that the desk drafted it, you approved it and @perk_os deployed it through Bankr, the contract address and the Bankr page. It opens in your browser and nothing is posted until you press Post.
- Copy contract chip on every Portfolio position and every Launch card.

### Fixed
- The docked desk panel (half the window) lays out by its own width: Portfolio rows go to three lines with the draft buttons in full view, Launches stacks. Before, the narrow rules looked at the window and never fired.

## [0.5.3] - 2026-09-17

### Changed
- Portfolio screen redesigned: header and rows share one grid so every title sits over its column; a Trades on column says where each position sells (Aerodrome or Uniswap V3, pool fee, USDC depth with a link to the pool, and the other venue); the buttons read Draft: sell half and Draft: sell all, with a line and a tooltip that nothing sells until you hold to approve and sign; four KPIs (value including USDC, USDC on Base, positions, 24h); skeleton rows while loading.

## [0.5.2] - 2026-09-17

### Changed
- Launches screen redesigned: each token is a card with a full width price curve (24 hour area chart with the day's high and low), six KPIs (price, 1h, 24h, volume, liquidity, FDV), where the pool is (Uniswap V4 on Base, pair, pool id, fee split), links to Uniswap, DexScreener, Bankr and Basescan stacked in their own column, and creator fees with daily earnings and the claim button. Stacks under 700 px.

### Added
- Market data for launched tokens from DexScreener, GeckoTerminal and Bankr's public fee endpoint, no keys, 60 second cache.

## [0.5.1] - 2026-09-16

### Added
- Launch options: `fees to @handle` (X), an ENS name, a Farcaster name or a wallet names who earns the creator fees; Bankr resolves the identity in the simulation and the card shows the wallet. The pair can be any quote token in Bankr's registry on Base (tokenized stocks, WETH, BNKR, cbHYPE, TAO). `no vesting` / `with vesting`, `quote only fees` and `degen` are understood; Sparky asks for the name or the pair when they are missing.
- Launches screen in the desk dock: every token that pays fees to the connected wallet, with pair, deployer, claimable and claimed, links to Bankr and Basescan, and Claim fees per token. `claim fees for OWL` claims one token.

### Fixed
- The Fees card head sums what is claimable per quote token instead of Bankr's WETH-only total.
- The desk's Trader restates the launch vesting rule exactly as the facts state it.

## [0.5.0] - 2026-09-16

### Added
- Launch a token paired with a tokenized stock on Base through Bankr: `launch Night Owl (OWL) paired with NVDA` drafts it, runs Bankr's simulation, lists Bankr's rules as checks and sends the facts to the desk in a new launch mode where Risk says GO or BLOCK. The Launch card deploys only after Hold to launch. 95% of the pool fee pays the wallet connected in Settings; when the Bankr wallet on the install is not that wallet, creator vesting is disabled so the deployer keeps nothing.
- Automations in Bankr: `dca $5 into NVDA every week`, `stop loss on TSLA at 380` and limit buys become an Automation card; Hold to create sends the prompt to Bankr's agent. New Automations screen in the desk dock with pause, resume, cancel and Ask Bankr.
- Fees card: `claim my fees` or `what did I earn` lists every launched token where the connected wallet is the creator beneficiary, with claimable and claimed amounts. Hold to claim builds the claim with Bankr's public endpoint; the person signs it in their wallet and pays the gas on Base.
- Settings › Desk shows the Bankr wallet, its ETH on Base, Bankr Club, launches used today and a link to the keys page.
- README: what you can do, with the user workflow diagram.

### Changed
- The desk's Trader restates the vesting rule exactly as the launch facts state it.

## [0.4.0] - 2026-09-16

### Security
- The local API is gated: loopback host only, no cross-site requests, no plain-text bodies, and a per-launch token shared by the shell, the window and the voice bridge. The command channel cannot buy, sell or approve.
- Trade drafts carry the recipient; the card shows it and the approval refuses to sign for any wallet other than the one connected. The wallet in settings must be an address.
- PerkOS sign-in only for the connected wallet; Grok device login only for a code this app requested.
- Vault paths are contained: tickers are whitelisted and every note path must resolve inside the vault.
- Risk without an explicit verdict blocks the order instead of letting it through.
- The main window never navigates away from the local server; only wallet and login popups open inside the app, every other link opens in the system browser.
- Log files are created 0600 and the UI log endpoint is capped. The notarization entitlements no longer allow dyld environment variables.

### Changed
- Next 16.3.5 and audit fixes for the native stack; MIT license, notices for marks, contributing and security policies, CI.

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
