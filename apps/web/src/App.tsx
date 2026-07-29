import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { Protected } from './components/Protected';
import { LoginPage } from './pages/LoginPage';
import { ExecutivePage } from './pages/ExecutivePage';
import { FinancialPage } from './pages/FinancialPage';
import { OperationalPage } from './pages/OperationalPage';
import { StrategicPage } from './pages/StrategicPage';
import { HumanCapitalPage } from './pages/HumanCapitalPage';
import { RiskPage } from './pages/RiskPage';
import { ProsesBisnisPage } from './pages/ProsesBisnisPage';
import { OrganisasiPage } from './pages/OrganisasiPage';
import { GcgEsgPage } from './pages/GcgEsgPage';
import { PetaPage } from './pages/PetaPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { InputRealisasiPage } from './pages/InputRealisasiPage';
import { KpiMasterPage } from './pages/KpiMasterPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminPage } from './pages/AdminPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <Protected>
            <AppShell />
          </Protected>
        }
      >
        <Route index element={<ExecutivePage />} />
        <Route path="financial" element={<FinancialPage />} />
        <Route path="operational" element={<OperationalPage />} />
        <Route path="strategic" element={<StrategicPage />} />
        <Route path="human-capital" element={<HumanCapitalPage />} />
        <Route path="risk" element={<RiskPage />} />
        <Route path="proses-bisnis" element={<ProsesBisnisPage />} />
        <Route path="struktur-organisasi" element={<OrganisasiPage />} />
        <Route path="gcg-esg" element={<GcgEsgPage />} />
        <Route path="peta" element={<PetaPage />} />
        <Route path="approvals" element={<ApprovalsPage />} />
        <Route path="input-realisasi" element={<InputRealisasiPage />} />
        {/* Input Kontrak Manajemen kini digabung ke "Manajemen KPI" (tab Dokumen KM) */}
        <Route path="input-kontrak" element={<Navigate to="/kpi-master" replace />} />
        <Route path="kpi-master" element={<KpiMasterPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
