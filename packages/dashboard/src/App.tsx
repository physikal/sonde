import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/common/Toast';
import { Overview } from './components/dashboard/Overview';
import { AppShell } from './components/layout/AppShell';
import { SetupWizard } from './components/setup/SetupWizard';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useSetupStatus } from './hooks/useSetupStatus';
import { AgentDetail } from './pages/AgentDetail';
import { ApiKeys } from './pages/ApiKeys';
import { Audit } from './pages/Audit';
import { Enrollment } from './pages/Enrollment';
import { Fleet } from './pages/Fleet';
import { IntegrationDetail } from './pages/IntegrationDetail';
import { Integrations } from './pages/Integrations';
import { Login } from './pages/Login';
import { Policies } from './pages/Policies';
import { Settings } from './pages/Settings';
import { TryIt } from './pages/TryIt';

function AppRoutes() {
  const { status, loading: setupLoading, refetch } = useSetupStatus();
  const { user, loading: authLoading } = useAuth();

  if (setupLoading || authLoading || !status) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-gray-400">
        Loading...
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      {!status.setupComplete ? (
        <>
          <Route path="/setup/*" element={<SetupWizard onComplete={refetch} />} />
          <Route path="*" element={<Navigate to="/setup" replace />} />
        </>
      ) : !user ? (
        <Route path="*" element={<Navigate to="/login" replace />} />
      ) : (
        <Route element={<AppShell />}>
          <Route index element={<Overview />} />
          <Route path="agents" element={<Fleet />} />
          <Route path="agents/:id" element={<AgentDetail />} />
          <Route path="enrollment" element={<Enrollment />} />
          <Route path="api-keys" element={<ApiKeys />} />
          <Route path="policies" element={<Policies />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="integrations/:id" element={<IntegrationDetail />} />
          <Route path="audit" element={<Audit />} />
          <Route path="try-it" element={<TryIt />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      )}
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
