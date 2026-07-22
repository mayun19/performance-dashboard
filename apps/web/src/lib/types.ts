export type Role = 'STAFF' | 'ASMAN' | 'MANAJER' | 'SRMANAJER' | 'GM' | 'SUPERADMIN' | 'DEVELOPER';

export interface RoleVariant {
  id: string;
  code: string;
  label: string;
  tier: Role;
  scope: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  unit: string;
  bidang?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  roleVariantId?: string | null;
  roleVariant?: RoleVariant | null;
}

export interface FillWindow {
  start: string;
  end: string;
  isOpen: boolean;
  overrideActive: boolean;
  daysUntilClose: number;
  daysUntilOpen: number;
}

export interface Period {
  id: string;
  yearMonth: string;
  label: string;
  isActive: boolean;
  fillWindow?: FillWindow;
  windowOverride?: boolean;
  overrideBy?: string | null;
  overrideAt?: string | null;
  kmReference?: 'draft' | 'final';
}

export interface Kpi {
  id: string;
  label: string;
  name?: string;
  value: number;
  formatted?: string;
  delta?: number;
  deltaUnit?: string;
  icon?: string;
  sparkline?: number[];
  target?: number;
  actual?: number;
  bobot?: number;
  nilai?: number;
  achievement?: number;
  satuan?: string;
  unit?: string;
  bidang?: string;
  category?: string;
  polarity?: string;
  status?: string;
}

export interface HealthScore {
  value: number;
  target: number;
  previous: number;
  label: string;
  delta: number;
  status: string;
}

export interface UnitRanking {
  code: string;
  name?: string;
  unit?: string;
  score: number;
  status: string;
  projects: number;
  criticalKpi: string;
}

export interface Initiative {
  id: string;
  name: string;
  owner: string;
  status: string;
  progress: number;
  dueDate: string;
}

export interface Alert {
  type: string;
  title: string;
  timestamp: string;
  route: string;
  action: string;
  targetId: string;
}

export interface ExecutiveData {
  healthScore: HealthScore;
  kpis: Kpi[];
  capacityAddition: Record<string, unknown>;
  unitRanking: UnitRanking[];
  unitTrend: Record<string, number[]>;
  initiatives: Initiative[];
  alerts: Alert[];
  efficiency: { value: number; target: number; label: string };
  csat: { value: number; max: number; responses: number; label: string; isInverse: boolean };
  safety: { value: number; target: number; isInverse: boolean; label: string; unit: string };
  selfAssessmentAccuracy?: { avgGap: number; unitsWithData: number; status: string };
  // Living-target dua-track: UPMK Version (self-reported) di samping KI Adjusted (unitRanking/healthScore).
  upmkTrack?: { overall: number; unitScores: Array<{ code: string; score: number }> };
}

export interface Report {
  id: string;
  unit: string;
  periodId: string;
  currentStage: number;
  status: 'DRAFT' | 'IN_REVIEW' | 'NEEDS_REVISION' | 'APPROVED';
  nextApprover?: string;
  history: HistoryEntry[];
  canApprove?: boolean;
}

export interface HistoryEntry {
  stage: number;
  actor: string;
  role: string;
  action: string;
  note?: string;
  ts: string;
}

export interface KMDocument {
  id: string;
  docId: string;
  tipe: 'WF1' | 'WF1B' | 'WF2' | 'WF3';
  bidangUnit: string;
  holder: string;
  status: 'IN_REVIEW_C1' | 'IN_REVIEW_C2' | 'IN_REVIEW_SM' | 'APPROVED' | 'SIGNED_GM' | 'RETURNED' | 'OVERDUE' | 'DRAFT';
  deadline?: string;
  slaRemain?: number;
  reviews: KMReview[];
}

export interface KMReview {
  id: string;
  docId: string;
  actor: string;
  action: string;
  note?: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  msg: string;
  route?: string;
  unread: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actor: string;
  action: string;
  entity?: string;
  targetId?: string;
  note?: string;
  createdAt: string;
}

export interface RiskItem {
  id: string;
  desc: string;
  cat: string;
  category?: string;
  unit: string;
  likelihood: number;
  impact: number;
  owner: string;
  status: string;
  mitigation: string;
  mitigationPct: number;
  dueDate: string;
}

export interface RealisasiKinerja {
  id: string;
  periodId: string;
  unitCode: string;
  submitter: string;
  submitterId?: string | null;
  values: Record<string, { indikator?: string; target?: string | number; realisasi?: string | number; satuan?: string; bobot?: string | number; masterKpiId?: string }>;
  status: 'draft' | 'submitted' | 'target_fix' | 'ready' | 'approved' | 'rejected';
  currentStage: number;
  reviewer?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  submittedAt: string;
  updatedAt: string;
}

export interface KontrakManajemen {
  id: string;
  periodId: string;
  unitCode: string;
  bidang: string;
  holder: string;
  kpiItems: Record<string, unknown>[];
  status: 'draft' | 'submitted' | 'ready' | 'approved' | 'rejected';
  kmType: 'draft' | 'final';
  currentStage: number;
  history?: Array<Record<string, unknown>>;
  submitter: string;
  submitterId?: string | null;
  reviewer?: string | null;
  reviewNote?: string | null;
  reviewedAt?: string | null;
  submittedAt: string;
  updatedAt: string;
}
