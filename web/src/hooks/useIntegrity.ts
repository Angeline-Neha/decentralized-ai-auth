import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { verifyAudit, type VerifyResult } from "../lib/api";
import { GATEWAY } from "../lib/constants";

export const INTEGRITY_KEY = ["audit-verify"] as const;

/** Shared audit-chain verification result. One query key => one poll, no matter how many components read it. */
export function useIntegrity() {
  return useQuery<VerifyResult>({
    queryKey: INTEGRITY_KEY,
    queryFn: () => verifyAudit(),
    refetchInterval: 3000,
  });
}

/** Mount ONCE (in Layout): re-verify instantly when the gateway reports a new block, a tamper, a restore or a reset. */
export function useIntegrityLive() {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource(`${GATEWAY}/stream`);
    const refresh = () => void qc.invalidateQueries({ queryKey: INTEGRITY_KEY });
    for (const t of ["integrity", "audit", "reset"]) es.addEventListener(t, refresh);
    return () => es.close();
  }, [qc]);
}
