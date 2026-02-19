import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from './components/common/Toast';
import { Overview } from './components/dashboard/Overview';
import { AppShell } from './components/layout/AppShell';
import { SetupWizard } from './components/setup/SetupWizard';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { useSetupStatus } from './hooks/useSetupStatus';
import { AccessGroups } from './pages/AccessGroups';
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
import { TagsManagement } from './pages/TagsManagement';
import { TryIt } from './pages/TryIt';
import { Users } from './pages/Users';

function MemberNotice() {
  const { logout } = useAuth();

  return (
    <div className="flex h-screen items-center justify-center bg-gray-950">
      <div className="max-w-md rounded-lg border border-gray-800 bg-gray-900 p-8 text-center">
        <h1 className="text-xl font-semibold text-white">MCP Access Only</h1>
        <p className="mt-3 text-sm text-gray-400">
          Your account is authorized for MCP access only. Use Claude Desktop or Claude Code to
          connect to Sonde and run diagnostic queries.
        </p>
        <p className="mt-4 text-xs text-gray-500">
          Contact your Sonde administrator if you need dashboard access.
        </p>
        <button
          type="button"
          onClick={logout}
          className="mt-6 rounded-md bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

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
      ) : user.role === 'member' ? (
        <Route path="*" element={<MemberNotice />} />
      ) : (
        <Route element={<AppShell />}>
          <Route index element={<Overview />} />
          <Route path="agents" element={<Fleet />} />
          <Route path="agents/:id" element={<AgentDetail />} />
          <Route path="enrollment" element={<Enrollment />} />
          <Route path="api-keys" element={<ApiKeys />} />
          <Route path="users" element={<Users />} />
          <Route path="access-groups" element={<AccessGroups />} />
          <Route path="policies" element={<Policies />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="integrations/:id" element={<IntegrationDetail />} />
          <Route path="audit" element={<Audit />} />
          <Route path="try-it" element={<TryIt />} />
          <Route path="settings" element={<Navigate to="/settings/sso" replace />} />
          <Route path="settings/sso" element={<Settings />} />
          <Route path="settings/tags" element={<TagsManagement />} />
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
