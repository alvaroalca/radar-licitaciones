// Compara lo que leyó el modelo con la anotación de referencia (evals/referencia/<id>.json).
//   npx tsx scripts/referencia/comparar.ts                → banco de ajuste (evals/referencia)
//   npx tsx scripts/referencia/comparar.ts --banco=validacion-2   → otro banco de evals/
// (tsx y no node: importa el encaje de la web, cuyos imports no llevan extensión)
//
// Formato de la anotación:
// {
//   "id": "20417353",
//   "no_exige_solvencia": false,
//   "volumen_eur": 364500,            // volumen anual de negocios mínimo exigido; null si no fija cifra
//   "seguro_rc_eur": 300000,          // seguro de responsabilidad civil mínimo; null si no lo pide
//   "certificaciones_obligatorias": ["ISO 27001", "ENS medio"],
//   "certificaciones_puntuan": ["ISO 9001"],
//   "clasificacion": [{ "grupo": "V", "subgrupo": "2", "categoria": "3", "sustituye": true }],
//   "notas": "…"
// }
// Es una referencia de Claude sobre las mismas páginas que vio el modelo, no una verdad
// absoluta: un pliego puede decir en otra página lo que aquí no aparece.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import pg from 'pg'
import { certificacion, esVolumen, evaluar, type Veredicto } from '../../web/src/lib/encaje'
import { PERFILES_DEMO } from '../../web/src/lib/perfil'
import type { Lectura, Requisitos } from '../../web/src/lib/supabase'

try { process.loadEnvFile('.env') } catch {}

type Referencia = {
  id: string
  no_exige_solvencia: boolean
  volumen_eur: number | null
  seguro_rc_eur: number | null
  certificaciones_obligatorias: string[]
  certificaciones_puntuan: string[]
  clasificacion: { grupo: string; subgrupo: string | null; categoria: string | null; sustituye: boolean }[]
  notas?: string
}

// Anotaciones versionadas en evals/referencia; el texto de las páginas y el resultado, en data/
const banco = process.argv.find((a) => a.startsWith('--banco='))?.split('=')[1]
  ?? (process.argv.includes('--validacion') ? 'validacion' : 'referencia')
const DIR = `evals/${banco}`
const SALIDA = 'data/referencia'
const refs: Referencia[] = readdirSync(DIR).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')))

const db = new pg.Client({ connectionString: process.env.RADAR_DSN, ssl: { rejectUnauthorized: false } })
await db.connect()
const { rows } = await db.query(
  `select l.id, l.titulo, l.valor_estimado::float, l.duracion, l.cpvs, x.requisitos
     from licitaciones.licitaciones l join licitaciones.extracciones x on x.licitacion_id = l.id
    where l.id = any($1)`, [refs.map((r) => r.id)])
await db.end()
const porId = new Map(rows.map((r) => [r.id, r]))

const sinTildes = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
const casi = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, 0.01 * Math.max(a, b))

// Lo que el encaje entiende como umbral de volumen y como "no exige solvencia"
function volumenModelo(req: Requisitos) {
  const eco = req.solvencia_economica ?? []
  const noExige = eco.some((s) => /no se exig|no sera exigible|exento|exime/.test(sinTildes(`${s.medio} ${s.descripcion}`)))
  const umbrales = eco.filter(esVolumen)
  return { noExige, volumen: umbrales.length ? Math.max(...umbrales.map((s) => s.umbral_eur!)) : null }
}
const seguroModelo = (req: Requisitos) => {
  const s = (req.solvencia_economica ?? []).filter((x) => x.umbral_eur != null && /seguro|poliza|responsabilidad civil/.test(sinTildes(`${x.medio} ${x.descripcion}`)))
  return s.length ? Math.max(...s.map((x) => x.umbral_eur!)) : null
}

// La referencia, traducida al mismo formato que la lectura del modelo, para calcular su veredicto
function lecturaDeReferencia(r: Referencia): Lectura {
  const eco: NonNullable<Requisitos['solvencia_economica']> = []
  if (r.no_exige_solvencia) eco.push({ medio: 'No se exige solvencia', umbral_eur: null, descripcion: 'no se exige', pagina: 1, cita: 'no se exige' })
  if (r.volumen_eur != null) eco.push({ medio: 'Volumen anual de negocios', umbral_eur: r.volumen_eur, descripcion: 'volumen anual de negocios', pagina: 1, cita: '' })
  return {
    estado: 'hecha',
    requisitos: {
      solvencia_economica: eco,
      certificaciones_exigidas: [
        ...r.certificaciones_obligatorias.map((nombre) => ({ nombre, pagina: 1, cita: 'deberá acreditar' })),
        ...r.certificaciones_puntuan.map((nombre) => ({ nombre, pagina: 1, cita: 'se valorará con puntos' })),
      ],
      clasificacion_empresarial: r.clasificacion.map((c) => ({
        grupo: c.grupo, subgrupo: c.subgrupo, categoria: c.categoria, sustituye_solvencia: c.sustituye, pagina: 1, cita: '',
      })),
    },
  }
}

const canon = (n: string) => certificacion(n) ?? sinTildes(n).replace(/\s+/g, ' ').trim()

const volumen = { correcto: 0, sin_cifra_ambos: 0, omitido: 0, inventado: 0, erroneo: 0 }
const noExige = { acierta: 0, falla: 0 }
const seguro = { correcto: 0, ninguno: 0, omitido: 0, inventado: 0, erroneo: 0 }
const cert = { aciertos: 0, confunde_puntua: 0, sobran: 0, faltan: 0 }
const clasif = { aciertos: 0, sobran: 0, faltan: 0 }
const veredictos = Object.fromEntries(PERFILES_DEMO.map((p) => [p.nombre, { coincide: 0, distinto: [] as string[] }]))
const detalle: unknown[] = []

for (const r of refs) {
  const l = porId.get(r.id)
  if (!l) { console.log(`${r.id}: sin lectura del modelo`); continue }
  const req: Requisitos = l.requisitos ?? {}

  const vm = volumenModelo(req)
  if (r.volumen_eur == null && vm.volumen == null) volumen.sin_cifra_ambos++
  else if (r.volumen_eur != null && vm.volumen == null) volumen.omitido++
  else if (r.volumen_eur == null) volumen.inventado++
  else if (casi(r.volumen_eur, vm.volumen!)) volumen.correcto++
  else volumen.erroneo++
  vm.noExige === r.no_exige_solvencia ? noExige.acierta++ : noExige.falla++

  const sm = seguroModelo(req)
  if (r.seguro_rc_eur == null && sm == null) seguro.ninguno++
  else if (r.seguro_rc_eur != null && sm == null) seguro.omitido++
  else if (r.seguro_rc_eur == null) seguro.inventado++
  else if (casi(r.seguro_rc_eur, sm!)) seguro.correcto++
  else seguro.erroneo++

  const obligatorias = new Set(r.certificaciones_obligatorias.map(canon))
  const puntuan = new Set(r.certificaciones_puntuan.map(canon))
  const delModelo = new Set((req.certificaciones_exigidas ?? []).map((c) => canon(c.nombre)))
  for (const c of delModelo) obligatorias.has(c) ? cert.aciertos++ : puntuan.has(c) ? cert.confunde_puntua++ : cert.sobran++
  for (const c of obligatorias) if (!delModelo.has(c)) cert.faltan++

  const clave = (g: string, s: string | null) => `${g.toUpperCase()}${s ? `-${s}` : ''}`
  const clasRef = new Set(r.clasificacion.map((c) => clave(c.grupo, c.subgrupo)))
  const clasMod = new Set((req.clasificacion_empresarial ?? []).map((c) => clave(c.grupo, c.subgrupo)))
  for (const c of clasMod) clasRef.has(c) ? clasif.aciertos++ : clasif.sobran++
  for (const c of clasRef) if (!clasMod.has(c)) clasif.faltan++

  const lecturaModelo: Lectura = { estado: 'hecha', requisitos: req }
  const vs: Record<string, [Veredicto, Veredicto]> = {}
  for (const p of PERFILES_DEMO) {
    const m = evaluar(l, lecturaModelo, p).veredicto
    const ref = evaluar(l, lecturaDeReferencia(r), p).veredicto
    vs[p.nombre] = [m, ref]
    if (m === ref) veredictos[p.nombre].coincide++
    else veredictos[p.nombre].distinto.push(`${r.id}: modelo ${m}, referencia ${ref}`)
  }
  detalle.push({ id: r.id, titulo: l.titulo, volumen: { referencia: r.volumen_eur, modelo: vm.volumen }, veredictos: vs })
}

const n = detalle.length
const resultado = { pliegos: n, volumen, noExige, seguro, cert, clasif, veredictos, detalle }
writeFileSync(`${SALIDA}/resultado-${DIR.split('/')[1]}.json`, JSON.stringify(resultado, null, 2))

console.log(`${n} pliegos comparados\n`)
console.log('Volumen de negocio  ', JSON.stringify(volumen))
console.log('"No exige solvencia"', JSON.stringify(noExige))
console.log('Seguro RC           ', JSON.stringify(seguro))
console.log('Certificaciones     ', JSON.stringify(cert))
console.log('Clasificación       ', JSON.stringify(clasif))
console.log('\nVeredicto igual que con la referencia:')
for (const [p, v] of Object.entries(veredictos)) {
  console.log(`  ${p.padEnd(42)} ${v.coincide}/${n}`)
  for (const d of v.distinto) console.log(`     ${d}`)
}
