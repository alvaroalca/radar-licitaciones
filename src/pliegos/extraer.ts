// Extracción de requisitos de un PCAP con un modelo local (Ollama).
//
// Reparto de trabajo, medido en la prueba del 24/09/2026 (docs/STATUS.md):
//  - Lo que el feed ya trae (presupuesto, valor estimado, duración, garantía y, casi siempre,
//    criterios con peso) no se le pide al modelo.
//  - El modelo PROPONE requisitos, cada uno con página y cita literal.
//  - El código DECIDE: solo sobrevive lo que tiene la cita en el pliego y pasa los validadores
//    de su campo (validar.ts).
import { z } from 'zod'
import { seleccionarPaginas } from './paginas.ts'
import { depurar, type Campo, type Elemento, type Requisitos } from './validar.ts'

export const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434'
export const MODELO = process.env.RADAR_MODELO ?? 'qwen3:4b'
const TOKENS_PLIEGO = 10_000

// Longitudes máximas: sin ellas un modelo pequeño puede entrar en bucle dentro de una cadena
// y agotar num_predict con el JSON a medias
const texto = (max: number) => z.string().max(max)
const fuente = { pagina: z.number().int(), cita: texto(200) }
// Tope de elementos: un modelo pequeño puede entrar en bucle rellenando una lista sin fin
const lista = <T extends z.ZodType>(item: T) => z.array(item).max(12)

export const CAMPOS = {
  solvencia_economica: lista(z.object({
    medio: texto(120),
    umbral_eur: z.number().nullable(),
    descripcion: texto(300),
    ...fuente,
  })),
  solvencia_tecnica: lista(z.object({ medio: texto(120), descripcion: texto(300), ...fuente })),
  clasificacion_empresarial: lista(z.object({
    grupo: texto(20),
    subgrupo: texto(20).nullable(),
    categoria: texto(20).nullable(),
    sustituye_solvencia: z.boolean(),
    ...fuente,
  })),
  certificaciones_exigidas: lista(z.object({ nombre: texto(120), ...fuente })),
  adscripcion_medios: lista(z.object({ perfil: texto(120), requisitos: texto(300), ...fuente })),
  criterios_adjudicacion: lista(z.object({
    nombre: texto(120),
    peso: z.number().nullable(),
    tipo: z.enum(['formula', 'juicio_valor']),
    ...fuente,
  })),
} satisfies Record<Campo, z.ZodType>

// Ollama 0.23 rechaza esquemas de más de ~2.000 caracteres con un error engañoso ("failed to
// load model vocabulary required for format"), aunque cada campo por separado funciona. Se piden
// en bloques con el mismo prefijo (instrucciones + pliego), que Ollama reutiliza entre llamadas.
const objeto = (campos: Campo[]) => z.object(Object.fromEntries(campos.map((c) => [c, CAMPOS[c]])))
function bloques(conCriterios: boolean): Campo[][] {
  const b: Campo[][] = [
    ['solvencia_economica', 'solvencia_tecnica', 'clasificacion_empresarial'],
    ['certificaciones_exigidas', 'adscripcion_medios'],
  ]
  if (conCriterios) b.push(['criterios_adjudicacion'])
  return b
}

const SISTEMA = `Analizas pliegos de cláusulas administrativas particulares (PCAP) de la contratación pública española para decirle a una PYME qué le exigen.

Recibes solo las páginas relevantes del pliego, cada una con su etiqueta <pagina n="…">. Extrae los requisitos que pide el esquema con estas reglas:

- Solo lo que dicen estas páginas. Si algo no aparece, la lista va vacía. No lo completes con lo que suele pedir la ley ni con valores habituales.
- Cada elemento lleva "pagina" (el número de la etiqueta donde está) y "cita" (un fragmento copiado literalmente de esa página, de 150 caracteres como mucho). Si no puedes copiar una cita literal que lo sostenga, no incluyas el elemento.
- Si el pliego remite a otro documento o a un artículo de la LCSP sin dar la cifra, el umbral va a null y la descripción dice a qué remite.
- Si el contrato tiene lotes con requisitos distintos, recoge los del primer lote y dilo en la descripción.
- Importes en euros sin IVA, como número.
- Responde en español.

Qué va en cada lista:
- solvencia_economica / solvencia_tecnica: los medios con los que el licitador acredita solvencia y su umbral (cifra de negocio mínima, seguro de responsabilidad civil, trabajos similares en los últimos años...). Si el pliego dice que no se exige solvencia, un solo elemento que lo diga. Los criterios que dan puntos no son solvencia.
- clasificacion_empresarial: grupo, subgrupo y categoría, solo si el pliego los indica. Los rótulos de apartados del cuadro ("F1 CLASIFICACIÓN", "Apartado F") no son grupos. "sustituye_solvencia" es true si la clasificación es una alternativa a acreditar la solvencia, y false solo si el pliego la exige.
- certificaciones_exigidas: solo certificados de calidad, seguridad o sector que debe tener la empresa (ISO 9001, ISO 27001, Esquema Nacional de Seguridad, certificaciones de fabricante...). Las declaraciones responsables y los registros no son certificaciones. Las certificaciones del personal (ITIL, PMP, CISSP...) van en adscripcion_medios. La cita de cada certificación es la frase que la exige ("deberán estar en posesión de…"), aunque el nombre de la norma venga en la línea siguiente: sin esa frase no se sabe si es obligatoria o solo puntúa.
- adscripcion_medios: solo el personal o los medios concretos que el adjudicatario debe dedicar al contrato (perfiles, titulación, experiencia, certificaciones del personal). La capacidad genérica para contratar no va aquí.
- criterios_adjudicacion: los criterios principales con su peso. Si un criterio tiene subcriterios, solo el principal con su peso total.`

type RespuestaOllama = {
  message: { content: string }
  eval_count: number
  total_duration: number
}

async function pedir(pliego: string, formato: object): Promise<RespuestaOllama> {
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({
      model: MODELO,
      stream: false,
      think: false,
      format: formato,
      options: { temperature: 0, num_ctx: TOKENS_PLIEGO + 6000, num_predict: 3000 },
      messages: [
        { role: 'system', content: SISTEMA },
        // El esquema va al final: el prefijo común se reutiliza entre bloques
        { role: 'user', content: `${pliego}\n\nDevuelve este JSON:\n${JSON.stringify(formato)}` },
      ],
    }),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`)
  return (await res.json()) as RespuestaOllama
}

export async function ollamaDisponible() {
  try {
    const res = await fetch(`${OLLAMA}/api/tags`)
    const { models } = (await res.json()) as { models: { name: string }[] }
    return models.some((m) => m.name === MODELO)
  } catch {
    return false
  }
}

export type Extraccion = {
  requisitos: Requisitos
  propuesta: Requisitos       // sin depurar: permite revalidar sin volver a la GPU
  descartados: string[]
  propuestos: number
  aceptados: number
  paginasEnviadas: number[]
  segundos: number
  tokensSalida: number
  esquemaValido: boolean
}

// El pliego tal como lo ve el lector: solo las páginas elegidas, cada una con su número
export function componer(titulo: string, paginas: string[]) {
  const seleccion = seleccionarPaginas(paginas, TOKENS_PLIEGO)
  const texto = `<pliego titulo="${titulo.replace(/"/g, "'")}">\n${seleccion.paginas
    .map((n) => `<pagina n="${n}">\n${paginas[n - 1].replace(/[ \t]+/g, ' ').trim()}\n</pagina>`)
    .join('\n')}\n</pliego>`
  return { texto, paginas: seleccion.paginas }
}

// La propuesta pasa por el código igual venga de donde venga: citas y forma de cada campo
function cerrar(propuesta: Requisitos, paginas: string[], paginasEnviadas: number[]) {
  const { requisitos, descartados } = depurar(propuesta, paginas)
  const contar = (r: Requisitos) => Object.values(r).reduce((n, xs) => n + (xs?.length ?? 0), 0)
  return { requisitos, propuesta, descartados, propuestos: contar(propuesta), aceptados: contar(requisitos), paginasEnviadas }
}

export async function extraer(titulo: string, paginas: string[], conCriterios: boolean): Promise<Extraccion> {
  const pliego = componer(titulo, paginas)
  const propuesta: Partial<Record<Campo, Elemento[]>> = {}
  let esquemaValido = true
  let segundos = 0
  let tokensSalida = 0
  for (const campos of bloques(conCriterios)) {
    const r = await pedir(pliego.texto, z.toJSONSchema(objeto(campos)))
    segundos += r.total_duration / 1e9
    tokensSalida += r.eval_count
    let json: unknown = null
    try { json = JSON.parse(r.message.content) } catch { esquemaValido = false; continue }
    const parseada = objeto(campos).safeParse(json)
    if (parseada.success) Object.assign(propuesta, parseada.data)
    else esquemaValido = false
  }
  return { ...cerrar(propuesta, paginas, pliego.paginas), segundos: +segundos.toFixed(1), tokensSalida, esquemaValido }
}

// --- Lector externo ----------------------------------------------------------------
// El lector puede ser cualquier LLM, no solo el local: el motor deja el pliego preparado en
// un fichero, el lector escribe su propuesta en JSON con el mismo esquema y el motor la
// importa. Lo que decide (citas, validadores, encaje) no cambia.

export function instrucciones(conCriterios: boolean) {
  const campos = Object.keys(CAMPOS).filter((c) => conCriterios || c !== 'criterios_adjudicacion') as Campo[]
  return `${SISTEMA}\n\nDevuelve este JSON:\n${JSON.stringify(z.toJSONSchema(objeto(campos)))}`
}

// Cada campo se valida por separado: un campo mal formado no tira los demás
export function importar(json: Record<string, unknown>, paginas: string[], paginasEnviadas: number[]) {
  const propuesta: Requisitos = {}
  const invalidos: string[] = []
  for (const [campo, valor] of Object.entries(json)) {
    if (!(campo in CAMPOS)) { invalidos.push(campo); continue }
    // Los topes de longitud son contra los bucles de un modelo pequeño: aquí se recorta
    const recortado = Array.isArray(valor)
      ? valor.map((e) => Object.fromEntries(Object.entries(e ?? {}).map(([k, v]) =>
        [k, typeof v === 'string' ? v.slice(0, k === 'cita' ? 200 : k === 'descripcion' || k === 'requisitos' ? 300 : 120) : v])))
      : valor
    const r = CAMPOS[campo as Campo].safeParse(recortado)
    if (r.success) propuesta[campo as Campo] = r.data as Elemento[]
    else invalidos.push(campo)
  }
  return { ...cerrar(propuesta, paginas, paginasEnviadas), invalidos }
}
