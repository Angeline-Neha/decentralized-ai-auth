import type { FastifyInstance } from "fastify";
import { relayDelegation, type DelegationRequest } from "../relayer/intents.js";
import { ChainTamperedError } from "../audit/verify.js";

export async function delegationRoutes(app: FastifyInstance) {
  app.post<{ Body: DelegationRequest }>("/delegations", async (req, reply) => {
    if (!req.body?.delegation || !req.body?.signature) {
      return app.httpErrors.badRequest("delegation and signature required");
    }
    try {
      return await relayDelegation(req.body);
    } catch (err) {
      if (err instanceof ChainTamperedError) {
        return reply.code(423).send({ error: err.message, code: err.code, outcome: "Refused", ...err.details });
      }
      const msg = err instanceof Error ? err.message : String(err);
      return app.httpErrors.badRequest(msg);
    }
  });
}
