# AgentGuard web console

React + Vite security UI. Dev server proxies:

- `/api/gateway` → `http://127.0.0.1:3001`
- `/api/agent` → `http://127.0.0.1:8000`

## Run

From repo root (with chain, deploy, gateway, agent running):

```bash
npm run build:shared
npm run web
```

Open http://127.0.0.1:5173

## MetaMask

Network: **Hardhat**, RPC `http://127.0.0.1:8545`, chain ID **31337**.  
Import **account #0** as owner for create grant / approvals / kill switch.
