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
    <div role="alert" className="bg-bad px-6 py-3 text-sm text-white">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ShieldAlert className="h-5 w-5 shrink-0" />
        <p className="min-w-0 flex-1">
          <strong>Audit chain tampered at block #{n}.</strong>{" "}
          {data.tamperedCount} block{data.tamperedCount === 1 ? "" : "s"} no longer match the on-chain record
          {data.missing.length > 0 && `, and block${data.missing.length > 1 ? "s" : ""} ${data.missing.map((m) => m + 1).join(", ")} ${data.missing.length > 1 ? "were" : "was"} deleted`}.
          {first?.reasons[0] && ` ${first.reasons[0]}`} New blocks are refused until it is restored.
        </p>
        <Link to="/dev" className="border border-white/60 px-3 py-1 font-semibold hover:bg-white/15">
          Inspect chain
        </Link>
        <button type="button" className="bg-white px-3 py-1 font-semibold text-bad hover:bg-red-50 disabled:opacity-60" disabled={restore.isPending} onClick={() => restore.mutate()}>
          {restore.isPending ? "Restoring…" : "Restore from chain"}
        </button>
      </div>
    </div>
  );
}

export { INTEGRITY_KEY };
