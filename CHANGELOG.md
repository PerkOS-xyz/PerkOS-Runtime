# Changelog

All notable changes to the PerkOS desktop app. Versions follow [Semantic Versioning](https://semver.org); the version lives in `apps/desktop/package.json` and shows in Settings › About with the git short SHA of the build.

## [Unreleased]

- An explicit order ("buy $1 of NVIDIA") paid with the delegated wallet executes on its own once Risk says GO: you gave the order and set the limits in Dynamic, so there is no second approval. The Trader waits 5 seconds first; Stop or any new message cancels it and the card stays on the table. Questions ("what should I buy?") still end in a card you hold to approve.
- A desk turn asked while the team was asleep no longer hangs after "The team is up.": the wake job never cleared itself, so the turn waited for it forever.
- Trader access: you can delegate a Dynamic wallet you own to the desk's Trader. Settings › Trader access opens a PerkOS page in your browser where you sign in, approve the delegation and set the Trader's limit. Back on the desk the card shows the wallet, its funds on Base and every limit, each marked with who enforces it: Dynamic's enclave, PerkOS, or your Hold.
- Switch "Pays for buys" to Delegated wallet and an approved buy is signed through that wallet after you hold Approve: no wallet popup, and the shares land back in the same wallet. Edit limits and Revoke are one press away. Your connected wallet stays the default, and sells always use it.

## [0.5.9] - 2026-09-19

- A desk can invite more than one Grok Bot. Seats are numbered, up to four, each with its own name and its own setup to paste, and the turn asks them all at once.
- The guest seat shows on the stage with the rest of the desk, reading its real state from the platform, and a guest can say the name it wants on its seat.
- Inviting stays reachable when the card fills up, and the setup is reachable again after a guest connects.
- Copy setup actually copies: the shell refused clipboard writes and the button said Copied anyway.

## [0.5.8] - 2026-09-19

### Fixed
- The desk stops warning about a lost wallet link while the connector is still resuming the session. The check now needs three answers in a row before it says the link is gone, and it waits a few seconds after connecting before asking at all. A wallet that signs normally no longer raises the warning.

### Changed
- Wallet sign in opens a new connector. The window offers the same two ways in, a wallet on your phone through WalletConnect and email or Google, and the app talks to it through the same internal contract as before, so nothing else in the app changed. Relinking a wallet after the phone drops the session is now a single step, and the app asks the connector whether the link is alive instead of assuming it from the session. The previous connector stays in the build: without `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID` nothing changes, and `NEXT_PUBLIC_WALLET_CONNECTOR=legacy` forces it back.

### Fixed
- The desk vault is per wallet. Until now every wallet that signed in on the same Mac read and wrote the same journal, orders, decisions and memory, so a new wallet opened onto the history of the previous one and added to it. Chats were already separate and encrypted by wallet; the notes are now too, and each wallet starts with the bundled desk notes. Notes written before this version stay where they are, in `~/.perkos-xyz/knowledge/app` and `~/.perkos-xyz/knowledge/<desk>`, and a wallet adopts them by moving those folders into `~/.perkos-xyz/knowledge/<wallet>/`.

## [0.5.7] - 2026-09-18

### Added
- A Desks screen behind the PerkOS mark: it leaves the desk and shows the catalogue published on PerkOS next to the desks you already run. Each template is a card you leaf through, with the desk name, the mark and Sparky. Opening a desk saves it, so the team, the knowledge and the outlooks are scoped to that desk.

- Setting up a desk asks which AI runs it, then its name, with the template under the name. Deploying takes you into the desk and the team is built in view, so Sparky can work while it happens.
- A desk can be taken down: its agents first, then the project, and only for the wallet that signed in.
- The wait during a signature shows what the desk does, in six slides, and only when the wait is long enough to fill.

### Changed
- A desk is a project on PerkOS: the template declares its chain, its name and its screens, and a desk module in the app supplies how that kind of desk trades. The dock now renders the screens the desk has, and a desk this version does not know keeps its own branding without inheriting mechanics it cannot run. Publishing a desk of a family the app already knows needs no new version of the app.
- Signing in with no desk lands on the catalogue instead of the setup step, and a template declares how many desks it admits per wallet. Floor follows the positions of the wallet you sign in with, so it is one per wallet, and the catalogue says so instead of offering a button that does nothing.
- The catalogue holds its shape while PerkOS answers, drawing a skeleton built from the same classes as the real cards.
- Turning on chat history says what it does: history is per wallet, so a new one has nothing to unlock.

### Fixed
- The first QR after signing out connects. WalletConnect was left pointing at a session it had just deleted, so the first pairing was born dead and only reopening the window built a fresh one.
- Known third party noise is recorded in plain words instead of being counted as a failure of the app.
- The card no longer tilts under the mouse, and the template card no longer clips its own text.
- The 1Claw claim stops being polled once it is clear it will not be finished.

## [0.5.6] - 2026-09-18

### Added
- Guided token launch: the desk reads which tokenized stocks a launch can pair with and ranks them, then Sparky helps name the token and write its description, the logo comes from a file or from the image model, fees go to the connected wallet, and Bankr simulates the launch before you hold.
- Buy a launched token from the desk, paid with ETH on Base in one signature, and sell it back to ETH in two. The route is quoted across every Uniswap fee tier, the exact transaction is simulated before it is offered, and a draft is refused when it would move the price too much.
- Launches panel as a wallet: a portfolio header, one row per token leading with what you hold and its value, and Trade, Pool and Fees tabs with an amount field and quick amounts.
- Launch pulse: what is trading on Bankr right now, shown when choosing a pair and available to Sparky.
- After advising the market, the Trader posts a working order book: scale in, a limit below the last price, or skip. Nothing spends until you hold.
- Sparky keeps talking while the desk wakes, and a live activity block shows what the desk is doing step by step.
- Agent avatars in the scene, starter chips on the composer, and a welcome page that opens the wallet directly.

### Fixed
- Relink the wallet without leaving the scene, and the sign in window actually opens.
- Third party noise (expired WalletConnect proposals, declined signatures) is logged as information instead of a red error.
- The chat no longer folds while a choice is waiting, and Sparky keeps the context of the thread.
- The 1Claw badge stays visible under the Trader when the desk splits.
- Links to other sites open the token page, and a paired stock shows its on chain symbol.

## [0.5.5] - 2026-09-17

### Added
- Agent avatars from the PerkOS construction kit: a permanent identity per agent, separate from role, expression and runtime state. Hibernating agents look asleep, not offline. The Trader, who signs with 1Claw, carries the 1Claw red.
- Chat history: threads saved as you go, encrypted on this computer with a key derived from one wallet signature, with a Chats drawer to rename, pin, search and reopen them.

### Changed
- The desk agents wake only when a task needs them. Sparky answers on its own.

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
