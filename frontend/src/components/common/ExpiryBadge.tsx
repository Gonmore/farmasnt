import { Badge } from './Badge'
import type { BadgeVariant } from './Badge'

export type ExpiryStatus = 'EXPIRED' | 'RED' | 'YELLOW' | 'GREEN'

const statusMap: Record<ExpiryStatus, { variant: BadgeVariant; label: string }> = {
  EXPIRED: { variant: 'danger', label: 'Vencido' },
  RED: { variant: 'danger', label: 'Crítico' },
  YELLOW: { variant: 'warning', label: 'Próximo' },
  GREEN: { variant: 'success', label: 'OK' },
}

export function ExpiryBadge({ status }: { status: ExpiryStatus }) {
  const config = statusMap[status]
  return <Badge variant={config.variant}>{config.label}</Badge>
}
