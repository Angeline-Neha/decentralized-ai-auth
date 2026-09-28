# AgentGuard

On-chain, capability-based delegation for AI agents. The agent never holds an API key:
it holds a keypair and signs intents, and a smart contract enforces the owner's policy.

## Phases
1. **Contract core**: grants, escrow, signed intents, nonces, Merkle action whitelist,
   caps, rate limit, budget, strikes / circuit breaker, revoke, audit hash-chain.
2. **Approval queue + sub-delegation** (contract extension)
3. **Gateway** (this drop): relayer, SQLite indexer, proof service, mock providers, SSE, audit verify
4. Python agent simulator
5. Frontend security console
6. Red-team demo, polish

## Quick start
```bash
npm install
npm test                      # contract tests
npm run chain                 # terminal 1: local blockchain
npm run deploy                # terminal 2: deploy AgentGuard
npm run build:shared          # compile shared types/helpers
cp gateway/.env.example gateway/.env
npm run gateway               # terminal 3: gateway on :3001
```

After creating a grant on-chain, upload its action manifest:
```bash
curl -X POST http://127.0.0.1:3001/grants/1/manifest \
  -H "Content-Type: application/json" \
  -d '{"actions":["read_calendar","send_email","pay_invoice"]}'
```

## Gateway API
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/grants` | List indexed grants |
| GET | `/grants/:id` | Grant detail + recent audit |
| POST | `/grants/:id/manifest` | Upload action whitelist (verifies Merkle root) |
| GET | `/grants/:id/proof?action=` | Merkle proofs for delegation chain |
| POST | `/intents` | Relay agent-signed intent |
| POST | `/delegations` | Relay parent-signed delegation |
| GET | `/events` | Paginated audit log |
| GET | `/audit/verify` | Recompute hash chain vs on-chain head |
| GET | `/stream` | SSE live feed |
| POST | `/dev/advance-time` | Advance Hardhat clock |
| POST | `/dev/tamper-audit` | Corrupt DB row (demo) |
