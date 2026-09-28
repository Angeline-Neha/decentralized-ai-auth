# AgentGuard — viva notes

## Architecture

- **Owner** (MetaMask): creates grants, approves high-value intents, revoke/unfreeze.
- **Agent** (Python keypair): signs EIP-712 intents only; no API keys.
- **Gateway**: relayer submits intents; mock providers run **after** `Executed`.
- **Contract**: policy, strikes, audit hash-chain, Merkle whitelist.

## Syllabus mapping

| Topic | Where |
|-------|--------|
| Smart contracts | `AgentGuard.sol` grants, execute, delegate |
| Digital signatures | EIP-712 intents, ECDSA in contract |
| Hashing | Audit chain `keccak256(prev, …)` |
| Merkle trees | Action whitelist proofs |
| Ethereum | Accounts, events, gas, Hardhat local |
| Python | Agent signer, FastAPI, `verify_audit.py` |

## Common questions

**OAuth scopes?** Provider-enforced; no tamper-evident log; central admin can change scopes.

**Stolen agent key?** Attacker gets bounded grant only; expiry, strikes, revoke limit damage.

**Why not revert on deny?** Revert rolls back strikes; denials must record strikes for circuit breaker.

**Replay griefing?** Bad nonce reverts **without** strike; only valid signatures count.

**Off-chain trust?** Gateway must not act before `Executed`; on-chain ETH transfers need no gateway honesty for authorization.

## Known limitations

- Fixed-window rate limit burst at window edges.
- Sub-delegation subset enforced at runtime (intersection of Merkle proofs), not purely from two roots.
- Local Hardhat by default; Sepolia optional.
