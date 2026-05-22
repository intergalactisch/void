# Security Policy

## Supported versions

Void is pre-1.0. Only the latest released version receives security fixes.

| Version | Supported |
|---------|-----------|
| latest  | yes       |
| older   | no — please upgrade |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Use GitHub's [private vulnerability reporting](https://github.com/intergalactisch/void/security/advisories/new). The advisory is visible only to repository maintainers until it is published. Include:

- A clear description of the issue and its impact.
- Reproduction steps or a proof of concept.
- Affected version (run Void → menu bar icon → About, or check `package.json`).
- Your name / handle if you'd like to be credited in the fix.

We will:

- Acknowledge receipt within **48 hours**.
- Confirm or dispute the report within **7 days**.
- Aim to ship a fix and release notes within **90 days**, depending on severity and complexity.
- Credit you in the release notes unless you ask us not to.

If a report is severe enough to warrant a coordinated release, we'll agree on disclosure timing with you before going public.

## Current security posture

Void is a desktop app that reads and writes local Markdown files and shells out to AI CLIs. The hardening already in place:

- **SSRF guards** on `web_fetch` — DNS resolution + private/loopback/cloud-metadata blocklists, re-validated on every redirect.
- **Path validation** on every file-system Tauri command — symlink-resolving canonicalisation, parent-traversal rejection, sensitive-directory blocklist.
- **Tightened Content Security Policy** — `object-src 'none'`, `frame-ancestors 'none'`, scoped `img-src`, `connect-src`, `font-src`.
- **URL scheme allowlist** on `openUrl` — only `http:`, `https:`, `mailto:`. No `javascript:`, `file:`, or `data:` URIs.
- **Concurrent-process cap** on spawned CLI children, plus an allowlist on binary names.
- **Credentials in the macOS Keychain** via the `keyring` crate — never plain files or localStorage.
- **Restricted GitHub contribution surface** — public PR creation is disabled, Actions use read-only default tokens, Actions cannot create or approve PRs, and CI refuses to execute code from forked PRs.
- **No telemetry**. Void does not phone home.

For details on what the Tauri side exposes, see `src-tauri/capabilities/default.json` and `src-tauri/src/commands/`.

## Scope

In scope:

- Code execution / privilege escalation through any Tauri command, including injection, traversal, deserialisation, or unsafe defaults.
- Data exfiltration through XSS, prompt injection of stored notes, or supply chain.
- Auto-update tampering.

Out of scope:

- Social-engineering attacks that require a user to disable macOS Gatekeeper, install a tampered DMG from outside our release page, or paste hostile content into their notes intentionally.
- Issues that depend on root-level write access to `/usr/local/bin` or similar (the attacker already owns the machine).
- Theoretical issues without a working proof of concept.

Thanks for keeping Void's users safe.
