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

Builds the web app in production mode (`next build`, standalone output), makes the icon from the vertical logo and packs everything with electron-builder into `apps/desktop/release/mac-arm64/PerkOS.app`. The app starts the bundled server with Electron's own Node, so the Mac that runs it needs no Node install.

- Build-time: `apps/web/.env.local` with the `NEXT_PUBLIC_*` values (they are inlined).
- Run-time: `~/.perkos-floor/env` with the server keys (`BASE_RPC_URL`, `BANKR_API_KEY`, `KNOWLEDGE_*`), same `KEY=VALUE` format. The keys never travel inside the bundle.
- Settings, session, vault and logs stay in `~/.perkos-floor/` (`logs/floor-app.log` is the server output of the packaged app).
- The signature is ad-hoc: fine on the Mac that built it. Distributing to other Macs needs a Developer ID and notarization.

## Desk knowledge

The desk reasons over three layers of knowledge, so every install answers from the same base:

- **Bundled notes** in `apps/web/knowledge/desk/*.md` (what B20 tokenized stocks are, venues and sizing, the desk method). They are seeded into the local vault (`~/.perkos-floor/knowledge/app/`) on first run and refreshed when the bundled copy is newer.
- **PerkOS Knowledge** (`knowledge.perkos.xyz`, public tier, no key): the same notes plus the daily valuation profile per asset (`floor/profiles/<TICKER>.md`). Every desk turn queries it; the install that holds `KNOWLEDGE_INGEST_TOKEN` publishes new profiles and notes for everyone else (`node scripts/publish-desk-knowledge.mjs`).
- **Local vault**: analyses, decisions, dated market outlooks and their one-month review, the desk memory.

Quality: every turn is logged to `~/.perkos-floor/logs/desk-quality.jsonl` with prompts, replies and automatic flags; History → Quality shows it, together with the outlooks and their reviews.

## Status

Scaffold for Runtime Agent Week (demo 19 Sep 2026). Spec lives in the PerkOS Obsidian vault under `Hackathons/Runtime-Agent-Week/`.
