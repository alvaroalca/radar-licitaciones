// Descarga de un pliego y extracción de su texto por páginas.
// Solo se llama para licitaciones concretas (abiertas y de TI), nunca recorriendo el portal:
// el robots.txt de contrataciondelestado.es pide que no se rastree. Caché en disco y pausa
// entre descargas.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import AdmZip from 'adm-zip'
import { extractText, getDocumentProxy } from 'unpdf'

const USER_AGENT = 'radar-licitaciones/0.1 (+https://alvaroalcaraz.com)'
const CACHE = 'data/pliegos'
const PAUSA_MS = 3000
// Por debajo de esto por página, el PDF es una imagen escaneada sin capa de texto
const CARACTERES_MIN_POR_PAGINA = 200

export type Pliego =
  | { estado: 'ok'; paginas: string[] }
  | { estado: 'escaneado' | 'sin_pdf' | 'error'; detalle: string }

let ultimaDescarga = 0

async function bajar(url: string): Promise<Buffer> {
  mkdirSync(CACHE, { recursive: true })
  const ruta = `${CACHE}/${createHash('sha1').update(url).digest('hex').slice(0, 16)}`
  if (existsSync(ruta)) return readFileSync(ruta)
  const espera = ultimaDescarga + PAUSA_MS - Date.now()
  if (espera > 0) await new Promise((r) => setTimeout(r, espera))
  ultimaDescarga = Date.now()
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
  if (!res.ok) throw new Error(`${res.status} al descargar el pliego`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(ruta, buf)
  return buf
}

const esPdf = (b: Buffer) => b.subarray(0, 5).toString() === '%PDF-'

// Algunos órganos suben el pliego dentro de un ZIP: se busca el PDF que parece el PCAP
function pdfDeZip(buf: Buffer): Buffer | null {
  const pdfs = new AdmZip(buf).getEntries()
    .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.pdf'))
  if (!pdfs.length) return null
  const pcap = pdfs.find((e) => /pcap|administrativ|clausulas|cl.usulas/i.test(e.entryName))
  const elegido = pcap ?? pdfs.sort((a, b) => b.header.size - a.header.size)[0]
  return elegido.getData()
}

export async function leerPliego(url: string): Promise<Pliego> {
  try {
    let buf = await bajar(url)
    if (buf.subarray(0, 2).toString() === 'PK') {
      const dentro = pdfDeZip(buf)
      if (!dentro) return { estado: 'sin_pdf', detalle: 'ZIP sin ningún PDF dentro' }
      buf = dentro
    }
    if (!esPdf(buf)) return { estado: 'sin_pdf', detalle: `formato no reconocido (${JSON.stringify(buf.subarray(0, 4).toString('latin1'))})` }
    const { totalPages, text } = await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: false })
    const caracteres = text.reduce((n, t) => n + t.replace(/\s+/g, '').length, 0)
    if (caracteres / totalPages < CARACTERES_MIN_POR_PAGINA) {
      return { estado: 'escaneado', detalle: `${totalPages} páginas sin capa de texto` }
    }
    return { estado: 'ok', paginas: text }
  } catch (err) {
    return { estado: 'error', detalle: String(err).slice(0, 300) }
  }
}
