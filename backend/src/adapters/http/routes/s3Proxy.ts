import type { FastifyInstance } from 'fastify'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getEnv } from '../../../shared/env.js'
import { requireAuth } from '../../../application/security/rbac.js'

function createS3Client(env: ReturnType<typeof getEnv>): S3Client {
  return new S3Client({
    region: env.S3_REGION ?? 'us-east-1',
    endpoint: env.S3_ENDPOINT!,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    },
  })
}

export function registerS3ProxyRoutes(app: FastifyInstance) {
  const env = getEnv()

  app.get(
    '/api/v1/s3/get/*',
    { preHandler: [requireAuth()] },
    async (request, reply) => {
      if (!env.S3_ENDPOINT || !env.S3_BUCKET) {
        return reply.status(500).send({ message: 'S3 not configured' })
      }

      const wildcard = (request.params as Record<string, string>)['*'] ?? ''
      const key = decodeURIComponent(wildcard)

      const s3 = createS3Client(env)

      try {
        const cmd = new GetObjectCommand({
          Bucket: env.S3_BUCKET,
          Key: key,
        })
        const s3Response = await s3.send(cmd)

        if (!s3Response.Body) {
          return reply.status(404).send({ message: 'File not found' })
        }

        const contentType = s3Response.ContentType ?? 'application/octet-stream'
        reply.header('Content-Type', contentType)

        const contentDisposition = s3Response.ContentDisposition
        if (contentDisposition) {
          reply.header('Content-Disposition', contentDisposition)
        }

        const stream = s3Response.Body as NodeJS.ReadableStream
        return reply.send(stream)
      } catch (err: any) {
        if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
          return reply.status(404).send({ message: 'File not found' })
        }
        if (err.name === 'AccessDenied') {
          return reply.status(403).send({ message: 'Access denied' })
        }
        app.log.error({ err }, 'S3 proxy error')
        return reply.status(500).send({ message: 'Error retrieving file' })
      }
    },
  )
}
