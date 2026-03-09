FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PIP_NO_CACHE_DIR=1
ENV SAM3_HOST=0.0.0.0
ENV SAM3_PORT=8000
ENV HF_HOME=/models/huggingface

WORKDIR /service

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && mkdir -p /models/huggingface \
    && chown -R appuser:appuser /service /models

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl --fail "http://127.0.0.1:${SAM3_PORT}/healthz" || exit 1

CMD ["sh", "-c", "uvicorn app.main:app --host ${SAM3_HOST} --port ${SAM3_PORT}"]
