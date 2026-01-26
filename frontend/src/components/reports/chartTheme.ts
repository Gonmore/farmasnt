export const reportColors = {
  // Paleta principal vibrante
  primary: ['#3B82F6', '#2563EB', '#1D4ED8', '#1E40AF', '#1E3A8A'],
  
  // Paleta de éxito (ventas, ganancias)
  success: ['#10B981', '#059669', '#047857', '#065F46', '#064E3B'],
  
  // Paleta de advertencia
  warning: ['#F59E0B', '#D97706', '#B45309', '#92400E', '#78350F'],
  
  // Paleta de peligro
  danger: ['#EF4444', '#DC2626', '#B91C1C', '#991B1B', '#7F1D1D'],
  
  // Paleta de información
  info: ['#06B6D4', '#0891B2', '#0E7490', '#155E75', '#164E63'],
  
  // Paleta arcoíris para gráficos múltiples
  rainbow: [
    '#3B82F6', // Azul
    '#10B981', // Verde
    '#F59E0B', // Amarillo
    '#EF4444', // Rojo
    '#8B5CF6', // Púrpura
    '#EC4899', // Rosa
    '#06B6D4', // Cyan
    '#F97316', // Naranja
    '#14B8A6', // Teal
    '#6366F1', // Índigo
  ],
  
  // Gradientes para gráficos de área
  gradients: {
    blue: ['rgba(59, 130, 246, 0.8)', 'rgba(59, 130, 246, 0.1)'],
    green: ['rgba(16, 185, 129, 0.8)', 'rgba(16, 185, 129, 0.1)'],
    yellow: ['rgba(245, 158, 11, 0.8)', 'rgba(245, 158, 11, 0.1)'],
    red: ['rgba(239, 68, 68, 0.8)', 'rgba(239, 68, 68, 0.1)'],
  },
}

// Función para obtener color por índice
export function getChartColor(index: number, palette: keyof typeof reportColors = 'rainbow'): string {
  const colors = reportColors[palette]
  if (!Array.isArray(colors)) return reportColors.primary[0]
  return colors[index % colors.length]
}

// Estilos comunes para tooltips de Recharts
export const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    border: 'none',
    borderRadius: '8px',
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
    padding: '12px',
  },
  labelStyle: {
    color: '#fff',
    fontWeight: 600,
    marginBottom: '8px',
  },
  itemStyle: {
    color: '#e2e8f0',
    padding: '2px 0',
  },
}

// Estilos de grid
export const chartGridStyle = {
  stroke: '#e2e8f0',
  strokeDasharray: '3 3',
  opacity: 0.3,
}

// Estilos de ejes
export const chartAxisStyle = {
  fontSize: 12,
  fill: '#64748b',
  fontFamily: 'system-ui, -apple-system, sans-serif',
}
