# Data: Firestore, Cloud Storage, retention and deletion

## Firestore schema

User data lives under `users/{uid}` so security rules stay simple, a user's data is
deleted with one recursive delete, and a guessed ID can never resolve to another user.
Clients **read** their own documents (for live status) and never write; every write
goes through the API. Collections not listed in the rules are denied.

| Path | Contents | Client |
|---|---|---|
| `users/{uid}` | `plan` (server-set), `displayName`, `createdAt`, `deletion{status}` | read own |
| `users/{uid}/consents/{kind}` | `ai_processing` / `recording`: `accepted`, `version`, timestamps | read own |
| `users/{uid}/usage/{m-YYYY-MM \| d-YYYY-MM-DD}` | counters: `liveSeconds`, `sessionsCreated`, `blueprintGenerations`, `aiCalls`, `aiTokens`, … | read own |
| `users/{uid}/resumes/{resumeId}` | `fileName`, `kind`, `sizeBytes`, `storagePath`, `status`, `stage` (reading/summarising/done), `profile` | read own |
| `users/{uid}/applications/{appId}` | `company`, `roleTitle`, `location`, `jobDescription`, `resumeId`, `activeBlueprintId`, `status` | read own |
| `…/applications/{appId}/blueprints/{bpId}/guides/{roundId}` | a round's preparation guide (API only; deleted with the application) | none |
| `…/applications/{appId}/blueprints/{bpId}` | `version`, `source` (agent/user_edit), `status`, summaries, `rounds[]`, `sources[]`, `caveats`, `searchSuggestionsHtml`, `progress` (streamed while generating: `stage`, `queries`, `sources`, `notes`, `summary`, draft `rounds`) | read own |
| `users/{uid}/courses/{courseId}` | oral exam: `subject`, `status`, `activeAnalysisId`, `materialCount`, `chosenStyle` (the student's own answer about the format, or null) | read own |
| `…/courses/{courseId}/materials/{materialId}` | `source` (file/link/text), `name`, `url`, `kind`, `sizeBytes`, `storagePath`, `textPath`, `status`, `detectedType`, `detectedTitle` | read own |
| `…/courses/{courseId}/analyses/{analysisId}` | `version`, `status`, `courseSummary`, `scope`, `topics[]`, `learningObjectives`, `likelyQuestions`, `examStyle` with `examStyleConfidence`/`examStyleEvidence`/`examStyleSources`, `materials[]` (what each file turned out to be), `caveats`, `progress` (streamed while analysing) | read own |
| `users/{uid}/sessions/{sessionId}` | `module`, `context`, `status`, `processingStatus`, `failure`, `attemptNo`, `retryOfSessionId`, `retryTargets`, `media`, `currentEvaluationRunId`, `summary`, `retryPlan`, `recordingExpiresAt` | read own |
| `…/sessions/{id}/turns/{seq}` | live turn log: speaker, text, `tStartMs`, `tEndMs` | read own |
| `…/sessions/{id}/codeSnapshots/{n}` | code/notes pane snapshots with media time | read own |
| `…/sessions/{id}/evaluations/{runId}` | model, prompt and catalog versions, overall score, strengths, improvements | read own |
| `…/evaluations/{runId}/events/{eventId}` | feedback events (below) | read own |
| `users/{uid}/competencies/{competencyId}` | profile: `current`, `best`, `attempts`, `lastScore`, `lastDelta`, `catalogVersion` | read own |
| `users/{uid}/competencyHistory/{sessionId_competencyId}` | one score per session and competency | read own |
| `users/{uid}/practice/progress` | Practice Center progress: `xp`, `streak {current, best, lastDay}`, `drills {id: {level, rounds, completed, bests {metric: {value, previous, day}}}}`, `achievements {id: day}`, `skills {id: {rounds}}`, `daily`, `counters` | read own; written only by the API |
| `users/{uid}/practiceAttempts/{attemptId}` | one analysed round: drill, prompt, `values`, `speechMs`, transcript, feedback, `skillEvidence` (0–1 per skill, labelled measured/ai/mixed, for future trends), awards. No audio. | read own |
| `jobs/{jobId}` | pipeline state: `uid`, `sessionId`, `runId`, `step`, `status`, `failures`, lease, STT operations, `expireAt` | none |
| `liveSessions/{sessionId}` | resumable live state: uid, resumption handle, last frame seq, media clock, segment counters | none |
| `liveLocks/{uid}` | one active live session per user | none |
| `rateLimits/{hash}` | fixed-window counters, `expireAt` | none |
| `config/runtime` | `aiEnabled` kill switch | none |
| `deletions/{saltedHash}` | deletion tombstone (no personal data) | none |

### Blueprint round

`id`, `order`, `type` (`screening`, `behavioral`, `technical`, `coding`,
`system_design`, `case`, `hiring_manager`, `presentation`, `take_home_review`, `other`),
`customLabel`, `title`, `format`, `durationMin`, `competencyIds`, `questionFamilies[]`
(predicted, with example questions), `reportedQuestions[]` (each citing `sourceIds`),
`resumeFocus`, `roleFocus`, `companyFocus`, `rubric[]`, `confidence`, `rationale`,
`evidenceSourceIds`.

### Exam topic

`name`, `importance` (`high` | `medium` | `low`), `why` (what in the material gives it
that weight), `subtopics[]`, `sourceMaterialIds[]`. The analyst classifies every material
as `lecture_slides`, `lecture_notes`, `textbook`, `personal_notes`, `syllabus`,
`past_exam`, `problem_set` or `other`; the student is never asked to. `examStyle` is
`oral_questions`, `board_work` or `unknown` — and `unknown`, or low confidence, is what
makes the app ask the student the one optional question about the format.

### Feedback event

`id` (deterministic per run), `timestampStart`, `timestampEnd` (ms on the recording),
`category` (`round` | `communication`), `competencyId`, `severity` (`strength`,
`minor`, `major`, `critical`), `title`, `observation`, `whyItMatters`,
`recommendation`, `example`, `questionId` (interviewer segment), `responseId`
(candidate segment), `evidence{quote, segmentIds}`, `confidence`, `priority`.

### Competency IDs

Permanent and namespaced: `comm.*` (communication, all modules), `interview.<area>.*`
(interview rounds) and `exam.<oral|board>.*` (oral exams). Definitions changes bump the catalog version;
deltas compare only the same competency and version with at least medium confidence.

### Indexes and TTL

`firebase/firestore.indexes.json`: competency history by competency and time; sessions
by application/round/status/time; collection-group sessions by status and by retention
date; jobs by status/time and by uid. TTL on `jobs.expireAt` and `rateLimits.expireAt`
(TTL does not delete subcollections; user data is removed by deletion and retention jobs).

### Size limits

Documents stay far below 1 MiB: at most 12 rounds per blueprint, 15 events per
evaluation, 20,000 characters per turn or code snapshot, 50,000 per job description.
Transcripts and full evaluations are stored in Cloud Storage.

## Cloud Storage

Buckets per environment, uniform access, **public access prevention enforced**, no
Firebase Storage rules access (`storage.rules` denies everything), CORS limited to the
app's origins.

`<project>-user-content` (soft delete 7 days):

```
users/{uid}/resumes/{resumeId}/original.{pdf|docx|txt|md}
users/{uid}/resumes/{resumeId}/extracted.txt
users/{uid}/courses/{courseId}/materials/{materialId}/original.{pdf|docx|pptx|txt|md|png|jpg|webp}
users/{uid}/courses/{courseId}/materials/{materialId}/extracted.txt
users/{uid}/sessions/{sessionId}/live/cand-0000.trk …   candidate voice segments (16 kHz)
users/{uid}/sessions/{sessionId}/live/ivr-0000.trk …    interviewer voice segments (24 kHz)
users/{uid}/sessions/{sessionId}/audio.m4a             both voices, for playback and download
users/{uid}/sessions/{sessionId}/video-{uploadId}.mp4  optional camera video (video only; .webm from some browsers)
users/{uid}/sessions/{sessionId}/transcript.json
users/{uid}/sessions/{sessionId}/evaluations/{runId}.json
```

`<project>-processing` (no soft delete, deleted after 3 days): FLAC chunks and
Speech-to-Text output under `jobs/{jobId}/{runId}/`.

Object names are always built on the server from the uid in the verified token
(`platform/storage/paths.py`). Resumes are uploaded through the API (≤ 10 MB, type
detected from content), study material likewise (≤ 40 MB; images are kept as they are and
read by the analyst itself). Camera video (≤ 1 GiB) is uploaded by the app directly to a
Cloud Storage resumable upload session the API creates for one server-named object of
the declared type and size (never overwriting); on completion the size is checked and
the worker copies the video stream into a streamable file. A file without a video
stream is marked `failed`, and feedback continues with the audio. `session.media.video`
holds `uploadId`, `path`, `contentType`, `sizeBytes`, `startedAtMediaMs` and `state`. Access is via V4 signed URLs: 90-minute inline playback links
and 10-minute download links, signed keylessly with IAM `signBlob`.

## Retention

| Data | Kept | Removed by |
|---|---|---|
| Recordings (`live/`, `audio.m4a`, `video-*`) | 365 days (`RECORDING_RETENTION_DAYS`) | daily retention job; the session keeps its feedback |
| Transcripts, evaluations, feedback, progress | until the user deletes their account | account deletion |
| Resumes | until the user deletes them or their account | resume delete / account deletion |
| Processing files | 3 days | bucket lifecycle |
| Pipeline job records | 30 days after completion | Firestore TTL |
| Rate-limit counters | minutes | Firestore TTL |
| Deleted objects | 7 more days in soft delete | Cloud Storage |
| Logs | Cloud Logging default retention (30 days) | Cloud Logging |
| Analytics | 400 days, hashed user IDs only | BigQuery table expiration |

## Account deletion

`DELETE /api/v1/me` requires a sign-in within the last 10 minutes (revocation checked).
The account is marked `deleting`; new requests from it are refused; the live lock is
released; a deletion task runs on the worker:

1. disable the Firebase user and revoke refresh tokens;
2. module deletion hooks;
3. delete `users/{uid}/` in the user-content bucket and each of the user's processing
   job prefixes;
4. delete the user's `jobs`, `liveSessions`, `liveLocks` and the whole `users/{uid}`
   subtree (recursive);
5. delete the Firebase user; write `deletions/{salted hash}` (no personal data), which
   also stops a still-valid ID token from recreating an empty profile.

Sweeps repeat steps 3–4 after 30 and 65 minutes (after any in-flight request and after
tokens issued before disabling expire). On iOS the app revokes the Sign in with Apple
token first, as Apple requires. Soft-deleted objects are purged by Cloud Storage after
7 days.
