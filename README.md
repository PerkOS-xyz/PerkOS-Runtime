# PerkOS Runtime

The app where Desks run.

A **Desk** is a solution: its own market, its own team of agents, its own screens. Runtime is what they run inside.

Runtime provides the account, Sparky, the screens every desk shares, a model that can run on your own machine, and the client for the PerkOS services. It does not know what an asset is, where it trades, or how an order is routed. That belongs to a Desk.

## Status

Working today:

- `apps/web`: the landing page, served on this machine only.
- `packages/ai`: model providers. Detects Ollama and LM Studio on this machine, and supports any OpenAI-compatible endpoint.
- `packages/desk-contract`: the contract a Desk answers with (version 1): market, series, orders.
- `packages/perkos-client`: wallet sign-in to PerkOS, the desk catalogue, and a desk's market and series.

In progress: connecting a wallet and choosing a model on the landing page, then a dashboard where Sparky answers and helps pick a desk.

## Layout

```
apps/web                the client: screens and the local server
packages/ai             model providers: local first, cloud optional
packages/desk-contract  the contract a Desk fulfils
packages/perkos-client  typed client for api.perkos.xyz
```

Planned: `apps/desktop` (desktop window and packaging) and `packages/vault` (local notes and encrypted chats).

A package never imports from `apps/`, so any client can use them.

## Run it

Requirements: Node 22 or later, and npm. A local model is optional: [Ollama](https://ollama.com) on port 11434 or [LM Studio](https://lmstudio.ai) on port 1234.

```
npm install
npm run dev
```

Then open http://127.0.0.1:3100.

The local API accepts requests from this machine only. Set `PERKOS_API_TOKEN` to also require a per-launch token in the `x-perkos-token` header.

## Checks

```
npm run typecheck                          # packages
npm run typecheck -w @perkos/runtime-web   # the app
npm test
```

## License

MIT for the code. Marks and the Sparky mascot are excluded.
