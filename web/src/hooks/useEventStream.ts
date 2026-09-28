import { useEffect, useState } from "react";
import { GATEWAY } from "../lib/constants";

export type StreamItem = {
  type: string;
  data: Record<string, unknown>;
  at: number;
};

export function useEventStream(max = 30) {
  const [items, setItems] = useState<StreamItem[]>([]);

  useEffect(() => {
    const es = new EventSource(`${GATEWAY}/stream`);
    const push = (type: string) => (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data as string) as Record<string, unknown>;
        setItems((prev) => [{ type, data, at: Date.now() }, ...prev].slice(0, max));
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("audit", push("audit"));
    es.addEventListener("intent", push("intent"));
    es.addEventListener("grant", push("grant"));
    es.addEventListener("pending", push("pending"));
    return () => es.close();
  }, [max]);

  return items;
}
