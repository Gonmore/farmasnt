import React, { useState, useEffect, useCallback } from 'react'
import { searchCountries } from '../lib/geo'
import type { GeoOption } from '../lib/geo'

interface CountrySelectorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
}

const CountrySelector: React.FC<CountrySelectorProps> = ({
  value,
  onChange,
  placeholder = "Buscar país...",
  disabled = false,
  required = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [options, setOptions] = useState<GeoOption[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  // Search countries when search term changes
  const performSearch = useCallback(async (query: string) => {
    if (query.length < 2) {
      setOptions([])
      return
    }

    setIsLoading(true)
    try {
      const results = await searchCountries(query)
      setOptions(results)
    } catch (error) {
      console.error('Error searching countries:', error)
      setOptions([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(searchTerm)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchTerm, performSearch])

  // Set initial search term from value
  useEffect(() => {
    if (value && !searchTerm) {
      setSearchTerm(value)
    }
  }, [value, searchTerm])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setSearchTerm(newValue)
    setIsOpen(true)

    // If user clears the input, clear the value
    if (!newValue.trim()) {
      onChange('')
    }
  }

  const handleOptionSelect = (option: GeoOption) => {
    setSearchTerm(option.label)
    onChange(option.value)
    setIsOpen(false)
  }

  const handleInputFocus = () => {
    setIsOpen(true)
  }

  const handleInputBlur = () => {
    // Delay closing to allow option selection
    setTimeout(() => setIsOpen(false), 200)
  }

  return (
    <div className="relative">
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
                key={option.value}
                onClick={() => handleOptionSelect(option)}
                className="px-3 py-2 hover:bg-slate-100 cursor-pointer dark:hover:bg-slate-600"
              >
                {option.label}
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