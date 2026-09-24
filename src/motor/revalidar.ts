// Vuelve a aplicar los validadores (src/pliegos/validar.ts) sobre lo que el modelo propuso,
// sin pasar otra vez por la GPU. Para cuando se afina un validador.
//   npm run revalidar
// Necesita los pliegos en la caché local (data/pliegos): las citas se comprueban contra su texto.
import pg from 'pg'
import { leerPliego } from '../pliegos/descargar.ts'
import { depurar, type Requisitos } from '../pliegos/validar.ts'

try { process.loadEnvFile('.env') } catch {}
if (!process.env.RADAR_DSN) throw new Error('Falta RADAR_DSN en .env (ver .env.ejemplo)')

const db = new pg.Client({
  connectionString: process.env.RADAR_DSN,
  // El pooler de Supabase exige TLS; su certificado no está en el almacén de Node
  ssl: { rejectUnauthorized: false },
})
await db.connect()

type Fila = { licitacion_id: string; pliego_url: string; propuesta: Requisitos; aceptados: number }
const { rows } = await db.query<Fila>(
  `select licitacion_id, pliego_url, propuesta, aceptados from licitaciones.extracciones
    where estado = 'hecha' and propuesta is not null`)

let antes = 0
let despues = 0
let cambiadas = 0
try {
  for (const r of rows) {
    const pliego = await leerPliego(r.pliego_url)
    if (pliego.estado !== 'ok') continue
    const { requisitos, descartados } = depurar(r.propuesta, pliego.paginas)
    const aceptados = Object.values(requisitos).reduce((n, xs) => n + (xs?.length ?? 0), 0)
    antes += r.aceptados
    despues += aceptados
    if (aceptados !== r.aceptados) cambiadas++
    await db.query(
      `update licitaciones.extracciones
          set requisitos = $2, aceptados = $3, descartados = $4, detalle = $5
        where licitacion_id = $1`,
      [r.licitacion_id, JSON.stringify(requisitos), aceptados, descartados.length,
        descartados.join('\n').slice(0, 4000) || null])
  }
} finally {
  await db.end()
}
console.log(`${rows.length} lecturas revalidadas: ${antes} → ${despues} requisitos aceptados (${cambiadas} cambian)`)
