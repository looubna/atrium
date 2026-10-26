# Local development

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22 (`.nvmrc`; `nvm use`) | web app, Capacitor CLI 8, Firebase CLI |
| Python + uv | 3.12, uv 0.11 | backend (`backend/uv.lock`) |
| Java | 21 (`brew install openjdk@21`) | Firebase emulators |
| ffmpeg | any recent (`brew install ffmpeg`) | audio assembly and chunking in the pipeline |
| Docker | Desktop | building the backend image |
| Terraform | 1.15 | infrastructure |
| gcloud | current | cloud access, deploys |
| Xcode | current (App Store) | iOS builds only |

npm 10.9 can crash while resolving peer dependencies in this repo (`Cannot read
properties of null (reading 'edgesOut')`); use `npx -y npm@11 install`.

## Run everything locally (no cloud, no cost)

```bash
# 1. Emulators (Auth + Firestore)
cd firebase && npm install && npx firebase emulators:start --project demo-atrium --only firestore,auth

# 2. API with the fake AI provider (in another terminal)
cd backend && uv sync
cp -n .env.example .env.local                # first run only; this file is git-ignored
set -a; source .env.local; set +a            # APP_ENV=local, AI_PROVIDER=fake, emulator hosts
uv run python -m uvicorn app.main:create_app --factory --port 8000

# 3. Web app (in another terminal)
npm install && npm run dev                     # http://localhost:5173, /api proxied to :8000
```

With `APP_ENV=local`, background tasks (pipeline steps, resume extraction, blueprint
generation) run inside the API process, so the whole flow works without Cloud Tasks.
`AI_PROVIDER=fake` replaces Gemini, Gemini Live and Speech-to-Text with deterministic
stand-ins. To use real models locally, set `AI_PROVIDER=vertex` and
`VERTEX_PROJECT=atrium-coach-dev` (the only project `APP_ENV=local` may bill), and run
`gcloud auth application-default login`.

For the Nebius x NVIDIA hackathon build, keep `AI_PROVIDER=vertex` for live voice,
speech recognition and grounded company research. Set `NEBIUS_TEXT_ENABLED=true`,
add a server-side `NEBIUS_API_KEY`, and use the default `NEBIUS_TEXT_MODEL` to route
the interview blueprint, resume profile and written round guide through NVIDIA
Nemotron 3.5 Lightning on Nebius Token Factory. Text generation sends structured
JSON requests to Token Factory's OpenAI-compatible API; calls that need Google Search
or attached audio/video remain on the existing Vertex path. The key must never go in
a `VITE_*` variable or browser storage. For local runs, put the API key and
`NEBIUS_TEXT_ENABLED=true` in the git-ignored `backend/.env.local`, then source that
file when starting the backend. Nemotron's default reasoning trace is disabled for
these schema-constrained calls so the output budget remains available for JSON.
Keep the tracked `.env.example` free of real keys.

Microphone access requires a secure context: `http://localhost` works; a LAN IP does not.

## Environment variables

### Backend (`backend/.env.example` documents all of them)

| Variable | Meaning |
|---|---|
| `APP_ENV` | `local`, `test`, `dev`, `staging`, `prod`; each is locked to its own projects |
| `ROLE` | `api` or `worker` |
| `GOOGLE_CLOUD_PROJECT` | data project (`demo-atrium` locally) |
| `VERTEX_PROJECT` | project billed for AI (defaults to `GOOGLE_CLOUD_PROJECT`) |
| `USER_CONTENT_BUCKET`, `PROCESSING_BUCKET` | buckets (a local directory when `APP_ENV` is local/test) |
| `LOCAL_OBJECTS_DIR` | where the local object store writes |
| `AI_PROVIDER` | `vertex` or `fake` (prod must be `vertex`) |
| `NEBIUS_TEXT_ENABLED` | `true` enables the hackathon's Token Factory path for supported structured interview text calls |
| `NEBIUS_API_KEY` | Secret Token Factory key; required when the Nemotron path is enabled outside fake-AI mode |
| `NEBIUS_BASE_URL` | Token Factory OpenAI-compatible base URL (`https://api.tokenfactory.nebius.com/v1`) |
| `NEBIUS_TEXT_MODEL` | Token Factory model ID (`nvidia/Nemotron-3_5-Lightning`) |
| `LIVE_MODEL`, `LIVE_LOCATION` | Gemini Live model and region |
| `TEXT_MODEL`, `TEXT_LOCATION` | structured-output model and location |
| `SPEECH_LOCATION` | Speech-to-Text multi-region (`us`) |
| `APP_CHECK_ENFORCED` | require App Check tokens (prod must be `true`) |
| `ALLOWED_ORIGINS` | CORS and WebSocket origins |
| `TASKS_LOCATION`, `TASKS_INVOKER_SA`, `WORKER_URL` | Cloud Tasks → worker |
| `FREE_TRIAL_MINUTES`, `RECORDING_RETENTION_DAYS` | limits |
| `ANALYTICS_SALT` | secret salt for hashed user IDs (Secret Manager in the cloud) |
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST` | emulator addresses |

Deployed values come from Terraform (`infra/terraform/modules/platform/runtime.tf`).

### Web (`.env.<mode>`, public by design)

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | API origin; empty means same origin (dev proxy) |
| `VITE_USE_EMULATORS` | `true` connects Auth and Firestore emulators |
| `VITE_FIREBASE_*` | Firebase web configuration (`terraform output platform`) |

Firebase web configuration identifies a project; it grants no access. Never put
secrets in `VITE_*` variables.

## Tests

```bash
# Web
npm run typecheck && npm test && npm run build

# Backend
cd backend
uv run ruff check app tests && uv run mypy app
uv run pytest tests/unit
../firebase/node_modules/.bin/firebase emulators:exec --config ../firebase/firebase.json \
  --project demo-atrium --only firestore "uv run pytest tests/integration"

# Security rules
cd firebase && npm run test:emulators
```

Integration tests clear the emulator's `demo-atrium` data; don't run them against an
emulator you're using for manual testing.

## iOS

```bash
npm run build && npx cap sync ios
open ios/App/App.xcodeproj          # requires Xcode
```

Before running on a device: set the bundle ID and team, add the **Sign in with Apple**
and **App Attest** capabilities, and place the environment's `GoogleService-Info.plist`
in `ios/App/App/` (`terraform output -raw` of `ios_google_service_info_base64`, base64-decoded;
it is git-ignored). Debug builds use the App Check debug provider: register the debug
token printed in Xcode's console in the Firebase console.
