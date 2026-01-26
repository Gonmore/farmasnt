import { SignJWT, jwtVerify } from 'jose'
import crypto from 'node:crypto'

export type AccessTokenClaims = {
  sub: string
  tenantId: string
}

function textEncoderSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function signAccessToken(params: {
  userId: string
  tenantId: string
  secret: string
  expiresInSeconds?: number
}): Promise<string> {
  const expiresIn = params.expiresInSeconds ?? 15 * 60
  return new SignJWT({ tenantId: params.tenantId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(params.userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresIn)
    .sign(textEncoderSecret(params.secret))
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, textEncoderSecret(secret))
  const sub = payload.sub
  const tenantId = payload.tenantId
  if (typeof sub !== 'string' || typeof tenantId !== 'string') throw new Error('Invalid token')
  return { sub, tenantId }
}

export function generateOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex')
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}
