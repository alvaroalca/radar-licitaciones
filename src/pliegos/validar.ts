// El código decide qué se queda de lo que propone el modelo. Dos filtros:
//  1. La cita tiene que estar en el pliego (coincidencia tolerante a erratas de copia).
//  2. El valor tiene que tener la forma de su campo. La cita prueba que el texto existe,
//     no que el modelo lo haya puesto en el campo correcto (visto el 24/09/2026: "N/A" como
//     grupo de clasificación, un seguro de responsabilidad civil como certificación).

export type Campo =
  | 'solvencia_economica' | 'solvencia_tecnica' | 'clasificacion_empresarial'
  | 'certificaciones_exigidas' | 'adscripcion_medios' | 'criterios_adjudicacion'
export type Elemento = { pagina: number; cita: string } & Record<string, unknown>
export type Requisitos = Partial<Record<Campo, Elemento[]>>

// El texto extraído del PDF rompe espacios y comillas de forma irregular: se compara sin ellos
const normalizar = (s: string) =>
  s.toLowerCase().normalize('NFKC').replace(/[\s"'«»“”‘’\-–—.,;:()•·]/g, '')

// Fracción de fragmentos de 8 caracteres de la cita que están en la página. Tolera erratas
// ("Critero" por "Criterio"); un texto inventado no llega ni de lejos. Control negativo del
// 24/09/2026: las citas de un pliego contra las páginas de otro, 1 aceptada de 79.
const FRAGMENTO = 8
const UMBRAL_CITA = 0.85
function similitud(cita: string, pagina: string) {
  const total = cita.length - FRAGMENTO + 1
  if (total <= 0) return 0
  let dentro = 0
  for (let i = 0; i < total; i++) if (pagina.includes(cita.slice(i, i + FRAGMENTO))) dentro++
  return dentro / total
}

// --- Forma de cada campo -------------------------------------------------------------

const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

// Grupos de clasificación de la LCSP: A a K obras, L a V servicios. "Grupo V" → "V".
function grupoValido(g: unknown): string | null {
  const m = sinTildes(String(g ?? '')).match(/^(grupo\s*)?([a-v])$/)
  return m ? m[2].toUpperCase() : null
}
// Subgrupo: una cifra. Filtra códigos CNAE leídos como clasificación ("J-62-Programación…",
// visto en el banco de referencia del 24/09/2026)
function subgrupoValido(s: unknown): string | null | false {
  if (s == null || String(s).trim() === '') return null
  const m = sinTildes(String(s)).trim().match(/^(subgrupo\s*)?(\d)$/)
  return m ? m[2] : false
}

const CERTIFICACION = /\b(iso|iec|une|en)[ /-]?\d{3,5}|esquema nacional de seguridad|\bens\b|\bitil\b|\bcmmi\b|\bpmp\b|\bcissp\b|\bccna\b|partner|certificaci[oó]n (del |de |oficial |para )?(fabricante|mantener|dar mantenimiento|oficial)|acreditaci[oó]n como|nivel (alto|medio|basico) del ens/

// El nombre de la certificación tiene que estar en su cita o en la página citada. Visto en la
// validación del 24/09/2026: "ISO 9001" colgada de una cita real que hablaba de otra cosa (el
// 9001 no aparecía en todo el pliego). La cita existe; lo que no existe es el dato. Se admite la
// página entera porque el modelo a veces cita el arranque del párrafo y el dato va en la frase
// siguiente (ISO 14001, ENS medio y ODILO, en la misma validación).
const PALABRAS_VACIAS = new Set(['certificacion', 'certificado', 'certificada', 'acreditacion', 'oficial', 'empresa', 'sistema', 'gestion', 'partner', 'nivel', 'categoria', 'para', 'como', 'con', 'del', 'las', 'los'])
function respaldada(nombre: string, cita: string, pagina: string) {
  const c = sinTildes(`${cita} ${pagina}`)
  const numeros = nombre.match(/\d{4,5}/g)
  if (numeros) return numeros.some((n) => c.includes(n))
  if (/esquema nacional de seguridad|\bens\b/.test(nombre)) return /esquema nacional de seguridad|\bens\b/.test(c)
  const palabras = nombre.split(/[^a-z0-9]+/).filter((p) => p.length >= 4 && !PALABRAS_VACIAS.has(p))
  return !palabras.length || palabras.some((p) => c.includes(p))
}
const NO_CERTIFICACION = /seguro|poliza|responsabilidad civil|rolece|registro|declaracion responsable|inscripcion/
const SEGURO = /seguro|poliza|responsabilidad civil/
// El ENS se menciona en casi todos los pliegos (protección de datos, RD 311/2022) sin pedir
// que la empresa esté certificada: solo cuenta si se habla de certificación o conformidad
const ENS = /esquema nacional de seguridad|\bens\b/
const CERTIFICARSE = /certific|conformidad|acredit|distintivo/

type Veredicto = { campo: Campo; elemento: Elemento } | { descartar: string }

function validarForma(campo: Campo, e: Elemento, pagina: string): Veredicto {
  switch (campo) {
    case 'clasificacion_empresarial': {
      const grupo = grupoValido(e.grupo)
      if (!grupo) return { descartar: `grupo "${e.grupo}" no es un grupo de clasificación` }
      const subgrupo = subgrupoValido(e.subgrupo)
      if (subgrupo === false) return { descartar: `subgrupo "${e.subgrupo}" no es un subgrupo de clasificación` }
      return { campo, elemento: { ...e, grupo, subgrupo } }
    }
    case 'certificaciones_exigidas': {
      const nombre = sinTildes(String(e.nombre ?? ''))
      // Un seguro de responsabilidad civil es solvencia económica, no certificación
      if (SEGURO.test(nombre)) {
        return {
          campo: 'solvencia_economica',
          elemento: { medio: e.nombre, umbral_eur: null, descripcion: e.nombre, pagina: e.pagina, cita: e.cita },
        }
      }
      if (NO_CERTIFICACION.test(nombre) || !CERTIFICACION.test(nombre)) {
        return { descartar: `"${e.nombre}" no es una certificación reconocible` }
      }
      // Tres o más cosas en un nombre es una lista, no una certificación. Visto: el modelo
      // copió la lista de ejemplo de sus propias instrucciones.
      if (nombre.split(/,|;|\s+y\s+/).filter((t) => t.trim()).length >= 3) {
        return { descartar: `"${e.nombre}" es una lista, no una certificación` }
      }
      if (ENS.test(nombre) && !CERTIFICARSE.test(`${nombre} ${sinTildes(e.cita)}`)) {
        return { descartar: `"${e.nombre}": el pliego menciona el ENS pero no pide certificarse` }
      }
      if (!respaldada(nombre, e.cita, pagina)) {
        return { descartar: `"${e.nombre}" no aparece ni en su cita ni en su página` }
      }
      return { campo, elemento: e }
    }
    case 'solvencia_tecnica': {
      // Mismo caso que en certificaciones: el seguro es solvencia económica (art. 87 LCSP)
      if (SEGURO.test(sinTildes(String(e.medio ?? '')))) {
        return {
          campo: 'solvencia_economica',
          elemento: { medio: e.medio, umbral_eur: null, descripcion: e.descripcion, pagina: e.pagina, cita: e.cita },
        }
      }
      return { campo, elemento: e }
    }
    case 'solvencia_economica': {
      // Un umbral negativo o ridículo es un número mal leído, no un requisito
      if (e.umbral_eur != null && (Number(e.umbral_eur) < 100 || Number(e.umbral_eur) > 1e9)) {
        return { campo, elemento: { ...e, umbral_eur: null } }
      }
      return { campo, elemento: e }
    }
    default:
      return { campo, elemento: e }
  }
}

// --- Depuración --------------------------------------------------------------------

export function depurar(propuesta: Requisitos, paginas: string[]) {
  const norm = paginas.map(normalizar)
  const requisitos: Requisitos = {}
  const descartados: string[] = []
  const vistas = new Set<string>()

  for (const [campoPropuesto, elementos] of Object.entries(propuesta) as [Campo, Elemento[]][]) {
    for (const propuesto of elementos) {
      const donde = `${campoPropuesto} p.${propuesto.pagina}`
      const q = normalizar(propuesto.cita)
      // Una cita demasiado corta ("sí", "5%", "15.7.3") casa en cualquier parte y no prueba nada
      if (q.length < 15) { descartados.push(`${donde}: cita demasiado corta "${propuesto.cita}"`); continue }
      // Un modelo pequeño a veces repite el mismo elemento en bucle
      if (vistas.has(campoPropuesto + q)) { descartados.push(`${donde}: repetido`); continue }
      vistas.add(campoPropuesto + q)

      let e = propuesto
      if (similitud(q, norm[e.pagina - 1] ?? '') < UMBRAL_CITA) {
        const otra = norm.findIndex((p) => similitud(q, p) >= UMBRAL_CITA)
        if (otra < 0) { descartados.push(`${donde}: sin respaldo en el pliego "${e.cita.slice(0, 80)}"`); continue }
        e = { ...e, pagina: otra + 1 }
      }

      const v = validarForma(campoPropuesto, e, paginas[e.pagina - 1] ?? '')
      if ('descartar' in v) { descartados.push(`${donde}: ${v.descartar}`); continue }
      ;(requisitos[v.campo] ??= []).push(v.elemento)
    }
  }
  return { requisitos, descartados }
}
