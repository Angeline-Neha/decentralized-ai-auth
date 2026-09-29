import json
import time
from pathlib import Path
from typing import Any

from web3 import Web3

from agentguard_agent.config import resolve_deployment_path, settings
from agentguard_agent.gateway_client import GatewayClient
from agentguard_agent.planner import NaivePlanner, execute_plan
from agentguard_agent.signer import IntentSigner
from agentguard_agent.thoughts import thought_bus
from agentguard_agent.tools import AgentTools, ZERO

def load_signer() -> IntentSigner:
    dep_path = resolve_deployment_path(settings)
    if not dep_path.is_file():
        raise FileNotFoundError(f"Deployment not found: {dep_path}. Run npm run deploy first.")
    dep = json.loads(dep_path.read_text(encoding="utf-8"))
    return IntentSigner(settings.agent_private_key, dep["chainId"], dep["address"])


def _tools(grant_id: int | None = None) -> tuple[AgentTools, GatewayClient]:
    gw = GatewayClient(settings.gateway_url)
    signer = load_signer()
    gid = grant_id if grant_id is not None else settings.grant_id
    return AgentTools(signer, gw, gid), gw


def run_scenario(name: str, grant_id: int | None = None) -> dict[str, Any]:
    thought_bus.clear()
    thought_bus.emit(f"Starting scenario: {name}")

    tools, gw = _tools(grant_id)
    try:
        if name == "normal_day":
            return _normal_day(tools)
        if name == "prompt_injection":
            return _prompt_injection(tools, gw)
        if name == "over_cap":
            return _over_cap(tools)
        if name == "replay_signature":
            return _replay_signature(tools, gw)
        if name == "unlisted_action":
            return _unlisted_action(tools)
        if name == "rate_limit_burst":
            return _rate_limit_burst(tools)
        raise ValueError(f"Unknown scenario: {name}")
    finally:
        gw.close()


def _normal_day(tools: AgentTools) -> dict[str, Any]:
    thought_bus.emit("Plan: check calendar, then send team email.")
    results = []
    results.append(tools.read_calendar().gateway)
    results.append(
        tools.send_email(
            "team@corp.example",
            "Morning brief",
            "Calendar reviewed; no conflicts.",
        ).gateway
    )
    return {"scenario": "normal_day", "results": results}


def _prompt_injection(tools: AgentTools, gw: GatewayClient) -> dict[str, Any]:
    inbox = gw.inbox()
    planner = NaivePlanner()
    steps = planner.plan_from_inbox(inbox)
    results = execute_plan(tools, steps)
    return {"scenario": "prompt_injection", "results": results}


def _over_cap(tools: AgentTools) -> dict[str, Any]:
    # 0.5 ETH — above typical 0.1–0.2 per-call cap in demos
    amount = Web3.to_wei(0.5, "ether")
    payee = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
    thought_bus.emit("Malicious / mistaken large invoice payment requested.")
    r = tools.pay_invoice("INV-HUGE", amount, payee).gateway
    return {"scenario": "over_cap", "results": [r]}


def _unlisted_action(tools: AgentTools) -> dict[str, Any]:
    thought_bus.emit("Attempting action not in grant whitelist: transfer_funds")
    amount = Web3.to_wei(0.05, "ether")
    r = tools.transfer_funds(amount, "0x000000000000000000000000000000000000dEaD").gateway
    return {"scenario": "unlisted_action", "results": [r]}


def _rate_limit_burst(tools: AgentTools) -> dict[str, Any]:
    results = []
    for i in range(6):
        thought_bus.emit(f"Burst call {i + 1}/6")
        results.append(tools.read_calendar().gateway)
    return {"scenario": "rate_limit_burst", "results": results}


def _replay_signature(tools: AgentTools, gw: GatewayClient) -> dict[str, Any]:
    grant_id = tools._grant_id
    nonce = gw.nonce(grant_id)
    deadline = 2000000000
    params = {"view": "replay-test"}
    thought_bus.emit("Signing intent for read_calendar (will replay same signature)")
    _msg, sig = tools._signer.sign_intent(
        grant_id=grant_id,
        action="read_calendar",
        payee=ZERO,
        amount_wei=0,
        params=params,
        nonce=nonce,
        deadline=deadline,
    )
    first = gw.submit_intent(
        grant_id=grant_id,
        action="read_calendar",
        signature=sig,
        params=params,
        nonce=nonce,
        deadline=deadline,
    )
    thought_bus.emit(f"First submit: {first.get('outcome')}")
    second = gw.submit_intent(
        grant_id=grant_id,
        action="read_calendar",
        signature=sig,
        params=params,
        nonce=nonce,
        deadline=deadline,
    )
    thought_bus.emit(f"Replay submit: {second.get('outcome')} ({second.get('reason', '')})")
    return {"scenario": "replay_signature", "results": [first, second]}


SCENARIOS = [
    "normal_day",
    "prompt_injection",
    "over_cap",
    "unlisted_action",
    "replay_signature",
    "rate_limit_burst",
]
