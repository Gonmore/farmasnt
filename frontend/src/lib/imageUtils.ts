/**
 * Utility functions for image processing and compression
 */

/**
 * Compress an image file
 * @param file - The original image file
 * @param maxWidth - Maximum width in pixels
 * @param maxHeight - Maximum height in pixels
 * @param quality - JPEG/WebP quality (0-1)
 * @returns Promise<File> - Compressed image file
 */
export async function compressImage(
  file: File,
  maxWidth: number = 1200,
  maxHeight: number = 1200,
  quality: number = 0.8
): Promise<File> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('Canvas not supported'))
      return
    }

    const img = new Image()
    img.onload = () => {
      // Calculate new dimensions
      let { width, height } = img

      if (width > height) {
        if (width > maxWidth) {
          height = (height * maxWidth) / width
          width = maxWidth
        }
      } else {
        if (height > maxHeight) {
          width = (width * maxHeight) / height
          height = maxHeight
        }
      }

      canvas.width = width
      canvas.height = height

      // Draw and compress
      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to compress image'))
            return
          }

          // Create new file with compressed data
          const compressedFile = new File([blob], file.name, {
            type: file.type,
            lastModified: Date.now(),
          })

          resolve(compressedFile)
        },
        file.type === 'image/png' ? 'image/png' : 'image/jpeg',
        quality
      )
    }

    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}

/**
 * Get image dimensions without loading the full image
 * @param file - Image file
 * @returns Promise<{width: number, height: number}>
 */
export async function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.width, height: img.height })
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => {
      reject(new Error('Failed to load image'))
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(file)
  })
}

/**
 * Check if an image needs compression based on size and dimensions
 * @param file - Image file
 * @param maxSizeMB - Maximum file size in MB
 * @param maxDimension - Maximum dimension in pixels
 * @returns Promise<boolean>
 */
export async function shouldCompressImage(
  file: File,
  maxSizeMB: number = 2,
  maxDimension: number = 1200
): Promise<boolean> {
  const maxSizeBytes = maxSizeMB * 1024 * 1024

  // Check file size first (quick check)
  if (file.size > maxSizeBytes) {
    return true
  }

  try {
    const dimensions = await getImageDimensions(file)
    return dimensions.width > maxDimension || dimensions.height > maxDimension
  } catch {
    // If we can't get dimensions, assume it needs compression if it's large
    return file.size > maxSizeBytes * 0.5
  }
}

/**
 * Auto-compress image if needed
 * @param file - Original image file
 * @param options - Compression options
 * @returns Promise<File> - Original or compressed file
 */
export async function autoCompressImage(
  file: File,
  options: {
    maxSizeMB?: number
    maxDimension?: number
    quality?: number
  } = {}
): Promise<File> {
  const { maxSizeMB = 2, maxDimension = 1200, quality = 0.8 } = options

  const needsCompression = await shouldCompressImage(file, maxSizeMB, maxDimension)

  if (needsCompression) {
    return compressImage(file, maxDimension, maxDimension, quality)
  }

  return file
}