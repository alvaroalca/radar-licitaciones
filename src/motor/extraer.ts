// Lectura de pliegos: los PCAP de las licitaciones abiertas que aún no se han leído (o que
// leyó otro modelo), empezando por las que cierran antes.
//   npm run extraer                    → hasta 20 licitaciones con el modelo local (Ollama)
//   npm run extraer -- --limite=100
//   npm run extraer -- --id=20292508   → una concreta (se relee aunque ya esté hecha)
// Con otro LLM (el que prefiera cada cual), en dos pasos y sin GPU:
//   npm run extraer -- --preparar --limite=300    → data/lectura/<id>.txt: instrucciones y páginas
//   (el lector deja su respuesta en data/lectura/<id>.json)
//   npm run extraer -- --importar --modelo=claude-opus-5-5
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { leerPliego } from '../pliegos/descargar.ts'
import { MODELO, OLLAMA, componer, extraer, importar, instrucciones, ollamaDisponible } from '../pliegos/extraer.ts'

try { process.loadEnvFile('.env') } catch {}
if (!process.env.RADAR_DSN) throw new Error('Falta RADAR_DSN en .env (ver .env.ejemplo)')

const opcion = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1]
const LIMITE = Number(opcion('limite') ?? 20)
const ID = opcion('id')
const PREPARAR = process.argv.includes('--preparar')
const IMPORTAR = process.argv.includes('--importar')
const LECTOR = opcion('modelo') ?? (PREPARAR || IMPORTAR ? 'claude-opus-5-5' : MODELO)
const LECTURA = 'data/lectura'

if (!PREPARAR && !IMPORTAR && !(await ollamaDisponible())) {
  throw new Error(`Ollama no responde en ${OLLAMA} o no tiene el modelo ${MODELO} (ollama pull ${MODELO})`)
}

const db = new pg.Client({
  connectionString: process.env.RADAR_DSN,
  // El pooler de Supabase exige TLS; su certificado no está en el almacén de Node
  ssl: { rejectUnauthorized: false },
})
await db.connect()

type Pendiente = { id: string; titulo: string; pcap_url: string; con_criterios: boolean }

const guardar = (id: string, url: string, campos: Record<string, unknown>) =>
  db.query(
    `insert into licitaciones.extracciones (licitacion_id, pliego_url, ${Object.keys(campos).join(', ')})
     values ($1, $2, ${Object.keys(campos).map((_, i) => `$${i + 3}`).join(', ')})
     on conflict (licitacion_id) do update set
       pliego_url = excluded.pliego_url, fecha = now(),
       ${Object.keys(campos).map((c) => `${c} = excluded.${c}`).join(', ')}`,
    [id, url, ...Object.values(campos)])

if (IMPORTAR) {
  const ficheros = readdirSync(LECTURA).filter((f) => /^\d+\.json$/.test(f))
  console.log(`${ficheros.length} propuestas de ${LECTOR} por importar`)
  mkdirSync(`${LECTURA}/importadas`, { recursive: true })
  try {
    for (const f of ficheros) {
      const id = f.replace('.json', '')
      const { rows: [l] } = await db.query<{ titulo: string; pcap_url: string }>(
        'select titulo, pcap_url from licitaciones.licitaciones where id = $1', [id])
      const pliego = l && await leerPliego(l.pcap_url)
      if (pliego?.estado !== 'ok') { console.log(`${id}: sin pliego legible, no se importa`); continue }
      let json: Record<string, unknown>
      try { json = JSON.parse(readFileSync(`${LECTURA}/${f}`, 'utf8')) } catch (err) {
        console.log(`${id}: JSON ilegible (${String(err).slice(0, 80)})`)
        continue
      }
      const x = importar(json, pliego.paginas, componer(l.titulo, pliego.paginas).paginas)
      await guardar(id, l.pcap_url, {
        estado: 'hecha',
        modelo: LECTOR,
        requisitos: JSON.stringify(x.requisitos),
        propuesta: JSON.stringify(x.propuesta),
        propuestos: x.propuestos,
        aceptados: x.aceptados,
        descartados: x.descartados.length,
        paginas_enviadas: x.paginasEnviadas,
        paginas_total: pliego.paginas.length,
        segundos: null,
        detalle: [...x.invalidos.map((c) => `${c}: no cumple el esquema`), ...x.descartados].join('\n').slice(0, 4000) || null,
      })
      renameSync(`${LECTURA}/${f}`, `${LECTURA}/importadas/${f}`)
      console.log(`${id} ${x.aceptados}/${x.propuestos} requisitos${x.invalidos.length ? `, campos inválidos: ${x.invalidos.join(', ')}` : ''}`)
    }
  } finally {
    await db.end()
  }
  process.exit(0)
}

// Abiertas sin leer, con error en el intento anterior (PLACSP devuelve 500 a veces al
// descargar), cuyo pliego ha cambiado desde la última lectura, leídas por otro modelo, o
// leídas antes de que se guardara la propuesta sin depurar
const { rows: pendientes } = await db.query<Pendiente>(
  ID
    ? `select id, titulo, pcap_url, jsonb_array_length(criterios) > 0 as con_criterios
         from licitaciones.licitaciones where id = $1 and pcap_url is not null`
    : `select l.id, l.titulo, l.pcap_url, jsonb_array_length(l.criterios) > 0 as con_criterios
         from licitaciones.licitaciones l
         left join licitaciones.extracciones x on x.licitacion_id = l.id
        where l.estado = 'PUB' and l.fecha_limite >= current_date and l.pcap_url is not null
          and (x.licitacion_id is null or x.estado = 'error' or x.pliego_url <> l.pcap_url
               or (x.estado = 'hecha' and (x.propuesta is null or x.modelo is distinct from $2)))
        order by l.fecha_limite, l.id
        limit $1`,
  ID ? [ID] : [LIMITE, LECTOR])

console.log(`${pendientes.length} pliegos por leer con ${LECTOR}`)

let hechas = 0
// Si Ollama cae, cada pliego fallaría al instante y quedaría marcado como error en cadena
// (pasó el 24/09/2026: 150 seguidos). Tras unos pocos fallos seguidos del modelo, se para.
const MAX_FALLOS_SEGUIDOS = 3
let fallosSeguidos = 0
try {
  for (const [i, p] of pendientes.entries()) {
    const prefijo = `[${i + 1}/${pendientes.length}] ${p.id}`
    const pliego = await leerPliego(p.pcap_url)
    if (pliego.estado !== 'ok') {
      await guardar(p.id, p.pcap_url, {
        estado: pliego.estado, detalle: pliego.detalle, requisitos: '{}', modelo: null,
        propuestos: null, aceptados: null, descartados: null, paginas_enviadas: null, paginas_total: null, segundos: null,
      })
      console.log(`${prefijo} ${pliego.estado}: ${pliego.detalle}`)
      continue
    }
    if (PREPARAR) {
      mkdirSync(LECTURA, { recursive: true })
      if (existsSync(`${LECTURA}/${p.id}.json`)) continue
      const { texto, paginas } = componer(p.titulo, pliego.paginas)
      writeFileSync(`${LECTURA}/${p.id}.txt`, `${instrucciones(!p.con_criterios)}\n\n${texto}\n`)
      hechas++
      console.log(`${prefijo} preparado: ${paginas.length} de ${pliego.paginas.length} páginas`)
      continue
    }
    try {
      const x = await extraer(p.titulo, pliego.paginas, !p.con_criterios)
      await guardar(p.id, p.pcap_url, {
        estado: 'hecha',
        modelo: MODELO,
        requisitos: JSON.stringify(x.requisitos),
        propuesta: JSON.stringify(x.propuesta),
        propuestos: x.propuestos,
        aceptados: x.aceptados,
        descartados: x.descartados.length,
        paginas_enviadas: x.paginasEnviadas,
        paginas_total: pliego.paginas.length,
        segundos: x.segundos,
        // Los motivos de descarte se guardan: son el material para afinar validadores
        detalle: x.descartados.join('\n').slice(0, 4000) || null,
      })
      hechas++
      fallosSeguidos = 0
      console.log(`${prefijo} ${x.aceptados}/${x.propuestos} requisitos en ${x.segundos} s`)
    } catch (err) {
      if (++fallosSeguidos >= MAX_FALLOS_SEGUIDOS) {
        console.log(`${prefijo} error: ${String(err).slice(0, 120)}`)
        console.log(`${MAX_FALLOS_SEGUIDOS} fallos seguidos del modelo: se para. ¿Sigue Ollama en marcha en ${OLLAMA}?`)
        break
      }
      await guardar(p.id, p.pcap_url, {
        estado: 'error', detalle: String(err).slice(0, 500), requisitos: '{}', modelo: MODELO,
        propuestos: null, aceptados: null, descartados: null, paginas_enviadas: null, paginas_total: pliego.paginas.length, segundos: null,
      })
      console.log(`${prefijo} error: ${String(err).slice(0, 120)}`)
    }
  }
} finally {
  await db.end()
  // Libera la VRAM al terminar: por defecto Ollama deja el modelo cargado 5 minutos
  if (!PREPARAR) await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: MODELO, keep_alive: 0 }) })
    .catch(() => {})
}
console.log(`${hechas} pliegos ${PREPARAR ? `preparados en ${LECTURA}` : 'leídos'}`)
