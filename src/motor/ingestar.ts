// El motor: descarga el ZIP mensual de PLACSP, se queda con las licitaciones de TI y las
// vuelca en Postgres. Pensado para encenderse a mano (una vez por semana basta: el plazo
// más corto del 10% de las licitaciones de TI es de 13 días) y apagarse.
//   npm run motor              → mes en curso, y el anterior si nunca se ingirió
//   npm run motor -- 202608    → meses concretos
//
// Fuente: el ZIP del mes en curso, que PLACSP regenera cada madrugada con unos 3 días de
// retraso. El feed Atom en directo se descartó: el 24/09 su página raíz seguía en el 08/09.
import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import AdmZip from 'adm-zip'
import pg from 'pg'
import { leerPagina, type Licitacion } from '../placsp/entrada.ts'
import { esTI } from '../placsp/ti.ts'

try { process.loadEnvFile('.env') } catch {}
if (!process.env.RADAR_DSN) throw new Error('Falta RADAR_DSN en .env (ver .env.ejemplo)')

const USER_AGENT = 'radar-licitaciones/0.1 (+https://alvaroalcaraz.com)'
const urlZip = (mes: string) =>
  `https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3_${mes}.zip`
const DIR = 'data/motor'
mkdirSync(DIR, { recursive: true })

const db = new pg.Client({
  connectionString: process.env.RADAR_DSN,
  // El pooler de Supabase exige TLS; su certificado no está en el almacén de Node
  ssl: { rejectUnauthorized: false },
})

const mesDe = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`

async function mesesPorDefecto(): Promise<string[]> {
  const hoy = new Date()
  const actual = mesDe(hoy)
  const anterior = mesDe(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1))
  const { rows } = await db.query(
    `select 1 from licitaciones.ingestas where fuente = $1 and error is null and fin is not null limit 1`, [anterior])
  // El ZIP de un mes ya cerrado no vuelve a cambiar: basta con haberlo ingerido una vez
  return rows.length ? [actual] : [anterior, actual]
}

// Descarga condicional: si el ETag coincide con la última ingesta buena, no hay nada nuevo
type Descarga = { ruta: string; etag: string | null } | { sinCambios: true; etag: string }

async function descargar(mes: string): Promise<Descarga> {
  const { rows } = await db.query(
    `select etag from licitaciones.ingestas
      where fuente = $1 and error is null and fin is not null and etag is not null
      order by inicio desc limit 1`, [mes])
  const previo: string | undefined = rows[0]?.etag
  const res = await fetch(urlZip(mes), {
    headers: { 'User-Agent': USER_AGENT, ...(previo ? { 'If-None-Match': previo } : {}) },
  })
  if (res.status === 304) return { sinCambios: true, etag: previo! }
  if (!res.ok || !res.body) throw new Error(`${res.status} al descargar el ZIP de ${mes}`)
  const ruta = `${DIR}/${mes}.zip`
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(`${ruta}.tmp`))
  renameSync(`${ruta}.tmp`, ruta)
  return { ruta, etag: res.headers.get('etag') }
}

type Registro = { lic: Licitacion; publicada: string | null }

// Una licitación aparece una vez por cada cambio de estado: se queda la entrada más
// reciente, y la fecha en que se vio publicada por primera vez
function leerZip(ruta: string) {
  const porId = new Map<string, Registro>()
  let entradas = 0
  let hasta = ''
  for (const f of new AdmZip(ruta).getEntries()) {
    if (!f.entryName.endsWith('.atom')) continue
    for (const l of leerPagina(f.getData().toString('utf8')).licitaciones) {
      entradas++
      if (l.actualizado > hasta) hasta = l.actualizado
      if (!esTI(l)) continue
      const r = porId.get(l.id) ?? { lic: l, publicada: null }
      if (l.actualizado >= r.lic.actualizado) r.lic = l
      if (l.estado === 'PUB' && (!r.publicada || l.actualizado < r.publicada)) r.publicada = l.actualizado
      porId.set(l.id, r)
    }
  }
  return { registros: [...porId.values()], entradas, hasta: hasta || null }
}

const COLUMNAS = [
  'id', 'expediente', 'titulo', 'estado', 'organo', 'tipo_contrato', 'presupuesto_sin_iva',
  'valor_estimado', 'duracion', 'garantia_definitiva_pct', 'cpvs', 'lotes', 'lugar', 'nuts',
  'fecha_limite', 'enlace', 'pcap_url', 'ppt_url', 'criterios', 'solvencia_economica',
  'solvencia_tecnica', 'actualizado', 'publicada',
] as const

const valores = ({ lic: l, publicada }: Registro) => [
  l.id, l.expediente, l.titulo, l.estado, l.organo, l.tipoContrato, l.presupuestoSinIva,
  l.valorEstimado, l.duracion, l.garantiaDefinitivaPct, l.cpvs, l.lotes, l.lugar, l.nuts,
  l.fechaLimite, l.enlace, l.pcap, l.ppt, JSON.stringify(l.criteriosAdjudicacion),
  l.solvenciaEconomica, l.solvenciaTecnica, l.actualizado, publicada,
]

// Upsert por lotes. Una entrada más vieja nunca pisa a una más nueva (el ZIP de agosto
// puede llegar después que el de septiembre), y la fecha de publicación se queda con la
// más antigua vista.
async function volcar(registros: Registro[]) {
  let nuevas = 0
  let actualizadas = 0
  const LOTE = 200
  for (let i = 0; i < registros.length; i += LOTE) {
    const lote = registros.slice(i, i + LOTE)
    const params = lote.flatMap(valores)
    const filas = lote.map((_, f) =>
      `(${COLUMNAS.map((_, c) => `$${f * COLUMNAS.length + c + 1}`).join(', ')})`).join(',\n')
    const { rows } = await db.query(
      `insert into licitaciones.licitaciones (${COLUMNAS.join(', ')})
       values ${filas}
       on conflict (id) do update set
         ${COLUMNAS.filter((c) => c !== 'id' && c !== 'publicada').map((c) => `${c} = excluded.${c}`).join(', ')},
         publicada = least(licitaciones.publicada, excluded.publicada)
       where licitaciones.actualizado <= excluded.actualizado
       returning (xmax = 0) as nueva`,
      params)
    for (const r of rows) r.nueva ? nuevas++ : actualizadas++
  }
  return { nuevas, actualizadas }
}

async function ingestar(mes: string) {
  const { rows: [{ id }] } = await db.query(
    `insert into licitaciones.ingestas (fuente) values ($1) returning id`, [mes])
  try {
    const zip = await descargar(mes)
    if ('sinCambios' in zip) {
      await db.query(
        `update licitaciones.ingestas set fin = now(), etag = $2, nuevas = 0, actualizadas = 0 where id = $1`,
        [id, zip.etag])
      console.log(`${mes}: sin cambios desde la última ingesta`)
      return
    }
    const { registros, entradas, hasta } = leerZip(zip.ruta)
    const { nuevas, actualizadas } = await volcar(registros)
    await db.query(
      `update licitaciones.ingestas
          set fin = now(), etag = $2, entradas = $3, ti = $4, nuevas = $5, actualizadas = $6, hasta = $7
        where id = $1`,
      [id, zip.etag, entradas, registros.length, nuevas, actualizadas, hasta])
    console.log(`${mes}: ${entradas} entradas, ${registros.length} de TI → ${nuevas} nuevas, ` +
      `${actualizadas} actualizadas, datos hasta ${hasta?.slice(0, 16)}`)
  } catch (err) {
    await db.query(`update licitaciones.ingestas set fin = now(), error = $2 where id = $1`,
      [id, String(err).slice(0, 500)])
    throw err
  }
}

await db.connect()
try {
  const meses = process.argv.slice(2).filter((a) => /^\d{6}$/.test(a))
  for (const mes of meses.length ? meses : await mesesPorDefecto()) await ingestar(mes)
} finally {
  await db.end()
}
