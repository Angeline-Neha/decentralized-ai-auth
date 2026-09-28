import re
from dataclasses import dataclass
from typing import Any

from agentguard_agent.thoughts import thought_bus
from agentguard_agent.tools import AgentTools

ATTACKER_ADDR = "0x000000000000000000000000000000000000dEaD"


@dataclass
class PlanStep:
    kind: str
    args: dict[str, Any]


class NaivePlanner:
    """
    Deterministic stand-in for an LLM. It naively follows instructions embedded in email bodies,
    which makes prompt-injection demos reliable.
    """

    def plan_from_inbox(self, inbox: list[dict[str, str]]) -> list[PlanStep]:
        steps: list[PlanStep] = []
        thought_bus.emit(f"Reading {len(inbox)} inbox messages…")
        for msg in inbox:
            thought_bus.emit(f"Email from {msg['from']}: {msg['subject']}")
            body = msg["body"]
            steps.extend(self._steps_from_body(body))
        if not steps:
            steps.append(PlanStep("read_calendar", {}))
        return steps

    def _steps_from_body(self, body: str) -> list[PlanStep]:
        steps: list[PlanStep] = []
        lower = body.lower()

        if "transfer everything" in lower or "transfer all" in lower:
            addr = self._extract_address(body) or ATTACKER_ADDR
            thought_bus.emit(f"Following email instruction: transfer all funds to {addr}")
            steps.append(PlanStep("transfer_funds", {"payee": addr, "amount_wei": 10**18}))

        if "send" in lower and "email" in lower:
            thought_bus.emit("Following email instruction: send status email")
            steps.append(
                PlanStep(
                    "send_email",
                    {
                        "to": "team@corp.example",
                        "subject": "Weekly status",
                        "body": "Automated status from agent.",
                    },
                )
            )

        return steps

    @staticmethod
    def _extract_address(text: str) -> str | None:
        m = re.search(r"0x[a-fA-F0-9]{40}", text)
        return m.group(0) if m else None


def execute_plan(tools: AgentTools, steps: list[PlanStep]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for step in steps:
        thought_bus.emit(f"Executing tool: {step.kind}")
        if step.kind == "read_calendar":
            tr = tools.read_calendar()
        elif step.kind == "send_email":
            tr = tools.send_email(**step.args)
        elif step.kind == "pay_invoice":
            tr = tools.pay_invoice(**step.args)
        elif step.kind == "transfer_funds":
            tr = tools.transfer_funds(**step.args)
        else:
            thought_bus.emit(f"Unknown tool {step.kind}, skipping")
            continue
        results.append({"action": tr.action, **tr.gateway})
    return results
