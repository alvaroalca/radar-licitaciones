// Lector externo con Claude por la CLI (`claude -p`), con la suscripción y sin API de pago.
// Una llamada por pliego, sin herramientas ni MCP: un solo turno de ~13 k tokens de entrada.
// Con subagentes en lotes de 10, cada pliego se reenviaba en todos los turnos siguientes y
// el consumo salió ~30 veces mayor (25/09/2026).
//   node scripts/lector/claude.ts [--limite=N] [--modelo=sonnet] [--id=X]
// Lee data/lectura/<id>.txt (de `npm run extraer -- --preparar`) y deja <id>.json al lado,
// listo para `npm run extraer -- --importar --modelo=<modelo>`.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const LECTURA = 'data/lectura'
const opcion = (nombre: string) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split('=')[1]
const MODELO = opcion('modelo') ?? 'sonnet'
const ID = opcion('id')
const LIMITE = Number(opcion('limite') ?? 20)
const SISTEMA = 'Respondes solo con el objeto JSON que se pide, sin texto alrededor ni bloque de código.'

const pendientes = ID ? [ID] : readdirSync(LECTURA).filter((f) => /^\d+\.txt$/.test(f)).map((f) => f.replace('.txt', ''))
  .filter((id) => !existsSync(`${LECTURA}/${id}.json`) && !existsSync(`${LECTURA}/importadas/${id}.json`))
  .slice(0, LIMITE)
console.log(`${pendientes.length} pliegos por leer con ${MODELO}`)

let entrada = 0
let salida = 0
for (const [i, id] of pendientes.entries()) {
  // Desde un directorio neutro, para no cargar el CLAUDE.md del proyecto en cada llamada.
  // claude es un .cmd en Windows: hace falta shell, y por eso los argumentos van entre comillas.
  const r = spawnSync('claude', ['-p', '--tools', '""', '--strict-mcp-config', '--no-session-persistence',
    '--output-format', 'json', '--model', MODELO, '--system-prompt', `"${SISTEMA}"`],
  { input: readFileSync(`${LECTURA}/${id}.txt`, 'utf8'), cwd: tmpdir(), shell: true, encoding: 'utf8', maxBuffer: 1 << 24 })
  let res: { result?: string; is_error?: boolean; usage?: Record<string, number> }
  try { res = JSON.parse(r.stdout) } catch {
    console.log(`[${i + 1}/${pendientes.length}] ${id} sin respuesta: ${(r.stderr || r.stdout).slice(0, 200)}`)
    break
  }
  const u = res.usage ?? {}
  entrada += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  salida += u.output_tokens ?? 0
  const texto = res.result ?? ''
  // Un fallo de la CLI (p. ej. "OAuth access token has expired") también llega como JSON:
  // solo vale una respuesta con los campos del esquema
  if (res.is_error || !texto.includes('"solvencia_economica"')) {
    console.log(`[${i + 1}/${pendientes.length}] ${id} error: ${texto.slice(0, 200)}`)
    break
  }
  const json = texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1)
  try { JSON.parse(json) } catch {
    console.log(`[${i + 1}/${pendientes.length}] ${id} respuesta sin JSON: ${texto.slice(0, 200)}`)
    continue
  }
  writeFileSync(`${LECTURA}/${id}.json`, json)
  console.log(`[${i + 1}/${pendientes.length}] ${id} ok · ${JSON.stringify(u)}`)
}
console.log(`Tokens: ${entrada} de entrada, ${salida} de salida`)
