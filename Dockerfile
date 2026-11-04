# Python minor pinned to match CI (pyproject allows ^3.12). Every locked binary package must
# publish a wheel for it, which is why a new minor is a deliberate change.
# ---- builder ----
FROM python:3.12-slim AS builder
WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*

# Same Poetry version as CI; poetry.lock is written in its lock format.
RUN pip install --no-cache-dir poetry==2.5.1

# Install the exact versions in poetry.lock into a venv that the runtime stage copies.
# Poetry installs into the active venv named by VIRTUAL_ENV.
ENV VIRTUAL_ENV=/opt/venv
RUN python -m venv "$VIRTUAL_ENV"

# --compile writes .pyc now: the runtime user can't write into the root-owned venv later.
COPY pyproject.toml poetry.lock /build/
RUN poetry install --only main --no-root --compile --no-interaction --no-ansi

# The app itself goes in without dependencies, so nothing outside the lock is resolved.
# README.md is only needed here (package metadata), so doc edits don't reinstall dependencies.
COPY README.md /build/
COPY src /build/src
RUN poetry build -f wheel \
    && "$VIRTUAL_ENV/bin/pip" install --no-cache-dir --no-deps dist/*.whl

# ---- runtime ----
FROM python:3.12-slim AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN useradd -m -u 10001 appuser
USER appuser

EXPOSE 8000
CMD ["uvicorn", "fpts.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
