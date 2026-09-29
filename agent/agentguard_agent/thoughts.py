import asyncio
import json
import threading
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
    """emit() is called from scenario code that may run in worker threads (sync FastAPI endpoints), while
    subscribers live on the event loop. asyncio.Queue is not thread-safe, so deliver via call_soon_threadsafe;
    otherwise the SSE stream only updated when something else happened to wake the loop."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subscribers: list[tuple[asyncio.AbstractEventLoop, asyncio.Queue[Thought]]] = []
        self._history: list[Thought] = []

    def emit(self, text: str) -> None:
        thought = Thought(text=text)
        with self._lock:
            self._history.append(thought)
            subs = list(self._subscribers)
        for loop, q in subs:
            try:
                loop.call_soon_threadsafe(q.put_nowait, thought)
            except RuntimeError:
                pass  # loop closed; subscriber is going away

    def history(self) -> list[Thought]:
        with self._lock:
            return list(self._history)

    def clear(self) -> None:
        with self._lock:
            self._history.clear()

    async def subscribe(self) -> AsyncIterator[Thought]:
        loop = asyncio.get_running_loop()
        q: asyncio.Queue[Thought] = asyncio.Queue()
        entry = (loop, q)
        with self._lock:
            backlog = list(self._history)
            self._subscribers.append(entry)
        try:
            for t in backlog:
                yield t
            while True:
                yield await q.get()
        finally:
            with self._lock:
                if entry in self._subscribers:
                    self._subscribers.remove(entry)


thought_bus = ThoughtBus()
