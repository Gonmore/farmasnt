import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'outline' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Visual variant of the button
   * - primary: Solid blue background (main actions)
   * - secondary: Solid gray background
   * - success: Solid green background (confirm actions)
   * - danger: Solid red background (destructive actions)
   * - outline: Border with transparent background
   * - ghost: No background, subtle hover (for table actions)
   */
  variant?: ButtonVariant
  
  /**
   * Size of the button
   * - sm: Small, compact (for tables)
   * - md: Medium (default)
   * - lg: Large (for CTAs)
   */
  size?: ButtonSize
  
  /**
   * Icon to display (Heroicon component)
   */
  icon?: ReactNode
  
  /**
   * Icon position relative to text
   */
  iconPosition?: 'left' | 'right'
  
  /**
   * Show loading spinner
   */
  loading?: boolean
  
  /**
   * Full width button
   */
  fullWidth?: boolean
  
  /**
   * Button children (text)
   */
  children?: ReactNode
}

/**
 * Modern button component with Heroicons support
 * Style: Linear/Outline icons, rounded borders, clean design
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      icon,
      iconPosition = 'left',
      loading = false,
      fullWidth = false,
      disabled,
      className = '',
      children,
      type = 'button',
      ...props
    },
    ref
  ) => {
    // Base styles
    const baseStyles = 'inline-flex items-center justify-center font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed'
    
    // Size styles
    const sizeStyles = {
      sm: children ? 'px-3 py-1.5 text-sm rounded-md gap-1.5' : 'p-1.5 text-sm rounded-md',
      md: children ? 'px-4 py-2.5 text-base rounded-lg gap-2' : 'p-2 text-base rounded-lg',
      lg: children ? 'px-5 py-3 text-lg rounded-lg gap-2.5' : 'p-2.5 text-lg rounded-lg',
    }
    
    // Variant styles
    const variantStyles = {
      primary: 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow focus:ring-blue-500',
      secondary: 'bg-gray-600 hover:bg-gray-700 text-white shadow-sm hover:shadow focus:ring-gray-500',
      success: 'bg-green-600 hover:bg-green-700 text-white shadow-sm hover:shadow focus:ring-green-500',
      danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm hover:shadow focus:ring-red-500',
      outline: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 focus:ring-blue-500',
      ghost: 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 focus:ring-blue-500',
    }
    
    // Icon size based on button size
    const iconSizeClass = {
      sm: 'w-4 h-4',
      md: 'w-5 h-5',
      lg: 'w-5 h-5',
    }
    
    const widthClass = fullWidth ? 'w-full' : ''
    
    const combinedClassName = `${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${widthClass} ${className}`
    
    // Loading spinner
    const spinner = (
      <svg className={`animate-spin ${iconSizeClass[size]}`} fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
    )
    
    const iconElement = loading ? spinner : icon
    
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={combinedClassName}
        {...props}
      >
        {iconElement && iconPosition === 'left' && (
          <span className={iconSizeClass[size]}>{iconElement}</span>
        )}
        {children}
        {iconElement && iconPosition === 'right' && (
          <span className={iconSizeClass[size]}>{iconElement}</span>
        )}
      </button>
    )
  }
)

Button.displayName = 'Button'
