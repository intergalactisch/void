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

## Good first issues

Browse open issues with the [`good first issue`](https://github.com/intergalactisch/void/issues?q=is:open+label:%22good+first+issue%22) label. If a topic interests you and there's no issue yet, open one before sinking time into a PR — it saves churn.

## Reporting bugs and asking questions

- **Bug?** Open a [bug report](https://github.com/intergalactisch/void/issues/new?template=bug_report.yml).
- **Feature idea?** Open a [feature request](https://github.com/intergalactisch/void/issues/new?template=feature_request.yml).
- **Question / unsure?** Use [Discussions](https://github.com/intergalactisch/void/discussions).
- **Security issue?** Read [SECURITY.md](SECURITY.md) — email, do not file a public issue.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
