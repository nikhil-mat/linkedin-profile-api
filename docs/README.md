# Documentation

Two entry points, by audience:

- **[`../README.md`](../README.md)** — for a human: what this is, how to run it, coverage.
- **[`../ai_context_mini.md`](../ai_context_mini.md)** — for an agent picking the project up
  cold: the safety rules, auth, the one call, the trap table, and a map of everything else.

| file | what is in it |
|---|---|
| [API.md](API.md) | The API: auth, the one call, parsing traps, pagination, hash rotation, and which reference repo snapshots which client. Points into `refs/` rather than restating it. |
| [OPERATIONS.md](OPERATIONS.md) | What it costs and how to keep it working: failure signals, silent throttling, measured rate limits, five real incidents, and the maintenance runbook for rotating hashes. |
| [BUILD.md](BUILD.md) | What we built: architecture, the two rate limiters, coverage, every bug and what caught it — plus the full request/response contract. |
| [SCHEMA.md](SCHEMA.md) | Every field in `src/schema.mjs`, how it is filled, and its source path in the payload. The schema module is the source of truth; this is the prose for it. |
| [TESTING.md](TESTING.md) | The five fixtures, exact expected counts, and how to verify them in a browser. |
| [EGRESS.md](EGRESS.md) | Routing Worker egress through a Tailscale node, when residential egress is needed. |
| [archive/](archive/) | Superseded working notes. **Contains disproved conclusions** — provenance only. |
