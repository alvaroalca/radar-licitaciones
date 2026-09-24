import { createClient } from '@supabase/supabase-js'

// Solo lectura: la clave publicable y la RLS del esquema `licitaciones` no dejan hacer otra cosa
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY, {
  db: { schema: 'licitaciones' },
  auth: { persistSession: false },
})

export type Criterio = { descripcion: string; peso: number | null; tipo: string | null }

export type Fila = {
  id: string
  titulo: string
  organo: string | null
  lugar: string | null
  nuts: string | null
  presupuesto_sin_iva: number | null
  fecha_limite: string | null
  estado: string | null
  valor_estimado: number | null
  duracion: string | null
  cpvs: string[]
  // Embebido por PostgREST: misma tabla hija en el mismo esquema, así que no hay PGRST200.
  // Trae los requisitos para calcular el encaje de cada fila en el navegador.
  extracciones: Lectura | null
}

// Lo que el modelo local leyó en el pliego, ya depurado por el motor (src/pliegos/validar.ts)
type ConFuente = { pagina: number; cita: string }
export type Requisitos = {
  solvencia_economica?: (ConFuente & { medio: string; umbral_eur: number | null; descripcion: string })[]
  solvencia_tecnica?: (ConFuente & { medio: string; descripcion: string })[]
  clasificacion_empresarial?: (ConFuente & { grupo: string; subgrupo: string | null; categoria: string | null; sustituye_solvencia: boolean })[]
  certificaciones_exigidas?: (ConFuente & { nombre: string })[]
  adscripcion_medios?: (ConFuente & { perfil: string; requisitos: string })[]
  criterios_adjudicacion?: (ConFuente & { nombre: string; peso: number | null; tipo: string })[]
}

// Lo mínimo de una extracción que necesita el encaje
export type Lectura = { estado: Extraccion['estado']; requisitos: Requisitos }

export type Extraccion = {
  estado: 'hecha' | 'escaneado' | 'sin_pdf' | 'error'
  modelo: string | null
  requisitos: Requisitos
  aceptados: number | null
  descartados: number | null
  paginas_total: number | null
  fecha: string
}

export type Licitacion = Fila & {
  expediente: string | null
  tipo_contrato: string | null
  garantia_definitiva_pct: number | null
  lotes: number
  enlace: string | null
  pcap_url: string | null
  ppt_url: string | null
  criterios: Criterio[]
  solvencia_economica: string[]
  solvencia_tecnica: string[]
  publicada: string | null
  actualizado: string
}

export const COLUMNAS_FILA =
  'id,titulo,organo,lugar,nuts,presupuesto_sin_iva,fecha_limite,estado,valor_estimado,duracion,cpvs,extracciones(estado,requisitos)'
