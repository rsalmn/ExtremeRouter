# Capability Drift Audit

`npm run audit:capabilities` — read-only diagnostic that compares the
**hand-written** capability tables in `open-sse/providers/capabilities.js`
(`PROVIDER_CAPABILITIES`, `MODEL_CAPABILITIES`) against external sources of
truth and reports drift for **human review**. It never modifies source files
and nothing is ever auto-applied.

## Why hand-written entries are authoritative

The runtime resolves capabilities in strict precedence:

```
PROVIDER_CAPABILITIES (per-provider, hand-written)
  > MODEL_CAPABILITIES (canonical exact ids, hand-written)
  > PATTERN_CAPABILITIES (glob families)
  > DEFAULT_CAPABILITIES (safe floor)
```

The background models.dev sync (src/lib/modelCatalog) **only fills gaps** —
it never overrides a hand-written entry, on purpose: those entries exist to
correct cases where models.dev / gateway metadata are wrong. The trade-off is
that a hand-written entry can silently drift from reality. This tool is the
alarm for that failure mode (it originated from the bynara
`glm-5.3-flash-free` incident: table said 128K context, live catalog said
1M → token budget starved → `max_tokens: 0` on the wire → months of
production failures with zero warnings).

## Modes

### Offline (default) — no secrets needed

Compares against the models.dev catalog, using the runtime's normalized
snapshot (`DATA_DIR/model-catalog.json`) when present, otherwise
`https://models.dev/api.json` with a 24 h local cache (`.cache/`).

All offline findings are tagged **`LOW_CONFIDENCE_SOURCE`**: models.dev is a
weaker source than the hand-written tables, reseller records wildly disagree,
and provider entries are only ever compared against models.dev's record for
the SAME provider id. A provider that models.dev does not list at all
(bynara, tokenharbor, codebuddy, xbyNara, …) is a **normal outcome**, printed
once as an INFO line — use `--live` for those lanes.

```
npm run audit:capabilities                # full report, human-readable
npm run audit:capabilities -- --json      # machine-readable (CI artifact)
npm run audit:capabilities -- --provider=orcarouter
```

### Live — operator-run, per-gateway truth

Fetches each of the ~27 registry providers that declare a
`modelsFetcher.url` (their own `/v1/models`), authenticated ONLY by an env
key (`AUDIT_CAPS_<PROVIDER_ID>_KEY`, e.g. `AUDIT_CAPS_BYNARA_KEY`). Providers
without a configured key are **skipped**, never failed. Keys are never
logged or persisted. Responses are parsed with the same FILTERS the runtime
uses. Live findings carry real severity:

| Tag | Meaning | Action |
| --- | --- | --- |
| `MISMATCH` | table vs live differ beyond the 10 % tolerance (numbers) or at all (vision/reasoning booleans) | verify with a fresh capture, then correct the table |
| `STALE_KEY` | hand-written id no longer in the live list | likely retired/renamed — replace or remove after confirming |
| `MISSING_ENTRY` | live model has a concrete `context_window` but runtime resolves to the DEFAULT floor | consider a hand-written entry (the glm-5.3-free class of bug) |

```
AUDIT_CAPS_BYNARA_KEY=sk-... npm run audit:capabilities -- --live --provider=bynara
npm run audit:capabilities -- --live              # all 27 fetcher providers
npm run audit:capabilities -- --live --strict     # exit 1 on any real MISMATCH
```

`--strict` deliberately never trips on offline LOW_CONFIDENCE_SOURCE findings.

## CI

`.github/workflows/capability-drift.yml` runs the OFFLINE mode weekly
(Monday ~04:17 UTC) and on demand. It is advisory (`continue-on-error`),
uploads the text + JSON report as an artifact, and emits workflow annotations
— it never blocks merges, because models.dev is not authoritative and PRs
that change routing should not fail on third-party metadata. Live mode stays
manual: the keys belong to the operator, not the repo.

## Adding findings to the tables — the correct fix

Findings are leads, not instructions. When you confirm drift, edit
`open-sse/providers/capabilities.js` directly (and `pricing.js` if the same
id is priced), keep the surrounding comment documenting the source of truth
and date, and add/update a guard test in `tests/unit/` pinning the corrected
number — see the bynara drift-guard cases in `tests/unit/bynara-provider.test.js`.
