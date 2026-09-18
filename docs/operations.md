# Operations: deployment, CI/CD, monitoring and troubleshooting

## Deployment

### Manual deploy to an environment

```bash
P=atrium-coach-dev; R=us-central1; REG=$R-docker.pkg.dev/$P/atrium; TAG=$(git rev-parse --short HEAD)
gcloud auth configure-docker $R-docker.pkg.dev
docker build --platform linux/amd64 -t $REG/atrium-backend:$TAG backend && docker push $REG/atrium-backend:$TAG
for s in atrium-worker atrium-api; do gcloud run deploy $s --image $REG/atrium-backend:$TAG --region $R --project $P; done
(cd firebase && npx firebase deploy --only firestore:rules,firestore:indexes --project $P)
```

Terraform owns service configuration (environment variables, identities, scaling,
secrets); image changes are the only thing a deploy changes (`ignore_changes` on the
image).

### CI/CD (`.github/workflows`)

- **`ci.yml`** — every pull request and push to `main`: web typecheck/tests/build;
  backend ruff, mypy, unit tests, integration tests on emulators (with ffmpeg); rules
  tests; Terraform format and validation for every environment; container build.
- **`deploy.yml`** — push to `main`: build the image once in staging's registry →
  staging job (Terraform apply, rules and indexes, both services, smoke tests: health
  200, unauthenticated API 401, worker unreachable) → **production** job, gated by the
  GitHub Environment `production` (configure required reviewers) → same image to
  production, Terraform, rules, services, smoke tests.
- **`ios.yml`** — simulator compile on app changes; TestFlight archive and upload on
  `main` once `IOS_SIGNING_READY=true`.

GitHub setup (no keys are stored): repository variables `STAGING_PROJECT`,
`STAGING_WIF_PROVIDER`, `STAGING_DEPLOYER_SA`, `STAGING_TERRAFORM_SA` and the same with
`PROD_`; values from `terraform output platform`. GitHub Environments `staging` and
`production` must exist — the Workload Identity provider only trusts jobs running in
the matching environment of `looubna/atrium`.

## Monitoring

| Signal | Source | Alert |
|---|---|---|
| AI call failures/timeouts | `ai_usage` logs with `outcome != ok` | ≥ 5 in 10 min |
| Pipeline step failures | "processing step failed…" logs | any in 10 min |
| Live interview failures | gateway/engine error logs | ≥ 3 in 10 min |
| Budget exceeded | kill-switch log | any |
| API server errors | Cloud Run 5xx count | > 1/min for 5 min |
| CPU saturation | Cloud Run container CPU p99 | > 85 % for 10 min |
| Processing backlog | Cloud Tasks queue depth | > 50 for 15 min |
| API availability | uptime check on `/health` | failing for 10 min |

Latency is analysed in Cloud Trace rather than alerted on Cloud Run request latency,
because live interviews are hour-long WebSocket requests. Logs carry `requestId`,
`sessionId`, `jobId`, `step` and a salted `uidHash`; they never contain prompts,
transcripts, resumes, tokens or email addresses. `ai_usage` and `product_event` logs are
exported to BigQuery (`atrium_analytics`).

## Runbooks

**AI disabled by the budget.** Confirm the spend in Billing, raise the budget or wait
for the next month, then set `aiEnabled` to `true` in the `config/runtime` document
(Firebase console → Firestore). Instances pick the change up within a minute.

**Estimated AI spend per user.** `users/{uid}/usage/m-YYYY-MM.estCostMicros` and the
`estCostMicros` field of `ai_usage` logs (BigQuery `atrium_analytics`) are estimates in
micro-USD from the configured rates; the billing report is authoritative.

**A session's feedback failed.** The user can press *Try again* (reprocess). Check the
job in `jobs/sess-<sessionId>` (`step`, `lastError`, `failures`) and the worker logs
filtered by `jsonPayload.jobId`.

**Stuck processing.** The reconciler re-enqueues jobs idle for 40 minutes. Speech batch
recognition can legitimately take several minutes.

**Rotate the analytics salt.** Add a new Secret Manager version and redeploy; hashed IDs
before and after won't join (acceptable for analytics).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Terraform: `Error creating Project: 403` for Firebase | Accept the Firebase terms once in the console with the account running Terraform |
| Terraform: budget `400 invalid argument` | The amount must be in the billing account's currency (don't set a different currency code) |
| Local API: `Transaction lock timeout` | The Firestore emulator locks pessimistically; avoid concurrent transactions on the same document (profile creation uses create-if-absent instead) |
| Speech-to-Text: `unsupported feature word_level_confidence` | Chirp 3 doesn't support word confidence; don't request it |
| "The city could not load / WebGL" | Enable Chrome's graphics acceleration; the rest of the app still works |
| `npm install` crashes (`edgesOut`) | npm 10 bug; use `npx -y npm@11 install` |
| WebSocket closes `4403` immediately | Origin not in `ALLOWED_ORIGINS`, consent missing, or email not verified |
| WebSocket `4409` | Another live session holds the user's lock, or the session already ended |
| Worker requests return 401 for every task | The worker checks the OIDC token audience against its own URL; tokens must be minted for the worker's service URL (Terraform does this) |
| Feedback stuck after "Saving your recording"; worker logs `HttpRequest.url must start with 'https://'` | The worker queues each pipeline's next step and needs `WORKER_URL`; Terraform sets it on both services (the deployed backend refuses to start without it) |
| Vertex AI `429 RESOURCE_EXHAUSTED` in worker logs | Shared model capacity was briefly exhausted. Each call retries after 3, 6, 12 and 20 s (the journey screen shows "The AI service is busy — retrying"); a journey still failing is re-queued up to 3 times, reusing its research, then shown as failed with "Try again". Consider Provisioned Throughput if it persists |
| Journey stays "researching" | A generation whose worker died is reclaimed by its next retry after 15 minutes, and generating again after 15 minutes retires it |
| iOS microphone blocked | Microphone requires `NSMicrophoneUsageDescription` (set) and user permission |

## Launch checklist

- [ ] Apple Developer account: bundle ID, team ID (`apple_team_id` in Terraform),
      Sign in with Apple and App Attest capabilities, App Store Connect API key
- [ ] Apple and Google providers configured in Firebase Authentication (staging, prod)
- [ ] Install Xcode; build and run on a **physical iPhone**; validate echo, speaker
      routing, interruptions, backgrounding and a 30-minute interview end to end
- [ ] Push the repository to GitHub; set repository variables and environments; require
      reviewers for `production`
- [ ] Production: `api_min_instances = 1`, review the budget amount and quotas
- [ ] Privacy policy and terms published; App Store privacy labels (see security-privacy.md)
- [ ] Real-model evaluation of Agent 1 and Agent 2 on a set of sample interviews
- [ ] Load test the live gateway (concurrent WebSockets per instance)
