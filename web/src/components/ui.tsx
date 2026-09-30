import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { copy } from "../lib/format";

/** Page title + one plain sentence saying what the page is for. Every page starts with this. */
export function PageHeader({ title, lead, actions }: { title: string; lead?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-ink">{title}</h1>
        {lead && <p className="mt-2 max-w-[62ch] text-[15px] leading-relaxed text-mute">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled block with a single oxblood rule. Replaces the old identical rounded cards. */
export function Section({ title, meta, children, className }: { title: string; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h2 className="h-section">
        {title}
        {meta && <span>{meta}</span>}
      </h2>
      {children}
    </section>
  );
}

/** Empty states say what to do next. */
export function Empty({ title, hint, action }: { title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border border-dashed border-line px-6 py-10 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-[52ch] text-sm text-mute">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

const noticeTone = {
  info: "border-ox-500 bg-ox-50 text-ox-800",
  warn: "border-warn bg-[#F7EBD6] text-[#5B3606]",
  bad: "border-bad bg-[#FBE4E5] text-[#7A1219]",
  ok: "border-ok bg-[#E1EEE7] text-[#173C2C]",
} as const;

export function Notice({ tone = "info", children }: { tone?: keyof typeof noticeTone; children: ReactNode }) {
  return <div className={clsx("border-l-4 px-4 py-3 text-sm leading-relaxed", noticeTone[tone])}>{children}</div>;
}

/** Click-to-copy hash. Confirms in place instead of a toast. */
export function CopyHash({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Copy full value"
      onClick={() => {
        copy(value);
        setDone(true);
        setTimeout(() => setDone(false), 1100);
      }}
      className={clsx(
        "border-b border-dashed font-mono text-xs transition-colors",
        done ? "border-ok text-ok" : "border-mute text-ink hover:border-ox-500 hover:text-ox-600",
        className,
      )}
    >
      {done ? "copied" : (label ?? value)}
    </button>
  );
}

/** Thin budget bar. Denominator zero renders empty, never NaN. */
export function BudgetBar({ pct, tone = "brand" }: { pct: number; tone?: "brand" | "bad" }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2 bg-sunk" role="img" aria-label={`${Math.round(w)}% of budget used`}>
      <div className={clsx("h-full transition-all duration-500", tone === "bad" ? "bg-bad" : "bg-ox-600")} style={{ width: `${w === 0 ? 0 : Math.max(w, 1.5)}%` }} />
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint block">{hint}</span>}
    </label>
  );
}
