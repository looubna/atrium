# Security and privacy

This document describes the technical controls. It is not a statement of legal
compliance; privacy policy, terms and regulatory review are separate work.

## Threats and controls

| Threat | Control | Where |
|---|---|---|
| Impersonation / forged identity | Firebase ID tokens verified server-side; uid only from the token; revocation checked on connect, uploads, deletion and generation | `platform/auth/dependencies.py` |
| Accessing another user's data (IDOR) | Every path/body ID resolved under `users/{uid}`; IDs validated against a strict pattern; tests with a second user on every resource | `platform/firestore/paths.py`, integration tests |
| Direct database or storage access | Firestore rules: owner read only for listed collections, no client writes; Storage rules deny all; rules tests | `firebase/` |
| Public recordings | Private buckets, public access prevention enforced, short-lived signed links, server-built object names | `storage.tf`, `platform/storage` |
| Non-genuine app clients | App Check (App Attest) enforced on API and Firestore in staging/prod | `firebase.tf`, `platform/native.ts` |
| Worker endpoints invoked by outsiders | Internal-only ingress, IAM invoker, OIDC audience and caller check | `runtime.tf`, `platform/auth/worker.py` |
| Leaked credentials | No keys: runtime identities, keyless signed URLs, Workload Identity Federation for CI; secrets in Secret Manager; `.gitignore` for env files and keys | `iam.tf`, `wif.tf` |
| Dev code touching production | Startup guard binds each environment to its projects; separate projects per environment | `core/settings.py` |
| Malicious uploads | Size limits (streaming-aware); type detected from content; encrypted/unreadable PDFs refused; text extraction bounded; no execution of uploaded content. Videos: upload sessions bound to one server-named object, declared type and size, create-only; size verified on completion; only the first video stream is copied by ffmpeg (no decoding to re-encode, files without video fail); served back only through signed links | `modules/interview/resumes.py`, `core/middleware.py`, `platform/media/video.py` |
| Prompt injection via resume, job description or web pages | Text sanitized (control characters, URLs, tags, instruction-like lines removed) and fenced as data; agents reading it have no side-effecting tools; all output schema-validated; research sources restricted to those retrieved; Search Suggestions rendered in a sandboxed frame | `modules/interview/sanitize.py`, agents |
| Model output injected into the UI | Model text rendered as text only; no HTML except the sandboxed Search Suggestions | frontend |
| Runaway AI cost or abuse | Per-user quotas, rate limits, one live session per user, time and idle caps, token caps, capped model calls per run, budget-driven kill switch, instance caps | `platform/plans.py`, `usage.py`, `ratelimit.py`, gateway |
| Sensitive data in logs | Redaction of tokens, emails and content-like fields; hashed user IDs; error responses never echo input; prompts kept out of traces | `core/logging.py`, `core/errors.py` |
| Replay / duplicate processing | Transactional job claims, deterministic task names and event IDs | `platform/jobs` |
| Deleted accounts continuing to act | Disable + revoke, tombstone check on profile creation, sweeps after token expiry, deletion checks in live gateway and pipeline | `platform/deletion.py` |

## Data inventory

| Data | Purpose | Stored | Shared with | Retention |
|---|---|---|---|---|
| Email, sign-in provider | account | Firebase Auth | — | until account deletion |
| Display name | account | Firestore | — | until account deletion |
| Consents (what, version, when) | lawful processing, App Store 5.1.2(i) | Firestore | — | until account deletion |
| Resume file and extracted text | interview journey | Cloud Storage | Google Cloud AI (Gemini) for the profile | until deleted by the user |
| Resume profile | interview journey | Firestore | — | until deleted |
| Company, role, location, job description | interview journey | Firestore | Google Cloud AI (Gemini, Google Search grounding with company and role) | until deleted |
| Voice during interviews | live interviewer, feedback | Cloud Storage (tracks, `audio.m4a`) | Google Cloud AI (Gemini Live, Speech-to-Text) | 365 days |
| Camera video (only when the camera is on) | reviewing your delivery | Cloud Storage (`video-*`) | Google Cloud AI (Gemini, low resolution) only with the separate `video_analysis` consent | 365 days |
| Face measurements (per second: face visible, looking at camera or, in person, at the interviewers, smiling, head movement, and for in-person panels turned toward the speaker) | eye contact, expression and composure feedback | Cloud Storage (`face-metrics.json`); computed on the device from camera frames, which never leave it | — | 365 days, deleted with recordings |
| Voice measurements (pitch movement and loudness changes per answer; never typical pitch) | intonation and projection feedback | Firestore session summary | — | until account deletion |
| Transcripts, code snapshots | feedback | Cloud Storage / Firestore | Google Cloud AI (Gemini) | until account deletion |
| Feedback, scores, progress | coaching | Firestore / Cloud Storage | — | until account deletion |
| Usage counters | quotas | Firestore | — | until account deletion |
| Operational logs | reliability, security | Cloud Logging (hashed uid) | — | 30 days |
| Analytics events | product analytics | BigQuery (hashed uid) | — | 400 days |

AI processing uses Google Cloud Vertex AI and Speech-to-Text under the project's
Google Cloud terms. Review those terms (including data use and residency) for your
agreement and describe them in the privacy policy.

Consent is requested before the first AI feature (`ai_processing`) and before any
recording (`recording`). The consent text version is stored; a new version requires
consent again. Withdrawal is immediate for new processing.

## App Store privacy label (draft mapping)

| App Store data type | Collected | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| Contact info — email address | yes | yes | no | App functionality (account) |
| User content — audio data | yes | yes | no | App functionality |
| User content — photos or videos | only if camera recording is used | yes | no | App functionality |
| User content — other (resume, job details, transcripts) | yes | yes | no | App functionality |
| Identifiers — user ID | yes | yes | no | App functionality |
| Usage data — product interaction | yes | yes (hashed) | no | Analytics |
| Diagnostics — performance/crash data | yes (server logs) | no | no | App functionality |

No third-party advertising or tracking SDKs are included.

## Account deletion

In-app deletion from the account sheet removes all personal data; see
[data — account deletion](data.md#account-deletion). Apple's Sign in with Apple token is
revoked on iOS before deletion.

## Known limitations

- Echo handling on physical iPhones has not been validated yet (no device available
  during development); see the launch checklist.
- Firebase Authentication email/password sign-in is available alongside Apple and
  Google; enforce strong passwords in Firebase Console → Authentication → Settings.
- Cloud Storage soft delete keeps deleted objects for 7 days before permanent removal.
