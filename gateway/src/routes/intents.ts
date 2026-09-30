import type { FastifyInstance } from "fastify";
import { relayIntent, type IntentRequest } from "../relayer/intents.js";
import { ChainTamperedError } from "../audit/verify.js";

export async function intentRoutes(app: FastifyInstance) {
  app.post<{ Body: IntentRequest }>("/intents", async (req, reply) => {
    const body = req.body;
    if (!body?.grantId || !body?.action || !body?.signature) {
      return app.httpErrors.badRequest("grantId, action, and signature are required");
    }
    try {
      const result = await relayIntent(body);
      return result;
    } catch (err) {
      if (err instanceof ChainTamperedError) {
        // 423 Locked: the request is fine, the audit chain it would extend is not.
        return reply.code(423).send({ error: err.message, code: err.code, outcome: "Refused", ...err.details });
      }
      const msg = err instanceof Error ? err.message : String(err);
      return app.httpErrors.badRequest(msg);
    }
  });
}
