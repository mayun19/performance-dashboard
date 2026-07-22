# Living-Target Workflow — Implementation Plan

> Companion to [`living-target-workflow.md`](./living-target-workflow.md). Order is
> dependency-first. Each phase is independently shippable and additive (nullable columns,
> new tables) so existing submitted/approved data is never disturbed.

## Guiding constraints

- **Additive migrations only.** New tables + nullable columns; no destructive changes to
  `InputRealisasi`, `KpiMaster`, `KpiAssignment`.
- **Backward compatible.** Existing review engine (`common/workflow-steps.ts`) and the
  `{checkerIds, approverId}` contract stay unchanged where possible.
- **Reuse before adding.** `kmReference`, `selfAssessment`/`values`, `KpiRollupReview`,
  `RealisasiBundle`, `AuditLog` already cover much of this (see design §9).

---

## Phase 1 — Schema: period targets, deadline, restatement provenance

New Prisma models / columns (`apps/api/prisma/schema.prisma`):

```prisma
// Per-period, per-assignment living target (KM Sementara instance).
model PeriodTarget {
  id              String   @id @default(cuid())
  periodId        String
  kpiAssignmentId String
  target          String   @default("")   // living target this period
  source          String   @default("fresh") // 'carried' | 'fresh'
  frozen          Boolean  @default(false) // true once the month closes / restated
  frozenTarget    String?                  // target-of-record captured at freeze
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([periodId, kpiAssignmentId])
  @@index([periodId])
  @@map("period_targets")
}

// Append-only revision log for symmetric audit (target + realisasi).
model RevisionLog {
  id        String   @id @default(cuid())
  entity    String   // 'period_target' | 'input_realisasi'
  targetId  String   // FK id of the revised row
  periodId  String
  actor     String
  actorId   String?
  field     String?  // e.g. 'target' | 'values'
  oldValue  Json?
  newValue  Json?
  note      String?
  createdAt DateTime @default(now())

  @@index([entity, targetId])
  @@index([periodId])
  @@map("revision_logs")
}
```

Additions to existing models:

- `Period`: add `deadline DateTime?` (monthly convergence deadline) and
  `restatedAt DateTime?` (set when KM Final restatement runs).
- `InputRealisasi`: add `targetOfRecord Json?` (snapshot of the targets used at freeze)
  and `packagePhase String @default("sementara")` (`sementara` | `final`).
- Snapshot models (`ExecutiveSnapshot`, `OperationalSnapshot`): add
  `phase String @default("sementara")` and `targetOfRecord Json?`. Relax `@@unique([periodId])`
  to `@@unique([periodId, phase])` so a period can hold both a live Sementara and a
  frozen Final snapshot.

Migration: `apps/api/prisma/migrations/<ts>_living_target/migration.sql` (additive).
**Backfill:** for the active period, create `PeriodTarget` rows from each
`KpiAssignment.target` with `source='fresh'`.

---

## Phase 2 — Package coupling & state machine

Files: `apps/api/src/input-realisasi/input-realisasi.service.ts`, `.controller.ts`,
`apps/api/src/common/workflow-steps.ts`.

1. **Bind target to the package.** On draft/submit, resolve the `PeriodTarget` for each
   `(period, assignment)` in the realisasi and attach it to the working set. The package
   = `InputRealisasi` + its `PeriodTarget`s for that `(unit, bidang, period)`.
2. **Ownership-routed return.** Extend the review action with a `returnKind`:
   - `realisasi` → return whole package to PIC (existing `returnTo: 'konseptor'`).
   - `target` → route to **PIC REN**: set a `targetFix` state, notify PIC REN, and on
     their correction, re-enter at the **PIC draft** (re-validate), then full re-flow.
   Reuse `stepMatches` / `stepRecipientWhere` for PIC REN resolution.
3. **Deadline circuit-breaker.** A scheduled/endpoint check: at `Period.deadline`, for any
   package not yet ready, freeze using PIC REN's current `PeriodTarget.target` as
   target-of-record; mark package `ready` (forced) with an audit note.
4. **All-or-nothing freeze guard.** GM freeze (`reviewBundle`) only proceeds when every
   contributor package for the period is `ready` (or deadline-forced).

Write a `RevisionLog` row on every target edit and every realisasi working-copy edit
(§Phase 5 wires this in fully).

---

## Phase 3 — Snapshots, rollup & restatement

Files: `apps/api/src/executive/executive.service.ts`,
`apps/api/src/operational/operational.service.ts`, plus a new
`apps/api/src/common/restatement.service.ts`.

1. **Two-track compute.** `refreshFromRealisasi(periodId)` computes **both**:
   - UPMK track from `selfAssessment`
   - KI track from `values`
   against each package's target-of-record, weighted by `bobot` / `persenAgregasi`
   (respecting `KpiMaster.aggregationMethod`). Store both tracks in the snapshot `data`.
2. **Provisional snapshot** (phase=`sementara`): recompute on every relevant change;
   overwrite in place. Badge as provisional.
3. **Rollup review.** Feed `KpiRollupReview` per `(kpiMasterId, period)` from the KI-track
   aggregate; freeze `nilaiParent` on approval.
4. **Restatement** (`restatement.service.ts`): triggered when `Period.kmReference` flips
   `draft → final`. For every prior period up to and including this one:
   - Load `PeriodTarget` frozen values → replace with KM Final targets.
   - Recompute both tracks' _capaian_ against KM Final.
   - Write **immutable** snapshots (phase=`final`) with `targetOfRecord = KM Final`.
   - Set `Period.restatedAt`.
   Actuals (`values`, `selfAssessment`) are untouched; only scores restate.

---

## Phase 4 — Frontend: two-track dashboards & package UI

Files: `apps/web/src/pages/ExecutivePage.tsx`, `OperationalPage.tsx`,
`InputRealisasiPage.tsx`, `ApprovalsPage.tsx`, `apps/web/src/lib/{api,types}.ts`.

1. **Dashboards default to Final**, with a **Sementara (provisional)** toggle. When
   showing Sementara, render a clear "provisional" badge.
2. **Two metrics side by side** at every level: **UPMK Version** vs **KI Adjusted
   Version**, with the divergence highlighted (reuse the existing self-assessment-gap UI).
3. **Package view** in `InputRealisasiPage`: show the living KM Sementara target next to
   the realisasi input; carry-forward vs fresh-input choice for the month's target.
4. **Approvals**: add the target-issue vs realisasi-issue return choice; surface the
   "target changed since you approved" soft-flag on already-Ready siblings.

---

## Phase 5 — Symmetric audit

- Wire `RevisionLog` writes into both target edits (PIC REN) and realisasi working-copy
  edits (KI review) throughout Phase 2/3 services.
- Expose a per-package revision-history endpoint + a timeline in the package UI.
- Keep `InputRealisasi.history` for step-level events; `RevisionLog` for value-level diffs.

---

## Phase 6 — Migration, backfill & tests

- **Backfill** current period `PeriodTarget`s from `KpiAssignment.target`; set existing
  snapshots to phase=`sementara`.
- **E2E (backend):** monthly cycle → provisional snapshot; target-issue bounce → PIC REN →
  re-validate → re-flow; deadline force-freeze; KM Final flip → restatement recomputes
  prior months; two-track aggregation correctness.
- **Edge cases:** carry-forward vs fresh target seeding across months; all-or-nothing
  freeze blocked by one straggler then released at deadline; K3L/MRO bidang without
  SRMANAJER (existing reviewer fallback still holds).

---

## Sequencing summary

| Phase | Deliverable | Depends on |
|-------|-------------|-----------|
| 1 | Schema: `PeriodTarget`, `RevisionLog`, phase/target-of-record cols | — |
| 2 | Package coupling + ownership routing + deadline | 1 |
| 3 | Two-track compute + restatement | 1, 2 |
| 4 | Dashboards & package UI | 3 |
| 5 | Symmetric audit surfacing | 2, 3 |
| 6 | Backfill & tests | all |
