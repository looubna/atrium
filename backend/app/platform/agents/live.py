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

ToolName = Literal["end_interview", "give_floor", "write_on_board"]


@dataclass(frozen=True, slots=True)
class PanelMember:
    """A colleague on a panel who speaks for themselves, in their own voice."""

    name: str
    role: str
    voice: str
    # What they say when the lead introduces the panel.
    hello: str = ""
    # What their questions explore, in terms that fit any job.
    focus: str = ""
    #: How many questions they may ask in the whole interview, or None for no declared share.
    #:
    #: A panel in a room is not a relay of equals: one person runs it and the others come in once
    #: or twice. Left to itself the lead shares the questioning out evenly, which is the one thing
    #: such a panel never does, so the share is set here and held to by the gateway. Zero is the
    #: person who sits in to listen — they say hello and nothing else.
    #:
    #: None means nobody has decided: the lead shares the questioning out as it sees fit and the
    #: gateway never refuses a hand-over. That is how a panel on a video call has always run and
    #: how it stays — the share is something the meeting room asks for, not the default.
    questions: int | None = None

    @property
    def first_name(self) -> str:
        return self.name.split()[0]

    @property
    def asks(self) -> bool:
        return self.questions != 0


@dataclass(frozen=True, slots=True)
class LiveAgentSpec:
    """What a module asks the live engine to be for one session."""

    system_instruction: str
    opening_message: str
    voice_name: str = "Charon"
    language_code: str = "en-US"
    # Candidates pause to think, and being asked a second question while still gathering an answer
    # to the first is the worst thing the interviewer can do. So this is longer than it needs to be
    # for a brisk reply: the gateway's own turn-end note (panel.py) is what keeps a finished answer
    # from hanging, and it deliberately waits longer still so the two never both fire.
    silence_duration_ms: int = 2000
    tools: tuple[ToolName, ...] = ("end_interview",)
    resumption_handle: str | None = None
    # Colleagues who speak for themselves; the gateway runs their turns (see panel.py).
    panel: tuple[PanelMember, ...] = ()
    #: One line about the interview, for writing the colleagues' questions.
    panel_brief: str = ""
    #: The lead interviewer's full name, as on the call.
    lead_name: str = ""
    #: The colleagues introduce themselves as soon as the lead's opening has been heard, spoken by
    #: the gateway from their `hello` lines (voiced in advance), instead of waiting for the lead to
    #: hand them the floor. The in-person panel: a room where someone who never says hello is odd.
    scripted_hellos: bool = False
    #: Colleagues' lines are voiced by the fast text-to-speech (see `speak_as_panelist(fast=)`).
    fast_panel_voices: bool = False
    #: The model may end the session at any time. Off for interviews and exams, which must not stop
    #: minutes in on a rude remark; on for a conversation the user closes by saying goodbye.
    may_end_early: bool = False
    #: The user holds the floor (a presentation): after the opening, nothing the model says reaches
    #: them — no voice, no hand-over, no ending — until the page sends `release` (they take
    #: questions), when `release_note` is sent to the model. Off for every other kind of session.
    hold_floor: bool = False
    #: While the floor is held, whether the model hears the user (and so knows the talk) or not.
    hears_while_held: bool = True
    release_note: str = ""
    #: At most one question reaches the user per turn: a colleague's question in a turn where the lead
    #: (or another colleague) already asked one is dropped, and so is one put before the user has
    #: answered the last question at all. The prompt asks for this; models forget.
    one_question_per_turn: bool = False


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
class BoardWrite:
    """The examiner wrote on the board: a problem, its numbers, a formula.

    Spoken mathematics is unusable — "x squared over two pi" is not something a student can
    work from — so anything with numbers in it is written up as well as said.
    """

    text: str
    kind: Literal["board_write"] = "board_write"


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
    | BoardWrite
    | EngineError
)


class LiveConnection(Protocol):
    async def send_audio(self, pcm16k: bytes) -> None: ...

    async def send_text(self, text: str) -> None: ...

    async def send_image(self, jpeg: bytes) -> None:
        """A still the model should look at: the board as the student has written it by hand."""
        ...

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
    received_images: list[bytes] = field(default_factory=list)
    closed: bool = False
    _queue: asyncio.Queue[LiveEvent | None] = field(default_factory=asyncio.Queue)

    async def send_audio(self, pcm16k: bytes) -> None:
        self.received_audio_bytes += len(pcm16k)

    async def send_text(self, text: str) -> None:
        self.received_text.append(text)

    async def send_image(self, jpeg: bytes) -> None:
        self.received_images.append(jpeg)

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
