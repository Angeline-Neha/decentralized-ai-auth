#!/usr/bin/env python3
"""
Independent audit-chain verifier: reads AuditAppended logs from the chain via RPC
and recomputes the hash chain without trusting the gateway database.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from eth_abi import encode
from web3 import Web3

AUDIT_TOPIC0 = Web3.keccak(
    text="AuditAppended(uint256,uint256,bytes32,uint256,bytes32,uint8,bytes32)"
).hex()


def load_deployment(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def compute_head(prev: bytes, grant_id: int, action_id: bytes, amount: int, params_hash: bytes, code: int, block_number: int) -> bytes:
    encoded = encode(
        ["bytes32", "uint256", "bytes32", "uint256", "bytes32", "uint8", "uint256"],
        [prev, grant_id, action_id, amount, params_hash, code, block_number],
    )
    return Web3.keccak(encoded)


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify AgentGuard audit hash chain from chain events")
    parser.add_argument("--rpc", default="http://127.0.0.1:8545")
    parser.add_argument(
        "--deployment",
        default=str(Path(__file__).resolve().parents[2] / "contracts" / "deployments" / "localhost.json"),
    )
    args = parser.parse_args()

    dep_path = Path(args.deployment)
    if not dep_path.is_file():
        print(f"Deployment file missing: {dep_path}", file=sys.stderr)
        return 2

    dep = load_deployment(dep_path)
    w3 = Web3(Web3.HTTPProvider(args.rpc))
    if not w3.is_connected():
        print("Cannot connect to RPC", file=sys.stderr)
        return 2

    address = Web3.to_checksum_address(dep["address"])
    contract = w3.eth.contract(address=address, abi=dep["abi"])

    on_chain_head = contract.functions.auditHead().call()
    on_chain_count = contract.functions.auditCount().call()

    logs = contract.events.AuditAppended.get_logs(fromBlock=0)
    logs.sort(key=lambda e: (e["blockNumber"], e["logIndex"]))

    head = b"\x00" * 32
    for i, ev in enumerate(logs):
        a = ev["args"]
        block_number = ev["blockNumber"]
        head = compute_head(
            head,
            int(a["grantId"]),
            bytes(a["actionId"]),
            int(a["amount"]),
            bytes(a["paramsHash"]),
            int(a["code"]),
            block_number,
        )
        stored = a["head"]
        if bytes(stored) != head:
            print(f"Broken link at event index {i} (log index {ev['logIndex']})")
            print(f"  computed: 0x{head.hex()}")
            print(f"  emitted:  {Web3.to_hex(stored)}")
            return 1

    if Web3.to_hex(head) != Web3.to_hex(on_chain_head):
        print("Final head mismatch")
        print(f"  computed: 0x{head.hex()}")
        print(f"  contract: {Web3.to_hex(on_chain_head)}")
        return 1

    print(f"OK: {len(logs)} events, auditCount={on_chain_count}, head={Web3.to_hex(head)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
