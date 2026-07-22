# Living-Target Performance Workflow — Design

> Status: **Design agreed** (pressure-tested). Not yet implemented.
> Companion: [`living-target-implementation-plan.md`](./living-target-implementation-plan.md)

## 1. Motivation

The authoritative KPI target ("KM Final") is set by the **top holding** and released
around **May/June each year**, in a board process that happens **outside this system**.
Units cannot wait until then to start measuring — they must record achievement from
January. So the business needs a **living (provisional) target**, called **KM Sementara**,
that units work against during the waiting period, alongside a **Realisasi Sementara**
(provisional actuals). When KM Final finally lands, everything is reconciled against it.

This is the core value of the app: **it must operate on a target that is still moving.**

## 2. Core concepts

| Term | Meaning |
|------|---------|
| **KM Sementara** | The living, provisional target for the current period. Editable in-cycle. |
| **KM Final** | The authoritative target from the top holding (external, ~May/June). Freezes the denominator. |
| **Realisasi Sementara** | Provisional actuals recorded monthly during the waiting period. |
| **Package** | KM Sementara + Realisasi for one `(unit, bidang, period)`, reviewed **together** as one unit. |
| **UPMK Version** | The value as self-reported by the reporting unit. |
| **KI Adjusted Version** | Kantor Induk's own judgement after review, decided by **REN PIC** (the performance warden). May equal or differ from the UPMK value. |
| **REN PIC** | PIC Perencanaan — the warden/authority for performance achievement. Owns targets and drives adjustments. |
| **Restatement** | On KM Final arrival, recompute all prior provisional months against the real target and write immutable snapshots. |

## 3. Annual cycle

```
 Jan ─────────── waiting period ─────────────►  KM Final arrives      Final phase
 [ KM Sementara, monthly ]                       (from holding,        [ fixed target,
   Realisasi Sementara                            ~May/June)             immutable ]
   → provisional snapshot each month                    │
                                                        ▼
                                                  RESTATEMENT
                                        (recompute all prior months
                                         against KM Final; freeze)
```

- **Monthly cadence.** Each month runs its own package cycle producing a **provisional
  snapshot**. Realisasi is input per month; KM Sementara per month is either **carried
  forward** from the prior month's frozen value or **freshly input** if it changed.
- **KM Final is an external event.** In the system it is represented by flipping the
  period's `kmReference` from `draft` (Sementara) to `final` and entering the final
  targets. That flip triggers **restatement**.
- **Restatement recomputes _capaian_, not actuals.** Realisasi values stay; only the
  denominator (target) changes, so scores are recomputed and frozen.

## 4. Package state machine

KM Sementara and Realisasi travel together as **one package** through one review chain
(not two serial flows like the legacy design).

```
        ┌────────────── corrected — re-validate ──────────────┐
        ▼                                                      │
   Draft (PIC) ──submit──► Under review ──pass──► Ready ──GM──► Approved (provisional)
        ▲                  (Checker → Approver,     │              │
        │                   serial)                 │              ▼
        │                     │   │                  │        (monthly provisional
        │   realisasi issue   │   │ target issue     │         snapshot written)
        └─────────────────────┘   └──► Target fix (PIC REN)
        ▲                                            │
        └──────────── GM reject ─────────────────────┘
```

**Rules:**
- **Whole-package bounce.** Any return sends the entire package back to draft — never a
  partial unlock.
- **Ownership routing.** A realisasi problem returns to the **PIC**; a target problem
  returns to **PIC REN**. After PIC REN corrects the target, the package lands back at
  the **PIC** first (not straight into review) because the new target changes _capaian_
  and the PIC must re-validate realisasi before re-submitting.
- **Serial review**, not parallel reviewers. "Parallel" only means the two documents
  (KM Sementara + Realisasi) travel together.
- **Provisional approval.** "Approved" during the Sementara phase is provisional status,
  not a locked score. Authoritative scores exist only after restatement.

### Circuit-breaker (deadline)

The target-correction loop is intentionally allowed, bounded by a **monthly deadline**.
If parties have not converged by the deadline, the freeze is deterministic:

> **At the deadline, PIC REN's current target-of-record wins**, realisasi freezes as-is,
> and the month closes. (Consistent with PIC REN being the warden.)

### Freeze semantics

- **All-or-nothing.** A period's monthly freeze requires **all** contributor packages
  ready. One stuck package blocks the freeze — the deadline above is the sole escape.

## 5. Value model — two tracks

The **aggregation formula is unchanged**. What splits into two is the **source** of each
number:

- **UPMK Version** — value input by the reporting unit (self-reported).
- **KI Adjusted Version** — Kantor Induk's own judgement after reviewing the UPMK value,
  decided by REN PIC. May equal or differ.

Both tracks run through the **same** rollup (`Σ child × persenAgregasi/100`), so at every
level — per-unit and rolled-up parent — there is a UPMK figure and a KI figure. The
dashboard shows the two **side by side**; divergence is REN PIC's adjustment made visible.

This is already partially modelled: `InputRealisasi.selfAssessment` is the locked UPMK
version; `InputRealisasi.values` is the KI-adjustable working copy.

## 6. Snapshots

Two snapshot kinds, which must never be confused:

| Kind | Mutability | Purpose |
|------|-----------|---------|
| **Sementara** | Mutable — recomputed whenever a target or realisasi moves. Overwrites itself. | Live projection. **Badged "provisional"** everywhere. Not an audit record. |
| **Final** | Immutable — written once at restatement. | Record of truth for trends. |

**Every snapshot records the target-of-record it was computed against** (the Sementara
target, or KM Final). This is mandatory — it is the only way trend lines across periods
with different denominators remain interpretable, and it makes restatement auditable.

Dashboards **default to the latest authoritative (Final)** view, with the live Sementara
projection behind a clearly-marked toggle.

## 7. Versioning lanes (avoid collision)

Two mechanisms for "target changes over time" must stay in separate lanes:

- **`KpiMaster.effectiveMonth` / `version`** — reserved for **structural redefinition**
  of a KPI (new indikator, formula, aggregation method, parent default). Fires for the
  *next* period, never the current one.
- **Monthly KM Sementara input** — routine **per-month operational target** movement.
  Does **not** create a version.

## 8. Decisions ledger

Every ruling from the design pressure-test, for the record:

1. Package = KM Sementara + Realisasi together (parallel = travel together, not parallel reviewers).
2. KM Final is external (holding, ~May/June); represented by `kmReference: draft → final`.
3. KM Final arrival → **retroactive restatement** of all prior months.
4. Whole-package bounce on any return.
5. Ownership routing: realisasi → PIC; target → PIC REN → back to PIC to re-validate.
6. Monthly cadence; KM Sementara carried-forward or freshly input per month.
7. All-or-nothing freeze; deadline is the circuit-breaker (PIC REN target-of-record wins).
8. Two snapshot kinds (Sementara mutable / Final immutable); each records target-of-record.
9. Two value tracks (UPMK / KI Adjusted) through the same aggregation; shown side by side.
10. Symmetric append-only audit on both target and realisasi revisions.
11. `effectiveMonth` versioning reserved for structural redefinition only.

## 9. What already exists (reuse)

- `Period.kmReference` (`draft`|`final`) + GM/Admin override → phase flag & KM Final flip.
- `InputRealisasi.selfAssessment` (locked UPMK) vs `values` (KI-adjustable) → two tracks.
- `InputRealisasi.steps` / `currentStepIndex` + `common/workflow-steps.ts` → review engine
  (already supports person-specific routing needed for PIC/PIC REN).
- `KpiRollupReview.nilaiParent` → frozen aggregate per (KPI, period).
- `RealisasiBundle` (per period) → all-or-nothing GM freeze.
- `AuditLog` + `InputRealisasi.history` → audit trail substrate.
- `KpiMaster` versioning (`effectiveMonth`, `version`, `previousVersionId`).

## 10. Open / future

- Real WhatsApp/SLA reminders tied to the monthly deadline (currently simulated in `whatsapp`).
- UI affordance for the "target changed since you approved" soft-flag on already-Ready siblings.
