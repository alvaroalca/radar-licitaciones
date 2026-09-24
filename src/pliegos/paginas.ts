// Selección de las páginas de un PCAP que contienen lo que el radar necesita.
// Un pliego mediano ronda los 30 k tokens y el p90 pasa de 80 k: no cabe en el contexto de
// un modelo local de 8 GB de VRAM. Solvencia, criterios y cuadro resumen suelen ocupar
// una fracción pequeña del documento, así que se puntúa cada página y se manda solo lo mejor.
//
// Dos trampas vistas en pliegos reales (24/09/2026):
//  - Los índices están llenos de palabras clave y no contienen ningún dato.
//  - Muchos pliegos son un "pliego tipo": cuerpo genérico que remite a "Apartado L del Anexo I",
//    y los valores concretos viven en el cuadro de características. Mencionar "solvencia" no
//    es contenerla: lo que delata una página útil son las cifras.

const PALABRAS: [RegExp, number][] = [
  [/solvencia (economica|financiera|tecnica|profesional)/g, 3],
  [/volumen anual de negocios|cifra anual de negocio/g, 5],
  [/clasificacion (empresarial|del contratista|exigida)|grupo [a-z],? subgrupo/g, 4],
  [/criterios? de adjudicacion|ponderacion|puntuacion maxima/g, 3],
  [/adscripcion de medios|medios personales|perfil(es)? profesional/g, 3],
  [/iso ?\d{4,5}|esquema nacional de seguridad|\bens\b/g, 2],
  // Pliegos en inglés (entidades con contratos internacionales, p. ej. Ineco)
  [/(economic|financial|technical|professional) (and financial |or professional )?solvency/g, 3],
  [/annual turnover|volume of business/g, 5],
  [/award(ing)? criteri(a|on)|weighting/g, 3],
]

// Cifras concretas: importes, porcentajes y puntos
const CIFRAS = /\d[\d.,]* ?(€|euros?\b|eur\b)|€ ?\d|\d+([.,]\d+)? ?%|\d+([.,]\d+)? (puntos|points)/g
// Remisión a otra parte del pliego: la página habla del dato pero no lo tiene
const REMISION = /(apartado|epigrafe|punto) [a-z0-9.]{1,4} del (anexo|cuadro)/g
// Línea de índice: título, puntos suspensivos y número de página
const LINEA_INDICE = /\.{5,}\s*\d+/g
// Arranque del cuadro de características o cuadro resumen
const INICIO_CUADRO = /cuadro (resumen|de caracteristicas)|hoja resumen|caracteristicas (particulares|del contrato)/
const FIN_CUADRO = /^\W*(\d+\W+)?anexo (ii|iii|iv)\b|modelo de (declaracion|proposicion|oferta)/

const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
const contar = (t: string, re: RegExp) => t.match(re)?.length ?? 0

// Orientativo para español con los tokenizadores de modelos abiertos
export const CARACTERES_POR_TOKEN = 3.5

export function puntuarPaginas(paginas: string[]) {
  const textos = paginas.map(sinTildes)
  const esIndice = textos.map((t) => contar(t, LINEA_INDICE) > 4)

  // El cuadro de características: desde la página que lo abre hasta el siguiente anexo
  const enCuadro = new Array(paginas.length).fill(false)
  const inicio = textos.findIndex((t, i) => !esIndice[i] && INICIO_CUADRO.test(t.slice(0, 400)))
  if (inicio >= 0) {
    for (let i = inicio; i < paginas.length && i < inicio + 15; i++) {
      if (i > inicio && FIN_CUADRO.test(textos[i].slice(0, 200))) break
      enCuadro[i] = true
    }
  }

  return textos.map((t, i) => {
    if (esIndice[i]) return { n: i + 1, puntos: 0, caracteres: paginas[i].length }
    let puntos = 0
    for (const [re, peso] of PALABRAS) puntos += contar(t, re) * peso
    puntos += Math.min(contar(t, CIFRAS), 10)
    puntos -= 2 * contar(t, REMISION)
    if (enCuadro[i]) puntos += 10
    return { n: i + 1, puntos, caracteres: paginas[i].length }
  })
}

export function seleccionarPaginas(paginas: string[], presupuestoTokens: number) {
  const presupuesto = presupuestoTokens * CARACTERES_POR_TOKEN
  const elegidas: number[] = []
  let usados = 0
  const puntuadas = puntuarPaginas(paginas)
  for (const p of [...puntuadas].sort((a, b) => b.puntos - a.puntos)) {
    if (p.puntos <= 0) break
    if (usados + p.caracteres > presupuesto) continue
    elegidas.push(p.n)
    usados += p.caracteres
  }
  // Red de seguridad: si las palabras clave apenas encuentran nada (otro idioma, redacción
  // atípica), mejor mandar el principio del pliego que dos páginas sueltas
  if (usados < 0.4 * presupuesto) {
    for (const p of puntuadas) {
      if (elegidas.includes(p.n) || usados + p.caracteres > presupuesto) continue
      elegidas.push(p.n)
      usados += p.caracteres
    }
  }
  return { paginas: elegidas.sort((a, b) => a - b), tokensEstimados: Math.round(usados / CARACTERES_POR_TOKEN) }
}
