# syntax=docker/dockerfile:1

FROM rust:bookworm AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

ENV BUN_INSTALL=/usr/local/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

RUN curl -fsSL https://bun.sh/install | bash -s -- bun-v1.3.14

WORKDIR /app

COPY Cargo.toml Cargo.lock package.json bun.lock tsconfig.json ./
COPY src ./src
COPY frontend ./frontend
COPY public ./public

RUN bun install --frozen-lockfile
RUN bun run build:frontend
RUN cargo build --release --features saas

FROM debian:bookworm-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive
ENV PIPX_HOME=/opt/pipx
ENV PIPX_BIN_DIR=/usr/local/bin
ENV PIP_NO_CACHE_DIR=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        nodejs \
        npm \
        openssh-client \
        pipx \
        procps \
        python3 \
        tmux \
        zsh \
    && npm install -g @anthropic-ai/claude-code @openai/codex opencode-ai \
    && npm cache clean --force \
    && pipx install aider-chat \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --home-dir /home/shelldeck --shell /bin/bash shelldeck \
    && mkdir -p /home/shelldeck/data/uploads /home/shelldeck/data/share \
    && chown -R shelldeck:shelldeck /home/shelldeck

COPY --from=build --chown=shelldeck:shelldeck /app/target/release/shelldeck /usr/local/bin/shelldeck
COPY --from=build --chown=shelldeck:shelldeck /app/public /home/shelldeck/baked/public
COPY --chown=shelldeck:shelldeck .env.example /home/shelldeck/data/.env.example
COPY --chown=shelldeck:shelldeck docker-entrypoint.sh /home/shelldeck/docker-entrypoint.sh
RUN chmod 0755 /home/shelldeck/docker-entrypoint.sh

USER shelldeck
WORKDIR /home/shelldeck/data

ENV DASHBOARD_HOST=0.0.0.0
ENV DASHBOARD_PORT=8787
ENV DASHBOARD_ROOT_DIR=/home/shelldeck/data
ENV DASHBOARD_UPLOAD_DIR=/home/shelldeck/data/uploads
ENV DASHBOARD_AGENT_WORKDIR=/home/shelldeck

EXPOSE 8787

ENTRYPOINT ["/home/shelldeck/docker-entrypoint.sh"]
