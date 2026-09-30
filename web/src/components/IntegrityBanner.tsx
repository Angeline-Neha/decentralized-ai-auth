import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { devRestoreAudit } from "../lib/api";
import { INTEGRITY_KEY, useIntegrity } from "../hooks/useIntegrity";

/** Shown on EVERY page while the indexed audit chain does not verify. */
export function IntegrityBanner() {
  const { data } = useIntegrity();
  const qc = useQueryClient();
  const restore = useMutation({
    mutationFn: devRestoreAudit,
    onSuccess: () => void qc.invalidateQueries(),
  });

  if (!data || data.valid) return null;
  const first = data.blocks.find((b) => b.status !== "ok");
  const n = data.brokenAt === null ? "?" : data.brokenAt + 1;

  return (
    <div className="border-b border-red-500/50 bg-red-950/70 px-4 py-2 text-xs text-red-100">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
        <ShieldAlert className="h-4 w-4 shrink-0 text-red-300" />
        <div className="min-w-0 flex-1">
          <span className="font-semibold text-red-200">Audit chain tampered — Block #{n}</span>
          <span className="text-red-200/80">
            {" "}
            · {data.tamperedCount} block{data.tamperedCount === 1 ? "" : "s"} failing
            {data.missing.length > 0 && ` · block${data.missing.length > 1 ? "s" : ""} ${data.missing.map((m) => m + 1).join(", ")} deleted`}
            {first?.reasons[0] && ` · ${first.reasons[0]}`} New blocks are refused until it is restored.
          </span>
        </div>
        <Link to="/dev" className="rounded border border-red-400/40 px-2 py-1 font-semibold hover:bg-red-500/20">
          Inspect chain
        </Link>
        <button
          type="button"
          className="rounded border border-red-400/40 bg-red-500/20 px-2 py-1 font-semibold hover:bg-red-500/40 disabled:opacity-50"
          disabled={restore.isPending}
          onClick={() => restore.mutate()}
        >
          {restore.isPending ? "Restoring…" : "Restore from chain"}
        </button>
      </div>
    </div>
  );
}

export { INTEGRITY_KEY };
