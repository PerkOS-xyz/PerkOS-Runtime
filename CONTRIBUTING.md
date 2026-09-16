# Contributing

## Setup

Node 22. Two npm projects, no workspace:

```
cd apps/web && npm install && cp .env.example .env.local   # fill NEXT_PUBLIC_* values
cd ../desktop && npm install && npm run brand              # optional: brand the dev Electron shell (macOS)
```

Run the app from the repo root with `npm run dev` (web only, http://127.0.0.1:3000) or `npm start` (Electron shell, which starts the web server itself). Packaging: see the README.

## Rules

- Pull requests only, from a branch off `main`. One topic per PR. Typecheck must pass (`npx tsc --noEmit -p apps/web`).
- Product copy is English. Comments may be English or Spanish. No secrets, keys, session files or personal data in commits: `.env.local` and `~/.perkos-xyz` never enter the repo.
- Anything that spends, signs or changes the wallet stays behind the person's approval. Do not add a path around it.
- Desk knowledge that other installs will read (`apps/web/knowledge`) needs a source line.

## Releases

Bump the version in `apps/desktop/package.json` and `apps/web/package.json`, add the entry to `CHANGELOG.md`, and after the merge tag `vX.Y.Z` and attach the DMG to the GitHub release (README, "Releases").
