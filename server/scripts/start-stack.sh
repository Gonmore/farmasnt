#!/usr/bin/env bash
set -euo pipefail

# Starts infra stacks in order and then project stacks.
# Adjust these paths to match your server layout.
POSTGRES_DIR=${POSTGRES_DIR:-/postgres}
PROXY_DIR=${PROXY_DIR:-/proxy}
MINIO_DIR=${MINIO_DIR:-/minio}
PROYECTOS_DIR=${PROYECTOS_DIR:-/proyectos}

# Container names as seen in `docker ps` (used for waiting).
POSTGRES_CONTAINER_NAME=${POSTGRES_CONTAINER_NAME:-postgres-principal}
PROXY_CONTAINER_NAME=${PROXY_CONTAINER_NAME:-nginx-proxy-manager}
MINIO_CONTAINER_NAME=${MINIO_CONTAINER_NAME:-minio-principal}

# Space-separated list of project directories under /proyectos to start (recommended).
# Example: "farmasnt another-service"
PROJECTS=${PROJECTS:-"farmasnt malafama"}

wait_for_health() {
  local container_name="$1"
  local timeout_seconds="${2:-120}"
  local start_ts
  start_ts=$(date +%s)

  echo "[stack] Waiting for container health: ${container_name} (timeout ${timeout_seconds}s)"
  while true; do
    # If container doesn't exist yet, keep waiting
    if ! docker inspect "$container_name" >/dev/null 2>&1; then
      sleep 2
    else
      local status
      status=$(docker inspect -f '{{.State.Status}}' "$container_name" 2>/dev/null || true)
      local health
      health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_name" 2>/dev/null || true)

      # If no healthcheck is defined, treat "running" as ready
      if [ "$health" = "none" ]; then
        if [ "$status" = "running" ]; then
          echo "[stack] ${container_name} is running (no healthcheck)"
          return 0
        fi
      else
        if [ "$health" = "healthy" ]; then
          echo "[stack] ${container_name} is healthy"
          return 0
        fi
      fi

      sleep 2
    fi

    local now_ts
    now_ts=$(date +%s)
    if [ $((now_ts - start_ts)) -ge "$timeout_seconds" ]; then
      echo "[stack] Timeout waiting for ${container_name}"
      docker ps -a || true
      exit 1
    fi
  done
}

up_dir() {
  local dir="$1"
  echo "[stack] Bringing up: ${dir}"
  (cd "$dir" && docker compose up -d)
}

up_dir "$POSTGRES_DIR"
# Adjust the container name if your postgres service uses a different name
# Example: postgres-principal
wait_for_health "$POSTGRES_CONTAINER_NAME" 180 || true

up_dir "$PROXY_DIR"
# If nginx has healthcheck, change accordingly; otherwise script will accept 'running'
wait_for_health "$PROXY_CONTAINER_NAME" 60 || true

up_dir "$MINIO_DIR"
wait_for_health "$MINIO_CONTAINER_NAME" 120 || true

# Start projects AFTER infra is up
for project in $PROJECTS; do
  project_dir="${PROYECTOS_DIR}/${project}"
  echo "[stack] Bringing up project: ${project_dir}"
  (cd "$project_dir" && docker compose up -d --build)

done

echo "[stack] All stacks started."
