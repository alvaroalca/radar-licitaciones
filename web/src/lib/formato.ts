// Comunidad autónoma a partir del NUTS de nivel 2 (los cuatro primeros caracteres)
export const COMUNIDADES: Record<string, string> = {
  ES11: 'Galicia',
  ES12: 'Asturias',
  ES13: 'Cantabria',
  ES21: 'País Vasco',
  ES22: 'Navarra',
  ES23: 'La Rioja',
  ES24: 'Aragón',
  ES30: 'Madrid',
  ES41: 'Castilla y León',
  ES42: 'Castilla-La Mancha',
  ES43: 'Extremadura',
  ES51: 'Cataluña',
  ES52: 'C. Valenciana',
  ES53: 'Illes Balears',
  ES61: 'Andalucía',
  ES62: 'Murcia',
  ES63: 'Ceuta',
  ES64: 'Melilla',
  ES70: 'Canarias',
}

export const comunidad = (nuts: string | null) =>
  (nuts && COMUNIDADES[nuts.slice(0, 4)]) || (nuts?.startsWith('ES') ? 'Estatal' : 'Extranjero')

const euros = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
export const importe = (v: number | null) => (v == null ? '—' : euros.format(v))

// Compacto para el panel: 82.404 € → 82 k€, 1.590.879 € → 1,6 M€
export const importeCorto = (v: number | null) => {
  if (v == null) return '—'
  if (v >= 1e6) return `${(v / 1e6).toLocaleString('es-ES', { maximumFractionDigits: 1 })} M€`
  if (v >= 1e3) return `${Math.round(v / 1e3).toLocaleString('es-ES')} k€`
  return `${Math.round(v)} €`
}

export const hoyISO = () => new Date().toLocaleDateString('sv-SE') // AAAA-MM-DD en hora local

export function diasRestantes(fecha: string | null): number | null {
  if (!fecha) return null
  const [a, m, d] = fecha.split('-').map(Number)
  const [ha, hm, hd] = hoyISO().split('-').map(Number)
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(ha, hm - 1, hd)) / 86_400_000)
}

export const fechaCorta = (fecha: string | null) => {
  if (!fecha) return '—'
  const [, m, d] = fecha.split('-')
  return `${d}.${m}`
}

export const fechaLarga = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'

const UNIDADES: Record<string, [string, string]> = {
  DAY: ['día', 'días'],
  MON: ['mes', 'meses'],
  ANN: ['año', 'años'],
}
export const duracion = (d: string | null) => {
  if (!d) return '—'
  const [n, u] = d.split(' ')
  const nombre = UNIDADES[u]
  return nombre ? `${n} ${Number(n) === 1 ? nombre[0] : nombre[1]}` : d
}

export const ESTADOS: Record<string, string> = {
  PRE: 'Anuncio previo',
  PUB: 'En plazo',
  EV: 'En evaluación',
  ADJ: 'Adjudicada',
  RES: 'Resuelta',
  ANUL: 'Anulada',
}

export const TIPOS_CONTRATO: Record<string, string> = {
  '1': 'Suministros',
  '2': 'Servicios',
  '3': 'Obras',
  '21': 'Gestión de servicios públicos',
  '22': 'Concesión de servicios',
  '31': 'Concesión de obras',
  '7': 'Administrativo especial',
  '8': 'Privado',
}
