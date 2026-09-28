# Using Ganache (no Hardhat node)

You **do not** need `npm run chain`. Hardhat in this repo is only for **compile + deploy scripts**.

## 1. Start Ganache

Open **Ganache** and start a workspace. Note:

| Setting | Ganache GUI (typical) |
|---------|------------------------|
| RPC URL | `http://127.0.0.1:7545` |
| Network / chain ID | **5777** |

Some setups use port **8545** and chain **1337** — if so, set those in `.env` (see below).

## 2. Configure keys (important)

Ganache accounts are **not** the same as Hardhat’s public test keys unless you use the **same mnemonic** in Ganache.

After `npm run seed`, the **agent** is Ganache **account #1** (second row). The **relayer** should be account **#2**.

Copy private keys from Ganache into:

- `agent/.env` → `AGENT_PRIVATE_KEY` (account #1)
- `gateway/.env` → `RELAYER_PRIVATE_KEY` (account #2)

Owner for MetaMask = account **#0**.

## 3. Root `.env` (for `npm start`)

```bash
copy .env.example .env
```

Edit if your Ganache RPC / chain ID differ:

```
RPC_URL=http://127.0.0.1:7545
CHAIN_ID=5777
DEPLOY_NETWORK=ganache
START_HARDHAT_NODE=0
```

## 4. Run

```bash
npm install
copy gateway\.env.example gateway\.env
# fill RELAYER_PRIVATE_KEY in gateway/.env
cd agent && python -m venv .venv && .venv\Scripts\pip install -r requirements.txt && copy .env.example .env
# fill AGENT_PRIVATE_KEY in agent/.env
cd ..
npm start
```

(Ganache must already be running.)

## 5. MetaMask

Add custom network:

- RPC URL = same as `RPC_URL`
- Chain ID = same as `CHAIN_ID` (e.g. 5777)
- Import Ganache account **#0** for owner actions in the UI

## Limitations on Ganache

- **Dev → Advance time** may not work (Hardhat-specific RPC). Expiry demos: redeploy or use Hardhat node (`START_HARDHAT_NODE=1` + `npm run start:hardhat` if you add Hardhat later).

## Still want Hardhat node?

```
START_HARDHAT_NODE=1
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337
DEPLOY_NETWORK=localhost
```

Use `npm run start:hardhat` (includes embedded Hardhat node).
