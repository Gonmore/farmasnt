import React, { useState, useEffect, useCallback } from 'react'
import { geoApi, type AdminLevel1 } from '../../lib/geoService'
import { countryCodeToName } from './countryUtils'

interface AdminLevel1SelectorProps {
  countryCode: string
  value: string
  onChange: (value: string) => void
  onAdminLevel1Select?: (admin: AdminLevel1) => void
  placeholder?: string
  label?: string
  disabled?: boolean
  required?: boolean
}

export type { AdminLevel1SelectorProps }

const AdminLevel1Selector: React.FC<AdminLevel1SelectorProps> = ({
  countryCode,
  value,
  onChange,
  onAdminLevel1Select,
  placeholder = 'Buscar región...',
  label,
  disabled = false,
  required = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [options, setOptions] = useState<AdminLevel1[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  const defaultLabel = countryCode ? `${countryCodeToName(countryCode)} - Departamento` : 'Departamento'
  const effectiveLabel = label ?? defaultLabel

  const performSearch = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setOptions([])
      return
    }

    setIsLoading(true)
    try {
      const { items } = await geoApi.searchAdminLevel1(countryCode, query)
      setOptions(items)
    } catch {
      setOptions([])
    } finally {
      setIsLoading(false)
    }
  }, [countryCode])

  useEffect(() => {
    setSearchTerm('')
    setOptions([])
  }, [countryCode])

  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(searchTerm)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchTerm, performSearch])

  useEffect(() => {
    if (value && !searchTerm) {
      const selected = options.find((o) => o.name.toUpperCase() === value.toUpperCase() || o.code === value)
      setSearchTerm(selected?.name ?? value)
    }
  }, [value, searchTerm, options])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setSearchTerm(newValue)
    setIsOpen(true)

    if (!newValue.trim()) {
      onChange('')
      onAdminLevel1Select?.(null as any)
    }
  }

  const handleOptionSelect = (option: AdminLevel1) => {
    setSearchTerm(option.name)
    onChange(option.name.toUpperCase())
    onAdminLevel1Select?.(option)
    setIsOpen(false)
  }

  const handleInputFocus = () => {
    setIsOpen(true)
  }

  const handleInputBlur = () => {
    setTimeout(() => setIsOpen(false), 200)
  }

  return (
    <div className="relative">
      {effectiveLabel && (
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          {effectiveLabel}
        </label>
      )}
      <input
        type="text"
        value={searchTerm}
        onChange={handleInputChange}
        onFocus={handleInputFocus}
        onBlur={handleInputBlur}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        className="w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-100 disabled:cursor-not-allowed dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
      />

      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-auto dark:border-slate-600 dark:bg-slate-700">
          {isLoading ? (
            <div className="px-3 py-2 text-slate-500 dark:text-slate-400">
              Buscando...
            </div>
          ) : options.length > 0 ? (
            options.map((option) => (
              <div
                key={option.code}
                onClick={() => handleOptionSelect(option)}
                className="px-3 py-2 hover:bg-slate-100 cursor-pointer dark:hover:bg-slate-600"
              >
                {option.name}
              </div>
            ))
          ) : searchTerm.length >= 2 ? (
            <div className="px-3 py-2 text-slate-500 dark:text-slate-400">
              No se encontraron regiones
            </div>
          ) : (
            <div className="px-3 py-2 text-slate-500 dark:text-slate-400">
              Escribe al menos 2 caracteres
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AdminLevel1Selector
