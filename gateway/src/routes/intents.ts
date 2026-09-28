import type { FastifyInstance } from "fastify";
import { relayIntent, type IntentRequest } from "../relayer/intents.js";

export async function intentRoutes(app: FastifyInstance) {
  app.post<{ Body: IntentRequest }>("/intents", async (req) => {
    const body = req.body;
    if (!body?.grantId || !body?.action || !body?.signature) {
      return app.httpErrors.badRequest("grantId, action, and signature are required");
    }
    try {
      const result = await relayIntent(body);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return app.httpErrors.badRequest(msg);
    }
  });
}
