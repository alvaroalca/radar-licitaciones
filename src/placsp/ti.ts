import type { Licitacion } from './entrada.ts'

// Alcance v1: servicios TI. Basta con que algún CPV sea 72 (servicios TI) o 48 (software).
// El CPV principal no sirve de filtro: los órganos lo asignan mal en los dos sentidos
// (redes sociales como 72511000, cortafuegos con CPV principal de hardware). Medido el 24/09/2026.
export const esTI = (l: Licitacion) => l.cpvs.some((c) => c.startsWith('72') || c.startsWith('48'))
