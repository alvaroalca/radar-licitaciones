// ¿Puede esta empresa presentarse a esta licitación? Reglas deterministas: el modelo solo
// aportó los datos del pliego (con su cita); el veredicto lo calcula este código.
import type { Fila, Lectura, Requisitos } from './supabase'
import type { Perfil } from './perfil'
import { importe } from './formato'

export type Estado = 'ok' | 'no' | 'duda' | 'info'
export type Comprobacion = {
  tema: string
  estado: Estado
  texto: string
  fuente?: { pagina: number; cita: string }
}
export type Veredicto = 'encaja' | 'revisa' | 'no'
export type Encaje = { veredicto: Veredicto; comprobaciones: Comprobacion[] }

type Datos = Pick<Fila, 'cpvs' | 'valor_estimado' | 'duracion'>

const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

// --- Volumen de negocio ------------------------------------------------------------

function meses(duracion: string | null): number | null {
  if (!duracion) return null
  const [n, u] = duracion.split(' ')
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  return u === 'ANN' ? v * 12 : u === 'MON' ? v : u === 'DAY' ? v / 30 : null
}

// LCSP art. 87.3 a): si el pliego no concreta la solvencia económica, el volumen anual de
// negocios exigible es 1,5 veces el valor estimado (contratos de hasta un año) o 1,5 veces el
// valor anual medio (más de un año). Aproximado: el feed da la duración inicial, sin prórrogas,
// y el valor estimado sí las incluye, así que la referencia sale algo por encima.
export function referenciaLegal(d: Datos): number | null {
  const m = meses(d.duracion)
  if (d.valor_estimado == null || m == null || m <= 0) return null
  return m <= 12 ? 1.5 * d.valor_estimado : (1.5 * d.valor_estimado) / (m / 12)
}

// Umbral de volumen de negocios. El medio manda: "Patrimonio neto" con una descripción que dice
// "no se pide volumen anual de negocios" no es volumen (visto el 25/09/2026, 20248517)
type Economica = NonNullable<Requisitos['solvencia_economica']>[number]
const OTRO_MEDIO = /patrimonio|fondos propios|recursos propios|seguro|poliza|responsabilidad civil/
export const esVolumen = (s: Economica) =>
  s.umbral_eur != null && !OTRO_MEDIO.test(sinTildes(s.medio))
  && /volumen|cifra|negocio|facturaci/.test(sinTildes(`${s.medio} ${s.descripcion}`))

function volumen(d: Datos, x: Lectura | null, perfil: Perfil): Comprobacion {
  const tema = 'Volumen de negocio'
  const eco = x?.estado === 'hecha' ? x.requisitos.solvencia_economica ?? [] : []

  const sinSolvencia = eco.find((s) => /no se exig|no sera exigible|exento|exime/.test(sinTildes(`${s.medio} ${s.descripcion}`)))
  if (sinSolvencia) {
    return { tema, estado: 'ok', texto: 'El pliego no exige solvencia económica.', fuente: sinSolvencia }
  }

  const umbrales = eco.filter(esVolumen)
  if (umbrales.length) {
    const mayor = umbrales.reduce((a, b) => (b.umbral_eur! > a.umbral_eur! ? b : a))
    const pide = `El pliego pide ${importe(mayor.umbral_eur)} de volumen anual de negocios`
    if (perfil.facturacion == null) return { tema, estado: 'duda', texto: `${pide}; tu perfil no tiene facturación.`, fuente: mayor }
    return perfil.facturacion >= mayor.umbral_eur!
      ? { tema, estado: 'ok', texto: `${pide}; tú facturas ${importe(perfil.facturacion)}.`, fuente: mayor }
      : { tema, estado: 'no', texto: `${pide}; tú facturas ${importe(perfil.facturacion)}.`, fuente: mayor }
  }

  const ref = referenciaLegal(d)
  const motivo = x?.estado === 'hecha' ? 'El pliego leído no fija una cifra' : 'El pliego aún no se ha leído'
  if (ref == null) return { tema, estado: 'duda', texto: `${motivo}, y el anuncio no da datos para calcular la referencia legal.` }
  const base = `${motivo}. Referencia legal aproximada (LCSP art. 87.3 a): ${importe(ref)}`
  if (perfil.facturacion == null) return { tema, estado: 'duda', texto: `${base}.` }
  return perfil.facturacion >= ref
    ? { tema, estado: 'ok', texto: `${base}; tú facturas ${importe(perfil.facturacion)}.` }
    : { tema, estado: 'duda', texto: `${base}; tú facturas ${importe(perfil.facturacion)}. Mira qué fija el pliego.` }
}

// --- Certificaciones -------------------------------------------------------------------

// Nombre libre del pliego → id del perfil. null: certificación que el radar no sabe comparar
export function certificacion(nombre: string): string | null {
  const n = sinTildes(nombre)
  if (/esquema nacional de seguridad|\bens\b/.test(n)) {
    if (/\balt[oa]\b/.test(n)) return 'ens_alto'
    if (/\bmedi[oa]\b/.test(n)) return 'ens_medio'
    return 'ens_basico'
  }
  if (/2701[78]/.test(n)) return 'iso27017'
  for (const iso of ['27001', '20000', '22301', '14001', '9001']) if (n.includes(iso)) return `iso${iso}`
  return null
}

// Un ENS de nivel superior cubre los inferiores
const CUBRE: Record<string, string[]> = {
  ens_alto: ['ens_alto', 'ens_medio', 'ens_basico'],
  ens_medio: ['ens_medio', 'ens_basico'],
}
const tiene = (perfil: Perfil, id: string) =>
  perfil.certificaciones.some((c) => (CUBRE[c] ?? [c]).includes(id))

// El modelo trae a veces certificaciones que solo puntúan como mejora (visto el 24/09/2026).
// Si falta una, lo que decide si es "no llegas" es la cita, que está comprobada en el pliego.
// La obligación se mira antes que la puntuación: "requisito necesario… de acuerdo con la
// valoración de las dimensiones de seguridad" es obligatorio aunque diga "valoración"
// (visto en la validación del 24/09/2026).
const OBLIGA = /deber[a]n?\b|debe\b|exig|acredit|obligatori|requisito|requerid|se requiere|imprescindible|necesari|dispon(er|ga|gan)\b|en posesion|habra de|condicion especial/
const PUNTUA = /\bpuntos?\b|se valorara|\bmejoras?\b|criterios? de adjudicacion/

function certificaciones(x: Lectura | null, perfil: Perfil): Comprobacion[] {
  if (x?.estado !== 'hecha') return []
  return (x.requisitos.certificaciones_exigidas ?? []).map((c): Comprobacion => {
    const tema = 'Certificación'
    const id = certificacion(c.nombre)
    if (id && tiene(perfil, id)) return { tema, estado: 'ok', texto: `${c.nombre}: la tienes.`, fuente: c }
    const cita = sinTildes(c.cita)
    const obliga = OBLIGA.test(cita)
    if (!obliga && PUNTUA.test(cita)) return { tema, estado: 'info', texto: `${c.nombre}: puntúa, no es obligatoria.`, fuente: c }
    if (!id) return { tema, estado: 'duda', texto: `Comprueba si cumples: ${c.nombre}`, fuente: c }
    return obliga
      ? { tema, estado: 'no', texto: `${c.nombre}: la exige y no la tienes.`, fuente: c }
      : { tema, estado: 'duda', texto: `${c.nombre}: no la tienes; mira si es obligatoria o solo puntúa.`, fuente: c }
  })
}

// --- Clasificación -----------------------------------------------------------------------

// Categorías: 1 a 6 desde el RD 773/2015; las antiguas A a F equivalen a 1 a 6
const categoria = (c: string | null) => {
  if (!c) return 0
  const t = c.trim().toUpperCase()
  return /^[A-F]$/.test(t) ? t.charCodeAt(0) - 64 : Number(t) || 0
}

// En servicios y suministros la clasificación no es exigible (LCSP art. 77.1 b): casi siempre es
// una alternativa a acreditar la solvencia. Solo da "no llegas" si la cita dice que es obligatoria.
// Visto en el segundo lote a ciegas: una J-2 alternativa marcada como exigida tumbaba a los tres perfiles.
const CLASIFICACION_OBLIGATORIA = /exigible|obligatori/
const NO_OBLIGATORIA = /no (es |sera |resulta |se )?(exigible|obligatori)/

function clasificaciones(x: Lectura | null, perfil: Perfil): Comprobacion[] {
  if (x?.estado !== 'hecha') return []
  return (x.requisitos.clasificacion_empresarial ?? []).map((c) => {
    const pide = `Grupo ${c.grupo}${c.subgrupo ? `, subgrupo ${c.subgrupo}` : ''}${c.categoria ? `, categoría ${c.categoria}` : ''}`
    const cubierta = perfil.clasificaciones.some((p) =>
      p.grupo.toUpperCase() === c.grupo.toUpperCase()
      && (!c.subgrupo || p.subgrupo === c.subgrupo.trim())
      && categoria(p.categoria) >= categoria(c.categoria))
    const cita = sinTildes(c.cita)
    const obligatoria = CLASIFICACION_OBLIGATORIA.test(cita) && !NO_OBLIGATORIA.test(cita)
    if (c.sustituye_solvencia || !obligatoria) {
      return {
        tema: 'Clasificación', estado: 'info' as const, fuente: c,
        texto: cubierta ? `${pide}: la tienes y te ahorra acreditar solvencia.` : `${pide}: opcional, sustituye a la solvencia.`,
      }
    }
    return cubierta
      ? { tema: 'Clasificación', estado: 'ok' as const, texto: `${pide}: la tienes.`, fuente: c }
      : { tema: 'Clasificación', estado: 'no' as const, texto: `${pide}: no la tienes.`, fuente: c }
  })
}

// --- Veredicto ---------------------------------------------------------------------------

export function evaluar(d: Datos, x: Lectura | null, perfil: Perfil): Encaje {
  const comprobaciones: Comprobacion[] = [volumen(d, x, perfil), ...certificaciones(x, perfil), ...clasificaciones(x, perfil)]

  // La actividad no decide si puedes presentarte, pero dice si te interesa
  if (perfil.familias.length) {
    const tuya = d.cpvs.some((c) => perfil.familias.some((f) => c.startsWith(f)))
    comprobaciones.push({
      tema: 'Actividad', estado: 'info',
      texto: tuya ? 'Coincide con tu actividad.' : 'Fuera de las familias de CPV de tu perfil.',
    })
  }

  const tecnicos = x?.estado === 'hecha' ? (x.requisitos.solvencia_tecnica?.length ?? 0) + (x.requisitos.adscripcion_medios?.length ?? 0) : 0
  if (tecnicos) {
    comprobaciones.push({
      tema: 'Solvencia técnica', estado: 'info',
      texto: `${tecnicos} ${tecnicos === 1 ? 'requisito técnico' : 'requisitos técnicos'} (experiencia, personal): revísalos en la ficha.`,
    })
  }

  const veredicto: Veredicto = comprobaciones.some((c) => c.estado === 'no') ? 'no'
    : comprobaciones.some((c) => c.estado === 'duda') || x?.estado !== 'hecha' ? 'revisa'
    : 'encaja'
  return { veredicto, comprobaciones }
}

export const esDeTuActividad = (d: Datos, perfil: Perfil) =>
  !perfil.familias.length || d.cpvs.some((c) => perfil.familias.some((f) => c.startsWith(f)))
