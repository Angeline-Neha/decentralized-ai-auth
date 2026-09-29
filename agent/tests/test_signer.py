"""Run: cd agent && python -m pytest tests/ -q (or python tests/test_signer.py)"""
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

from agentguard_agent.signer import INTENT_TYPES, action_id, params_hash, IntentSigner


def test_action_id_matches_web3():
    # web3 v7 .hex() has no 0x prefix; compare canonical 0x-hex instead
    assert action_id("read_calendar").lower() == Web3.to_hex(Web3.keccak(text="read_calendar")).lower()


def test_sign_intent_recovers_agent():
    key = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78627d"
    signer = IntentSigner(key, 31337, "0x0000000000000000000000000000000000000001")
    msg, sig = signer.sign_intent(
        grant_id=1,
        action="read_calendar",
        payee="0x0000000000000000000000000000000000000000",
        amount_wei=0,
        params={"view": "today"},
        nonce=0,
        deadline=9999999999,
    )
    domain = {
        "name": "AgentGuard",
        "version": "1",
        "chainId": 31337,
        "verifyingContract": "0x0000000000000000000000000000000000000001",
    }
    message_data = {
        "grantId": msg["grantId"],
        "actionId": Web3.keccak(text="read_calendar"),
        "payee": msg["payee"],
        "amount": msg["amount"],
        "paramsHash": Web3.to_bytes(hexstr=msg["paramsHash"]),
        "nonce": msg["nonce"],
        "deadline": msg["deadline"],
    }
    recovered = Account.recover_message(
        encode_typed_data(domain_data=domain, message_types=INTENT_TYPES, message_data=message_data),
        signature=bytes.fromhex(sig[2:]),
    )
    assert recovered.lower() == signer.address.lower()


if __name__ == "__main__":
    test_action_id_matches_web3()
    test_sign_intent_recovers_agent()
    print("ok")
