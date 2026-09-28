import type { FastifyInstance } from "fastify";
import { getDb } from "../db/index.js";
import { getGuardReadOnly } from "../contract/client.js";
import { syncGrantsFromChain } from "../indexer/index.js";
import { saveManifest, getManifest, proofsForAction } from "../proof/service.js";

export async function grantRoutes(app: FastifyInstance) {
  app.get("/grants", async () => {
    await syncGrantsFromChain();
    const rows = getDb().prepare("SELECT * FROM grants ORDER BY id ASC").all();
    return { grants: rows };
  });

  app.get<{ Params: { id: string } }>("/grants/:id", async (req) => {
    const id = Number(req.params.id);
    await syncGrantsFromChain(id);
    const row = getDb().prepare("SELECT * FROM grants WHERE id = ?").get(id);
    if (!row) return app.httpErrors.notFound(`Grant ${id} not found`);

    const manifest = getManifest(id);
    const audit = getDb()
      .prepare("SELECT * FROM audit_events WHERE grant_id = ? ORDER BY index_num DESC LIMIT 20")
      .all(id);
    const pending = getDb().prepare("SELECT * FROM pending_intents WHERE grant_id = ? AND status = 1").all(id);
    const guard = getGuardReadOnly();
    const onChain = await guard.getGrant(id);

    return {
      grant: row,
      onChain: {
        spent: onChain.spent.toString(),
        escrow: onChain.escrow.toString(),
        strikes: Number(onChain.strikes),
        status: Number(onChain.status),
        nonce: (await guard.nonces(id)).toString(),
      },
      manifest,
      recentAudit: audit,
      pending,
    };
  });

  app.post<{ Params: { id: string }; Body: { actions: string[] } }>(
    "/grants/:id/manifest",
    async (req) => {
      const id = Number(req.params.id);
      const guard = getGuardReadOnly();
      const g = await guard.getGrant(id);
      if (g.owner === "0x0000000000000000000000000000000000000000") {
        return app.httpErrors.notFound(`Grant ${id} not found`);
      }
      const actions = req.body?.actions;
      if (!Array.isArray(actions) || actions.length === 0) {
        return app.httpErrors.badRequest("actions[] required");
      }
      const saved = saveManifest(id, actions, g.actionsRoot);
      return { grantId: id, ...saved };
    },
  );

  app.get<{ Params: { id: string }; Querystring: { action?: string } }>(
    "/grants/:id/proof",
    async (req) => {
      const id = Number(req.params.id);
      const action = req.query.action;
      if (!action) return app.httpErrors.badRequest("action query param required");
      const proofs = await proofsForAction(id, action);
      const chain = proofs.map((p, k) => ({ level: k, proof: p }));
      return { grantId: id, action, proofs: chain };
    },
  );
}
