# Live collaboration transport — realtime-agnostic (engine/realtime).
# Build context: engine/realtime. WS pub/sub only; no DB CDC.
# Base images come from Docker Hub, like every other image in this stack. public.ecr.aws
# meters anonymous pulls per source IP, and GitHub's shared runners exhaust that quota
# ("429 toomanyrequests: Data limit exceeded"), which failed CI run 36230407015.
FROM rust:1.89-slim-bookworm AS builder
WORKDIR /build
RUN apt-get update && apt-get install -y pkg-config && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY tests/ tests/
RUN cargo build --release --bin realtime-server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 1001 app \
 && useradd  -u 1001 -g app -d /app -s /sbin/nologin app
WORKDIR /app
COPY --from=builder --chown=app:app /build/target/release/realtime-server /app/realtime-server
COPY --chown=app:app sandbox/static/ /app/static/
EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/v1/health >/dev/null 2>&1 || exit 1

USER app
CMD ["/app/realtime-server"]
