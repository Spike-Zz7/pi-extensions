# Security Policy

## Reporting a vulnerability

Please report security issues privately via GitHub's
[security advisories](https://github.com/Sarrius/pi-multi-account/security/advisories/new)
rather than opening a public issue.

## Handling of credentials

pi-multi-account reads authenticated accounts from `~/.pi/agent/auth.json` but
**never** stores, logs, or transmits raw credentials:

- Only SHA-256 fingerprints (first 12 hex chars) of tokens/keys are kept, to
  detect re-login and dedupe accounts.
- Its config and state files are written with `0600` permissions.

When reporting an issue, never include tokens, API keys, or the contents of
`auth.json`.
