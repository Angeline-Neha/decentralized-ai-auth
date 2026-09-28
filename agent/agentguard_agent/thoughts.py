import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class Thought:
    text: str
    at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_json(self) -> str:
        return json.dumps({"text": self.text, "at": self.at})


class ThoughtBus:
    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue[Thought]] = []
        self._history: list[Thought] = []

    def emit(self, text: str) -> None:
        thought = Thought(text=text)
        self._history.append(thought)
        for q in self._subscribers:
            q.put_nowait(thought)

    def history(self) -> list[Thought]:
        return list(self._history)

    def clear(self) -> None:
        self._history.clear()

    async def subscribe(self) -> AsyncIterator[Thought]:
        q: asyncio.Queue[Thought] = asyncio.Queue()
        self._subscribers.append(q)
        try:
            for t in self._history:
                yield t
            while True:
                yield await q.get()
        finally:
            self._subscribers.remove(q)


thought_bus = ThoughtBus()
