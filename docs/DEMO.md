# AgentGuard — live demo script

Run stack: `npm run chain` → `npm run deploy` → `npm run seed` → `npm run gateway` → `npm run agent` → `npm run web`.

| Step | UI / action | Expected |
|------|-------------|----------|
| 1 | Red team → **Normal day** | `Executed` for calendar + email |
| 2 | Red team → **Prompt injection** | `Denied` ActionNotAllowed, strike +1 |
| 3 | Red team → **Over cap** | `Denied` OverCap |
| 4 | Red team → **Rate limit burst** | RateLimit strikes → **Frozen** |
| 5 | Red team → **Replay signature** | Second submit reverts BadNonce, no extra strike |
| 6 | Grant detail → **Kill switch** | Revoked; next agent call denied |
| 7 | Dev → **Tamper audit #0** → Audit → Verify | Chain **invalid** in gateway DB |
| 8 | Terminal: `python agent/scripts/verify_audit.py` | Still **valid** vs on-chain head |
| 9 | Merkle page → pick action | Proof siblings + root match manifest |
| 10 | Approvals (if high-value intent) | Owner approves in MetaMask |

## Viva one-liners

- **Why chain?** Policy is neutral code; agent and prompt injection cannot widen permissions.
- **Gateway trust?** Relayer cannot forge intents; off-chain APIs trust a small auditable gateway.
- **Why Merkle?** One `bytes32` root on-chain; O(log n) proof per action.

See `docs/VIVA.md` for longer Q&A.
