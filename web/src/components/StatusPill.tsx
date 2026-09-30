import clsx from "clsx";

export function StatusPill({ label, tone }: { label: string; tone: "ok" | "warn" | "bad" | "neutral" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 text-xs font-semibold",
        tone === "ok" && "bg-[#E1EEE7] text-ok",
        tone === "warn" && "bg-[#F7EBD6] text-warn",
        tone === "bad" && "bg-bad text-white",
        tone === "neutral" && "bg-sunk text-mute",
      )}
    >
      {label}
    </span>
  );
}
