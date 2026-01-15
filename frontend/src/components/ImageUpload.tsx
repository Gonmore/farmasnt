import { useCallback, useState } from 'react'
import { Button } from '../components'
import { autoCompressImage } from '../lib/imageUtils'

interface ImageUploadProps {
  currentImageUrl?: string | null
  onImageSelect: (file: File) => void
  onImageRemove: () => void
  loading?: boolean
  disabled?: boolean
  accept?: string
  maxSizeMB?: number
  className?: string
}

export function ImageUpload({
  currentImageUrl,
  onImageSelect,
  onImageRemove,
  loading = false,
  disabled = false,
  accept = 'image/png,image/jpeg,image/webp',
  maxSizeMB = 5,
  className = '',
}: ImageUploadProps) {
  const [dragOver, setDragOver] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const validateAndProcessFile = useCallback(async (file: File): Promise<File | null> => {
    // Check file type
    if (!accept.split(',').some(type => file.type === type.trim())) {
      alert(`Tipo de archivo no soportado. Use: ${accept}`)
      return null
    }

    // Check file size
    const maxSizeBytes = maxSizeMB * 1024 * 1024
    if (file.size > maxSizeBytes) {
      alert(`El archivo es demasiado grande. Máximo ${maxSizeMB}MB`)
      return null
    }

    try {
      // Auto-compress if needed
      const processedFile = await autoCompressImage(file, {
        maxSizeMB: maxSizeMB * 0.8, // Leave some margin for compression
        maxDimension: 1200,
        quality: 0.8
      })

      return processedFile
    } catch (error) {
      console.error('Error processing image:', error)
      alert('Error al procesar la imagen. Intente con otra.')
      return null
    }
  }, [accept, maxSizeMB])

  const handleFileSelect = useCallback(async (file: File | null) => {
    if (!file) {
      setSelectedFile(null)
      setPreviewUrl(null)
      return
    }

    setIsProcessing(true)
    try {
      const processedFile = await validateAndProcessFile(file)
      if (processedFile) {
        setSelectedFile(processedFile)
        // Create preview URL
        const url = URL.createObjectURL(processedFile)
        setPreviewUrl(url)
        onImageSelect(processedFile)
      }
    } finally {
      setIsProcessing(false)
    }
  }, [validateAndProcessFile, onImageSelect])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)

    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileSelect(files[0])
    }
  }, [handleFileSelect])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }, [])

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    handleFileSelect(file)
  }, [handleFileSelect])

  const handleUpload = useCallback(() => {
    if (selectedFile) {
      onImageSelect(selectedFile)
      // Clear preview after upload starts
      setSelectedFile(null)
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
        setPreviewUrl(null)
      }
    }
  }, [selectedFile, previewUrl, onImageSelect])

  const handleCancel = useCallback(() => {
    setSelectedFile(null)
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
      setPreviewUrl(null)
    }
  }, [previewUrl])

  const displayImageUrl = previewUrl || currentImageUrl

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Image Display Area */}
      <div
        className={`relative rounded-lg border-2 border-dashed transition-colors ${
          dragOver
            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
            : disabled
            ? 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800'
            : 'border-slate-300 bg-slate-50 hover:border-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:hover:border-slate-500'
        } ${displayImageUrl ? 'p-2' : 'p-8'}`}
        onDrop={disabled ? undefined : handleDrop}
        onDragOver={disabled ? undefined : handleDragOver}
        onDragLeave={disabled ? undefined : handleDragLeave}
      >
        {displayImageUrl ? (
          <div className="space-y-3">
            <img
              src={displayImageUrl}
              alt="Preview"
              className="mx-auto max-h-48 w-auto rounded-lg object-contain bg-white shadow-md dark:bg-slate-900"
            />
            {previewUrl && (
              <p className="text-center text-sm text-slate-600 dark:text-slate-400">
                Vista previa - {selectedFile?.name}
              </p>
            )}
          </div>
        ) : (
          <div className="text-center">
            {isProcessing ? (
              <div className="mb-4">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600 dark:border-slate-600 dark:border-t-slate-300"></div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                  Procesando imagen...
                </p>
              </div>
            ) : (
              <>
                <div className="mb-4 text-4xl">📸</div>
                <p className="mb-2 text-sm font-medium text-slate-900 dark:text-slate-100">
                  {disabled ? 'Carga deshabilitada' : 'Arrastra una imagen aquí'}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  PNG, JPG, WebP hasta {maxSizeMB}MB
                </p>
              </>
            )}
          </div>
        )}

        {/* Hidden file input */}
        <input
          type="file"
          accept={accept}
          onChange={handleFileInputChange}
          disabled={disabled || loading || isProcessing}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          capture="environment" // Prefer rear camera on mobile
        />
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2">
        {selectedFile ? (
          <>
            <Button
              type="button"
              size="sm"
              loading={loading}
              disabled={disabled}
              onClick={handleUpload}
            >
              Subir imagen
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled || loading}
              onClick={handleCancel}
            >
              Cancelar
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={disabled || loading}
              onClick={() => document.querySelector<HTMLInputElement>('input[type="file"]')?.click()}
            >
              Seleccionar archivo
            </Button>
            {currentImageUrl && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={disabled || loading}
                onClick={onImageRemove}
              >
                Quitar imagen
              </Button>
            )}
          </>
        )}
      </div>

      {/* Mobile camera hint */}
      <p className="text-xs text-slate-500 dark:text-slate-400 md:hidden">
        💡 En móvil, toca "Seleccionar archivo" para usar la cámara
      </p>
    </div>
  )
}