import { NavLink, Outlet } from "react-router-dom";
import {
  Shield,
  LayoutDashboard,
  PlusCircle,
  FileSearch,
  Zap,
  ListChecks,
  GitBranch,
  Network,
  Wrench,
} from "lucide-react";
import { Header } from "./Header";
import { IntegrityBanner } from "./IntegrityBanner";
import { useIntegrityLive } from "../hooks/useIntegrity";
import clsx from "clsx";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/create", label: "Create grant", icon: PlusCircle },
  { to: "/audit", label: "Audit log", icon: FileSearch },
  { to: "/approvals", label: "Approvals", icon: ListChecks },
  { to: "/redteam", label: "Red team", icon: Zap },
  { to: "/merkle", label: "Merkle tree", icon: Network },
  { to: "/delegation", label: "Delegation", icon: GitBranch },
  { to: "/dev", label: "Dev / demo", icon: Wrench },
];

export function Layout() {
  useIntegrityLive();
  return (
    <div className="min-h-screen">
      <Header />
      <IntegrityBanner />
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <nav className="hidden w-52 shrink-0 flex-col gap-1 md:flex">
          <div className="mb-4 flex items-center gap-2 px-2 text-emerald-400">
            <Shield className="h-5 w-5" />
            <span className="text-sm font-semibold tracking-wide">AgentGuard</span>
          </div>
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition",
                  isActive ? "bg-emerald-500/15 text-emerald-300" : "text-console-muted hover:bg-white/5",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
