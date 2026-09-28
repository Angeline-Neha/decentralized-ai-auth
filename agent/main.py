import asyncio
import sys
from pathlib import Path

_root = Path(__file__).resolve().parent
if str(_root) not in sys.path:
    sys.path.insert(0, str(_root))

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agentguard_agent.config import settings
from agentguard_agent.scenarios import SCENARIOS, run_scenario
from agentguard_agent.thoughts import thought_bus

app = FastAPI(title="AgentGuard Agent Simulator", version="0.1.0")


class RunRequest(BaseModel):
    scenario: str
    grantId: int | None = None


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "gateway": settings.gateway_url}


@app.get("/scenarios")
def list_scenarios() -> dict[str, list[str]]:
    return {"scenarios": SCENARIOS}


@app.post("/run")
def run(req: RunRequest) -> dict:
    if req.scenario not in SCENARIOS:
        raise HTTPException(400, f"Unknown scenario. Choose from: {SCENARIOS}")
    try:
        return run_scenario(req.scenario, req.grantId)
    except FileNotFoundError as e:
        raise HTTPException(503, str(e)) from e
    except Exception as e:
        raise HTTPException(500, str(e)) from e


@app.get("/thoughts")
async def thoughts_stream() -> StreamingResponse:
    async def gen():
        async for t in thought_bus.subscribe():
            yield f"data: {t.to_json()}\n\n"
            await asyncio.sleep(0)

    return StreamingResponse(gen(), media_type="text/event-stream")


@app.get("/thoughts/history")
def thoughts_history() -> dict:
    return {"thoughts": [{"text": t.text, "at": t.at} for t in thought_bus.history()]}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=settings.agent_port, reload=True)
