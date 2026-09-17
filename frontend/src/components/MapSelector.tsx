import React, { useCallback, useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { geoApi } from '../lib/geoService'
import { countryCodeToName } from './geo/countryUtils'

// Fix for default markers in react-leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

interface MapSelectorProps {
  countryCode?: string
  city?: string
  zone?: string
  address?: string
  mapsUrl?: string
  onLocationSelect: (mapsUrl: string, address?: string) => void
  disabled?: boolean
}

const BOUNTRY_FALLBACK_COORDS: Record<string, [number, number]> = {
  BO: [-17.7833, -63.1821],
  AR: [-38.4161, -63.6167],
  BR: [-14.2350, -57.9229],
  CL: [-33.4489, -70.6693],
  PE: [-12.0464, -77.0428],
  PY: [-25.2847, -57.6384],
  UY: [-33.1640, -56.2000],
  CO: [4.5709, -74.2973],
  EC: [-1.8394, -78.1631],
  VE: [6.4238, -66.5897],
  MX: [23.6345, -102.5528],
  ES: [40.4168, -3.7038],
  US: [39.8283, -98.5698],
}

function getFallbackCenter(countryCode?: string): [number, number] {
  if (!countryCode) return [-17.7833, -63.1821]
  return BOUNTRY_FALLBACK_COORDS[countryCode.toUpperCase()] ?? [-17.7833, -63.1821]
}

function LocationMarker({ onLocationSelect }: { onLocationSelect: (mapsUrl: string, address?: string) => void }) {
  const [position, setPosition] = useState<L.LatLng | null>(null)

  useMapEvents({
    click(e) {
      setPosition(e.latlng)

      const lat = e.latlng.lat
      const lng = e.latlng.lng
      const mapsUrl = `https://www.google.com/maps/@${lat},${lng},18z`

      geoApi
        .reverseGeocode(lat, lng)
        .then((result) => {
          const address = result?.formatted || `${lat.toFixed(6)}, ${lng.toFixed(6)}`
          onLocationSelect(mapsUrl, address)
        })
        .catch(() => {
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
  countryCode,
  city,
  zone,
  address,
  mapsUrl,
  onLocationSelect,
  disabled = false,
}) => {
  const [mapCenter, setMapCenter] = useState<[number, number]>(getFallbackCenter(countryCode))
  const [mapZoom, setMapZoom] = useState(12)

  const geocodeAddress = useCallback(async (address: string, city: string, zone?: string, countryCode?: string) => {
    const fullAddress = [address, zone, city, countryCode ? countryCodeToName(countryCode) : null].filter(Boolean).join(', ')
    const searchQuery = fullAddress || city || 'Santa Cruz, Bolivia'

    try {
      const { items } = await geoApi.searchCities(countryCode ?? 'BO', searchQuery)
      if (items && items.length > 0) {
        const first = items[0]
        if (first) {
          return [first.lat, first.lng] as [number, number]
        }
      }
    } catch (error) {
      console.error('Geocoding error:', error)
    }
    return null
  }, [])

  const parseMapsUrl = useCallback((url: string) => {
    const coordsMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/)
    if (coordsMatch) {
      return {
        lat: parseFloat(coordsMatch[1]),
        lng: parseFloat(coordsMatch[2]),
      }
    }
    return null
  }, [])

  useEffect(() => {
    if (disabled) return

    const updateMapLocation = async () => {
      let coordinates = null

      if (mapsUrl) {
        const parsed = parseMapsUrl(mapsUrl)
        if (parsed) {
          coordinates = [parsed.lat, parsed.lng] as [number, number]
        }
      }

      if (!coordinates && (address || zone || city)) {
        coordinates = await geocodeAddress(address || '', city || '', zone, countryCode)
      }

      if (coordinates) {
        setMapCenter(coordinates)
        setMapZoom(16)
      } else {
        setMapCenter(getFallbackCenter(countryCode))
        setMapZoom(12)
      }
    }

    updateMapLocation()
  }, [address, city, zone, mapsUrl, geocodeAddress, parseMapsUrl, disabled, countryCode])

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
        key={`${mapCenter[0]}-${mapCenter[1]}-${mapZoom}`}
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
