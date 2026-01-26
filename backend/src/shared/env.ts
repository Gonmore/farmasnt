import { z } from 'zod'

function emptyStringToUndefined(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(6000),
  WEB_ORIGIN: z.string().default('http://localhost:6001'),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),

  // SMTP (for password reset emails)
  SMTP_HOST: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
  SMTP_PORT: z.coerce.number().int().positive().optional().default(587),
  SMTP_SECURE: z.coerce.boolean().optional().default(false),
  SMTP_USER: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
  SMTP_PASS: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
  SMTP_FROM: z.preprocess(emptyStringToUndefined, z.string().min(3).optional()),

  // S3-compatible object storage (for tenant logos)
  S3_ENDPOINT: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
  S3_ACCESS_KEY_ID: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
  S3_SECRET_ACCESS_KEY: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
  // Public base URL for objects (e.g. https://cdn.example.com or https://bucket.s3.amazonaws.com)
  S3_PUBLIC_BASE_URL: z.preprocess(emptyStringToUndefined, z.string().url().optional()),
  // Useful for MinIO / many S3-compatible providers
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
})

export type Env = z.infer<typeof envSchema>

export function getEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    // Avoid logging secrets; only show key-level issues
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment configuration: ${issues.join('; ')}`)
  }
  return parsed.data
}
