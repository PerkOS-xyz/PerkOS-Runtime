# Security

PerkOS is a desktop app that drafts on-chain trades for a human to sign. Reports that affect funds, keys, sessions or the local API get priority.

**Report privately.** Use GitHub's private vulnerability reporting on this repository ("Report a vulnerability" under the Security tab). Do not open a public issue with details. If private reporting is unavailable, open an issue titled "security" with no details and a maintainer will reach out.

**What to include.** Version (Settings › About shows version and build), steps to reproduce, impact, and whether it needs a page open in the browser, a local process, or network position.

**Scope notes.** The app runs a local HTTP server on 127.0.0.1 for its own window; it is gated by a per-launch token and origin checks. Keys and sessions live in `~/.perkos-xyz` with 0600 permissions. Nothing is signed or spent without the person holding the approval control in the app and confirming in their wallet.

We aim to acknowledge within 3 days and to ship a fix in a release before public disclosure.
