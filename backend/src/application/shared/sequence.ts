import type { Prisma } from '../../generated/prisma/client.js'

export type SequenceKey = 'MS' | 'OP' | 'LI' | 'OA' | 'OC' | 'OV' | 'LOT'

function padLeft(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

export function currentYearUtc(): number {
  return new Date().getUTCFullYear()
}

export async function nextSequence(
  tx: Prisma.TransactionClient,
  args: {
    tenantId: string
    year: number
    key: SequenceKey
  },
): Promise<{ value: number; number: string }> {
  // We store currentValue as the last issued value.
  // Upsert+increment gives us an atomic and tenant/year scoped sequence.
  const row = await tx.tenantSequence.upsert({
    where: { tenantId_year_key: { tenantId: args.tenantId, year: args.year, key: args.key } },
    create: { tenantId: args.tenantId, year: args.year, key: args.key, currentValue: 1 },
    update: { currentValue: { increment: 1 } },
    select: { currentValue: true },
  })

  if (args.key === 'LOT') {
    return { value: row.currentValue, number: `LOT-${args.year}${padLeft(row.currentValue, 3)}` }
  }

  return { value: row.currentValue, number: `${args.key}${args.year}-${row.currentValue}` }
}
