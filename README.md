# PerkOS Floor

Desktop door into PerkOS. You open an app, say **Hey PerkOS**, and a team of specialized teammates drafts work on **Base**. You approve. Nothing spends without you.

The runtime is the CPU. PerkOS is the OS. Floor is the door.

## What this is

- Native app (`Floor.app` / AppImage), not a marketing site
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

## Desk knowledge

The desk reasons over three layers of knowledge, so every install answers from the same base:

- **Bundled notes** in `apps/web/knowledge/desk/*.md` (what B20 tokenized stocks are, venues and sizing, the desk method). They are seeded into the local vault (`~/.perkos-floor/knowledge/app/`) on first run and refreshed when the bundled copy is newer.
- **PerkOS Knowledge** (`knowledge.perkos.xyz`, public tier, no key): the same notes plus the daily valuation profile per asset (`floor/profiles/<TICKER>.md`). Every desk turn queries it; the install that holds `KNOWLEDGE_INGEST_TOKEN` publishes new profiles and notes for everyone else (`node scripts/publish-desk-knowledge.mjs`).
- **Local vault**: analyses, decisions, dated market outlooks and their one-month review, the desk memory.

Quality: every turn is logged to `~/.perkos-floor/logs/desk-quality.jsonl` with prompts, replies and automatic flags; History → Quality shows it, together with the outlooks and their reviews.

## Status

Scaffold for Runtime Agent Week (demo 19 Sep 2026). Spec lives in the PerkOS Obsidian vault under `Hackathons/Runtime-Agent-Week/`.
