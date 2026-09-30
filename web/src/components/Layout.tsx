import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, PlusCircle, FileSearch, Zap, ListChecks, GitBranch, Network, Wrench } from "lucide-react";
import clsx from "clsx";
import { Header } from "./Header";
import { IntegrityBanner } from "./IntegrityBanner";
import { useIntegrity, useIntegrityLive } from "../hooks/useIntegrity";

const links = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/create", label: "Create grant", icon: PlusCircle },
  { to: "/audit", label: "Audit log", icon: FileSearch },
  { to: "/approvals", label: "Approvals", icon: ListChecks },
  { to: "/redteam", label: "Red team", icon: Zap },
  { to: "/merkle", label: "Merkle proof", icon: Network },
  { to: "/delegation", label: "Delegation", icon: GitBranch },
  { to: "/dev", label: "Audit chain", icon: Wrench },
];

function ChainStatus() {
  const d = useIntegrity().data;
  if (!d) return <p className="text-xs text-ox-300">Checking chain…</p>;
  return (
    <div className="text-xs leading-relaxed">
      <p className="flex items-center gap-2 font-semibold text-white">
        <span className={clsx("inline-block h-2 w-2", d.valid ? "rounded-full bg-[#7FD1A0]" : "animate-pulse bg-bad")} />
        {d.valid ? "Chain verified" : "Chain tampered"}
      </p>
      <p className="mt-1 truncate font-mono text-ox-300">
        {d.entriesChecked} block{d.entriesChecked === 1 ? "" : "s"} · head {d.onChainHead ? `${d.onChainHead.slice(0, 6)}…${d.onChainHead.slice(-4)}` : "—"}
      </p>
    </div>
  );
}

export function Layout() {
  useIntegrityLive();
  return (
    <div className="min-h-screen md:grid md:grid-cols-[236px_1fr]">
      <aside className="flex flex-col bg-ox-700 text-ox-100 md:sticky md:top-0 md:h-screen">
        <div className="px-6 pb-4 pt-7 md:pb-8">
          <p className="text-xl font-extrabold tracking-tight text-white">AgentGuard</p>
          <p className="mt-0.5 font-mono text-xs text-ox-300">policy enforcement</p>
        </div>
        <nav aria-label="Main" className="flex overflow-x-auto pb-2 md:flex-1 md:flex-col md:overflow-visible md:pb-0">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex shrink-0 items-center gap-3 whitespace-nowrap px-6 py-2.5 text-sm font-medium transition-colors md:border-l-[3px]",
                  isActive ? "bg-ox-800 text-white md:border-white" : "text-ox-100 hover:bg-ox-800 hover:text-white md:border-transparent",
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden border-t border-ox-500/60 px-6 py-5 md:block">
          <ChainStatus />
        </div>
      </aside>

      <div className="min-w-0">
        <Header />
        <IntegrityBanner />
        <main className="mx-auto max-w-[1080px] px-6 pb-20 pt-10 md:px-12">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
