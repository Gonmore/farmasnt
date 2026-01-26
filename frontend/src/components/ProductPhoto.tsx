import { useEffect, useState } from 'react'

type Props = {
  url?: string | null
  alt: string
  className?: string
  placeholder?: React.ReactNode
}

export function ProductPhoto({ url, alt, className = '', placeholder }: Props) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [url])

  if (!url || failed) {
    return (
      <div className={className}>
        {placeholder ?? <div className="text-6xl text-slate-400 drop-shadow-sm">📦</div>}
      </div>
    )
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
      loading="lazy"
      decoding="async"
    />
  )
}
