# Contributing to Void

Thanks for thinking about contributing. Void is a small, opinionated project — clear contributions and small PRs land fastest.

## Prerequisites

- **macOS 12+** (Void targets macOS exclusively right now).
- **Node 20+** — `node --version`.
- **Rust 1.80+** with `cargo` on PATH — install via [rustup](https://rustup.rs/).
- **Xcode Command Line Tools** — `xcode-select --install`.

## Dev setup

```bash
git clone https://github.com/intergalactisch/void.git
cd void
npm install
npm run tauri dev
```

The Tauri dev shell will pull Rust deps on first run (5–10 min). Subsequent launches are fast.

For browser-only iteration (no Tauri shell, mock adapters):

```bash
npm run dev
```

To produce and install a local build into `/Applications`:

```bash
npm run tauri:install
```

## Architecture in 5 lines

Void uses **hexagonal architecture** (ports & adapters). Pure domain types live in `src/lib/domain/`. They are wrapped by application services in `src/lib/application/services/`. Services depend on **inbound ports** (what the UI calls) and **outbound ports** (what infrastructure provides). Tauri/Rust implementations live in `src/lib/adapters/tauri/`; in-memory test doubles in `src/lib/adapters/memory/`. Everything is wired together in `src/lib/bootstrap.ts` — the single composition root.

Read [AGENTS.md](AGENTS.md) for the full architecture guide, including the Artifact System (`.void/` sidecar), event bus, and DI container.

## Adding a feature

Mirror the existing pattern step by step:

1. **Domain entity / value object** in `src/lib/domain/` (no external deps).
2. **Outbound port** in `src/lib/ports/outbound/` — interface for whatever infrastructure you need.
3. **Inbound port** in `src/lib/ports/inbound/` — interface the UI calls.
4. **Adapters** in `src/lib/adapters/tauri/` (and `src/lib/adapters/memory/` for tests).
5. **Service implementation** in `src/lib/application/services/`.
6. **Bootstrap registration** in `src/lib/bootstrap.ts`.
7. **Store / component** in `src/lib/stores/` or `src/lib/components/`.

Cross-cutting Rust commands go in `src-tauri/src/commands/`.

## Conventions

- All fallible operations return `Result<T, Error>` from `$lib/core`. Never throw.
- Interfaces and implementations are PascalCase (`SettingsService.ts`, `SettingsServiceImpl.ts`).
- Adapters carry the infrastructure as a prefix (`TauriSettingsAdapter.ts`).
- Svelte stores are `lowercase.svelte.ts`.
- Default to no comments. Add one only when the *why* is non-obvious.
- No `{@html}` on untrusted strings — route through the markdown-it renderer with `html: false`.
- All new Tauri commands run user input through `validate_path()` in `src-tauri/src/commands/files.rs`.

## Tests

```bash
npm run check       # svelte-check (TypeScript)
npm run test:run    # vitest unit + integration
npm run test:e2e    # playwright (slower)
npm run test:rust   # cargo check
npm run test:all    # all of the above
```

Cargo unit tests:

```bash
cd src-tauri && cargo test
```

A green `npm run test:all` plus `cd src-tauri && cargo test` is the minimum bar for a PR.

## PR workflow

1. Branch from `main`: `git switch -c feat/your-feature` (or `fix/...`, `docs/...`).
2. Write tests alongside the code. Memory adapters make this cheap.
3. Use **Conventional Commits** for the commit subject:
   - `feat:` new behavior.
   - `fix:` bug fix.
   - `docs:` documentation only.
   - `refactor:` no behavior change.
   - `chore:` tooling, deps, CI.
   - `test:` test-only.
4. Add a line under `[Unreleased]` in `CHANGELOG.md`.
5. Open a PR with a 1–3 sentence summary + the issue it closes. Keep one concern per PR.

CI runs `npm run check`, `npm run test:run`, `cargo check`, and `cargo clippy -- -D warnings`. Anything red blocks merge.

## Release signing keys

Void's auto-updater verifies update bundles against a minisign public key embedded in the app at build time (`src-tauri/tauri.conf.json` → `plugins.updater.pubkey`). Building a release locally (`npm run tauri:install`) or via the `Release` workflow requires the matching private key in environment variables.

### Maintainers (publishing official releases)

Tauri's `TAURI_SIGNING_PRIVATE_KEY` env var accepts the key in one of two forms — both work:

- **Raw multi-line file contents** (what `tauri signer generate` writes):
  ```
  untrusted comment: rsign encrypted secret key
  RWRTY0Iy…==
  ```
- **Single-line base64 encoding** of those contents (what most secrets managers store cleanly).

Store the key + password in a secrets manager — never in the repo, never as plaintext on disk, never in shell history. Then on each new machine:

```bash
npm run setup:signing
```

The script asks where the key lives (1Password CLI, paste, or manual), detects which form the value is in, and writes an idempotent block to your shell rc that exports the right env var. Re-running detects the existing block and prompts to replace it.

Source the rc (or open a new shell), then `npm run tauri:install` and the `Release` workflow both sign with the key.

**CI** publishes via tagged push (`.github/workflows/release.yml`) using GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. CI takes either form too — store whichever you have, no encoding dance needed:

```bash
# Whatever's in 1Password (raw or base64), push it through verbatim:
op read 'op://Private/Void Tauri Signing/key'      | gh secret set TAURI_SIGNING_PRIVATE_KEY
op read 'op://Private/Void Tauri Signing/password' | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD

# Or from a file on disk:
gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/void.key
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body '<password>'
```

Rotating the key permanently breaks auto-update for already-installed builds (their embedded pubkey no longer matches new signatures). Reserve rotation for genuine compromise or when the key is truly unrecoverable.

### Forks (publishing your own builds)

GitHub does not pass parent-repo secrets to forks. To run the `Release` workflow on your fork, either:

1. **Sign with your own keypair** — generate one, point your fork at it:
   ```bash
   npm run tauri -- signer generate -w ~/.tauri/<your-fork>.key
   base64 -i ~/.tauri/<your-fork>.key | gh secret set TAURI_SIGNING_PRIVATE_KEY
   gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --body '<password you set>'
   ```
   Then update `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` with **your** public key (`cat ~/.tauri/<your-fork>.key.pub`). Push a tag.

2. **Disable auto-update entirely** — if your fork doesn't need the in-app updater, set `plugins.updater.active: false` in `tauri.conf.json` and the signing requirement disappears.

Without one of the above, the `Release` workflow fails fast with a clear error.

## Good first issues

Browse open issues with the [`good first issue`](https://github.com/intergalactisch/void/issues?q=is:open+label:%22good+first+issue%22) label. If a topic interests you and there's no issue yet, open one before sinking time into a PR — it saves churn.

## Reporting bugs and asking questions

- **Bug?** Open a [bug report](https://github.com/intergalactisch/void/issues/new?template=bug_report.yml).
- **Feature idea?** Open a [feature request](https://github.com/intergalactisch/void/issues/new?template=feature_request.yml).
- **Question / unsure?** Use [Discussions](https://github.com/intergalactisch/void/discussions).
- **Security issue?** Read [SECURITY.md](SECURITY.md) — email, do not file a public issue.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
