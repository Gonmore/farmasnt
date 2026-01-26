import type { ReactNode } from 'react'
import { Button } from './Button'
import type { ButtonProps } from './Button'

export interface IconButtonProps {
  label: string
  icon: ReactNode
  variant?: ButtonProps['variant']
  size?: ButtonProps['size']
  loading?: ButtonProps['loading']
  disabled?: ButtonProps['disabled']
  className?: string
  onClick?: ButtonProps['onClick']
  type?: ButtonProps['type']
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'sm',
  loading,
  disabled,
  className = '',
  onClick,
  type = 'button',
}: IconButtonProps) {
  return (
    <Button
      type={type}
      size={size}
      variant={variant}
      aria-label={label}
      title={label}
      onClick={onClick}
      loading={loading}
      disabled={disabled}
      className={`h-9 w-9 px-0 py-0 ${className}`}
    >
      <span className="text-base leading-none">{icon}</span>
    </Button>
  )
}
