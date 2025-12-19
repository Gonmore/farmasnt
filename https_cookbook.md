# HTTPS Cookbook — PharmaFlow Bolivia (supernovatel.com)

Este documento describe una receta práctica para pasar de HTTP a HTTPS con **Let’s Encrypt** en un **datacenter propio**, usando subdominios públicos bajo `supernovatel.com` y manteniendo MinIO (S3-compatible) para **logos públicos**.

> Objetivo: evitar “mixed content”, mantener URLs estables de assets y que el backend pueda seguir generando presigned URLs.

---

## 0) Arquitectura recomendada

### Subdominios
- `farmacia.supernovatel.com` → Frontend (SPA)
- `api.supernovatel.com` → Backend (Fastify)
- `assets.supernovatel.com` → S3-compatible público (MinIO detrás de proxy)
- (opcional, restringido) `minio-console.supernovatel.com` → Consola MinIO

### Puertos
- Externos (internet): **80/443** hacia el reverse proxy
- Internos (LAN/DC):
  - Frontend (si aplica): 3000/8080/etc (según tu servidor)
  - Backend: `6000` (o el que uses)
  - MinIO S3: `9000`
  - MinIO Console: `9001`

### Flujo de logo (público)
1) Admin (frontend) pide `POST /api/v1/admin/tenant/branding/logo-upload`
2) Backend genera presigned `PUT` contra `S3_ENDPOINT`
3) Frontend hace `PUT` directo a `uploadUrl`
4) Backend guarda `logoUrl = publicUrl` (público)

---

## 1) DNS (público)

Crear registros DNS tipo `A` (o `CNAME` si corresponde) apuntando al IP público de tu reverse proxy:
- `farmacia.supernovatel.com`
- `api.supernovatel.com`
- `assets.supernovatel.com`

**TTL**: durante pruebas usa bajo (p.ej. 60–300s). Luego lo subís.

---

## 2) Método de Let’s Encrypt (recomendado)

Como el dominio es público, lo más simple suele ser **HTTP-01**:
- Let’s Encrypt valida que tu proxy responde en `http://<host>/.well-known/acme-challenge/...`
- Requisito: puerto **80** público y enrutable hacia el proxy.

Si por política no querés abrir 80, alternativa:
- **DNS-01** (validación por TXT), útil para entornos más cerrados. Requiere automatizar cambios DNS.

### Recomendación para tu escenario (NAT + control total del DNS)
- Para comenzar con `farmacia.supernovatel.com` + `api` + `assets`: **HTTP-01** es suficiente y suele ser lo más rápido.
- Para futuro (muchos dominios / wildcards bajo tu control): **DNS-01** es excelente para emitir certificados tipo `*.supernovatel.com`.
- Para dominios de clientes (ej. `farmacia.febsa.com`): normalmente NO podrás usar DNS-01 (no controlas ese DNS), así que el camino típico es **HTTP-01** siempre que el cliente apunte su subdominio a tu IP pública.

---

## 3) Opción A (recomendada): Caddy como reverse proxy (más simple)

Caddy obtiene y renueva certificados automáticamente.

### 3.1) Caddyfile (ejemplo)

> Ajusta IPs internos/puertos según tu red.

```caddyfile
{
  email admin@supernovatel.com
}

farmacia.supernovatel.com {
  encode gzip
  root * /var/www/pharma-frontend
  try_files {path} /index.html
  file_server
}

api.supernovatel.com {
  encode gzip
  reverse_proxy 127.0.0.1:6000
}

assets.supernovatel.com {
  encode gzip
  reverse_proxy 10.10.0.50:9000
}

# Opcional: consola MinIO sólo desde LAN/VPN (ejemplo simple por IP)
minio-console.supernovatel.com {
  @blocked not remote_ip 10.0.0.0/8 192.168.0.0/16 172.16.0.0/12
  respond @blocked "forbidden" 403

  reverse_proxy 10.10.0.50:9001
}
```

### 3.2) Notas
- Caddy ya maneja:
  - certificado
  - renovación
  - redirect HTTP→HTTPS
- Si el frontend es un build (Vite), servís el contenido estático desde `/var/www/pharma-frontend`.

---

## 4) Opción B: Nginx + Certbot (más control)

### 4.1) Nginx server blocks (idea general)
- `app.supernovatel.com` sirve estáticos (SPA)
- `api.supernovatel.com` proxy al backend
- `assets.supernovatel.com` proxy a MinIO

### 4.2) Certbot
- `certbot --nginx -d app.supernovatel.com -d api.supernovatel.com -d assets.supernovatel.com`
- Asegurarse que exista cron/systemd timer para renovar.

---

## 5) Configuración del backend para S3-compatible con HTTPS

Cuando uses `assets.supernovatel.com` (TLS), setea en `backend/.env`:

```dotenv
S3_ENDPOINT=https://assets.supernovatel.com
S3_REGION=us-east-1
S3_BUCKET=farmasnt-assets
S3_ACCESS_KEY_ID=... 
S3_SECRET_ACCESS_KEY=...

# Muy importante: incluye bucket porque el backend hace joinUrl(base, key)
S3_PUBLIC_BASE_URL=https://assets.supernovatel.com/farmasnt-assets

# MinIO/on-prem
S3_FORCE_PATH_STYLE=true
```

### Por qué `S3_PUBLIC_BASE_URL` incluye el bucket
En el backend se arma `publicUrl` como `joinUrl(S3_PUBLIC_BASE_URL, key)`.
- Si `S3_PUBLIC_BASE_URL=https://assets.../farmasnt-assets`, entonces `publicUrl` queda:
  - `https://assets.../farmasnt-assets/tenant-logos/<tenantId>.png`

---

## 6) Evitar mixed content (regla de oro)

Si `app.supernovatel.com` es HTTPS, tus assets también deben ser HTTPS.
- No mezclar `https://app...` con `http://<ip>:9000/...`
- Por eso `assets.supernovatel.com` es clave.

---

## 7) MinIO (bucket público sólo lectura)

Para logos públicos:
- Bucket `farmasnt-assets`
- Política anónima: **download** (GetObject) únicamente
- Subida: sólo por credenciales del backend o presigned PUT

Recomendación:
- Mantener MinIO en LAN
- Exponer públicamente sólo vía proxy `assets.supernovatel.com` (TLS)

---

## 8) Migración sugerida (sin downtime largo)

1) **Hoy (HTTP interno)**: app/api/minio por IP → pruebas funcionales
2) **Agregar reverse proxy**: publicar `app/api/assets` por HTTP (validar routing)
3) **Emitir certificados**: Let’s Encrypt (HTTP-01)
4) **Pasar app y api a HTTPS** (redirigir HTTP→HTTPS)
5) **Pasar assets a HTTPS** y actualizar `S3_ENDPOINT`/`S3_PUBLIC_BASE_URL`
6) (Opcional) Activar HSTS cuando estés seguro

---

## 9) Checklist de verificación

- `https://app.supernovatel.com` carga y navega
- `https://api.supernovatel.com/api/v1/health` responde `ok`
- Admin → Branding:
  - `logo-upload` devuelve `uploadUrl` con host `assets.supernovatel.com`
  - `PUT uploadUrl` funciona
  - El logo se ve en el header sin warnings del navegador

---

## 10) Hardening mínimo recomendado

- Limitar acceso público a `minio-console.*` (IP allowlist o VPN)
- En el proxy:
  - Redirigir `HTTP → HTTPS`
  - Deshabilitar TLS viejos (si aplica)
- En backend:
  - Mantener `expiresInSeconds` corto para presigned URLs (ej. 600)
  - Validar `contentType` permitido para logos (image/*)

---

## 11) Notas sobre Let’s Encrypt en datacenter

- HTTP-01 requiere que el proxy sea alcanzable por internet en 80/443.
- Si el DC tiene NAT/firewall, abrir y forwardear esos puertos al proxy.
- Si DNS está bajo tu control, DNS-01 es alternativa robusta.

---

## 12) NAT / Firewall: despliegue con una sola IP pública

Tu escenario: Windows y luego Ubuntu Server salen a internet por NAT con **la misma IP pública**. La diferencia es que en el firewall harás el **NAT de entrada** (port-forward) hacia la máquina que esté activa.

### Reglas de entrada mínimas
- TCP `80` → reverse proxy (Caddy/Nginx)
- TCP `443` → reverse proxy (Caddy/Nginx)

Todo lo demás (backend `6000`, MinIO `9000/9001`) debería quedar **solo interno**.

### Cutover (Windows → Ubuntu) sin dolor
1) Asegurar que Ubuntu tiene el proxy listo y responde en LAN.
2) Cambiar el port-forward del firewall (80/443) desde Windows → Ubuntu.
3) Esperar propagación (si no cambiaste DNS, el cambio es inmediato; solo impacta el NAT).

Nota: Let’s Encrypt renueva por dominio, no por host. Si cambias el NAT de entrada, el proxy “nuevo” debe poder completar renovaciones y servir los mismos hosts.

---

## 13) Dominios por cliente (multi-tenant con “sentido de pertenencia”)

Objetivo futuro: además de `farmacia.supernovatel.com`, permitir dominios tipo:
- `farmacia.febsa.com`
- `farmacia.otrocliente.com`

### 13.1) Qué es lo mínimo para que funcione
- El cliente debe apuntar su subdominio a tu IP pública:
  - `A farmacia.febsa.com -> <tu IP pública>`
  - o `CNAME farmacia.febsa.com -> farmacia.supernovatel.com`
- Tu reverse proxy debe aceptar ese `Host` y servir la SPA.
- HTTPS: necesitas un certificado válido para `farmacia.febsa.com`.

### 13.2) HTTPS para dominios de clientes
Como NO controlas el DNS del cliente, lo normal es:
- Usar **HTTP-01**: si `farmacia.febsa.com` apunta a tu IP y tu proxy responde, Let’s Encrypt valida y emite cert.

Con Caddy, esto puede ser muy simple, pero hay 2 consideraciones:
- **Rate limits** de Let’s Encrypt si agregas muchos dominios de golpe.
- Seguridad: no quieres emitir certificados “para cualquier dominio” sin control.

Recomendación para operar seguro:
- Mantener una lista explícita de dominios permitidos (por tenant) y solo servir TLS para esos dominios.
- (Opcional) Implementar verificación de dominio antes de activarlo:
  - el cliente publica un TXT DNS (si te lo permite) o
  - un archivo HTTP temporal en `https://farmacia.febsa.com/.well-known/...`.

En PharmaFlow, el backend puede exponer un token por dominio en:
- `/.well-known/pharmaflow-domain-verification` (responde texto plano con el token para el `Host` actual)

### 13.3) Resolución de tenant por dominio
Hoy el tenant se determina por el JWT (claims). Para dar una UX más “nativa” por dominio:
- Mantener un mapeo `domain -> tenantId` en DB.
- En el backend, al login, inferir el tenant por `Host` (ej. `farmacia.febsa.com`) y emitir token con ese `tenantId`.
- En el frontend, antes de login, cargar branding/tenant name por `Host` (opcional) para que la pantalla de login ya sea “de Febsa”.

Modelo sugerido (futuro):
- Tabla `TenantDomain`:
  - `id`, `tenantId`, `domain` (unique), `isPrimary`, `verifiedAt`, `createdAt`
  - `verificationToken`, `verificationTokenExpiresAt` (para flujos de verificación controlada)

### 13.4) Assets / logos cuando hay dominios por cliente
Los logos siguen siendo públicos bajo `assets.supernovatel.com/...` (estable). Esto evita:
- tener que emitir certificados de assets por cada cliente
- complejidad de CORS/mixed content

---

## 14) Recomendación práctica: empezar simple

Fase inicial:
- Publicar solo `farmacia.supernovatel.com`, `api.supernovatel.com`, `assets.supernovatel.com`.

Fase 2:
- Agregar soporte a dominios de clientes uno por uno (HTTP-01), con validación y whitelist.

Fase 3:
- Si el volumen crece, evaluar automatización/centralización de verificación y emisión.
