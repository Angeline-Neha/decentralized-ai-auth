import type { FastifyInstance } from "fastify";
import { sseHandler } from "../sse/broadcaster.js";

export async function streamRoutes(app: FastifyInstance) {
  app.get("/stream", (req, reply) => {
    sseHandler(req, reply as never);
  });
}
