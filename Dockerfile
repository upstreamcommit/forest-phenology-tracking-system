# ---- builder ----
FROM python:3.15-slim AS builder
WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir poetry==1.8.3

COPY pyproject.toml poetry.lock* README.md /build/
COPY src /build/src

RUN poetry config virtualenvs.create false \
    && poetry build -f wheel

# ---- runtime ----
FROM python:3.15-slim AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libexpat1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/dist/ /tmp/dist/
RUN pip install --no-cache-dir /tmp/dist/*.whl \
    && rm -rf /tmp/dist

RUN useradd -m -u 10001 appuser
USER appuser

EXPOSE 8000
CMD ["uvicorn", "fpts.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
