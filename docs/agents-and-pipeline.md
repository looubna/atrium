# Agents, competencies and the processing pipeline

## Agent 1 — Interview Strategist

`backend/app/modules/interview/agents/strategist.py`, run as a background task.

1. **Research** (`gateway.research`): an ADK agent whose only tool is Google Search.
   It prefers official careers pages and the posting, then candidate-reported interview
   experiences, then recent news, and must name the website for each fact. Grounding
   metadata supplies the sources actually retrieved (title, domain) and Google's Search
   Suggestions markup, which the app shows in a sandboxed frame as Google requires.
2. **Blueprint** (`gateway.generate`, schema `BlueprintDraft`): turns the application,
   resume profile, research notes, sources, allowed round types and each type's
   competency catalog into rounds. The number, order and types are not fixed.
3. **Validation** (`blueprint.validate_blueprint`): 1–12 rounds renumbered in order;
   round types parsed from values, labels and common aliases; competencies filtered to
   the round's catalog (topped up if too few); reported questions kept only when they
   cite a retrieved source; high confidence without evidence downgraded to medium;
   durations outside 5–240 minutes treated as unknown; all text cleaned; the summary
   always says "Likely". One repair attempt with the problems; then the generation fails.

The user can edit rounds (title, type, duration, order, add/remove); edits are
validated the same way and saved as a new version.

Without a company (general practice) research is skipped.

**Live progress.** The journey streams while it is built, so the user isn't left waiting:

- research starts immediately, in parallel with a resume that is still being read (the
  blueprint stage waits up to 90 s for its profile);
- both model calls stream (ADK `StreamingMode.SSE`) with Gemini's `LOW` thinking level, which
  cut the time to first text from ~13 s to ~2.5 s in measurements on Gemini 3.8 Flash;
- the worker writes `blueprint.progress` — stage, search queries, source domains, the latest
  research notes, the process summary and each round as soon as its JSON object is complete
  (`platform/ai/stream_json.py`) — throttled to about one write per second;
- the app listens to the blueprint and resume documents with Firestore listeners (read-only,
  owner-scoped) and falls back to polling the API if a listener can't run.

Streamed rounds are display-only previews; the validated journey replaces them when ready.

## Agent 2a — Live interviewer

`modules/interview/agents/live_interviewer.py` builds the instruction;
`platform/agents/live_adk.py` runs Gemini Live; `platform/agents/live_gateway.py`
relays and records.

The instruction contains the round (type, title, format, length), likely question
areas, competencies to listen for (never to be mentioned), resume/role/company focus,
retry targets and questions to avoid, and behaviour rules: one question at a time,
follow up for specifics, challenge weak reasoning, clarify, adapt difficulty, no
feedback during the interview, wrap up near time and call `end_interview`. Untrusted
material is sanitized and placed in labelled data blocks the model is told not to obey.
A panel is one speaking persona on behalf of three interviewers. Coding and system-design
rounds tell the interviewer about the shared editor snapshots.

Live configuration: audio responses with a fixed voice, input and output transcription,
voice activity detection with low end-of-speech sensitivity and ~1.2 s silence (people
pause to think), session resumption, and context compression at ~32k tokens (the round
plan stays in the instruction; evaluation uses the full recording, not the live context).

On a phone speaker the app sends silence while the interviewer speaks (plus 300 ms), so
the model doesn't hear itself; **Interrupt** cuts playback, **Headphones** allows
talking over the interviewer.

## Agent 2b — Evaluator (coach)

`modules/interview/agents/evaluator.py`, schema `platform/feedback/schemas.py`.

Input: round type and competencies, all communication competencies, the transcript as
numbered segments with millisecond times and speakers, measured delivery metrics, the
last code snapshots and previous scores. Output: overall score, round and
communication scores with confidence and rationale, at most 12 moments (strengths and
improvements), strengths, improvement areas, and a question-family classification of
each interviewer question.

Validation (`platform/feedback/validators.py`) before anything is stored:

- scores are integers 0–100 for known competencies of the right layer; duplicates dropped;
- timestamps are non-negative, end after start, inside the recording (1 s tolerance),
  overlap the cited candidate segments and are snapped to them; moments ≤ 90 s;
- the evidence quote must be a verbatim (normalized) substring of the cited candidate text;
- interviewer segments can't be cited as evidence; `questionId` must be an interviewer segment;
- improvements need a recommendation; strengths have no "better example";
- overlapping events for the same competency are merged (higher severity/confidence
  wins); the list is capped at 15, keeping at least one strength;
- event IDs are deterministic per evaluation run, so re-writing a run cannot duplicate.

If more than half the moments are invalid, or scores are missing, the evaluation is
rejected; one repair attempt is made with the problems, then the step fails.

## The oral exam agents

`backend/app/modules/exam`. The student gives a subject and whatever material their
course handed out; everything else is read off the material.

**Exam Analyst** (`agents/analyst.py`, a background task):

1. **Knowledge map** (`gateway.generate`, schema `KnowledgeMapDraft`): reads the text
   extracted from every material — and the images among them, straight from the bucket —
   and returns what each file is (lecture slides, textbook, personal notes, syllabus,
   past exam, problem set), the course's scope, the topics an examiner is likely to press
   on with the weight the material gives them, the learning objectives and the questions
   an examiner would plausibly ask. The student never labels a file.
2. **Exam style**, only when the material didn't settle it: a Google-Search-grounded
   agent looks up how this course and institution examine (using any links the student
   added — the API never fetches a user-supplied URL itself), then one structured call
   decides between "the professor asks questions" and "problems at the board".
3. **Validation** (`knowledge.validate_knowledge_map`): material ids must reference real
   materials and every material is accounted for; topics are capped, cleaned and dropped
   when nothing survives cleaning; an unrecognised style becomes `unknown`; a confident
   style with no evidence is downgraded. One repair attempt, then the analysis fails.

If the style is still `unknown` or only weakly supported, the app asks the student the
one optional question about it — and never asks again once they have answered.

**Live examiner** (`agents/examiner.py`): the instruction is built from the knowledge
map — topics with their weights, objectives, the questions drawn from the material — and
from the style. A spoken exam sits across a desk; a board exam sets one problem at a
time, reads the board's snapshots as the student writes (the shared-editor channel of
the live protocol), and asks a question that unlocks the next step instead of giving it.

**Exam evaluator** (`agents/evaluator.py`): the same pipeline as the interview's, scoring
`exam.oral.*` or `exam.board.*` plus the communication competencies, and judging whether
the answers were actually right and deep enough before how they were delivered.

## Explained scores, voice and body language

Every score comes with `measured` (what was observed, with numbers), `meaning` (one plain
sentence), `rationale` (why this number) and `toReach100` (2–3 concrete steps); delivery
scores also carry a platform-computed `metric` (value, unit, target, verdict). Score bands:
80+ strong, 60–79 good, 40–59 developing, under 40 needs work. The app links each skill to a
Practice Center drill (`src/modules/interview/feedback/practiceLinks.ts`).

- **Voice** (`platform/media/prosody.py`): per answer, pitch movement in semitones (flat below
  2) and whether the voice fades at the end (last fifth ≥ 6 dB quieter). Gemini also listens
  to the candidate's FLAC chunks (read from the processing bucket) for intonation,
  articulation, projection and confidence.
- **Body language** (`src/platform/media/faceMetrics.ts`, `platform/media/visual.py`): MediaPipe
  Face Landmarker runs on the device at 4 fps and uploads per-second numbers; the worker turns
  them into eye contact, smiling and restless-movement percentages and flags answers with
  little eye contact. With the `video_analysis` consent, Gemini also watches the uploaded
  video at low resolution; evaluation waits up to about 2.5 minutes for a video still
  uploading. Body-language competencies are scored only when the camera was on.
  In person (`context.mode == "in_person"`), eye contact means looking at the interviewers on
  screen rather than into the lens, and panels also send `toSpeaker` (the share of each second
  spent turned toward whoever was speaking), reported as "turned toward whoever was asking".
- The evaluator never comments on accent, natural pitch, appearance or background.

## Delivery metrics

`platform/transcripts/metrics.py` measures from word timestamps: speaking time, words
per minute overall and per segment (fast > 185, slow < 100 for segments ≥ 8 s), filler
words (um/uh/…, "you know", "I mean", "sort of", "kind of", and "like" in filler
positions), repeated words, and pauses ≥ 2.5 s. The evaluator cites these by segment.

## Competency model

Layer 1 — module competencies: per interview round type
(`modules/interview/catalogs.py`: coding, system design, case, technical, behavioral,
hiring manager, screening, presentation, take-home review) and per oral exam style
(`modules/exam/catalogs.py`: spoken examination, and work at the board). Layer 2 — communication (`platform/competencies/catalog.py`):
clarity, answer structure, conciseness, relevance, fluency, pace, filler words,
repetition, listening, professional vocabulary, explaining reasoning, handling
questions, delivery, storytelling.

The profile (`platform/competencies/profile.py`) writes one history entry per session
and competency (re-processing replaces it) and recomputes each competency from the last
five entries weighted by confidence. The delta compares with the previous attempt of the
same application and round when there is one, otherwise the latest comparable attempt.

## Retries

`modules/interview/retry.py` (which `modules/exam/retry.py` reuses with the exam
catalog) targets up to three weakest competencies (score < 75,
confidence above low), keeps the question families that tested them and lists the
questions already asked (plus earlier exclusions). The next attempt's interviewer
instruction asks for new questions on those skills and forbids the listed questions.

## Transcription choice

Speech-to-Text (Chirp 3) produces word-level timestamps that feedback must point to; a
generative model's timestamps are not reliable enough for click-to-seek. Gemini is used
for judgement over the transcript and metrics. Only the candidate track is transcribed
(the interviewer's words come from the live session with playback times), so speaker
diarization isn't needed. Words that are the interviewer's voice leaking into the
microphone during playback are removed.

## Processing pipeline

`platform/jobs/pipeline.py`; one job per session (`jobs/sess-{sessionId}`); each
processing run has its own run ID.

| Step | Work | Session status |
|---|---|---|
| `prepare_submit_stt` | rebuild candidate audio (placed by capture time, re-sent frames dropped, gaps silent) and interviewer audio (placed at playback times, cut at interruptions); mix `audio.m4a`; cut 15-minute FLAC chunks; start batch recognition | `transcribing` |
| `poll_stt` | re-enqueue every 20 s until done (≤ ~66 min); parse words; assemble transcript with interviewer turns; store `transcript.json` | `analyzing` |
| `evaluate_persist` | metrics → evaluator → validation → store evaluation run and events → competency history and profile → retry plan → session summary (in a transaction that aborts if the account is being deleted) | `completed` |

Reliability:

- **Claiming.** A step runs only if the job's run ID and step match the task and it
  isn't leased by a running attempt (35-minute lease). Duplicate or late tasks return
  `skipped`.
- **Task names** include job, run, step and sequence, so enqueueing is idempotent and
  re-processing never collides.
- **Failures.** Transient errors are retried by Cloud Tasks (up to 5 recorded
  failures). Permanent failures (no candidate audio, invalid recognition, timeouts)
  mark the job and session `failed` with the step and whether a retry could help.
- **Re-processing** starts a new run; tasks of the old run are ignored.
- **Reconciler** (every 10 minutes) ends live sessions abandoned for 15 minutes and
  re-enqueues jobs stuck for 40 minutes.

Local development runs the same steps in-process (`LocalInlineQueue`).
