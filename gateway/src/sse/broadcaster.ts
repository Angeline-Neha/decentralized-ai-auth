import { EventEmitter } from "node:events";

export type SseEvent =
  | { type: "audit"; data: Record<string, unknown> }
  | { type: "grant"; data: Record<string, unknown> }
  | { type: "pending"; data: Record<string, unknown> }
  | { type: "provider"; data: Record<string, unknown> }
  | { type: "intent"; data: Record<string, unknown> };

class SseBroadcaster extends EventEmitter {
  publish(event: SseEvent) {
    this.emit("message", event);
  }
}

export const sse = new SseBroadcaster();

export function sseHandler(_req: unknown, reply: { raw: NodeJS.WritableStream; header: (k: string, v: string) => void }) {
  reply.header("Content-Type", "text/event-stream");
  reply.header("Cache-Control", "no-cache");
  reply.header("Connection", "keep-alive");

  const send = (event: SseEvent) => {
    reply.raw.write(`event: ${event.type}\n`);
    reply.raw.write(`data: ${JSON.stringify(event.data)}\n\n`);
  };

  const onMessage = (event: SseEvent) => send(event);
  sse.on("message", onMessage);

  reply.raw.write(": connected\n\n");

  const keepAlive = setInterval(() => reply.raw.write(": ping\n\n"), 15000);

  reply.raw.on("close", () => {
    clearInterval(keepAlive);
    sse.off("message", onMessage);
  });
}
