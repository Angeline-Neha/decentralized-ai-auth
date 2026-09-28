# AgentGuard Python agent

Deterministic agent simulator: EIP-712 signing, naive inbox-following planner, and demo scenarios for the red-team console.

## Setup

```bash
cd agent
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -r requirements.txt
copy .env.example .env
```

When creating a grant in MetaMask, set **agent** to Hardhat account **#1**:

`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`

Use account **#2** for the gateway relayer (`gateway/.env`).

## Run

With chain, deploy, gateway, and manifest uploaded:

```bash
python -m uvicorn main:app --reload --port 8000
```

Or from repo root: `npm run agent`

## API

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/scenarios` | List demo scenario names |
| POST | `/run` | Run a scenario (`{"scenario":"prompt_injection","grantId":1}`) |
| GET | `/thoughts` | SSE stream of agent reasoning |
| GET | `/thoughts/history` | Last run thoughts |

## Scenarios

- `normal_day` — calendar + email (should execute)
- `prompt_injection` — reads gateway inbox, obeys malicious transfer instruction (denied)
- `over_cap` — payment above per-call cap (denied + strike)
- `unlisted_action` — `transfer_funds` not in whitelist (denied)
- `replay_signature` — same signed intent twice (second reverts BadNonce)
- `rate_limit_burst` — six rapid calls (rate limit / freeze if configured)

## Independent audit verifier

```bash
python scripts/verify_audit.py --rpc http://127.0.0.1:8545
```

Reads `AuditAppended` events from RPC and checks the hash chain against `auditHead()` without using the gateway DB.
