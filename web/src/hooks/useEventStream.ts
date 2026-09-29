import { useEffect, useState } from "react";
import { GATEWAY } from "../lib/constants";

export type StreamItem = {
  type: string;
  data: Record<string, unknown>;
  at: number;
};

/** Live activity feed. Seeded from the audit log so a page refresh doesn't start with an empty panel. */
export function useEventStream(max = 30) {
  const [items, setItems] = useState<StreamItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    const seed = async () => {
      try {
        const r = await fetch(`${GATEWAY}/events?limit=${max}`);
        if (!r.ok) return;
        const j = (await r.json()) as { events: Array<Record<string, unknown>> };
        if (cancelled) return;
        const seeded: StreamItem[] = j.events.map((e) => ({
          type: "audit",
          at: Date.now(),
          data: {
            index: e.index_num,
            grantId: e.grant_id,
            actionName: e.action_name,
            amount: e.amount,
            code: e.code,
            outcome: e.outcome,
            txHash: e.tx_hash,
          },
        }));
        setItems((prev) => {
          const seen = new Set(prev.filter((p) => p.type === "audit").map((p) => p.data.index));
          return [...prev, ...seeded.filter((s) => !seen.has(s.data.index))].slice(0, max);
        });
      } catch {
        /* gateway not ready yet */
      }
    };
    void seed();

    const es = new EventSource(`${GATEWAY}/stream`);
    const push = (type: string) => (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data as string) as Record<string, unknown>;
        setItems((prev) => {
          if (type === "audit" && prev.some((p) => p.type === "audit" && p.data.index === data.index)) return prev;
          return [{ type, data, at: Date.now() }, ...prev].slice(0, max);
        });
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("audit", push("audit"));
    es.addEventListener("intent", push("intent"));
    es.addEventListener("grant", push("grant"));
    es.addEventListener("pending", push("pending"));
    es.onopen = () => void seed(); // catch up on anything missed while the stream was down

    const onReset = () => {
      setItems([]);
      void seed();
    };
    window.addEventListener("agentguard:reset", onReset);

    return () => {
      cancelled = true;
      es.close();
      window.removeEventListener("agentguard:reset", onReset);
    };
  }, [max]);

  return items;
}
