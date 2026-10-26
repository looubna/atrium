# Nebius x NVIDIA Global AI Hackathon submission notes

## Category

**Best Apps & Agents** — Atrium is an interview-preparation app and live coaching
agent. It is not positioned as an always-on personal assistant or a coding agent.

## Project description

Atrium turns interview preparation into a practice journey in an interactive 3D
city. A candidate enters a company and role; Atrium researches the interview
process, creates a likely round-by-round plan, and writes a preparation guide using
the candidate's experience. The candidate can then practise with a live voice
interviewer and receive timestamped feedback tied to what they actually said.

When the hackathon backend flag is enabled, NVIDIA Nemotron 3.5 Lightning through
Nebius Token Factory drafts the candidate's interview blueprint, resume profile and
written round-preparation guide. The app validates model output against typed
schemas, keeps the Token Factory key on the server, and records model and token
usage without logging candidate content. Existing Gemini Live and Vertex
capabilities continue to handle real-time voice, grounded company research, and
attached audio/video analysis where those modalities are required.

Token Factory's hosted API provides the Nemotron inference path without requiring
Atrium to provision or operate model-serving GPUs. This keeps the implementation
focused on the role-specific interview workflow, schema validation, and evidence-based
coaching.

The integration has passed a live Token Factory request with synthetic text, and the
response passed schema validation. NVIDIA documents that Nemotron 3.5 Lightning reasons
by default; concise structured calls therefore set `chat_template_kwargs.enable_thinking`
to `false` so the reasoning trace cannot consume the entire output budget before JSON
is returned. The complete app flow has not been deployed or verified yet; finish that
demo flow before submitting a working demo URL.

## Readiness status

- **Track and model path:** Best Apps & Agents; the interview blueprint, resume profile,
  and written preparation guide route to NVIDIA Nemotron 3.5 Lightning on Token Factory
  when the backend flag is enabled.
- **Repository materials:** the root README, setup notes, and MIT license are present.
- **Live verification:** synthetic live request returned visible JSON, stopped normally,
  and used 241 tokens; full deployed app flow is pending.
- **Video asset:** a 134-second, caption-led MP4 and matching SRT have been produced
  locally. The MP4 has no narration audio; it still needs a public YouTube upload.
- **Still needed:** publish the source repository, provide a working hosted demo URL,
  and add firsthand product feedback. The local video explains the product and model
  path but does not replace a deployed end-to-end demo.

The project predates this hackathon. The changes listed below describe the substantive
work in this edition; keep the disclosure in the Devpost submission.

## What changed for the submission

Atrium existed before the hackathon. This edition adds a materially new provider
path and product experience rather than changing branding alone:

- Added a server-side Nebius Token Factory integration for NVIDIA Nemotron 3.5
  Lightning using the OpenAI-compatible chat-completions API.
- Routed interview blueprint, resume-profile and round-guide generation to
  Nemotron when the backend flag is enabled, while keeping media- and search-tool
  workflows on their existing providers.
- Added schema-constrained JSON validation, one repair attempt, retry handling for
  temporary Token Factory capacity errors, token/cost telemetry, and provider/model
  attribution in generated materials.
- Added a server-side grounding guard: model-written sample anecdotes are replaced
  with STAR fill-in templates, and a resume hook is shown only when it matches an
  exact achievement or role highlight from the profile.
- Updated the interview journey and preparation guide to identify content generated
  with Nemotron on Nebius Token Factory.
- Added setup guidance, environment-variable documentation, and an MIT license for
  the public hackathon code repository.

## Demo flow (under three minutes)

1. Open the interview area in Atrium's 3D city and create an application for a role.
2. Generate the likely interview journey and show the Nemotron / Nebius attribution.
3. Open a round's preparation guide and show role-specific questions, answer
   outlines, resume-based examples, and the model attribution.
4. Start a live voice practice round and briefly show the evidence-based feedback
   flow, explaining that the live audio path remains separate from the Nemotron text
   preparation path.
5. Show the backend configuration and a sanitized usage-log line identifying the
   Token Factory model. Do not show API keys or candidate personal information.

## Deployment configuration

Use the existing app backend deployment and set these server-side variables:

```dotenv
AI_PROVIDER=vertex
NEBIUS_TEXT_ENABLED=true
NEBIUS_API_KEY=<Token Factory API key>
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1
NEBIUS_TEXT_MODEL=nvidia/Nemotron-3_5-Lightning
```

Keep `AI_PROVIDER=vertex` for the live voice and search capabilities used by the
existing app. Do not put `NEBIUS_API_KEY` in the frontend or a checked-in `.env`
file. Local setup instructions are in [setup.md](setup.md).

A Token Factory **promo code** adds credits to the account; it is not an API key and
cannot authenticate model requests. Redeem it in Token Factory billing, then create
an API key in Token Factory and store that key in the backend environment or Secret
Manager. Never add either value to the repository.

## Before submitting

- Publish the source repository with the MIT license visible on the repository
  page. The target repository now contains the source on `main`, but it is still
  private; change its visibility to public before submitting.
- Deploy an accessible demo and confirm the public demo's backend has the
  Token Factory variables above.
- Upload `Atrium-Nebius-Hackathon-Demo.mp4` to YouTube as a public video (it is 2:14
  and includes an SRT subtitle file). The current cut is caption-led and has no voice
  narration.
- Record a short live end-to-end run against the deployed app so judges can see the
  actual interface generate and display Nemotron output, rather than relying only on
  the explainer cards and sample interview footage in the local video.
- Add honest feedback on Nebius Token Factory and NVIDIA Nemotron based on actual
  development and deployment experience.
- Disclose that Atrium predates the hackathon and use the update list above to
  describe the work added during the submission period.
