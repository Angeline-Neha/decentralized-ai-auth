import type { FastifyInstance } from "fastify";
import { getDb } from "../db/index.js";
import { indexHistoricalEvents } from "../indexer/index.js";

export async function eventRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { grantId?: string; limit?: string; offset?: string } }>("/events", async (req) => {
    await indexHistoricalEvents();
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    const grantId = req.query.grantId ? Number(req.query.grantId) : null;

    const rows = grantId
      ? getDb()
          .prepare("SELECT * FROM audit_events WHERE grant_id = ? ORDER BY index_num DESC LIMIT ? OFFSET ?")
          .all(grantId, limit, offset)
      : getDb()
          .prepare("SELECT * FROM audit_events ORDER BY index_num DESC LIMIT ? OFFSET ?")
          .all(limit, offset);

    const total = grantId
      ? (getDb().prepare("SELECT COUNT(*) as c FROM audit_events WHERE grant_id = ?").get(grantId) as { c: number }).c
      : (getDb().prepare("SELECT COUNT(*) as c FROM audit_events").get() as { c: number }).c;

    return { total, limit, offset, events: rows };
  });
}
