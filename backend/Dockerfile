# One image for both Cloud Run services; ROLE (api|worker) selects the routes.
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

# ffmpeg: audio assembly, chunking and video remux in the worker.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.11.9 /uv /bin/uv

WORKDIR /srv
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY app ./app
RUN uv sync --locked --no-dev

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin atrium
USER 10001

ENV PATH="/srv/.venv/bin:$PATH" \
    PORT=8080

CMD ["sh", "-c", "exec uvicorn app.main:create_app --factory --host 0.0.0.0 --port \"$PORT\" --proxy-headers --forwarded-allow-ips='*' --no-server-header --timeout-graceful-shutdown 8"]
