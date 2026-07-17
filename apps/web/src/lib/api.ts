import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

let refreshing: Promise<void> | null = null;
const queue: Array<() => void> = [];

// Auth endpoints that should never trigger the refresh-and-retry logic
const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/me'];

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const original = err.config;
    const url: string = original?.url ?? '';

    // Skip refresh logic for auth endpoints — just let them fail
    if (AUTH_ENDPOINTS.some((e) => url.includes(e))) {
      return Promise.reject(err);
    }

    if (err.response?.status === 401 && !original._retry) {
      original._retry = true;
      if (!refreshing) {
        refreshing = api
          .post('/auth/refresh')
          .then(() => { queue.forEach((r) => r()); queue.length = 0; })
          .catch(() => {
            queue.length = 0;
            // Dispatch an event so the app can react without a hard reload
            window.dispatchEvent(new CustomEvent('auth:expired'));
          })
          .finally(() => { refreshing = null; });
      }
      await new Promise<void>((res) => queue.push(res));
      return api(original);
    }
    return Promise.reject(err);
  },
);

export const auth = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }).then((r) => r.data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me').then((r) => r.data),
};

export const meta = {
  period: () => api.get('/meta/period').then((r) => r.data),
  periods: () => api.get('/meta/periods').then((r) => r.data),
  roleVariants: () => api.get('/meta/role-variants').then((r) => r.data),
};

export const executive = {
  summary: (periodId?: string) =>
    api.get('/executive/summary', { params: { periodId } }).then((r) => r.data),
};

export const financial = {
  get: (periodId?: string) =>
    api.get('/financial', { params: { periodId } }).then((r) => r.data),
};

export const operational = {
  get: (periodId?: string) =>
    api.get('/operational', { params: { periodId } }).then((r) => r.data),
};

export const strategic = {
  get: (periodId?: string) =>
    api.get('/strategic', { params: { periodId } }).then((r) => r.data),
};

export const humanCapital = {
  get: (periodId?: string) =>
    api.get('/human-capital', { params: { periodId } }).then((r) => r.data),
};

export const risk = {
  get: (periodId?: string) =>
    api.get('/risk', { params: { periodId } }).then((r) => r.data),
};

export const prosesBisnis = {
  get: (periodId?: string) =>
    api.get('/proses-bisnis', { params: { periodId } }).then((r) => r.data),
};

export const organisasi = {
  get: (periodId?: string) =>
    api.get('/organisasi', { params: { periodId } }).then((r) => r.data),
};

export const gcgEsg = {
  get: (periodId?: string) =>
    api.get('/gcg-esg', { params: { periodId } }).then((r) => r.data),
};

export const peta = {
  get: (periodId?: string) =>
    api.get('/peta', { params: { periodId } }).then((r) => r.data),
};

export const approvals = {
  reports: (periodId?: string) =>
    api.get('/approvals/reports', { params: { periodId } }).then((r) => r.data),
  advance: (id: string, note?: string) =>
    api.post(`/approvals/reports/${id}/advance`, { note }).then((r) => r.data),
  return: (id: string, note: string) =>
    api.post(`/approvals/reports/${id}/return`, { note }).then((r) => r.data),
};

export const workflowKm = {
  usulan: () => api.get('/workflow-km/usulan').then((r) => r.data),
  realisasi: () => api.get('/workflow-km/realisasi').then((r) => r.data),
  review: (docId: string, action: 'approve' | 'return', note?: string) =>
    api.post(`/workflow-km/${docId}/review`, { action, note }).then((r) => r.data),
};

export const inputRealisasi = {
  history: (unitCode?: string, periodId?: string) =>
    api.get('/input-realisasi/history', { params: { unitCode, periodId } }).then((r) => r.data),
  submit: (unitCode: string, bidang: string, values: Record<string, unknown>, checkerIds: string[], approverId: string, periodId?: string) =>
    api.put('/input-realisasi/submit', { unitCode, bidang, values, checkerIds, approverId, periodId }).then((r) => r.data),
  reviewList: () =>
    api.get('/input-realisasi/review/list').then((r) => r.data),
  reviewerCandidates: () =>
    api.get('/input-realisasi/reviewer-candidates').then((r) => r.data),
  review: (id: string, action: 'approve' | 'reject', note?: string, returnTo?: 'konseptor' | 'previous') =>
    api.post(`/input-realisasi/${id}/review`, { action, note, returnTo }).then((r) => r.data),
  updateValues: (id: string, values: Record<string, unknown>) =>
    api.patch(`/input-realisasi/${id}/values`, { values }).then((r) => r.data),
  delete: (id: string) =>
    api.delete(`/input-realisasi/${id}`).then((r) => r.data),
  bundle: (periodId?: string) =>
    api.get('/input-realisasi/bundle', { params: { periodId } }).then((r) => r.data),
  reviewBundle: (action: 'approve' | 'reject', note: string, periodId?: string) =>
    api.post('/input-realisasi/bundle/review', { action, note, periodId }).then((r) => r.data),
  uploadEvidence: (id: string, files: File[]) => {
    const form = new FormData();
    files.forEach((f) => form.append('files', f));
    return api.post(`/input-realisasi/${id}/evidence`, form).then((r) => r.data);
  },
  deleteEvidence: (id: string, fileId: string) =>
    api.delete(`/input-realisasi/${id}/evidence/${fileId}`).then((r) => r.data),
  evidenceUrl: (id: string, fileId: string) => `/api/input-realisasi/${id}/evidence/${fileId}`,
};

export const inputKontrak = {
  list: (unitCode?: string, periodId?: string, kmType?: 'draft' | 'final') =>
    api.get('/input-kontrak', { params: { unitCode, periodId, kmType } }).then((r) => r.data),
  getById: (id: string) =>
    api.get(`/input-kontrak/${id}`).then((r) => r.data),
  save: (
    unitCode: string,
    bidang: string,
    holder: string,
    kpiItems: Record<string, unknown>[],
    id?: string,
    kmType: 'draft' | 'final' = 'draft',
  ) =>
    api.post('/input-kontrak/save', { id, unitCode, bidang, holder, kpiItems, kmType }).then((r) => r.data),
  submit: (id: string, checkerIds: string[], approverId: string) =>
    api.post(`/input-kontrak/${id}/submit`, { checkerIds, approverId }).then((r) => r.data),
  delete: (id: string) =>
    api.delete(`/input-kontrak/${id}`).then((r) => r.data),
  reviewList: () =>
    api.get('/input-kontrak/review/list').then((r) => r.data),
  reviewerCandidates: () =>
    api.get('/input-kontrak/reviewer-candidates').then((r) => r.data),
  approved: (unitCode?: string, year?: string, kmType?: 'draft' | 'final') =>
    api.get('/input-kontrak/approved', { params: { unitCode, year, kmType } }).then((r) => r.data),
  review: (id: string, action: 'approve' | 'reject', note?: string, returnTo?: 'konseptor' | 'previous') =>
    api.post(`/input-kontrak/${id}/review`, { action, note, returnTo }).then((r) => r.data),
  bundle: (scope: 'KP' | 'UPMK' = 'KP', year?: string, kmType: 'draft' | 'final' = 'draft') =>
    api.get('/input-kontrak/bundle', { params: { scope, year, kmType } }).then((r) => r.data),
  reviewBundle: (scope: 'KP' | 'UPMK', action: 'approve' | 'reject', note: string, year?: string, kmType: 'draft' | 'final' = 'draft') =>
    api.post('/input-kontrak/bundle/review', { scope, action, note, year, kmType }).then((r) => r.data),
  updateValues: (id: string, kpiItems: Record<string, unknown>[]) =>
    api.patch(`/input-kontrak/${id}/values`, { kpiItems }).then((r) => r.data),
};

export type KpiAssignmentInput = {
  unitCode: string; bidang: string; holder?: string; bobotKm?: string; target?: string; target2?: string;
  persenAgregasi?: number;
};
export const kpiMaster = {
  list: (year?: string, kmType?: 'draft' | 'final') =>
    api.get('/kpi-master', { params: { year, kmType } }).then((r) => r.data),
  getById: (id: string) => api.get(`/kpi-master/${id}`).then((r) => r.data),
  save: (dto: {
    id?: string; kmType?: 'draft' | 'final'; indikator: string; formula?: string;
    satuan?: string; targetParent?: string; assignments: KpiAssignmentInput[];
    defaultCheckerIds?: string[]; defaultApproverId?: string;
    aggregationMethod?: 'weighted' | 'sum';
  }) => api.post('/kpi-master/save', dto).then((r) => r.data),
  delete: (id: string) => api.delete(`/kpi-master/${id}`).then((r) => r.data),
  rollup: (id: string, periodId?: string) =>
    api.get(`/kpi-master/${id}/rollup`, { params: { periodId } }).then((r) => r.data),
  reviewPerKpi: (periodId?: string) =>
    api.get('/kpi-master/review/per-kpi', { params: { periodId } }).then((r) => r.data),
  reviewConsolidation: (kpiMasterId: string, action: 'approve' | 'reject', note?: string, periodId?: string) =>
    api.post('/kpi-master/review/consolidation', { kpiMasterId, action, note, periodId }).then((r) => r.data),
  defaultsForKm: (kmId: string) =>
    api.get(`/kpi-master/defaults-for-km/${kmId}`).then((r) => r.data as { checkerIds: string[]; approverId: string | null }),
};

export const notifications = {
  list: () => api.get('/notifications').then((r) => r.data),
  markRead: (id: string) => api.post(`/notifications/${id}/read`),
  markAllRead: () => api.post('/notifications/read-all'),
};

export const audit = {
  logs: (page = 1, limit = 20) =>
    api.get('/audit', { params: { page, limit } }).then((r) => r.data),
};

export const kpi = {
  deepDive: (id: string) => api.get(`/kpi/deepdive/${id}`).then((r) => r.data),
};

export const kinerja = {
  rekap: (periodId?: string, mode?: string) =>
    api.get('/kinerja/rekap', { params: { periodId, mode } }).then((r) => r.data),
  latestPeriod: () =>
    api.get('/kinerja/latest-period').then((r) => r.data),
};

export const admin = {
  resetTestData: () => api.delete('/admin/reset-test-data').then((r) => r.data),
  togglePeriodWindow: (periodId: string, enabled: boolean) =>
    api.patch(`/admin/periods/${periodId}/window-override`, { enabled }).then((r) => r.data),
  setKmReference: (periodId: string, kmReference: 'draft' | 'final') =>
    api.patch(`/admin/periods/${periodId}/km-reference`, { kmReference }).then((r) => r.data),
  whatsappLogs: () => api.get('/admin/whatsapp-sim/logs').then((r) => r.data),
  whatsappPreview: (periodId: string) =>
    api.get('/admin/whatsapp-sim/preview', { params: { periodId } }).then((r) => r.data),
  whatsappRun: () => api.post('/admin/whatsapp-sim/run').then((r) => r.data),
  backfillKpiMasterPreview: () => api.get('/admin/backfill-kpi-master/preview').then((r) => r.data),
  backfillKpiMasterRun: () => api.post('/admin/backfill-kpi-master/run').then((r) => r.data),
};

export default api;
