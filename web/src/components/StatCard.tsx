import type { ReactNode } from "react";
import clsx from "clsx";

export function StatCard({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "neutral" | "ok" | "warn" | "bad";
}) {
  const ring =
    tone === "ok"
      ? "border-emerald-500/30"
      : tone === "warn"
        ? "border-amber-500/30"
        : tone === "bad"
          ? "border-red-500/30"
          : "border-console-border";
  return (
    <div className={clsx("panel p-4", ring)}>
      <div className="text-xs uppercase tracking-wide text-console-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-console-muted">{hint}</div>}
    </div>
  );
}
