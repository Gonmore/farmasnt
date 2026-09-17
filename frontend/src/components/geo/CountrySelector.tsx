import React, { useState, useEffect, useCallback } from 'react'
import { geoApi, type Country } from '../../lib/geoService'
import { countryCodeToName } from './countryUtils'

interface CountrySelectorProps {
  value: string
  onChange: (value: string) => void
  onCountryDetail?: (country: Country) => void
  placeholder?: string
  label?: string
  disabled?: boolean
  required?: boolean
}

export type { CountrySelectorProps }

interface Option {
  code: string
  name: string
  currency: string
}

const CountrySelector: React.FC<CountrySelectorProps> = ({
  value,
  onChange,
  onCountryDetail,
  placeholder = 'Buscar país...',
  label = 'País',
  disabled = false,
  required = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [options, setOptions] = useState<Option[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  const performSearch = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setOptions([])
      return
    }

    setIsLoading(true)
    try {
      const { items } = await geoApi.searchCountries(query)
      setOptions(items.map((c) => ({ code: c.code, name: c.name, currency: c.currency })))
    } catch {
      setOptions([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(searchTerm)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchTerm, performSearch])

  useEffect(() => {
    if (value && !searchTerm) {
      setSearchTerm(countryCodeToName(value))
    }
  }, [value, searchTerm])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setSearchTerm(newValue)
    setIsOpen(true)

    if (!newValue.trim()) {
      onChange('')
      onCountryDetail?.(undefined as any)
    }
  }

  const handleOptionSelect = (option: Option) => {
    setSearchTerm(option.name)
    onChange(option.code)
    onCountryDetail?.({ code: option.code, code3: option.code, name: option.name, currency: option.currency, phoneCode: '' })
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
      {label && (
        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          {label}
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
                <span className="font-medium">{option.name}</span>
                <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">({option.currency})</span>
              </div>
            ))
          ) : searchTerm.length >= 2 ? (
            <div className="px-3 py-2 text-slate-500 dark:text-slate-400">
              No se encontraron países
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

export default CountrySelector
