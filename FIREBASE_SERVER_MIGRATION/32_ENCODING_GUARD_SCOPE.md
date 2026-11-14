# 32 — Encoding guard scope, and a committed corruption it was blind to

Status: **done, verified, no production change.** Written 2026-11-14.

## 1. Why this exists

While drafting the batch-23d-4 bullet for `AGENTS.md`, a PowerShell
`Get-Content -Raw` → `[System.IO.File]::WriteAllText` round-trip decoded UTF-8
as cp1252 and re-encoded it, double-encoding every em dash, arrow and ₹ in the
bullet. The damage was caught by *reading the diff*, not by
`tests/encoding-check.mjs`, because:

* that guard only walks directories that are listed in `ROOTS` — `AGENTS.md`
  is a repo-root file and was scanned by nothing;
* `md` was not in its extension list at all, so no `.md` anywhere was scanned;
* `FIREBASE_SERVER_MIGRATION/` (where every investigation is recorded by
  mandate) was not in `ROOTS`.

The near-miss turned into a finding: `PROJECT_LEDGER.md`, the persistent
cross-session ledger, **had been sitting corrupted in the repository**. One
PowerShell save (most likely during a later post-2026-10-26 sweep edit) had
double-encoded 81 characters across 48 lines — em dashes in commit notes,
arrows in state transitions, ₹ in money figures, one circled ②, one ≤, one §,
one ellipsis — and prepended a UTF-8 BOM. The guard reported "encoding ok" the
whole time.

## 2. What the adoption scan covered

Run with the guard's full marker list before changing anything:

| scope | files | result |
|---|---|---|
| `FIREBASE_SERVER_MIGRATION/**` (source, tests, **and** `functions/lib`) | 150 | clean |
| `docs/**.md` | 66 | clean |
| repo-root `*.md` | 16 | `AGENTS.md` 2 hits, `PROJECT_LEDGER.md` 8 sequences / 81 hits + BOM, `Pending-Work.md` 1 hit |
| `menu/ Admin/ SupremeAdmin/ website/ rider-app/src/ shared/ bot/ bot-control-api/` | 440 incl. `.md` | clean apart from the two root docs |

The hits in `AGENTS.md` are **deliberate**: the file documents this guard
(`₹` → its double-encoded form) and the Costs `\uf8ff` range-bound bug (which
recorded that character's cp1252 reading). `Pending-Work.md` has one deliberate
hit of the same kind. Only `PROJECT_LEDGER.md` was actual corruption.

## 3. The repair

`PROJECT_LEDGER.md` was repaired with literal, round-trip-verified
replacements — no generic "decode everything" pass, which would have damaged
legitimate characters that cp1252 cannot represent (₹, emoji):

| sequence (cp1252 reading of the UTF-8 bytes) | replacement | count |
|---|---|---|
| em dash | `—` | 26 |
| rightwards arrow | `→` | 23 |
| rupee sign | `₹` | 21 |
| middle dot | `·` | 7 |
| circled two | `②` | 1 |
| less-than-or-equal | `≤` | 1 |
| section sign | `§` | 1 |
| ellipsis | `…` | 1 |

The BOM was removed. The arithmetic is exact: six three-character sequences
(26+23+21+1+1+1 = 73 occurrences) shrink by 2 each, the two two-character
sequences (7+1) shrink by 1 each, plus the BOM — 73×2 + 8 + 1 = **155
characters**, and the file went 156,253 → 156,098. Nothing else changed
(48 lines, same line endings, same content).

## 4. The guard change

`tests/encoding-check.mjs`:

* `ROOTS` gains `FIREBASE_SERVER_MIGRATION` and `docs`.
* `EXTS` gains `md`, so hand-written docs are covered.
* A new `FILES` list scans the two repo-root documents that no `ROOT` walk can
  reach: `AGENTS.md`, `PROJECT_LEDGER.md`.
* `DOC_QUOTE_EXEMPT` allows **exactly two markers, in `AGENTS.md` only** — the
  two deliberate documentation quotes above. Any other marker there, or either
  marker anywhere else, still fails.
* The per-file check was factored into one `check(file, txt)` used by both
  loops, so the two paths cannot drift.

**Deliberate decision: the build output is scanned.** `functions/lib` is what
`firebase deploy` uploads; if a corrupted string exists there it ships even
when `src/` is clean. A failure caused by stale output is fixed by
`npm run build`, never by editing `lib`.

## 5. Verification

| check | result |
|---|---|
| `node tests/encoding-check.mjs` (whole tree incl. the new scopes) | exit 0 |
| mutation: a `.md` under `FIREBASE_SERVER_MIGRATION/` containing a corrupted sequence | exit 1, names the file and the marker |
| mutation: the same file with a UTF-8 BOM | exit 1 |
| remove the file | exit 0 |
| repaired `PROJECT_LEDGER.md` rescan | 0 markers, 0 C1, 0 U+FFFD, no BOM |
| `npm run test:encoding` | already a CI step, so the new scope is gated |

No Firebase deploy, no rules change, no runtime file touched — the guard runs
in CI and on demand only.

## 6. Honest limits

* The marker list is empirical (the sequences this repo has actually produced).
  A cp1252 round-trip that yields a byte sequence outside it would not match a
  marker — but the structural checks (BOM, C1 controls, U+FFFD) still catch
  every round-trip that loses or re-encodes bytes, which is all of them.
* A future doc that deliberately quotes a corruption signature will fail the
  guard loudly and needs one precise `DOC_QUOTE_EXEMPT` entry. Failing loudly
  is the safe direction: this doc avoids literal corrupted sequences for that
  reason.
* `Pending-Work.md` (working notes with one deliberate quote) is not in
  `FILES`. If it becomes maintained documentation, add it with the same kind of
  exemption.
* `FIREBASE_SERVER_MIGRATION/functions/node_modules` is skipped by name, like
  every other `node_modules`.
