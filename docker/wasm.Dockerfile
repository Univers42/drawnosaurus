# syntax=docker/dockerfile:1.7
# The only place WASM is built. Produces engine/pkg/ (the wasm-bindgen glue plus
# draw_engine_bg.wasm), which every other image consumes as a plain artifact —
# no other Dockerfile carries a Rust toolchain.
#
#   make wasm   -> runs this image with engine/ bind-mounted, so pkg/ lands on the host
#   CI          -> runs it once and uploads engine/pkg as a job artifact

FROM rust:1-slim-bookworm

RUN apt-get update \
	&& apt-get install -y --no-install-recommends ca-certificates curl \
	&& rm -rf /var/lib/apt/lists/*

RUN rustup target add wasm32-unknown-unknown

# Prebuilt CLI on purpose: building wasm-bindgen-cli from crates.io is minutes of
# LLVM. Must match `wasm-bindgen = "=<version>"` in the crate; wasm-build.sh
# asserts that rather than trusting this default.
ARG WASM_BINDGEN_VERSION=0.2.128
RUN curl -sSL "https://github.com/rustwasm/wasm-bindgen/releases/download/${WASM_BINDGEN_VERSION}/wasm-bindgen-${WASM_BINDGEN_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
	| tar -xz -C /usr/local/bin --strip-components=1 \
	&& chmod +x /usr/local/bin/wasm-bindgen

COPY scripts/wasm-build.sh /usr/local/bin/wasm-build
RUN chmod +x /usr/local/bin/wasm-build

# `make wasm` runs this as the host user so engine/pkg is not left root-owned on a
# bind mount. That user cannot write the image's default CARGO_HOME, so point cargo
# at a world-writable dir which compose backs with a named volume to keep the
# crates.io cache across runs.
ENV CARGO_HOME=/cargo-home
RUN mkdir -p /cargo-home && chmod 0777 /cargo-home

ENV ENGINE_DIR=/engine
WORKDIR /engine

CMD ["wasm-build"]
