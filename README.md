# AgentGuard

On-chain, capability-based delegation for AI agents. The agent never holds an API key:
it holds a keypair and signs intents, and a smart contract enforces the owner's policy.

## Phases
1. **Contract core**: grants, escrow, signed intents, nonces, Merkle action whitelist,
   caps, rate limit, budget, strikes / circuit breaker, revoke, audit hash-chain.
2. **Approval queue + sub-delegation** (contract extension)
3. **Gateway**: relayer, SQLite indexer, proof service, mock providers, SSE, audit verify
4. **Python agent** (`agent/`): EIP-712 signer, naive planner, FastAPI `/run` + `/thoughts`, `verify_audit.py`
5. **Frontend** (`web/`): security console — wallet, dashboard, create grant, audit, approvals, red team
6. **Polish**: Merkle + delegation views, dev tools, demo docs (`docs/DEMO.md`)

## Quick start

**Ganache (default):** start Ganache, then:

```bash
copy .env.example .env
npm start
```

See **[docs/GANACHE.md](docs/GANACHE.md)** for RPC URL, chain ID, and copying account keys into `gateway/.env` / `agent/.env`.

**Hardhat node instead:** `npm run start:hardhat`

**First-time setup:**

```bash
npm install
copy .env.example .env
copy gateway\.env.example gateway\.env
cd agent && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt && copy .env.example .env && cd ..
```

Fill **RELAYER_PRIVATE_KEY** (Ganache account #2) and **AGENT_PRIVATE_KEY** (account #1) from the Ganache UI.

**Manual (multi-terminal)** if you prefer: `npm run chain` → `npm run deploy` → `npm run seed` → `npm run dev:ui`

Full viva walkthrough: [`docs/DEMO.md`](docs/DEMO.md) · Q&A: [`docs/VIVA.md`](docs/VIVA.md)

### MetaMask (for Create grant / Approvals)
Add network **Hardhat Local**: RPC `http://127.0.0.1:8545`, chain ID **31337**. Import account **#0** private key (Hardhat default) as owner.

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
