// Fase 0: medir un mes de licitaciones antes de decidir alcance y coste.
//   node scripts/fase0/medir-mes.ts [AAAAMM] [tamaño de muestra de pliegos]
// Fuente: ZIP mensual oficial de datos abiertos de PLACSP (sindicación 643).
// Pliegos: solo una muestra de licitaciones TI, con pausa entre descargas y caché.
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import AdmZip from 'adm-zip'
import { extractText, getDocumentProxy } from 'unpdf'
import { leerPagina, type Licitacion } from '../../src/placsp/entrada.ts'
import { esTI } from '../../src/placsp/ti.ts'

const MES = process.argv[2] ?? '202608'
const MUESTRA = Number(process.argv[3] ?? 40)
const PAUSA_MS = 3000
const USER_AGENT = 'radar-licitaciones/0.0.1 (+https://alvaroalcaraz.com)'
const ZIP_URL = `https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3_${MES}.zip`
// Por debajo de esto por página, el PDF es una imagen escaneada sin capa de texto
const CARACTERES_MIN_POR_PAGINA = 200

const DIR = 'data/fase0'
mkdirSync(`${DIR}/pliegos`, { recursive: true })

async function descargar(url: string, destino: string) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok || !res.body) throw new Error(`${res.status} al descargar ${url}`)
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(`${destino}.tmp`))
  renameSync(`${destino}.tmp`, destino)
  return res.headers.get('content-type')
}

const percentil = (xs: number[], p: number) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]
}
const pct = (n: number, total: number) => (total ? `${((100 * n) / total).toFixed(1)}%` : '-')

// --- 1. Un mes de feed ---------------------------------------------------------

const rutaZip = `${DIR}/${MES}.zip`
if (!existsSync(rutaZip)) {
  console.log(`Descargando ${ZIP_URL} ...`)
  await descargar(ZIP_URL, rutaZip)
}

type Seguimiento = { ultima: Licitacion; pub: Licitacion | null; primeraPub: string | null }
const vistas = new Map<string, Seguimiento>()
let entradas = 0
let borradas = 0

const ficheros = new AdmZip(rutaZip).getEntries().filter((f) => f.entryName.endsWith('.atom'))
console.log(`${ficheros.length} ficheros atom en el ZIP`)
for (const f of ficheros) {
  const pagina = leerPagina(f.getData().toString('utf8'))
  borradas += pagina.borradas
  for (const l of pagina.licitaciones) {
    entradas++
    const s = vistas.get(l.id) ?? { ultima: l, pub: null, primeraPub: null }
    if (l.actualizado >= s.ultima.actualizado) s.ultima = l
    if (l.estado === 'PUB') {
      if (!s.pub || l.actualizado >= s.pub.actualizado) s.pub = l
      if (!s.primeraPub || l.actualizado < s.primeraPub) s.primeraPub = l.actualizado
    }
    vistas.set(l.id, s)
  }
}

const diasMes = new Date(Number(MES.slice(0, 4)), Number(MES.slice(4)), 0).getDate()
const abiertas = [...vistas.values()].filter((s) => s.pub)
const ti = abiertas.filter((s) => esTI(s.pub!))
const tiPub = ti.map((s) => s.pub!)

const presupuestos = tiPub.map((l) => l.presupuestoSinIva).filter((v): v is number => v != null)
const diasDePlazo = ti
  .filter((s) => s.pub!.fechaLimite)
  .map((s) => (Date.parse(s.pub!.fechaLimite!) - Date.parse(s.primeraPub!.slice(0, 10))) / 86_400_000)
  .filter((d) => d >= 0)

const feed = {
  mes: MES,
  entradas,
  borradas,
  licitacionesDistintas: vistas.size,
  abiertasEnElMes: abiertas.length,
  abiertasAlDia: +(abiertas.length / diasMes).toFixed(1),
  ti: {
    abiertas: ti.length,
    alDia: +(ti.length / diasMes).toFixed(1),
    cpv72: tiPub.filter((l) => l.cpvs.some((c) => c.startsWith('72'))).length,
    cpv48: tiPub.filter((l) => l.cpvs.some((c) => c.startsWith('48'))).length,
    conPcap: pct(tiPub.filter((l) => l.pcap).length, ti.length),
    conPpt: pct(tiPub.filter((l) => l.ppt).length, ti.length),
    conLotes: pct(tiPub.filter((l) => l.lotes > 0).length, ti.length),
    enElFeed: {
      criteriosAdjudicacion: pct(tiPub.filter((l) => l.criteriosAdjudicacion.length > 0).length, ti.length),
      solvenciaEconomica: pct(tiPub.filter((l) => l.solvenciaEconomica.length > 0).length, ti.length),
      solvenciaTecnica: pct(tiPub.filter((l) => l.solvenciaTecnica.length > 0).length, ti.length),
    },
    presupuestoSinIva: { mediana: percentil(presupuestos, 0.5), p90: percentil(presupuestos, 0.9) },
    diasDePlazo: { p10: percentil(diasDePlazo, 0.1), mediana: percentil(diasDePlazo, 0.5) },
  },
}
console.log(JSON.stringify(feed, null, 2))

// --- 2. Muestra de pliegos TI ------------------------------------------------------

// Muestra determinista: repartida a lo largo de la lista ordenada por id
const candidatas = tiPub.filter((l) => l.pcap).sort((a, b) => a.id.localeCompare(b.id))
const paso = Math.max(1, Math.floor(candidatas.length / MUESTRA))
const elegidas = candidatas.filter((_, i) => i % paso === 0).slice(0, MUESTRA)

type Pliego = {
  id: string; titulo: string; tipo: string | null; bytes: number
  paginas?: number; caracteres?: number; escaneado?: boolean; error?: string
}
const pliegos: Pliego[] = []
for (const [i, l] of elegidas.entries()) {
  const ruta = `${DIR}/pliegos/${createHash('sha1').update(l.pcap!).digest('hex').slice(0, 16)}`
  let tipo: string | null = null
  try {
    if (!existsSync(ruta)) {
      tipo = await descargar(l.pcap!, ruta)
      await new Promise((r) => setTimeout(r, PAUSA_MS))
    }
    const buf = readFileSync(ruta)
    const p: Pliego = { id: l.id, titulo: l.titulo.slice(0, 80), tipo, bytes: buf.length }
    if (buf.subarray(0, 5).toString() === '%PDF-') {
      const { totalPages, text } = await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: false })
      const caracteres = text.reduce((n, t) => n + t.replace(/\s+/g, '').length, 0)
      Object.assign(p, { paginas: totalPages, caracteres, escaneado: caracteres / totalPages < CARACTERES_MIN_POR_PAGINA })
    } else {
      p.error = `no es PDF (empieza por ${JSON.stringify(buf.subarray(0, 4).toString('latin1'))})`
    }
    pliegos.push(p)
  } catch (err) {
    pliegos.push({ id: l.id, titulo: l.titulo.slice(0, 80), tipo, bytes: 0, error: String(err) })
  }
  process.stdout.write(`\rpliegos ${i + 1}/${elegidas.length}`)
}
console.log()

const pdfs = pliegos.filter((p) => p.paginas != null)
const conTexto = pdfs.filter((p) => !p.escaneado)
const muestra = {
  pedidos: elegidas.length,
  pdf: pdfs.length,
  noPdfOError: pliegos.length - pdfs.length,
  escaneados: pct(pdfs.filter((p) => p.escaneado).length, pdfs.length),
  paginas: { mediana: percentil(pdfs.map((p) => p.paginas!), 0.5), p90: percentil(pdfs.map((p) => p.paginas!), 0.9) },
  // Orientativo: ~4 caracteres por token en español. El coste real se mide en la fase 2.
  caracteres: {
    mediana: percentil(conTexto.map((p) => p.caracteres!), 0.5),
    p90: percentil(conTexto.map((p) => p.caracteres!), 0.9),
  },
}
console.log(JSON.stringify(muestra, null, 2))

// Registro completo de las TI abiertas: lo usa la prueba de extracción para contrastar con el feed
writeFileSync(`${DIR}/ti-${MES}.json`, JSON.stringify(tiPub, null, 2))
writeFileSync(`${DIR}/informe-${MES}.json`, JSON.stringify({ feed, muestra, pliegos }, null, 2))
console.log(`Informe en ${DIR}/informe-${MES}.json`)
