import type { FastifyInstance } from "fastify";
import { verifyAuditFromDb } from "../audit/verify.js";

export async function auditRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { grantId?: string } }>("/audit/verify", async (req) => {
    const grantId = req.query.grantId ? Number(req.query.grantId) : undefined;
    return verifyAuditFromDb(grantId);
  });
}
