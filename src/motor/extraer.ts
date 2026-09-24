// Lectura de pliegos: pasa por el modelo local los PCAP de las licitaciones abiertas que aún
// no se han leído, empezando por las que cierran antes. Necesita Ollama encendido con el modelo.
//   npm run extraer                 → hasta 20 licitaciones
//   npm run extraer -- --limite=100
//   npm run extraer -- --id=20292508   → una concreta (se relee aunque ya esté hecha)
import pg from 'pg'
import { leerPliego } from '../pliegos/descargar.ts'
import { MODELO, OLLAMA, extraer, ollamaDisponible } from '../pliegos/extraer.ts'

try { process.loadEnvFile('.env') } catch {}
if (!process.env.RADAR_DSN) throw new Error('Falta RADAR_DSN en .env (ver .env.ejemplo)')

const opcion = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1]
const LIMITE = Number(opcion('limite') ?? 20)
const ID = opcion('id')

if (!(await ollamaDisponible())) {
  throw new Error(`Ollama no responde en ${OLLAMA} o no tiene el modelo ${MODELO} (ollama pull ${MODELO})`)
}

const db = new pg.Client({
  connectionString: process.env.RADAR_DSN,
  // El pooler de Supabase exige TLS; su certificado no está en el almacén de Node
  ssl: { rejectUnauthorized: false },
})
await db.connect()

type Pendiente = { id: string; titulo: string; pcap_url: string; con_criterios: boolean }

// Abiertas sin leer, con error en el intento anterior (PLACSP devuelve 500 a veces al
// descargar), cuyo pliego ha cambiado desde la última lectura, o leídas antes de que se
// guardara la propuesta sin depurar
const { rows: pendientes } = await db.query<Pendiente>(
  ID
    ? `select id, titulo, pcap_url, jsonb_array_length(criterios) > 0 as con_criterios
         from licitaciones.licitaciones where id = $1 and pcap_url is not null`
    : `select l.id, l.titulo, l.pcap_url, jsonb_array_length(l.criterios) > 0 as con_criterios
         from licitaciones.licitaciones l
         left join licitaciones.extracciones x on x.licitacion_id = l.id
        where l.estado = 'PUB' and l.fecha_limite >= current_date and l.pcap_url is not null
          and (x.licitacion_id is null or x.estado = 'error' or x.pliego_url <> l.pcap_url
               or (x.estado = 'hecha' and x.propuesta is null))
        order by l.fecha_limite, l.id
        limit $1`,
  [ID ?? LIMITE])

console.log(`${pendientes.length} pliegos por leer con ${MODELO}`)

const guardar = (id: string, url: string, campos: Record<string, unknown>) =>
  db.query(
    `insert into licitaciones.extracciones (licitacion_id, pliego_url, ${Object.keys(campos).join(', ')})
     values ($1, $2, ${Object.keys(campos).map((_, i) => `$${i + 3}`).join(', ')})
     on conflict (licitacion_id) do update set
       pliego_url = excluded.pliego_url, fecha = now(),
       ${Object.keys(campos).map((c) => `${c} = excluded.${c}`).join(', ')}`,
    [id, url, ...Object.values(campos)])

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
  await fetch(`${OLLAMA}/api/generate`, { method: 'POST', body: JSON.stringify({ model: MODELO, keep_alive: 0 }) })
    .catch(() => {})
}
console.log(`${hechas} pliegos leídos`)
