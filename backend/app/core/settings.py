"""Runtime configuration, loaded from environment variables.

Every environment (local, test, dev, staging, prod) is bound to an explicit set
of Google Cloud projects. Startup fails if the configuration points an
environment at a project it is not allowed to touch, so development code can
never read or write production data by accident.
"""

from __future__ import annotations

from enum import StrEnum
from functools import lru_cache
from typing import Annotated

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Env(StrEnum):
    LOCAL = "local"
    TEST = "test"
    DEV = "dev"
    STAGING = "staging"
    PROD = "prod"


class Role(StrEnum):
    API = "api"
    WORKER = "worker"


class AiProvider(StrEnum):
    VERTEX = "vertex"
    FAKE = "fake"


PROD_PROJECTS = frozenset({"atrium-coach-prod"})

# Which projects each environment may use for data (Firestore/Storage/Tasks).
DATA_PROJECTS: dict[Env, frozenset[str]] = {
    Env.LOCAL: frozenset({"demo-atrium"}),
    Env.TEST: frozenset({"demo-atrium"}),
    # atrium-coach-app: the app's project since 2026-10-01, on a new account (atrium-coach-dev's credits ran out).
    Env.DEV: frozenset({"atrium-coach-dev", "atrium-coach-app"}),
    Env.STAGING: frozenset({"atrium-coach-staging"}),
    Env.PROD: PROD_PROJECTS,
}

# Which projects each environment may bill AI calls to.
AI_PROJECTS: dict[Env, frozenset[str]] = {
    Env.LOCAL: frozenset({"atrium-coach-dev", "atrium-coach-app"}),
    Env.TEST: frozenset(),
    Env.DEV: frozenset({"atrium-coach-dev", "atrium-coach-app"}),
    Env.STAGING: frozenset({"atrium-coach-staging"}),
    Env.PROD: PROD_PROJECTS,
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore", case_sensitive=False)

    app_env: Env
    role: Role = Role.API
    google_cloud_project: str
    gcp_region: str = "us-central1"
    vertex_project: str | None = None

    user_content_bucket: str
    processing_bucket: str
    tasks_location: str = "us-central1"
    tasks_invoker_sa: str = ""
    worker_url: str = ""
    allowed_origins: Annotated[list[str], NoDecode] = Field(default_factory=list)

    ai_provider: AiProvider = AiProvider.VERTEX
    live_model: str = "gemini-live-2.5-flash-native-audio"
    live_location: str = "us-central1"
    text_model: str = "gemini-3.8-flash"
    #: Used when `text_model` stays busy (429) after two retries: widely available, so coaching and
    #: reports still arrive when shared capacity for the newest model runs out. Empty turns it off.
    text_fallback_model: str = "gemini-2.5-flash"
    text_location: str = "global"
    speech_location: str = "us"

    # Cost estimates in micro-USD (see platform/ai/pricing.py). Text rates are Gemini 3.8 Flash's
    # introductory Vertex AI prices (valid through 2026-12-31); speech is Speech-to-Text V2 standard.
    # Live rates have no default: set them from the Vertex AI pricing page for the configured Live model.
    text_input_micros_per_m: int | None = Field(default=750_000, ge=0)
    text_output_micros_per_m: int | None = Field(default=3_750_000, ge=0)
    live_input_micros_per_m: int | None = Field(default=None, ge=0)
    live_output_micros_per_m: int | None = Field(default=None, ge=0)
    speech_micros_per_minute: int | None = Field(default=16_000, ge=0)

    app_check_enforced: bool = True
    analytics_salt: SecretStr = SecretStr("")
    # RevenueCat (paid plans): the webhook's Authorization header value, and the secret REST API key the
    # server uses to double-check a subscriber before changing their plan. Unset = billing is off.
    revenuecat_webhook_secret: SecretStr = SecretStr("")
    # Cloudflare TURN (face video relay for networks that block WebRTC, platform/faces/ice.py): the TURN
    # key's id and API token. Unset = direct connections only, as before.
    cloudflare_turn_key_id: str = ""
    cloudflare_turn_api_token: SecretStr = SecretStr("")
    revenuecat_api_key: SecretStr = SecretStr("")
    # Faces: people recorded seated at a desk, lip-synced by our LiveTalking server. Unset URL
    # simply means no face — the interview runs on audio alone — so this is deliberately not
    # required in deployed environments. The secret signs the tokens the server checks;
    # `livetalking_faces` maps a person to the recording that plays them ("gabriel=william,..."),
    # so one recorded face can stand in for several people; anyone not listed gets
    # `livetalking_avatar`, the stand-in for everyone not yet recorded.
    livetalking_url: str = ""
    livetalking_secret: SecretStr = SecretStr("")
    livetalking_avatar: str = ""
    livetalking_faces: str = ""
    # Scale to zero: the face server's GPU VMs, as "zone/name,zone/name" in failover order. They
    # sit stopped until a candidate opens the setup of a session with a face, are started then,
    # and stop themselves once idle (`ATRIUM_IDLE_STOP_S` on the VM). Their address is read from
    # Compute Engine, so it may change on every start. Empty: `livetalking_url` is the one server.
    face_vms: str = ""
    face_vm_port: int = 8010
    # Reach the VM over https at <ip-with-dashes>.sslip.io (Caddy on the VM, gpu-startup.sh) instead of
    # plain http on face_vm_port: phones' WebViews refuse insecure connections. Off = http, as on the desktop.
    face_vm_https: bool = False
    # The project the VMs live in, when it is not this environment's (local runs on emulators).
    face_vm_project: str = ""
    # The face server on Cloud Run with a GPU (https://atrium-face-….run.app): Google starts an instance
    # when a conversation needs a face and scales to zero when nobody talks. Used first when set; the VMs
    # above (if any) take over only when it cannot come up in time. Empty: VMs only, as before. Several regions:
    # comma-separated, in order of preference (the next one is woken when the first stays busy).
    face_cloud_run_url: str = ""

    recording_retention_days: int = Field(default=365, ge=1, le=3650)
    #: Live minutes a free account gets once, ever: the trial before a paid plan.
    free_trial_minutes: int = Field(default=20, ge=0)
    max_json_bytes: int = 1_048_576
    max_resume_bytes: int = 10 * 1_048_576
    # Study material: a term of lecture slides or a scanned chapter is larger than a resume.
    max_material_bytes: int = 40 * 1_048_576
    # Camera video at ~600 kbps is ~270 MB per hour. Remuxing holds the input and output in the
    # worker's in-memory disk, so keep 2x this well under the worker's memory limit (4 GiB).
    max_video_bytes: int = 1_073_741_824
    log_level: str = "INFO"

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [o.strip() for o in value.split(",") if o.strip()]
        return value

    @property
    def ai_project(self) -> str:
        return self.vertex_project or self.google_cloud_project

    @property
    def is_deployed(self) -> bool:
        return self.app_env in (Env.DEV, Env.STAGING, Env.PROD)

    @model_validator(mode="after")
    def _guard_environment(self) -> Settings:
        allowed = DATA_PROJECTS[self.app_env]
        if self.google_cloud_project not in allowed:
            raise ValueError(
                f"APP_ENV={self.app_env} may not use project {self.google_cloud_project!r}; "
                f"allowed: {sorted(allowed)}"
            )
        if self.app_env != Env.PROD:
            for name in (
                "google_cloud_project", "vertex_project", "user_content_bucket", "processing_bucket", "face_vm_project",
            ):
                value = getattr(self, name) or ""
                if any(p in value for p in PROD_PROJECTS):
                    raise ValueError(f"{name} references a production resource outside APP_ENV=prod")
        if self.ai_provider is AiProvider.VERTEX:
            if self.ai_project not in AI_PROJECTS[self.app_env]:
                raise ValueError(f"APP_ENV={self.app_env} may not bill AI calls to {self.ai_project!r}")
        if self.app_env is Env.PROD:
            if self.ai_provider is not AiProvider.VERTEX:
                raise ValueError("production must use the Vertex AI provider")
            if not self.app_check_enforced:
                raise ValueError("App Check must be enforced in production")
        if self.is_deployed and not self.analytics_salt.get_secret_value():
            raise ValueError("ANALYTICS_SALT is required in deployed environments")
        if self.is_deployed and not self.worker_url.startswith("https://"):
            raise ValueError("WORKER_URL (https) is required in deployed environments: tasks are sent to the worker")
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
