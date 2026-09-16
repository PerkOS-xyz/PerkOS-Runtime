# PerkOS Floor

Desktop door into PerkOS. You open an app, say **Hey PerkOS**, and a team of specialized teammates drafts work on **Base**. You approve. Nothing spends without you.

The runtime is the CPU. PerkOS is the OS. Floor is the door.

## What this is

- Native app (`PerkOS.app` / AppImage), not a marketing site
- Canvas dashboard: four core Hermes desks (Scout, Risk, Trader, Auditor) plus an invited guest
- Voice + hands + LiveKit as the pipe, not the brain
- Base only for the Runtime Agent Week demo (Dynamic, B20, Uniswap, x402)

Product copy is English. They draft. You approve.

## Layout

```
apps/web       Canvas UI (Next.js)
apps/desktop   Electron shell
```

## Run

Node 22. From repo root:

```
npm run dev --prefix apps/web
npm start --prefix apps/desktop
```

Ask the floor: `Hey PerkOS`, `Wake the team`, `Invite the guest`, `Show the documentation`, `Review the market`, `Stop`.

## Package as PerkOS.app (macOS, Apple Silicon)

```
npm run package:mac --prefix apps/desktop
```

Builds the web app in production mode (`next build`, standalone output), makes the icon and the DMG background from the vertical logo, packs the shell with electron-builder and puts the desk server inside the bundle (`after-pack.cjs`). Output: `apps/desktop/release/PerkOS-<version>-arm64.dmg` and `apps/desktop/release/mac-arm64/PerkOS.app`. The app starts the bundled server with Electron's own Node, so the Mac that runs it needs no Node install.

- Build-time: `apps/web/.env.local` with the `NEXT_PUBLIC_*` values (they are inlined).
- Run-time: optional `~/.perkos-floor/env` with server keys (`BASE_RPC_URL`, `BANKR_API_KEY`, `KNOWLEDGE_*`), same `KEY=VALUE` format. Without it the app uses the public Base RPC and PerkOS Knowledge and skips the Bankr second quote. Keys never travel inside the bundle.
- Settings, session, vault and logs stay in `~/.perkos-floor/` (`logs/floor-app.log` is the server output of the packaged app).

### Signing and notarization

The script signs with the first "Developer ID Application" identity in the keychain (hardened runtime, `entitlements.mac.plist`). Without one it signs ad-hoc, which only runs on the Mac that built it. Notarization, needed for other Macs to open the DMG without warnings, runs when Apple credentials are in the environment:

```
xcrun notarytool store-credentials perkos-floor --apple-id <apple id> --team-id <team id>
APPLE_KEYCHAIN_PROFILE=perkos-floor npm run package:mac --prefix apps/desktop
```

`store-credentials` asks for an app-specific password from appleid.apple.com. `APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` work too.

### Releases

Versions follow semver and live in `apps/desktop/package.json` (mirrored in `apps/web/package.json`). Settings › About shows the version and the git short SHA of the build. To release:

1. Bump the version in both `package.json` files and add the entry to `CHANGELOG.md`, in a PR.
2. After the merge, tag and publish the DMG from `main`:

```
git tag v0.2.0 && git push origin v0.2.0
npm run package:mac --prefix apps/desktop
gh release create v0.2.0 apps/desktop/release/PerkOS-0.2.0-arm64.dmg --title "PerkOS 0.2.0" --notes-file <(sed -n '/## \[0.2.0\]/,/## \[0.1.0\]/p' CHANGELOG.md)
```

## Desk knowledge

The desk reasons over three layers of knowledge, so every install answers from the same base:

- **Bundled notes** in `apps/web/knowledge/desk/*.md` (what B20 tokenized stocks are, venues and sizing, the desk method). They are seeded into the local vault (`~/.perkos-floor/knowledge/app/`) on first run and refreshed when the bundled copy is newer.
- **PerkOS Knowledge** (`knowledge.perkos.xyz`, public tier, no key): the same notes plus the daily valuation profile per asset (`floor/profiles/<TICKER>.md`). Every desk turn queries it; the install that holds `KNOWLEDGE_INGEST_TOKEN` publishes new profiles and notes for everyone else (`node scripts/publish-desk-knowledge.mjs`).
- **Local vault**: analyses, decisions, dated market outlooks and their one-month review, the desk memory.

Quality: every turn is logged to `~/.perkos-floor/logs/desk-quality.jsonl` with prompts, replies and automatic flags; History → Quality shows it, together with the outlooks and their reviews.

## Status

Scaffold for Runtime Agent Week (demo 19 Sep 2026). Spec lives in the PerkOS Obsidian vault under `Hackathons/Runtime-Agent-Week/`.
