# PerkOS Runtime

The app where Desks run.

A **Desk** is a solution: its own market, its own team of agents, its own screens. PerkOS Floor (tokenized stocks on Base) was the first one; EQLTY (Robinhood Chain) is the second. Runtime is what they run inside.

Runtime brings the window, the account, Sparky and the voice, the local knowledge, the screens every desk shares, a model that can run on your own machine, and the client for the PerkOS services. It does not know what a stock is, which venue quotes it, or how an order is routed. That belongs to a Desk.

## Layout

```
apps/desktop            Electron shell: window, per launch token, packaging
apps/web                the client: screens and the local server
packages/desk-contract  the contract a Desk fulfils
packages/perkos-client  typed client for api.perkos.xyz
packages/ai             model providers: local first, cloud optional
packages/vault          local storage: notes and encrypted chats
```

A package never imports from `apps/`: a web client has to be able to use them without Electron.

## Development

Node 22.

```
npm install
npm run typecheck
npm test
```

## License

MIT for the code. Marks and the Sparky mascot are excluded.
