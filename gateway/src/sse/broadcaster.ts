import { EventEmitter } from "node:events";

export type SseEvent =
  | { type: "audit"; data: Record<string, unknown> }
  | { type: "grant"; data: Record<string, unknown> }
  | { type: "pending"; data: Record<string, unknown> }
  | { type: "provider"; data: Record<string, unknown> }
  | { type: "intent"; data: Record<string, unknown> }
  | { type: "reset"; data: Record<string, unknown> }
  | { type: "integrity"; data: Record<string, unknown> };

class SseBroadcaster extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }
  publish(event: SseEvent) {
    this.emit("message", event);
  }
}

export const sse = new SseBroadcaster();

export function sseHandler(
  req: { headers: Record<string, string | string[] | undefined> },
  reply: { hijack: () => void; raw: import("node:http").ServerResponse },
) {
  // Fastify does not apply reply.header() to writes made through reply.raw, so the old handler never sent
  // Content-Type: text/event-stream (or CORS headers) and browsers/EventSource silently got nothing.
  reply.hijack();
  const origin = (req.headers.origin as string | undefined) ?? "*";
  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  });

  const send = (event: SseEvent) => {
    try {
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event.data, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n\n`);
    } catch {
      /* client went away */
    }
  };

  sse.on("message", send);
  reply.raw.write("retry: 2000\n: connected\n\n");
  const keepAlive = setInterval(() => reply.raw.write(": ping\n\n"), 15000);

  reply.raw.on("close", () => {
    clearInterval(keepAlive);
    sse.off("message", send);
  });
}
