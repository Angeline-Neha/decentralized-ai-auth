import type { FastifyInstance } from "fastify";
import { relayDelegation, type DelegationRequest } from "../relayer/intents.js";

export async function delegationRoutes(app: FastifyInstance) {
  app.post<{ Body: DelegationRequest }>("/delegations", async (req) => {
    if (!req.body?.delegation || !req.body?.signature) {
      return app.httpErrors.badRequest("delegation and signature required");
    }
    try {
      return await relayDelegation(req.body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return app.httpErrors.badRequest(msg);
    }
  });
}
