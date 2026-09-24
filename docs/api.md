# API reference

Base path `/api/v1`. Every endpoint requires `Authorization: Bearer <Firebase ID token>`
and, where App Check is enforced, `X-Firebase-AppCheck: <token>`. The user is always the
token's uid; IDs in paths and bodies are resolved under that user, so another user's ID
returns 404.

## Errors

RFC 9457 problem details (`application/problem+json`):

```json
{"type": "https://atrium.app/problems/quota_exceeded", "title": "You've reached your usage limit",
 "status": 429, "code": "quota_exceeded", "requestId": "…", "metric": "sessionsCreated", "resetsAt": "…"}
```

Stable `code` values include `unauthenticated`, `invalid_token`, `token_revoked`,
`app_check_failed`, `forbidden`, `consent_required`, `email_not_verified`,
`account_deleting`, `recent_login_required`, `not_found`, `conflict`,
`precondition_failed`, `validation_failed` (field locations only, never values),
`payload_too_large`, `unsupported_media_type`, `rate_limited` (`Retry-After`),
`quota_exceeded`, `unavailable`.

## Account

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | Profile (created on first call), consents with the current consent version |
| PATCH | `/me` | `{displayName}` |
| PUT | `/me/consents/{ai_processing\|recording}` | `{accepted, version}`; accepting requires the current version |
| GET | `/me/usage` | Plan limits, this month's and today's usage |
| DELETE | `/me` | 202; requires a sign-in within 10 minutes |

## Interview module

| Method | Path | Notes |
|---|---|---|
| POST | `/interview/resumes` | multipart `file` (PDF, DOCX, TXT, MD; ≤ 10 MB); requires AI consent; 201 `processing` |
| GET | `/interview/resumes` | status and profile summary |
| DELETE | `/interview/resumes/{id}` | removes the file and record |
| POST | `/interview/applications` | `{id (UUIDv4), company, roleTitle, location, jobDescription, resumeId?}`; repeatable with the same id |
| GET | `/interview/applications` · `/interview/applications/{id}` | |
| DELETE | `/interview/applications/{id}` | with its blueprints |
| POST | `/interview/applications/{id}/blueprints:generate` | 202 `{blueprintId}`; consent, verified email, kill switch, daily quota; 409 while one is running |
| GET | `/interview/applications/{id}/blueprints/{bpId}` | includes `competencyNames` |
| PUT | `/interview/applications/{id}/blueprints/{bpId}` | header `If-Match: "<version>"`; `{rounds: [{id?, type, customLabel?, title, format?, durationMinutes?}]}`; returns the new version |
| GET | `/interview/applications/{id}/blueprints/{bpId}/rounds/{roundId}/guide` | the round's preparation guide, 404 until written |
| POST | `/interview/applications/{id}/blueprints/{bpId}/rounds/{roundId}/guide` | writes (or rewrites) it and waits: `{approach, questions[{question, reported, sources, assesses, outline, sampleAnswer, resumeHook, pitfalls}], standOut[{title, idea, how, why, effort}], questionsToAsk[{question, why}], hasResume}`; consent, verified email, kill switch, `roundGuides` daily quota (free 15, internal 100); 404 unless the journey is ready |
| POST | `/interview/sessions` | `{id, practice: "general_behavioral"}` or `{id, applicationId, blueprintId, roundId}` plus `mode`, `panel`, `durationMinutes` |
| POST | `/interview/sessions/{id}/retry` | `{id}`; next attempt targeting the weakest competencies |
| POST | `/interview/sessions/{id}/avatar-session` | Short-lived avatar token for the interviewer's face. The server chooses the face and voice from the round type; the provider key never reaches the client. 503 when no provider is configured or it is unreachable, and the interview then runs on audio alone |

## Oral exam module

The student gives a subject and whatever material they have; what each file is, what the
exam covers and how it is run are worked out from the material, never asked.

| Method | Path | Notes |
|---|---|---|
| POST | `/exam/courses` | `{id (UUIDv4), subject}`; repeatable with the same id |
| GET | `/exam/courses` · `/exam/courses/{id}` | |
| DELETE | `/exam/courses/{id}` | with its materials, analyses and stored files |
| POST | `/exam/courses/{id}/materials` | multipart `file` (PDF, DOCX, PPTX, TXT, MD, PNG/JPEG/WEBP; ≤ 40 MB); requires AI consent; 201 `processing`, then the text is extracted |
| POST | `/exam/courses/{id}/materials/link` | `{id, url, title?}`; the URL is never fetched by the API — it is given to the grounded analyst |
| POST | `/exam/courses/{id}/materials/text` | `{id, text (≤ 50 000 chars), title?}` |
| GET | `/exam/courses/{id}/materials` | each material's status and detected type |
| DELETE | `/exam/courses/{id}/materials/{materialId}` | |
| PUT | `/exam/courses/{id}/style` | `{style: oral_questions\|board_work\|unknown}`; the student's own answer, which wins over the inference. `unknown` clears it |
| POST | `/exam/courses/{id}/analyses:generate` | 202 `{analysisId}`; consent, verified email, kill switch, daily quota; 409 while one is running |
| GET | `/exam/courses/{id}/analyses/{analysisId}` | the knowledge map, each material's type, the exam style with its evidence, and `effectiveStyle` |
| POST | `/exam/sessions` | `{id, courseId?, analysisId?, style?, durationMinutes}`; the style is settled server-side (student's answer, then the analysis, then a spoken exam) |
| POST | `/exam/sessions/{id}/retry` | `{id}`; the same exam again with new questions |
| POST | `/exam/sessions/{id}/avatar-session` | short-lived token for the examiner's face; 503 means the exam runs on voice alone |

## Sessions (all modules)

| Method | Path | Notes |
|---|---|---|
| GET | `/sessions/{id}` | status, processing status, summary, retry plan |
| GET | `/sessions/{id}/feedback` | evaluation, events (sorted by time), transcript link, competency names |
| GET | `/sessions/{id}/media/playback-url?kind=audio\|video` | 90-minute inline signed link; video includes `startedAtMediaMs` |
| GET | `/sessions/{id}/media/download-url?kind=audio\|video` | 10-minute attachment link and `fileName` |
| POST | `/sessions/{id}/media/video-upload` | `{contentType: video/mp4\|video/webm, sizeBytes ≤ 1 GiB, startedAtMediaMs}`; recording consent; live or ended session; 201 `{uploadId, uploadUrl, chunkBytes}` — a Cloud Storage resumable upload session for that exact object |
| POST | `/sessions/{id}/media/video-complete` | `{uploadId}`; verifies the stored size, then processes the video (`processing` → `ready` or `failed`); repeatable |

Video uploads go straight to Cloud Storage: `PUT` chunks of `chunkBytes` to `uploadUrl` with
`Content-Range: bytes a-b/total`; `308` + `Range: bytes=0-n` means continue from `n+1`,
`200`/`201` means complete; after an error, `PUT` an empty body with
`Content-Range: bytes */total` to learn what arrived.
| POST | `/sessions/{id}/reprocess` | 202; failed or completed sessions; rate-limited and quota'd |

## Progress

| Method | Path | Notes |
|---|---|---|
| GET | `/competencies` | profile with names, communication first |
| GET | `/competencies/{id}/history?limit=20` | scores over time |

## Practice Center

| Method | Path | Notes |
|---|---|---|
| POST | `/practice/rounds` | multipart: `audio` (webm/mp4/ogg/wav, ≤ 8 MB, first 200 s analysed), `drillId`, `prompt` (JSON), `localDate`, `prepUsedMs`, `speakSeconds`, `eyeContactPct?`. Needs `ai_processing` consent; daily quota `practiceRounds` (free 40, internal 200). Returns measured and AI-rated `metrics` (each labelled `source`), `feedback` (headline, strengths and improvements with transcript quotes, next try), `awards` (XP, personal bests, challenge result, achievements) and the updated `progress`. The audio is analysed in memory and not stored. 415 for unreadable audio, 422 for an unknown drill, 503 when speech-to-text is down. |
| GET | `/practice/progress?day=YYYY-MM-DD` | Streak, level/XP, today's optional challenge, achievements, rounds per skill and, per drill, its skills, challenge levels and personal bests (the catalog merged in). |

Rules live in `backend/app/modules/practice/catalog.py` (drills, skills, metrics, challenges, achievements) and `progress.py` (bests, levels, streak, XP). A round with less speech than the drill's minimum earns nothing. Nothing elsewhere in the app depends on Practice Center progress.

## Live interview WebSocket

`wss://<api>/api/v1/sessions/{sessionId}/live`

1. Within 5 seconds send `{"type":"auth","idToken":"…","appCheckToken":"…"}`.
2. Server replies `{"type":"ready","sessionId","resumed","maxDurationMs","elapsedMs","lastSeq","coding"}`.
   After a reconnect, resend buffered frames with `seq > lastSeq`.

Client → server

- Binary: `seq u32 | captureMs u32 | PCM16 mono 16 kHz` (little-endian, ≤ 250 ms per frame).
- `{"type":"playback_started","turnSeq","mediaMs"}` / `{"type":"playback_stopped",…}`
- `{"type":"code_snapshot","mediaMs","language","text"}` (≤ 20,000 characters; the first
  400 per session are stored for evaluation; the interviewer receives at most one every 8 s)
- `{"type":"ping","mediaMs"}` · `{"type":"end"}`

Server → client

- Binary: `turnSeq u32 | chunk u32 | PCM16 mono 24 kHz`
- `caption` (`speaker`, `text`, `final`), `interrupted`, `turn_complete`, `time_left`,
  `reconnect_soon`, `ended` (`reason`)

Close codes: `4400` protocol error, `4401` unauthenticated, `4403` forbidden (origin,
consent, verified email, deletion), `4404` not found, `4408` authentication timeout,
`4409` conflict (another live session, session not open), `4429` live minutes exhausted,
`4503` unavailable (kill switch, engine failure). Normal end: `1000`.

`mediaMs`/`captureMs` are milliseconds since the app started capturing; all feedback
timestamps use this clock.

## Internal (worker, OIDC-authenticated)

`/internal/tasks/{prepare_submit_stt|poll_stt|evaluate_persist}`, `/internal/media/remux`,
`/internal/modules/{module}/tasks/{task}`, `/internal/account-deletion`,
`/internal/cron/{reconcile|retention}`, `/internal/events/budget`. The worker is not
publicly reachable and verifies that callers are the invoker service account.
