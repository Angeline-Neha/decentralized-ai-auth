import clsx from "clsx";

export function StatusPill({ label, tone }: { label: string; tone: "ok" | "warn" | "bad" | "neutral" }) {
  return (
    <span
      className={clsx(
        "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
        tone === "ok" && "bg-emerald-500/20 text-emerald-300",
        tone === "warn" && "bg-amber-500/20 text-amber-200",
        tone === "bad" && "bg-red-500/20 text-red-300",
        tone === "neutral" && "bg-slate-500/20 text-slate-300",
      )}
    >
      {label}
    </span>
  );
}
