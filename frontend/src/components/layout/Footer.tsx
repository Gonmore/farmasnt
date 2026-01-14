import { useState, useRef, useEffect } from 'react'
import type { ReactElement } from 'react'
import { Modal } from '../common/Modal'
import { api } from '../../lib/api'
import { useScroll } from '../../contexts/ScrollContext'

interface ContactInfo {
  id: string
  modalHeader: string
  modalBody: string
}

// Parser para detectar emails y números de WhatsApp y convertirlos en botones
function parseContactBody(text: string) {
  const lines = text.split('\n')
  const elements: ReactElement[] = []
  
  lines.forEach((line, index) => {
    // Detectar email
    const emailMatch = line.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i)
    if (emailMatch) {
      const email = emailMatch[1]
      const beforeEmail = line.substring(0, emailMatch.index)
      
      elements.push(
        <div key={index} className="flex items-center gap-2">
          <span className="text-slate-700 dark:text-slate-300">{beforeEmail.trim()}</span>
          <a
            href={`mailto:${email}`}
            className="inline-flex rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700"
          >
            📧 {email}
          </a>
        </div>
      )
      return
    }
    
    // Detectar WhatsApp
    const whatsappMatch = line.match(/(WhatsApp|whatsapp|wa):\s*(\+?\d[\d\s-]+)/i)
    if (whatsappMatch) {
      const phoneRaw = whatsappMatch[2]
      const phoneClean = phoneRaw.replace(/[\s-]/g, '') // Limpiar espacios y guiones
      const beforePhone = line.substring(0, whatsappMatch.index)
      
      elements.push(
        <div key={index} className="flex items-center gap-2">
          <span className="text-slate-700 dark:text-slate-300">{beforePhone.trim()}</span>
          <a
            href={`https://wa.me/${phoneClean}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white transition-all hover:bg-green-600 dark:bg-green-600 dark:hover:bg-green-700"
          >
            📱 WhatsApp {phoneRaw}
          </a>
        </div>
      )
      return
    }
    
    // Línea normal sin botón
    if (line.trim()) {
      elements.push(
        <p key={index} className="text-slate-700 dark:text-slate-300">
          {line}
        </p>
      )
    }
  })
  
  return elements
}

export function Footer() {
  const [isOpen, setIsOpen] = useState(false)
  const [contactInfo, setContactInfo] = useState<ContactInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const { scrollLeft, setScrollLeft, maxScroll } = useScroll()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollLeft
    }
  }, [scrollLeft])

  const loadContactInfo = async () => {
    if (contactInfo) return // Ya cargado
    setIsLoading(true)
    try {
      const response = await api.get<ContactInfo>('/api/v1/contact/info')
      setContactInfo(response.data)
    } catch (error) {
      console.error('Error loading contact info:', error)
      // Valores por defecto en caso de error
      setContactInfo({
        id: '',
        modalHeader: 'Contactos',
        modalBody: 'Únete a este sistema o solicita el tuyo personalizado:\n- 📧 contactos@supernovatel.com\n- 📱 WhatsApp: +591 65164773',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpen = () => {
    setIsOpen(true)
    loadContactInfo()
  }

  return (
    <>
      <footer className="sticky bottom-0 border-t border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        <button
          onClick={handleOpen}
          className="w-full"
        >
          <div className="flex h-[3.75rem] items-center justify-center px-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600 dark:text-slate-400">
                Powered
              </span>
              <div className="group flex h-7 w-7 items-center justify-center rounded-full bg-slate-200 transition-colors hover:bg-blue-500 dark:bg-slate-700 dark:hover:bg-blue-500">
                <span className="text-xs font-medium text-slate-700 transition-colors group-hover:text-white dark:text-slate-300 dark:group-hover:text-white">
                  by
                </span>
              </div>
              <img
                src="/Logo_Azul.png"
                alt="Supernovatel"
                className="w-32 dark:hidden"
              />
              <img
                src="/Logo_Blanco.png"
                alt="Supernovatel"
                className="hidden w-32 dark:block"
              />
            </div>
          </div>
        </button>
        {maxScroll > 0 && (
          <div
            ref={scrollRef}
            className="overflow-x-auto bg-slate-100 dark:bg-slate-800"
            style={{ height: '16px' }}
            onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
          >
            <div style={{ width: `${maxScroll + window.innerWidth}px`, height: '1px' }} />
          </div>
        )}
      </footer>

      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={contactInfo?.modalHeader || 'Contactos'}
      >
        <div className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            </div>
          ) : (
            <div className="space-y-3">
              {contactInfo?.modalBody && parseContactBody(contactInfo.modalBody)}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
