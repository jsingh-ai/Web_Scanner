# src/

Application code. Populated in later phases.

Planned layout:

- `server.js` — always-on Fastify dashboard (never launches a browser).
- `scan.js` — short-lived scan worker (launches Chromium, then exits).
- `scan/` — capture, deterministic checks, runner.
- `ai/` — provider-agnostic `judge()` + Anthropic/OpenAI implementations.
- `db/` — SQLite connection, schema, app CRUD, results.
- `storage/` — screenshot save + pruning.

See [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) and
[../docs/BUILD-RULES.md](../docs/BUILD-RULES.md).
