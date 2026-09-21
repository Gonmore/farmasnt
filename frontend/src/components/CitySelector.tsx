import React, { useState, useEffect, useCallback } from 'react'
import { geoApi, type City } from '../lib/geoService'

interface CitySelectorProps {
  countryCode?: string
  adminLevel1Code?: string
  value: string
  onChange: (value: string) => void
  onCitySelect?: (city: City) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
}

const CitySelector: React.FC<CitySelectorProps> = ({
  countryCode,
  adminLevel1Code,
  value,
  onChange,
  onCitySelect,
  placeholder = 'Buscar ciudad...',
  disabled = false,
  required = false,
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [options, setOptions] = useState<City[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  const performSearch = useCallback(async (query: string) => {
    if (!query || query.length < 2) {
      setOptions([])
      return
    }

    if (!countryCode) {
      setOptions([])
      return
    }

    setIsLoading(true)
    try {
      const { items } = await geoApi.searchCities(countryCode, query, adminLevel1Code)
      setOptions(items)
    } catch {
      setOptions([])
    } finally {
      setIsLoading(false)
    }
  }, [countryCode, adminLevel1Code])

  useEffect(() => {
    const timer = setTimeout(() => {
      performSearch(searchTerm)
    }, 300)

    return () => clearTimeout(timer)
  }, [searchTerm, performSearch])

  useEffect(() => {
    if (value && !searchTerm) {
      setSearchTerm(value)
    }
  }, [value, searchTerm])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setSearchTerm(newValue)
    setIsOpen(true)

    if (!newValue.trim()) {
      onChange('')
    }
  }

  const handleOptionSelect = (option: City) => {
    setSearchTerm(option.name)
    onChange(option.name.toUpperCase())
    onCitySelect?.(option)
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
            options.map((option) => {
              const typeLabel =
                option.featureType === 'city' ? 'Ciudad' :
                option.featureType === 'town' ? 'Pueblo' :
                option.featureType === 'village' ? 'Aldea' :
                option.featureType === 'municipality' ? 'Municipio' :
                option.featureType === 'province' ? 'Provincia' :
                option.featureType
              return (
                <div
                  key={option.id}
                  onClick={() => handleOptionSelect(option)}
                  className="px-3 py-2 hover:bg-slate-100 cursor-pointer dark:hover:bg-slate-600"
                >
                  <div className="font-medium text-sm">{option.name}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">{typeLabel}</div>
                </div>
              )
            })
          ) : searchTerm.length >= 2 ? (
            <div className="px-3 py-2 text-slate-500 dark:text-slate-400">
              No se encontraron ciudades
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

export default CitySelector
