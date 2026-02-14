import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/common/Toast';
import { Overview } from './components/dashboard/Overview';
import { AppShell } from './components/layout/AppShell';
import { SetupWizard } from './components/setup/SetupWizard';
import { useSetupStatus } from './hooks/useSetupStatus';
import { AgentDetail } from './pages/AgentDetail';
import { ApiKeys } from './pages/ApiKeys';
import { Audit } from './pages/Audit';
import { Enrollment } from './pages/Enrollment';
import { Fleet } from './pages/Fleet';
import { Policies } from './pages/Policies';
import { TryIt } from './pages/TryIt';

export function App() {
  const { status, loading, refetch } = useSetupStatus();

  if (loading || !status) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-gray-400">
        Loading...
      </div>
    );
  }

  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          {status.setupComplete ? (
            <Route element={<AppShell />}>
              <Route index element={<Overview />} />
              <Route path="agents" element={<Fleet />} />
              <Route path="agents/:id" element={<AgentDetail />} />
              <Route path="enrollment" element={<Enrollment />} />
              <Route path="api-keys" element={<ApiKeys />} />
              <Route path="policies" element={<Policies />} />
              <Route path="audit" element={<Audit />} />
              <Route path="try-it" element={<TryIt />} />
              <Route path="settings" element={<PlaceholderPage title="Settings" />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          ) : (
            <>
              <Route path="/setup/*" element={<SetupWizard onComplete={refetch} />} />
              <Route path="*" element={<Navigate to="/setup" replace />} />
            </>
          )}
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}

function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-white">{title}</h1>
      <p className="mt-2 text-gray-400">Coming soon.</p>
    </div>
  );
}
