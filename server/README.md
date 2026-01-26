# Server bootstrap (postgres/proxy/minio/proyectos)

This folder contains *templates* to run your server infra in separate directories:

- `/postgres`
- `/proxy`
- `/minio`
- `/proyectos/<project>`

## MinIO (shared)

Copy [server/minio/docker-compose.yml](minio/docker-compose.yml) to the server directory `/minio/docker-compose.yml`.

Create `/minio/.env` on the server:

- `MINIO_ROOT_USER=...`
- `MINIO_ROOT_PASSWORD=...`
- `MINIO_BUCKETS=farmasnt-assets,another-service-bucket`

Bring it up:

- `cd /minio && docker compose up -d`

If buckets don't appear, run the init job manually (it is one-shot and may already have exited):

- `cd /minio && docker compose ps -a`
- `docker logs minio-init`
- `cd /minio && docker compose run --rm minio-init`

## Auto-start on boot (systemd)

1) Copy scripts:

- Copy [server/scripts/start-stack.sh](scripts/start-stack.sh) to `/opt/supernovatel/scripts/start-stack.sh`
- `chmod +x /opt/supernovatel/scripts/start-stack.sh`

2) Install the unit:

- Copy [server/systemd/supernovatel-stack.service](systemd/supernovatel-stack.service) to `/etc/systemd/system/supernovatel-stack.service`
- `systemctl daemon-reload`
- `systemctl enable --now supernovatel-stack.service`

## Important

- Container names in `start-stack.sh` must match your actual containers (postgres/nginx/minio).
	- From your `docker ps`: `postgres-principal` and `nginx-proxy-manager`.
	- MinIO will be `minio-principal` if you use the provided compose.
- If you have healthchecks configured, the script waits for `healthy`. If not, it only waits for `running`.
- Projects are started after infra by running `docker compose up -d --build` in each project directory.

### Troubleshooting: why `minio-init` may do nothing

Docker Compose tokenizes `command:` strings. If you use `/bin/sh -lc` as entrypoint and provide a multi-line `command:` as a plain string, Compose may split it and the shell will only execute the first token.

The provided compose files use list-form `command: ["<script>"]` to ensure the full script runs.

### Tunables (env)

You can override without editing files by setting env vars in the systemd unit:

- `POSTGRES_CONTAINER_NAME` (default: `postgres-principal`)
- `PROXY_CONTAINER_NAME` (default: `nginx-proxy-manager`)
- `MINIO_CONTAINER_NAME` (default: `minio-principal`)
- `PROJECTS` (default: `farmasnt malafama`)
