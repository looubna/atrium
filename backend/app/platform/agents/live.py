"""Live conversation engine contract.

The gateway speaks only to `LiveEngine`. The ADK implementation lives in
`live_adk.py`; `FakeLiveEngine` drives tests and local development without
Google Cloud. Swapping to another Live model or SDK means a new engine, not a
new gateway.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol

ToolName = Literal["end_interview", "give_floor"]


@dataclass(frozen=True, slots=True)
class PanelMember:
    """A colleague on a panel call who asks their own questions, in their own voice."""

    name: str
    role: str
    voice: str
    # What they say when the lead introduces the panel.
    hello: str = ""
    # What their questions explore, in terms that fit any job.
    focus: str = ""

    @property
    def first_name(self) -> str:
        return self.name.split()[0]


@dataclass(frozen=True, slots=True)
class LiveAgentSpec:
    """What a module asks the live engine to be for one session."""

    system_instruction: str
    opening_message: str
    voice_name: str = "Charon"
    language_code: str = "en-US"
    # Candidates pause to think; a long silence window avoids cutting them off.
    silence_duration_ms: int = 1200
    tools: tuple[ToolName, ...] = ("end_interview",)
    resumption_handle: str | None = None
    # Colleagues who speak for themselves; the gateway runs their turns (see panel.py).
    panel: tuple[PanelMember, ...] = ()
    #: One line about the interview, for writing the colleagues' questions.
    panel_brief: str = ""
    #: The lead interviewer's full name, as on the call.
    lead_name: str = ""


@dataclass(frozen=True, slots=True)
class AudioOut:
    pcm: bytes
    kind: Literal["audio"] = "audio"


@dataclass(frozen=True, slots=True)
class InputText:
    text: str
    finished: bool = False
    kind: Literal["input_text"] = "input_text"


@dataclass(frozen=True, slots=True)
class OutputText:
    text: str
    finished: bool = False
    kind: Literal["output_text"] = "output_text"


@dataclass(frozen=True, slots=True)
class Interrupted:
    kind: Literal["interrupted"] = "interrupted"


@dataclass(frozen=True, slots=True)
class TurnComplete:
    kind: Literal["turn_complete"] = "turn_complete"


@dataclass(frozen=True, slots=True)
class ResumptionHandle:
    handle: str
    kind: Literal["resumption"] = "resumption"


@dataclass(frozen=True, slots=True)
class Usage:
    prompt_tokens: int
    response_tokens: int
    total_tokens: int
    kind: Literal["usage"] = "usage"


@dataclass(frozen=True, slots=True)
class EndRequested:
    reason: str
    kind: Literal["end_requested"] = "end_requested"


PanelPurpose = Literal["hello", "question"]


@dataclass(frozen=True, slots=True)
class PanelTurn:
    """The lead interviewer gave a colleague the floor: they say these words now."""

    colleague: str
    words: str
    purpose: PanelPurpose = "question"
    kind: Literal["panel_turn"] = "panel_turn"


@dataclass(frozen=True, slots=True)
class EngineError:
    code: str
    kind: Literal["error"] = "error"


LiveEvent = (
    AudioOut
    | InputText
    | OutputText
    | Interrupted
    | TurnComplete
    | ResumptionHandle
    | Usage
    | EndRequested
    | PanelTurn
    | EngineError
)


class LiveConnection(Protocol):
    async def send_audio(self, pcm16k: bytes) -> None: ...

    async def send_text(self, text: str) -> None: ...

    def events(self) -> AsyncIterator[LiveEvent]: ...

    async def close(self) -> None: ...


class LiveEngine(Protocol):
    async def connect(self, spec: LiveAgentSpec, *, user_id: str, session_id: str) -> LiveConnection: ...


class LiveAgentFactory(Protocol):
    """Provided by a module (service name "live_agent_factory")."""

    async def build(self, *, uid: str, session_id: str, session: dict[str, Any], resumed: bool) -> LiveAgentSpec: ...

    def is_coding_session(self, session: dict[str, Any]) -> bool: ...


@dataclass(frozen=True, slots=True)
class TurnDirection:
    """What a module wants done once a turn has been said and written.

    `note` is sent into the live session as text. Anything sent that way prompts the
    model to answer, so a module whose note is meant for a *later* turn sets `silent`:
    the gateway then discards whatever the model generates in reply, and the note sits
    in the conversation until the user speaks again. That is how the debate module
    steers its opponent without adding a pause before every reply.
    """

    note: str | None = None
    silent: bool = False
    #: Module state to persist with the live session, so a reconnect resumes mid-argument.
    state: dict[str, Any] | None = None


Speaker = Literal["candidate", "interviewer"]


class TurnObserver(Protocol):
    """Optional module service ("turn_observer"): sees each turn, may steer the next one.

    Called off the event loop, one turn at a time, after the turn has been written to the
    log. It must not raise — the gateway treats a failure as "no direction" and the
    conversation carries on — and it must not block for long, because the user is waiting
    to be answered.
    """

    async def on_turn(
        self,
        *,
        uid: str,
        session_id: str,
        session: dict[str, Any],
        speaker: Speaker,
        text: str,
        at_ms: int,
        time_remaining_ms: int,
        state: dict[str, Any] | None,
        dropped_last: bool,
    ) -> TurnDirection: ...

    async def on_end(
        self, *, uid: str, session_id: str, state: dict[str, Any] | None
    ) -> dict[str, Any] | None:
        """Final state to store on the session, for the evaluator to read."""
        ...


# ---------------------------------------------------------------------------
# Fake engine for tests and local development


@dataclass
class FakeLiveConnection:
    spec: LiveAgentSpec
    received_audio_bytes: int = 0
    received_text: list[str] = field(default_factory=list)
    closed: bool = False
    _queue: asyncio.Queue[LiveEvent | None] = field(default_factory=asyncio.Queue)

    async def send_audio(self, pcm16k: bytes) -> None:
        self.received_audio_bytes += len(pcm16k)

    async def send_text(self, text: str) -> None:
        self.received_text.append(text)

    def inject(self, *events: LiveEvent) -> None:
        for event in events:
            self._queue.put_nowait(event)

    async def events(self) -> AsyncIterator[LiveEvent]:
        while True:
            event = await self._queue.get()
            if event is None:
                return
            yield event

    async def close(self) -> None:
        self.closed = True
        self._queue.put_nowait(None)


@dataclass
class FakeLiveEngine:
    """Speaks a scripted opening turn; tests inject further events."""

    opening_pcm_ms: int = 400
    connections: list[FakeLiveConnection] = field(default_factory=list)
    fail_connect: bool = False
    # False: the interviewer says nothing on connect, like a call dropped before the greeting.
    speak_on_connect: bool = True

    async def connect(self, spec: LiveAgentSpec, *, user_id: str, session_id: str) -> LiveConnection:
        if self.fail_connect:
            raise ConnectionError("fake engine unavailable")
        conn = FakeLiveConnection(spec)
        silence = b"\x00\x00" * (24_000 * self.opening_pcm_ms // 1000)
        if not self.speak_on_connect:
            self.connections.append(conn)
            return conn
        conn.inject(
            ResumptionHandle(f"handle-{session_id}-{len(self.connections)}"),
            OutputText("Tell me about a project you're proud of.", finished=True),
            AudioOut(silence),
            TurnComplete(),
        )
        self.connections.append(conn)
        return conn
