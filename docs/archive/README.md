# Archive — superseded working notes

Kept for provenance. **Most of this contains conclusions that were later disproved** — do not
use it as reference.

⚠️ **One exception:** `07-RSC-FLIGHT-DECODING.md` is superseded as the primary architecture but
still documents the React Flight decoder that `enrich=counts` **ships and depends on** — it is
the only way to read follower/connection counts. Treat that file as live documentation. Current position: [README.md](../../README.md).

| file | what it was | why it is here |
|---|---|---|
| `TRANSFER.md` | the original handoff brief | its core assumption — that `rsc-action` POSTs carry the profile — was disproved on day one |
| `LINKEDIN_PROFILE_API_RESEARCH.md` | first research pass | superseded by `LEARNED-01-API.md` |
| `07-RSC-FLIGHT-DECODING.md` | the React Flight decoder | superseded as architecture, but **still live** for `enrich=counts` |
| `01-BACKEND-MODEL.md` | first model of the backend | broadly right, but the graph arrives in ONE decorated call, not lazy per-section fetches |
| `02-REPOSITORY-AUDIT.md` | audit of the 8 reference repos | verdict still holds and got stronger; detail lives in `LEARNED-03` §5 |
| `03-FIELD-EVIDENCE.md` | early field map | superseded by `12-COVERAGE.md` |
| `04-LOCAL-PROBE.md` | advised AGAINST browserless as a first test | **fully overturned** — browserless is the only viable transport |
| `05-DECISIONS-AND-OPEN-QUESTIONS.md` | early decisions | **both were reversed** |
| `06-CORRECTIONS-AND-CONFIRMED-LIVE-FINDINGS.md` | first correction round | its own architecture (React Flight) was superseded the same day |

The reference repos themselves are in `refs/` and remain the better source for anything
historical.
