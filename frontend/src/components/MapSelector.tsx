import React, { useCallback, useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix for default markers in react-leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface MapSelectorProps {
  city?: string
  zone?: string
  address?: string
  mapsUrl?: string
  onLocationSelect: (mapsUrl: string, address?: string) => void
  disabled?: boolean
}

// Component to handle map clicks
function LocationMarker({ onLocationSelect }: { onLocationSelect: (mapsUrl: string, address?: string) => void }) {
  const [position, setPosition] = useState<L.LatLng | null>(null)

  useMapEvents({
    click(e) {
      setPosition(e.latlng)

      // Generate Google Maps URL
      const lat = e.latlng.lat
      const lng = e.latlng.lng
      const mapsUrl = `https://www.google.com/maps/@${lat},${lng},18z`

      // Try reverse geocoding to get address
      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
        .then(response => response.json())
        .then(data => {
          const address = data.display_name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`
          onLocationSelect(mapsUrl, address)
        })
        .catch(() => {
          // Fallback if geocoding fails
          onLocationSelect(mapsUrl, `${lat.toFixed(6)}, ${lng.toFixed(6)}`)
        })
    },
  })

  return position === null ? null : (
    <Marker position={position}>
      <Popup>Ubicación seleccionada</Popup>
    </Marker>
  )
}

const MapSelector: React.FC<MapSelectorProps> = ({
  city,
  zone,
  address,
  mapsUrl,
  onLocationSelect,
  disabled = false,
}) => {
  const [mapCenter, setMapCenter] = useState<[number, number]>([-17.7833, -63.1821]) // Default to Santa Cruz, Bolivia
  const [mapZoom, setMapZoom] = useState(12)

  // Geocode address to coordinates
  const geocodeAddress = useCallback(async (address: string, city: string, zone?: string) => {
    const fullAddress = [address, zone, city].filter(Boolean).join(', ')

    // If we only have a city, search for it specifically
    const searchQuery = fullAddress || city || 'Santa Cruz, Bolivia'

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1&countrycodes=bo,pe,ar,cl,br,py,uy`
      )
      const data = await response.json()

      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat)
        const lon = parseFloat(data[0].lon)
        return [lat, lon] as [number, number]
      }
    } catch (error) {
      console.error('Geocoding error:', error)
    }
    return null
  }, [])

  // Parse mapsUrl to coordinates
  const parseMapsUrl = useCallback((url: string) => {
    // Handle Google Maps URLs like:
    // https://www.google.com/maps/@-17.7833,-63.1821,15z
    // https://www.google.com/maps/place/.../@-17.7833,-63.1821,15z

    const coordsMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
    if (coordsMatch) {
      return {
        lat: parseFloat(coordsMatch[1]),
        lng: parseFloat(coordsMatch[2]),
      }
    }
    return null
  }, [])

  // Update map center when address changes
  useEffect(() => {
    if (disabled) return

    const updateMapLocation = async () => {
      let coordinates = null

      // First try to parse existing mapsUrl
      if (mapsUrl) {
        const parsed = parseMapsUrl(mapsUrl)
        if (parsed) {
          coordinates = [parsed.lat, parsed.lng] as [number, number]
        }
      }

      // If no coordinates from URL, try geocoding
      if (!coordinates && (address || zone || city)) {
        coordinates = await geocodeAddress(address || '', city || '', zone)
      }

      if (coordinates) {
        setMapCenter(coordinates)
        setMapZoom(16)
      }
    }

    updateMapLocation()
  }, [address, city, zone, mapsUrl, geocodeAddress, parseMapsUrl, disabled])

  if (disabled) {
    return (
      <div className="h-64 w-full rounded-md border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400">
        Mapa deshabilitado
      </div>
    )
  }

  return (
    <div className="h-64 w-full rounded-md border border-slate-200 dark:border-slate-700 overflow-hidden">
      <MapContainer
        key={`${mapCenter[0]}-${mapCenter[1]}-${mapZoom}`} // Force re-render when center/zoom changes
        center={mapCenter}
        zoom={mapZoom}
        style={{ height: '100%', width: '100%' }}
        className="leaflet-container"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <LocationMarker onLocationSelect={onLocationSelect} />
      </MapContainer>
    </div>
  )
}

export default MapSelector