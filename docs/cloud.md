# Google Cloud, Firebase and AI setup

## Projects

| Environment | Project | Notes |
|---|---|---|
| dev | `atrium-coach-dev` | App Check not enforced; small quotas and budget |
| staging | `atrium-coach-staging` | Mirrors production; App Check enforced |
| prod | `atrium-coach-prod` | Deletion protection, point-in-time recovery, App Check enforced |

Region `us-central1` (Cloud Run, Firestore, buckets, Tasks); Speech-to-Text multi-region
`us`; Gemini Live `us-central1`; structured Gemini calls `global`.

## Creating an environment

```bash
BILLING_ACCOUNT=<id> infra/bootstrap/create-project.sh atrium-coach-<env> <env>
terraform -chdir=infra/terraform/envs/<env> init -backend-config=backend.hcl
terraform -chdir=infra/terraform/envs/<env> apply
```

The bootstrap script creates the project, links billing, enables base APIs and creates
the versioned Terraform state bucket. Terraform (`infra/terraform/modules/platform`)
creates everything else:

| File | Resources |
|---|---|
| `main.tf` | APIs |
| `firebase.tf` | Firebase project, web and iOS apps, Identity Platform (email/password), Firestore, TTL policies, App Check (App Attest, Firestore enforcement) |
| `storage.tf` | `<project>-user-content` and `<project>-processing` buckets |
| `iam.tf` | service accounts and least-privilege bindings, Speech service agent access |
| `runtime.tf` | Artifact Registry, Secret Manager, Cloud Tasks queues, Cloud Run api/worker, Cloud Scheduler |
| `budget.tf` | billing budget, Pub/Sub kill-switch topic and push subscription, email channel |
| `monitoring.tf` | log metrics, alert policies, uptime check, BigQuery analytics sink |
| `wif.tf` | Workload Identity Federation for GitHub Actions |

Budgets are in the billing account's currency (currently KRW).

## Firebase

1. **Terms of service.** The Google account running Terraform must have accepted the
   Firebase terms once (open console.firebase.google.com). Until then adding Firebase
   fails with `403 The caller does not have permission`.
2. **Authentication providers.** Terraform enables email/password. Configure
   **Apple** (Services ID, key, team ID from the Apple Developer account) and **Google**
   (OAuth client) in Firebase Console → Authentication → Sign-in method.
3. **App Check.** Set `apple_team_id` in the environment's Terraform to enable App
   Attest for the iOS app. Enforcement for Firestore follows `app_check_enforced`. For
   web testing in staging, register debug tokens in Firebase Console → App Check.
4. **Rules and indexes** are deployed with the Firebase CLI from `firebase/`
   (`firebase deploy --only firestore:rules,firestore:indexes --project <project>`).

## Vertex AI / Gemini

- APIs: `aiplatform.googleapis.com` (Terraform).
- Models (configurable):
  - `gemini-3.8-flash` — structured output (evaluator, blueprint, resume profile) and
    grounded research. Gemini 2.5 text models retire on 2026-10-16 and are not used.
  - `gemini-live-2.5-flash-native-audio` — the live interviewer (GA on Vertex, not in
    `global`; retirement not before 2026-12-12). A 3.x Live model can replace it by
    configuration; `LiveEngine` isolates the change.
- The runtime service accounts have `roles/aiplatform.user`.
- Quotas: Live API sessions are capped per project (1,000 concurrent by default); the
  app allows one live session per user and a monthly minute quota.

## Agent Development Kit (ADK)

`google-adk` 2.9 (Python). Patterns used:

- Structured agents: `Agent(model=Gemini(model, client_kwargs={vertexai, project, location}), instruction=<provider>, output_schema=<Pydantic>)`
  run through `Runner` with an in-memory session per call; the final response is
  validated with the schema. Instructions are passed as a callable so ADK does not
  substitute `{placeholders}` from state (interview material can contain braces).
- Usage accounting through `after_model_callback` (tokens per call).
- Research: an agent whose only tool is `google_search`; grounding metadata (source
  title/domain, queries, Search Suggestions markup) is captured in the callback.
- Live: `Runner.run_live` with `LiveRequestQueue` and `RunConfig` (audio modality,
  transcription, voice activity detection, session resumption, context compression).
- `ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS=false` keeps prompts and answers out of traces.

## Speech-to-Text

Speech-to-Text v2 `BatchRecognize` with `chirp_3` at `us-speech.googleapis.com`,
word time offsets and punctuation, GCS input and output in the processing bucket.
Chirp 3 returns word timestamps for files up to 20 minutes, so the candidate track is
cut into exact 15-minute FLAC chunks. `enable_word_confidence` is not supported by this
recognizer and is not requested. Batch recognition of even short audio can take several
minutes; the pipeline polls every 20 seconds for up to about an hour.

## Cost controls

- Budget alerts at 50/90/100 %; at 100 % the worker sets `config/runtime.aiEnabled=false`
  and new AI work is refused until an operator re-enables it (see operations).
- Per-user quotas (`platform/plans.py`): live minutes per month, sessions, blueprint
  generations, evaluations and re-processing per day.
- Per-call limits: token caps, temperature and model per purpose, capped model calls
  per agent run, timeouts (`platform/ai/gateway.py`).
- Live: one session per user, round time cap, idle timeout, context compression.
- Cloud Run max instances per environment; production scales to zero until launch.
- Estimated cost per call and per user (`estCostMicros`, micro-USD) from configured rates
  (`platform/ai/pricing.py`): Gemini 3.8 Flash at its introductory Vertex AI price
  ($0.75 input / $3.75 output per 1M tokens through 2026-12-31; $1.50 / $7.50 from
  2027-01-01 — update `TEXT_*_MICROS_PER_M` then) and Speech-to-Text V2 at $0.016 per
  minute. Live API rates are left unset until copied from the pricing page for the
  configured Live model (`LIVE_INPUT_MICROS_PER_M`, `LIVE_OUTPUT_MICROS_PER_M`); until
  then live cost is tracked as minutes and tokens only. Google Search grounding is
  billed per query and not included.
