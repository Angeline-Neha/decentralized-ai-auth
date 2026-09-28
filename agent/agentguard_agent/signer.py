import json
from typing import Any

from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

INTENT_TYPES = {
    "Intent": [
        {"name": "grantId", "type": "uint256"},
        {"name": "actionId", "type": "bytes32"},
        {"name": "payee", "type": "address"},
        {"name": "amount", "type": "uint256"},
        {"name": "paramsHash", "type": "bytes32"},
        {"name": "nonce", "type": "uint256"},
        {"name": "deadline", "type": "uint256"},
    ],
}


def action_id(name: str) -> str:
    return Web3.keccak(text=name).hex()


def params_hash(params: dict[str, Any] | None) -> str:
    payload = json.dumps(params or {}, sort_keys=True, separators=(",", ":"))
    return Web3.keccak(text=payload).hex()


class IntentSigner:
    def __init__(self, private_key: str, chain_id: int, verifying_contract: str) -> None:
        self._account = Account.from_key(private_key)
        self._domain = {
            "name": "AgentGuard",
            "version": "1",
            "chainId": chain_id,
            "verifyingContract": Web3.to_checksum_address(verifying_contract),
        }

    @property
    def address(self) -> str:
        return self._account.address

    def sign_intent(
        self,
        *,
        grant_id: int,
        action: str,
        payee: str,
        amount_wei: int,
        params: dict[str, Any] | None,
        nonce: int,
        deadline: int,
    ) -> tuple[dict[str, Any], str]:
        ph = params_hash(params)
        message_data = {
            "grantId": grant_id,
            "actionId": Web3.keccak(text=action),
            "payee": Web3.to_checksum_address(payee),
            "amount": amount_wei,
            "paramsHash": Web3.to_bytes(hexstr=ph),
            "nonce": nonce,
            "deadline": deadline,
        }
        signable = encode_typed_data(
            domain_data=self._domain,
            message_types=INTENT_TYPES,
            message_data=message_data,
        )
        signed = self._account.sign_message(signable)
        wire = {
            "grantId": grant_id,
            "actionId": action_id(action),
            "payee": Web3.to_checksum_address(payee),
            "amount": amount_wei,
            "paramsHash": ph,
            "nonce": nonce,
            "deadline": deadline,
        }
        sig_hex = signed.signature.hex()
        if not sig_hex.startswith("0x"):
            sig_hex = "0x" + sig_hex
        return wire, sig_hex
