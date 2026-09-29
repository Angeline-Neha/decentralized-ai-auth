import time
from dataclasses import dataclass
from typing import Any

from agentguard_agent.gateway_client import GatewayClient
from agentguard_agent.signer import IntentSigner
from agentguard_agent.thoughts import thought_bus

ZERO = "0x0000000000000000000000000000000000000000"


@dataclass
class ToolResult:
    action: str
    gateway: dict[str, Any]


class AgentTools:
    def __init__(self, signer: IntentSigner, gateway: GatewayClient, grant_id: int) -> None:
        self._signer = signer
        self._gateway = gateway
        self._grant_id = grant_id

    def _submit(
        self,
        action: str,
        *,
        payee: str = ZERO,
        amount_wei: int = 0,
        params: dict[str, Any] | None = None,
        nonce: int | None = None,
        deadline: int | None = None,
    ) -> ToolResult:
        if nonce is None:
            nonce = self._gateway.nonce(self._grant_id)
        if deadline is None:
            # Use timestamp far in future so Ganache time-travel tests do not expire intent
            deadline = 2000000000

        thought_bus.emit(f"Signing intent: {action} amount={amount_wei} wei")
        _msg, sig = self._signer.sign_intent(
            grant_id=self._grant_id,
            action=action,
            payee=payee,
            amount_wei=amount_wei,
            params=params,
            nonce=nonce,
            deadline=deadline,
        )
        thought_bus.emit("Submitting signed intent to gateway relayer…")
        result = self._gateway.submit_intent(
            grant_id=self._grant_id,
            action=action,
            signature=sig,
            payee=payee,
            amount_wei=amount_wei,
            params=params,
            nonce=nonce,
            deadline=deadline,
        )
        outcome = result.get("outcome", "Unknown")
        thought_bus.emit(f"Contract response: {outcome}" + (f" ({result.get('reason')})" if result.get("reason") else ""))
        return ToolResult(action=action, gateway=result)

    def read_calendar(self) -> ToolResult:
        return self._submit("read_calendar", params={"view": "today"})

    def send_email(self, to: str, subject: str, body: str) -> ToolResult:
        return self._submit("send_email", params={"to": to, "subject": subject, "body": body})

    def pay_invoice(self, invoice_id: str, amount_wei: int, payee: str) -> ToolResult:
        return self._submit(
            "pay_invoice",
            amount_wei=amount_wei,
            payee=payee,
            params={"invoiceId": invoice_id},
        )

    def transfer_funds(self, amount_wei: int, payee: str) -> ToolResult:
        return self._submit(
            "transfer_funds",
            amount_wei=amount_wei,
            payee=payee,
            params={"memo": "agent-initiated transfer"},
        )
