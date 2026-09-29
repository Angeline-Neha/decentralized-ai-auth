import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { WalletProvider } from "./lib/wallet";
import { DashboardPage } from "./pages/Dashboard";
import { CreateGrantPage } from "./pages/CreateGrant";
import { GrantDetailPage } from "./pages/GrantDetail";
import { AuditLogPage } from "./pages/AuditLog";
import { ApprovalsPage } from "./pages/Approvals";
import { RedTeamPage } from "./pages/RedTeam";
import { MerkleVisualizerPage } from "./pages/MerkleVisualizer";
import { DelegationTreePage } from "./pages/DelegationTree";
import { DevToolsPage } from "./pages/DevTools";

const qc = new QueryClient({
  defaultOptions: { queries: { staleTime: 0, refetchOnMount: "always", refetchOnWindowFocus: true, refetchOnReconnect: true, retry: 1 } },
});

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <WalletProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<DashboardPage />} />
              <Route path="create" element={<CreateGrantPage />} />
              <Route path="grants/:id" element={<GrantDetailPage />} />
              <Route path="audit" element={<AuditLogPage />} />
              <Route path="approvals" element={<ApprovalsPage />} />
              <Route path="redteam" element={<RedTeamPage />} />
              <Route path="merkle" element={<MerkleVisualizerPage />} />
              <Route path="delegation" element={<DelegationTreePage />} />
              <Route path="dev" element={<DevToolsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </WalletProvider>
    </QueryClientProvider>
  );
}
