// Banco de referencia: elige N pliegos ya leídos por el modelo, repartidos por tamaño, y
// vuelca las MISMAS páginas que vio el modelo a data/referencia/<id>.txt para anotarlas a mano.
//   node scripts/referencia/preparar.ts [n=25]            → banco de ajuste (evals/referencia)
//   node scripts/referencia/preparar.ts 12                → pliegos nuevos; se anotan en el banco que toque (evals/<banco>)
// Nunca repite un pliego ya anotado en ningún banco de evals/.
// Las anotaciones van a evals/referencia/<id>.json (versionadas; formato en comparar.ts) y se comparan con
// node scripts/referencia/comparar.ts
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { leerPliego } from '../../src/pliegos/descargar.ts'

try { process.loadEnvFile('.env') } catch {}
const N = Number(process.argv[2] ?? 25)
const anotados = new Set((existsSync('evals') ? readdirSync('evals') : [])
  .flatMap((d) => readdirSync(`evals/${d}`)).map((f) => f.replace(/.json$/, '')))
const DIR = 'data/referencia'
mkdirSync(DIR, { recursive: true })

const db = new pg.Client({ connectionString: process.env.RADAR_DSN, ssl: { rejectUnauthorized: false } })
await db.connect()
const { rows } = await db.query<{ id: string; titulo: string; pliego_url: string; paginas_enviadas: number[]; paginas_total: number }>(
  `select l.id, l.titulo, x.pliego_url, x.paginas_enviadas, x.paginas_total
     from licitaciones.extracciones x join licitaciones.licitaciones l on l.id = x.licitacion_id
    where x.estado = 'hecha' and x.propuesta is not null
    order by x.paginas_total, l.id`)
await db.end()

// Repartidos por tamaño, de forma determinista, entre los que no se han anotado aún
const libres = rows.filter((r) => !anotados.has(r.id))
const elegidos = Array.from({ length: Math.min(N, libres.length) }, (_, i) => libres[Math.floor(((i + 0.5) / N) * libres.length)])
for (const r of elegidos) {
  const ruta = `${DIR}/${r.id}.txt`
  if (existsSync(ruta)) continue
  const pliego = await leerPliego(r.pliego_url)
  if (pliego.estado !== 'ok') { console.log(r.id, pliego.estado); continue }
  const texto = r.paginas_enviadas
    .map((n) => `<pagina n="${n}">\n${pliego.paginas[n - 1].replace(/[ \t]+/g, ' ').trim()}\n</pagina>`)
    .join('\n')
  writeFileSync(ruta, `# ${r.id} · ${r.titulo}\n# ${r.paginas_enviadas.length} de ${r.paginas_total} páginas (las que vio el modelo)\n\n${texto}\n`)
  console.log(r.id, `${r.paginas_enviadas.length}/${r.paginas_total} págs`, r.titulo.slice(0, 60))
}
