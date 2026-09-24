// Banco de pruebas de la extracción: pasa N pliegos de la muestra de la fase 0, repartidos por
// tamaño, con el mismo código que usa el motor (src/pliegos/), y resume calidad y tiempo.
//   node scripts/fase2/probar-extraccion.ts [n=8]
// El modelo se cambia con RADAR_MODELO (por defecto qwen3:4b).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { Licitacion } from '../../src/placsp/entrada.ts'
import { leerPliego } from '../../src/pliegos/descargar.ts'
import { MODELO, extraer } from '../../src/pliegos/extraer.ts'

const N = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 8)
const MES = '202608'

type PliegoInforme = { id: string; paginas?: number; escaneado?: boolean }
const informe = JSON.parse(readFileSync(`data/fase0/informe-${MES}.json`, 'utf8'))
const porId = new Map((JSON.parse(readFileSync(`data/fase0/ti-${MES}.json`, 'utf8')) as Licitacion[]).map((l) => [l.id, l]))
const legibles = (informe.pliegos as PliegoInforme[])
  .filter((p) => p.paginas != null && !p.escaneado)
  .sort((a, b) => a.paginas! - b.paginas!)
const elegidos = Array.from({ length: N }, (_, i) => legibles[Math.floor(((i + 0.5) / N) * legibles.length)])

mkdirSync('data/fase2', { recursive: true })
let propuestos = 0, aceptados = 0, segundos = 0
for (const p of elegidos) {
  const lic = porId.get(p.id)!
  const pliego = await leerPliego(lic.pcap!)
  if (pliego.estado !== 'ok') { console.log(p.id, pliego.estado, pliego.detalle); continue }
  const x = await extraer(lic.titulo, pliego.paginas, lic.criteriosAdjudicacion.length === 0)
  propuestos += x.propuestos; aceptados += x.aceptados; segundos += x.segundos
  writeFileSync(`data/fase2/${p.id}-${MODELO.replace(/[:/]/g, '_')}.json`, JSON.stringify({ licitacion: lic, ...x }, null, 2))
  console.log(JSON.stringify({
    id: p.id, paginas: `${x.paginasEnviadas.length}/${pliego.paginas.length}`, segundos: x.segundos,
    esquemaValido: x.esquemaValido, propuestos: x.propuestos, aceptados: x.aceptados,
  }))
  for (const d of x.descartados) console.log('   descartado', d.slice(0, 110))
}
console.log(`\n${elegidos.length} pliegos con ${MODELO}: ${segundos.toFixed(0)} s, ${aceptados} requisitos aceptados de ${propuestos} propuestos`)
