// Lectura del feed Atom de PLACSP (formato CODICE 2.07).
// Cada <entry> es una actualización de una licitación: la misma licitación aparece
// varias veces a lo largo de su vida (PUB → EV → ADJ → RES).
import { XMLParser } from 'fast-xml-parser'

export type Licitacion = {
  id: string                  // id numérico de PLACSP, final del <id> del entry
  actualizado: string         // <updated> del entry
  expediente: string | null
  titulo: string
  estado: string | null       // PRE, PUB, EV, ADJ, RES, ANUL
  organo: string | null
  tipoContrato: string | null // 1 suministros, 2 servicios, 3 obras...
  presupuestoSinIva: number | null
  valorEstimado: number | null
  duracion: string | null     // p. ej. "12 MON", "2 ANN"
  garantiaDefinitivaPct: number | null
  cpvs: string[]              // del proyecto y de todos sus lotes
  lotes: number
  lugar: string | null        // lugar de ejecución, normalmente la provincia
  nuts: string | null         // código NUTS del lugar: ES30 Madrid, ES523 Valencia...
  enlace: string | null       // ficha de la licitación en PLACSP
  fechaLimite: string | null  // fin del plazo de presentación de ofertas
  pcap: string | null         // pliego de cláusulas administrativas
  ppt: string | null          // pliego de prescripciones técnicas
  // Lo que el feed ya trae estructurado, sin necesidad de leer el pliego
  criteriosAdjudicacion: Criterio[]
  solvenciaEconomica: string[]  // descripción de cada criterio de solvencia
  solvenciaTecnica: string[]
}

export type Criterio = {
  descripcion: string
  peso: number | null
  tipo: string | null  // OBJ: fórmula automática · SUBJ: juicio de valor
}

const SIEMPRE_LISTA = new Set([
  'entry', 'ProcurementProjectLot', 'RequiredCommodityClassification',
  'LegalDocumentReference', 'TechnicalDocumentReference',
])

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  isArray: (nombre) => SIEMPRE_LISTA.has(nombre),
})

type Nodo = any

// Un elemento con atributos llega como objeto { '#text', '@_...' }
function texto(n: Nodo): string | null {
  if (n == null) return null
  if (typeof n === 'object') return n['#text'] != null ? String(n['#text']).trim() : null
  return String(n).trim()
}

function numero(n: Nodo): number | null {
  const t = texto(n)
  if (t == null || t === '') return null
  const v = Number(t)
  return Number.isFinite(v) ? v : null
}

// Recoge todos los valores de una clave en cualquier nivel del subárbol
function recoger(n: Nodo, clave: string, acc: Nodo[] = []): Nodo[] {
  if (n == null || typeof n !== 'object') return acc
  if (Array.isArray(n)) {
    for (const x of n) recoger(x, clave, acc)
    return acc
  }
  for (const [k, v] of Object.entries(n)) {
    if (k === clave) acc.push(...(Array.isArray(v) ? v : [v]))
    else recoger(v, clave, acc)
  }
  return acc
}

function duracion(n: Nodo): string | null {
  const v = texto(n)
  return v ? `${v} ${n?.['@_unitCode'] ?? ''}`.trim() : null
}

function descripciones(n: Nodo, clave: string): string[] {
  return recoger(n, clave).map((c) => texto(c.Description) ?? '')
}

function uriDocumento(refs: Nodo[] | undefined): string | null {
  return texto(refs?.[0]?.Attachment?.ExternalReference?.URI)
}

export function leerEntrada(e: Nodo): Licitacion {
  const cfs = e.ContractFolderStatus ?? {}
  const proyecto = cfs.ProcurementProject ?? {}
  const cpvs = recoger([proyecto, cfs.ProcurementProjectLot], 'ItemClassificationCode')
    .map(texto).filter((c): c is string => !!c)

  return {
    id: String(texto(e.id)).split('/').pop()!,
    actualizado: texto(e.updated)!,
    expediente: texto(cfs.ContractFolderID),
    titulo: texto(e.title) ?? '',
    estado: texto(cfs.ContractFolderStatusCode),
    organo: texto(cfs.LocatedContractingParty?.Party?.PartyName?.Name),
    tipoContrato: texto(proyecto.TypeCode),
    presupuestoSinIva: numero(proyecto.BudgetAmount?.TaxExclusiveAmount),
    valorEstimado: numero(proyecto.BudgetAmount?.EstimatedOverallContractAmount),
    duracion: duracion(proyecto.PlannedPeriod?.DurationMeasure),
    // Tipo de garantía 2 = definitiva
    garantiaDefinitivaPct: numero(recoger(cfs.TenderingTerms, 'RequiredFinancialGuarantee')
      .find((g) => texto(g.GuaranteeTypeCode) === '2')?.AmountRate),
    cpvs: [...new Set(cpvs)],
    lotes: cfs.ProcurementProjectLot?.length ?? 0,
    lugar: texto(proyecto.RealizedLocation?.CountrySubentity),
    nuts: texto(proyecto.RealizedLocation?.CountrySubentityCode),
    enlace: [].concat(e.link ?? []).map((l: Nodo) => l['@_href']).find(Boolean) ?? null,
    fechaLimite: texto(cfs.TenderingProcess?.TenderSubmissionDeadlinePeriod?.EndDate),
    pcap: uriDocumento(cfs.LegalDocumentReference),
    ppt: uriDocumento(cfs.TechnicalDocumentReference),
    criteriosAdjudicacion: recoger(cfs.TenderingTerms, 'AwardingCriteria').map((c) => ({
      descripcion: texto(c.Description) ?? '',
      peso: numero(c.WeightNumeric),
      tipo: texto(c.AwardingCriteriaTypeCode),
    })),
    solvenciaEconomica: descripciones(cfs.TenderingTerms, 'FinancialEvaluationCriteria'),
    solvenciaTecnica: descripciones(cfs.TenderingTerms, 'TechnicalEvaluationCriteria'),
  }
}

export type PaginaFeed = {
  licitaciones: Licitacion[]
  borradas: number   // <at:deleted-entry>: licitaciones retiradas del perfil
  siguiente: string | null
}

export function leerPagina(xml: string): PaginaFeed {
  const feed = parser.parse(xml).feed ?? {}
  const enlaces: Nodo[] = [].concat(feed.link ?? [])
  const siguiente = enlaces.find((l) => l['@_rel'] === 'next')?.['@_href'] ?? null
  const borradas = [].concat(feed['deleted-entry'] ?? []).length
  return { licitaciones: (feed.entry ?? []).map(leerEntrada), borradas, siguiente }
}
