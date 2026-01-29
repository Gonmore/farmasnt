import { useQuery } from '@tanstack/react-query'
import React, { useState, useEffect, useRef, useMemo } from 'react'
import { apiFetch } from '../lib/api'
import { useAuth } from '../providers/AuthProvider'
import { Input } from './common'
import { ChevronDownIcon, CheckIcon } from '@heroicons/react/24/outline'

type CustomerListItem = {
  id: string
  name: string
  isActive: boolean
  city?: string | null
  creditEnabled?: boolean
  creditDays?: number | null
}

type CustomerListResponse = { items: CustomerListItem[]; nextCursor: string | null }

async function fetchCustomers(token: string, search?: string): Promise<CustomerListResponse> {
  const params = new URLSearchParams({ take: '50' })
  if (search?.trim()) {
    params.append('q', search.trim())
  }
  return apiFetch(`/api/v1/customers?${params}`, { token })
}

interface CustomerSelectorProps {
  value?: string
  onChange: (customerId: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function CustomerSelector({ value, onChange, placeholder = "Buscar cliente...", disabled, className = '' }: CustomerSelectorProps) {
  const auth = useAuth()
  const [searchTerm, setSearchTerm] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch all customers initially
  const allCustomersQuery = useQuery({
    queryKey: ['customers-list'],
    queryFn: () => fetchCustomers(auth.accessToken!),
    enabled: !!auth.accessToken,
  })

  // Fetch filtered customers when searching
  const searchQuery = useQuery({
    queryKey: ['customers-search', searchTerm],
    queryFn: () => fetchCustomers(auth.accessToken!, searchTerm),
    enabled: !!auth.accessToken && searchTerm.length > 0,
  })

  const customers = searchTerm ? searchQuery.data?.items ?? [] : allCustomersQuery.data?.items ?? []
  const activeCustomers = customers.filter(c => c.isActive)

  // Find selected customer
  const selectedCustomer = useMemo(() => {
    if (value && allCustomersQuery.data?.items) {
      return allCustomersQuery.data.items.find(c => c.id === value) || null
    }
    return null
  }, [value, allCustomersQuery.data])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (customer: CustomerListItem) => {
    onChange(customer.id)
    setIsOpen(false)
    setSearchTerm('')
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value)
    if (!isOpen) setIsOpen(true)
  }

  const handleInputFocus = () => {
    setIsOpen(true)
  }

  const displayValue = selectedCustomer ? selectedCustomer.name : ''

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      <div className="relative">
        <Input
          ref={inputRef}
          type="text"
          value={isOpen ? searchTerm : displayValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          placeholder={placeholder}
          disabled={disabled}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={disabled}
          className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-slate-600 disabled:opacity-50"
        >
          <ChevronDownIcon className={`h-5 w-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-60 overflow-auto">
          {activeCustomers.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
              {searchTerm ? 'No se encontraron clientes' : 'Cargando clientes...'}
            </div>
          ) : (
            activeCustomers.map((customer) => (
              <button
                key={customer.id}
                type="button"
                onClick={() => handleSelect(customer)}
                className="w-full px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700 focus:bg-slate-50 dark:focus:bg-slate-700 focus:outline-none flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                    {customer.name}
                  </div>
                  {customer.city && (
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                        {customer.city}
                      </span>
                    </div>
                  )}
                </div>
                {selectedCustomer?.id === customer.id && (
                  <CheckIcon className="h-5 w-5 text-blue-600 dark:text-blue-400 ml-2 flex-shrink-0" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}