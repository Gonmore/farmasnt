import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { getEnv } from './env.js'

export type Mailer = {
  sendPasswordResetEmail: (input: { to: string; resetUrl: string; tenantName?: string | null }) => Promise<void>
}

function isSmtpConfigured(env: ReturnType<typeof getEnv>): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS && env.SMTP_FROM)
}

let cached: Transporter | null = null

function getTransporter(): Transporter {
  if (cached) return cached

  const env = getEnv()
  if (!isSmtpConfigured(env)) {
    throw new Error('SMTP is not configured (missing SMTP_HOST/SMTP_USER/SMTP_PASS/SMTP_FROM)')
  }

  cached = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  })

  return cached
}

export function getMailer(): Mailer {
  return {
    sendPasswordResetEmail: async ({ to, resetUrl, tenantName }) => {
      const env = getEnv()
      const subject = tenantName ? `${tenantName}: restablecer contraseña` : 'Restablecer contraseña'

      const text =
        `Hola,\n\n` +
        `Recibimos una solicitud para restablecer tu contraseña.\n` +
        `Usa este enlace (válido por tiempo limitado):\n\n` +
        `${resetUrl}\n\n` +
        `Si no solicitaste este cambio, puedes ignorar este correo.\n`

      const html = `
        <p>Hola,</p>
        <p>Recibimos una solicitud para restablecer tu contraseña.</p>
        <p><a href="${resetUrl}">Haz click aquí para restablecer tu contraseña</a></p>
        <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
      `.trim()

      const transporter = getTransporter()
      await transporter.sendMail({
        from: env.SMTP_FROM,
        to,
        subject,
        text,
        html,
      })
    },
  }
}
