from typing import Any

import httpx

from agentguard_agent.signer import params_hash


class GatewayClient:
    def __init__(self, base_url: str) -> None:
        self._base = base_url.rstrip("/")
        self._client = httpx.Client(timeout=60.0)

    def close(self) -> None:
        self._client.close()

    def grant(self, grant_id: int) -> dict[str, Any]:
        r = self._client.get(f"{self._base}/grants/{grant_id}")
        r.raise_for_status()
        return r.json()

    def nonce(self, grant_id: int) -> int:
        data = self.grant(grant_id)
        return int(data["onChain"]["nonce"])

    def inbox(self) -> list[dict[str, str]]:
        r = self._client.get(f"{self._base}/dev/inbox")
        r.raise_for_status()
        return r.json()["inbox"]

    def submit_intent(
        self,
        *,
        grant_id: int,
        action: str,
        signature: str,
        payee: str = "0x0000000000000000000000000000000000000000",
        amount_wei: int = 0,
        params: dict[str, Any] | None = None,
        nonce: int | None = None,
        deadline: int | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "grantId": grant_id,
            "action": action,
            "signature": signature if signature.startswith("0x") else f"0x{signature}",
            "payee": payee,
            "amount": str(amount_wei),
            "paramsHash": params_hash(params),
            "params": params or {},
        }
        if nonce is not None:
            body["nonce"] = nonce
        if deadline is not None:
            body["deadline"] = deadline
        r = self._client.post(f"{self._base}/intents", json=body)
        if r.status_code >= 400:
            return {"outcome": "Error", "reason": r.text, "status": r.status_code}
        return r.json()
