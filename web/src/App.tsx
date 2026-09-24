import { useCallback, useEffect, useMemo, useState } from 'react'
import { COLUMNAS_FILA, supabase, type Extraccion, type Fila, type Licitacion } from './lib/supabase'
import { CERTIFICACIONES, FAMILIAS, PERFILES_DEMO, cargarPerfil, guardarPerfil, type Perfil } from './lib/perfil'
import { esDeTuActividad, evaluar, type Encaje, type Veredicto } from './lib/encaje'
import {
  COMUNIDADES, ESTADOS, TIPOS_CONTRATO, comunidad, diasRestantes, duracion, fechaCorta, fechaLarga,
  hoyISO, importe, importeCorto,
} from './lib/formato'

const POR_PAGINA = 60

type Plazo = 'abiertas' | 'semana' | 'todas'
type FiltroEncaje = '' | 'actividad' | 'posibles' | 'encaja'
type Filtros = { q: string; ccaa: string; importe: string; plazo: Plazo; encaje: FiltroEncaje }

// El encaje se calcula en el navegador, así que con ese filtro se trae el lote entero (las
// abiertas de TI son unas 300) y se filtra aquí
const LIMITE_ENCAJE = 1000

const TRAMOS: Record<string, [number, number | null]> = {
  hasta15: [0, 15_000],
  hasta100: [15_000, 100_000],
  hasta500: [100_000, 500_000],
  mas500: [500_000, null],
}

// --- Datos -------------------------------------------------------------------------

function useLicitaciones(f: Filtros, limite: number) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    setCargando(true)
    let q = supabase.from('licitaciones').select(COLUMNAS_FILA, { count: 'exact' })
    if (f.plazo !== 'todas') q = q.eq('estado', 'PUB').gte('fecha_limite', hoyISO())
    if (f.plazo === 'semana') {
      const d = new Date()
      d.setDate(d.getDate() + 7)
      q = q.lte('fecha_limite', d.toLocaleDateString('sv-SE'))
    }
    if (f.ccaa) q = q.like('nuts', `${f.ccaa}%`)
    if (f.importe) {
      const [min, max] = TRAMOS[f.importe]
      q = q.gte('presupuesto_sin_iva', min)
      if (max != null) q = q.lt('presupuesto_sin_iva', max)
    }
    if (f.q.trim()) q = q.textSearch('busqueda', f.q.trim(), { type: 'websearch', config: 'spanish' })
    q = q.order('fecha_limite', { ascending: f.plazo !== 'todas', nullsFirst: false }).range(0, limite - 1)

    q.then(({ data, count, error }) => {
      if (!vigente) return
      setError(error ? error.message : null)
      setFilas((data as Fila[] | null) ?? [])
      setTotal(count ?? null)
      setCargando(false)
    })
    return () => { vigente = false }
  }, [f.q, f.ccaa, f.importe, f.plazo, limite])

  return { filas, total, cargando, error }
}

function usePerfil() {
  const [perfil, setPerfil] = useState<Perfil | null>(cargarPerfil)
  const cambiar = (p: Perfil | null) => { setPerfil(p); guardarPerfil(p) }
  return [perfil, cambiar] as const
}

function useUltimaIngesta() {
  const [hasta, setHasta] = useState<string | null>(null)
  useEffect(() => {
    supabase.from('ingestas').select('hasta').is('error', null).not('hasta', 'is', null)
      .order('hasta', { ascending: false }).limit(1)
      .then(({ data }) => setHasta(data?.[0]?.hasta ?? null))
  }, [])
  return hasta
}

// La ficha abierta vive en la URL (#/l/<id>): se puede enlazar y el botón atrás la cierra
function useFichaAbierta() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const cambio = () => setHash(location.hash)
    addEventListener('hashchange', cambio)
    return () => removeEventListener('hashchange', cambio)
  }, [])
  const id = useMemo(() => hash.match(/^#\/l\/(\w+)/)?.[1] ?? null, [hash])
  const abrir = (nuevo: string) => { location.hash = `/l/${nuevo}` }
  const cerrar = useCallback(() => {
    history.pushState(null, '', location.pathname + location.search)
    setHash('')
  }, [])
  return { id, abrir, cerrar }
}

// --- Piezas ------------------------------------------------------------------------

// Reloj de panel de salidas: HH:MM con los dos puntos latiendo. El latido es CSS; React solo
// repinta cuando cambia el minuto.
function Reloj() {
  const [ahora, setAhora] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 5000)
    return () => clearInterval(t)
  }, [])
  const hh = String(ahora.getHours()).padStart(2, '0')
  const mm = String(ahora.getMinutes()).padStart(2, '0')
  return (
    <time className="reloj" dateTime={`${hh}:${mm}`} aria-label={`Son las ${hh}:${mm}`}>
      {hh}<span className="reloj-puntos">:</span>{mm}
    </time>
  )
}

function Dias({ fecha, estado }: { fecha: string | null; estado: string | null }) {
  const d = diasRestantes(fecha)
  if (d == null) return <span className="dias dias-nada">—</span>
  if (d < 0 || estado !== 'PUB') return <span className="dias dias-cerrada">{ESTADOS[estado ?? ''] ?? 'Cerrada'}</span>
  return (
    <span className={d <= 3 ? 'dias dias-urgente' : 'dias'}>
      <b>{d === 0 ? 'Hoy' : d}</b>
      {d > 0 && <small>{d === 1 ? 'día' : 'días'}</small>}
    </span>
  )
}

function Filtrado({ f, set, total, conPerfil }: { f: Filtros; set: (f: Filtros) => void; total: number | null; conPerfil: boolean }) {
  const [texto, setTexto] = useState(f.q)
  // La búsqueda espera a que se deje de teclear: cada consulta es un viaje a Postgres
  useEffect(() => {
    const t = setTimeout(() => { if (texto !== f.q) set({ ...f, q: texto }) }, 350)
    return () => clearTimeout(t)
  }, [texto]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <form className={conPerfil ? 'filtros filtros-encaje' : 'filtros'} onSubmit={(e) => e.preventDefault()}>
      <label className="filtro filtro-busqueda">
        <span>Buscar</span>
        <input type="search" value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="ciberseguridad, licencias, desarrollo web…" />
      </label>
      <label className="filtro">
        <span>Plazo</span>
        <select value={f.plazo} onChange={(e) => set({ ...f, plazo: e.target.value as Plazo })}>
          <option value="abiertas">Abiertas</option>
          <option value="semana">Cierran en 7 días</option>
          <option value="todas">Todas</option>
        </select>
      </label>
      <label className="filtro">
        <span>Comunidad</span>
        <select value={f.ccaa} onChange={(e) => set({ ...f, ccaa: e.target.value })}>
          <option value="">Toda España</option>
          {Object.entries(COMUNIDADES).sort((a, b) => a[1].localeCompare(b[1], 'es'))
            .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="filtro">
        <span>Presupuesto sin IVA</span>
        <select value={f.importe} onChange={(e) => set({ ...f, importe: e.target.value })}>
          <option value="">Cualquiera</option>
          <option value="hasta15">Hasta 15.000 €</option>
          <option value="hasta100">15.000 a 100.000 €</option>
          <option value="hasta500">100.000 a 500.000 €</option>
          <option value="mas500">Más de 500.000 €</option>
        </select>
      </label>
      {conPerfil && (
        <label className="filtro">
          <span>Encaje</span>
          <select value={f.encaje} onChange={(e) => set({ ...f, encaje: e.target.value as FiltroEncaje })}>
            <option value="">Todas</option>
            <option value="actividad">De tu actividad</option>
            <option value="posibles">Encajas o por revisar</option>
            <option value="encaja">Solo las que encajas</option>
          </select>
        </label>
      )}
      <output className="filtros-total">
        {total == null ? '…' : total.toLocaleString('es-ES')}
        <small>{total === 1 ? 'licitación' : 'licitaciones'}</small>
      </output>
    </form>
  )
}

function Panel({ filas, onAbrir, encajes }: { filas: Fila[]; onAbrir: (id: string) => void; encajes: Map<string, Encaje> | null }) {
  return (
    <ol className="panel">
      <li className="panel-cabecera" aria-hidden>
        <span>Cierra</span><span>Quedan</span><span>Licitación</span><span>Lugar</span><span className="num">Importe</span>
      </li>
      {filas.map((l, i) => (
        <li key={l.id} className="panel-fila" style={{ animationDelay: `${Math.min(i, 20) * 22}ms` }}>
          <button onClick={() => onAbrir(l.id)}>
            <span className="panel-fecha num">{fechaCorta(l.fecha_limite)}</span>
            <Dias fecha={l.fecha_limite} estado={l.estado} />
            <span className="panel-titulo">
              <strong>{l.titulo}</strong>
              <em>
                {encajes?.get(l.id) && <MarcaEncaje v={encajes.get(l.id)!.veredicto} />}
                {l.extracciones?.estado === 'hecha' && <span className="leido">Pliego leído</span>}
                {l.organo}
              </em>
            </span>
            <span className="panel-lugar">
              {comunidad(l.nuts)}
              {l.lugar && comunidad(l.nuts) !== l.lugar && <small>{l.lugar}</small>}
            </span>
            <span className="panel-importe num">{importeCorto(l.presupuesto_sin_iva)}</span>
          </button>
        </li>
      ))}
    </ol>
  )
}

// Página del PDF: los visores de PDF de los navegadores entienden #page=N
function Pagina({ pdf, n, cita }: { pdf: string | null; n: number; cita: string }) {
  return (
    <details className="fuente">
      <summary>
        {pdf ? <a href={`${pdf}#page=${n}`} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>p. {n}</a> : `p. ${n}`}
        <span className="fuente-ver">cita</span>
      </summary>
      <blockquote>«{cita}»</blockquote>
    </details>
  )
}

function LoQuePide({ x, pdf }: { x: Extraccion | null | undefined; pdf: string | null }) {
  if (x === undefined) return <p className="cargando">Buscando la lectura del pliego…</p>
  if (x === null) return <p className="vacio">El pliego de esta licitación aún no se ha leído.</p>
  if (x.estado === 'escaneado') return <p className="vacio">El pliego es un PDF escaneado, sin texto que leer.</p>
  if (x.estado !== 'hecha') return <p className="vacio">No se pudo leer el pliego.</p>

  const r = x.requisitos
  const vacio = !Object.values(r).some((xs) => xs?.length)
  return (
    <>
      <p className="lectura-nota">
        Leído en local por <b>{x.modelo}</b>. Cada dato lleva su página y una cita que el código ha
        comprobado en el pliego; lo que no se pudo comprobar se descartó
        {x.descartados ? ` (${x.descartados} ${x.descartados === 1 ? 'dato' : 'datos'})` : ''}.
      </p>
      {vacio && <p className="vacio">No quedó ningún requisito comprobable.</p>}

      {!!r.solvencia_economica?.length && (
        <div className="requisito-grupo">
          <h4>Solvencia económica</h4>
          <ul>
            {r.solvencia_economica.map((s, i) => (
              <li key={i}>
                <div className="requisito-cabeza">
                  <strong>{s.medio}</strong>
                  {s.umbral_eur != null && <span className="umbral num">{importe(s.umbral_eur)}</span>}
                </div>
                {s.descripcion !== s.medio && <p>{s.descripcion}</p>}
                <Pagina pdf={pdf} n={s.pagina} cita={s.cita} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!r.solvencia_tecnica?.length && (
        <div className="requisito-grupo">
          <h4>Solvencia técnica</h4>
          <ul>
            {r.solvencia_tecnica.map((s, i) => (
              <li key={i}>
                <div className="requisito-cabeza"><strong>{s.medio}</strong></div>
                {s.descripcion !== s.medio && <p>{s.descripcion}</p>}
                <Pagina pdf={pdf} n={s.pagina} cita={s.cita} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!r.clasificacion_empresarial?.length && (
        <div className="requisito-grupo">
          <h4>Clasificación empresarial</h4>
          <ul>
            {r.clasificacion_empresarial.map((c, i) => (
              <li key={i}>
                <div className="requisito-cabeza">
                  <strong className="num">
                    Grupo {c.grupo}{c.subgrupo ? `, subgrupo ${c.subgrupo}` : ''}{c.categoria ? `, categoría ${c.categoria}` : ''}
                  </strong>
                </div>
                <p>{c.sustituye_solvencia ? 'Sustituye a la solvencia' : 'Exigida'}</p>
                <Pagina pdf={pdf} n={c.pagina} cita={c.cita} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!r.certificaciones_exigidas?.length && (
        <div className="requisito-grupo">
          <h4>Certificaciones</h4>
          <ul className="certificaciones">
            {r.certificaciones_exigidas.map((c, i) => (
              <li key={i}>
                <strong>{c.nombre}</strong>
                <Pagina pdf={pdf} n={c.pagina} cita={c.cita} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!r.adscripcion_medios?.length && (
        <div className="requisito-grupo">
          <h4>Medios que hay que adscribir</h4>
          <ul>
            {r.adscripcion_medios.map((m, i) => (
              <li key={i}>
                <div className="requisito-cabeza"><strong>{m.perfil}</strong></div>
                <p>{m.requisitos}</p>
                <Pagina pdf={pdf} n={m.pagina} cita={m.cita} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!!r.criterios_adjudicacion?.length && (
        <div className="requisito-grupo">
          <h4>Criterios de adjudicación</h4>
          <ul>
            {r.criterios_adjudicacion.map((c, i) => (
              <li key={i}>
                <div className="requisito-cabeza">
                  <strong>{c.nombre}</strong>
                  {c.peso != null && <span className="umbral num">{c.peso}</span>}
                </div>
                <Pagina pdf={pdf} n={c.pagina} cita={c.cita} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

// --- Encaje con el perfil de empresa --------------------------------------------------

const VEREDICTOS: Record<Veredicto, string> = { encaja: 'Encajas', revisa: 'Revisar', no: 'No llegas' }

function MarcaEncaje({ v }: { v: Veredicto }) {
  return <span className={`encaje encaje-${v}`}>{VEREDICTOS[v]}</span>
}

const ICONOS = { ok: '✓', no: '✕', duda: '?', info: 'i' } as const

function PuedesPresentarte({ encaje, perfil, pdf }: { encaje: Encaje; perfil: Perfil; pdf: string | null }) {
  return (
    <section className={`presentarte presentarte-${encaje.veredicto}`}>
      <h3>
        ¿Puedes presentarte? <MarcaEncaje v={encaje.veredicto} />
      </h3>
      <p className="presentarte-perfil">Con el perfil «{perfil.nombre}». Reglas fijas sobre los datos del pliego, no una opinión del modelo.</p>
      <ul className="comprobaciones">
        {encaje.comprobaciones.map((c, i) => (
          <li key={i} className={`comprobacion comprobacion-${c.estado}`}>
            <span className="comprobacion-icono" aria-hidden>{ICONOS[c.estado]}</span>
            <span>
              <b>{c.tema}.</b> {c.texto}
              {c.fuente && <Pagina pdf={pdf} n={c.fuente.pagina} cita={c.fuente.cita} />}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

const PERFIL_VACIO: Perfil = { id: 'propio', nombre: 'Mi empresa', facturacion: null, familias: [], certificaciones: [], clasificaciones: [] }

function SelectorPerfil({ perfil, set, onEditar }: { perfil: Perfil | null; set: (p: Perfil | null) => void; onEditar: () => void }) {
  const propio = perfil?.id === 'propio' ? perfil : null
  return (
    <div className="selector-perfil">
      <label>
        <span>Empresa</span>
        <select value={perfil?.id ?? ''} onChange={(e) => {
          const id = e.target.value
          if (!id) set(null)
          else if (id === 'propio') set(propio ?? PERFIL_VACIO)
          else set(PERFILES_DEMO.find((p) => p.id === id) ?? null)
        }}>
          <option value="">Sin perfil</option>
          {PERFILES_DEMO.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          <option value="propio">{propio?.nombre ?? 'Mi empresa'}</option>
        </select>
      </label>
      <button type="button" onClick={onEditar}>{perfil ? 'Editar' : 'Crear perfil'}</button>
    </div>
  )
}

function EditorPerfil({ inicial, onGuardar, onCerrar }: { inicial: Perfil; onGuardar: (p: Perfil) => void; onCerrar: () => void }) {
  // Editar un ejemplo lo convierte en el perfil propio: los ejemplos no se tocan
  const [p, setP] = useState<Perfil>({ ...inicial, id: 'propio', nombre: inicial.id === 'propio' ? inicial.nombre : 'Mi empresa' })
  const alternar = (lista: string[], v: string) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v])
  const [clasif, setClasif] = useState(p.clasificaciones.map((c) => `${c.grupo}-${c.subgrupo}-${c.categoria}`).join(', '))

  const guardar = () => {
    const clasificaciones = clasif.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
      .map((t) => t.split(/[-\s]+/)).filter((x) => /^[A-V]$/.test(x[0] ?? ''))
      .map(([grupo, subgrupo = '', categoria = '']) => ({ grupo, subgrupo, categoria }))
    onGuardar({ ...p, clasificaciones })
  }

  return (
    <div className="ficha-fondo" onClick={onCerrar}>
      <form className="ficha editor" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); guardar() }}>
        <button type="button" className="ficha-cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        <h2>Perfil de empresa</h2>
        <p className="ficha-meta">Se guarda solo en este navegador.</p>

        <label className="filtro">
          <span>Nombre</span>
          <input value={p.nombre} onChange={(e) => setP({ ...p, nombre: e.target.value })} />
        </label>
        <label className="filtro">
          <span>Volumen anual de negocios (mejor de los tres últimos años), en euros</span>
          <input type="number" min={0} step={1000} value={p.facturacion ?? ''}
            onChange={(e) => setP({ ...p, facturacion: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>

        <fieldset>
          <legend>Actividad (familias de CPV)</legend>
          {Object.entries(FAMILIAS).map(([k, v]) => (
            <label key={k} className="casilla">
              <input type="checkbox" checked={p.familias.includes(k)} onChange={() => setP({ ...p, familias: alternar(p.familias, k) })} />
              {v} <small>{k}</small>
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>Certificaciones</legend>
          {Object.entries(CERTIFICACIONES).map(([k, v]) => (
            <label key={k} className="casilla">
              <input type="checkbox" checked={p.certificaciones.includes(k)}
                onChange={() => setP({ ...p, certificaciones: alternar(p.certificaciones, k) })} />
              {v}
            </label>
          ))}
        </fieldset>

        <label className="filtro">
          <span>Clasificación (grupo-subgrupo-categoría, separadas por comas)</span>
          <input value={clasif} onChange={(e) => setClasif(e.target.value)} placeholder="V-2-3, V-5-2" />
        </label>

        <button className="mas" type="submit">Guardar perfil</button>
      </form>
    </div>
  )
}

const COLUMNAS_FICHA = `${COLUMNAS_FILA},expediente,tipo_contrato,garantia_definitiva_pct,` +
  'lotes,enlace,pcap_url,ppt_url,criterios,solvencia_economica,solvencia_tecnica,publicada,actualizado'

function Ficha({ id, onCerrar, perfil }: { id: string; onCerrar: () => void; perfil: Perfil | null }) {
  const [l, setL] = useState<Licitacion | null>(null)
  const [error, setError] = useState<string | null>(null)
  // undefined: cargando · null: sin leer
  const [lectura, setLectura] = useState<Extraccion | null | undefined>(undefined)

  useEffect(() => {
    setLectura(undefined)
    supabase.from('extracciones').select('estado,modelo,requisitos,aceptados,descartados,paginas_total,fecha')
      .eq('licitacion_id', id).maybeSingle()
      .then(({ data }) => setLectura((data as Extraccion | null) ?? null))
  }, [id])

  useEffect(() => {
    setL(null)
    setError(null)
    supabase.from('licitaciones').select(COLUMNAS_FICHA).eq('id', id).maybeSingle()
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else if (!data) setError('Esta licitación no está en el radar.')
        else setL(data as unknown as Licitacion)
      })
  }, [id])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    addEventListener('keydown', esc)
    return () => removeEventListener('keydown', esc)
  }, [onCerrar])

  const pesoTotal = l?.criterios.reduce((n, c) => n + (c.peso ?? 0), 0) ?? 0

  return (
    <div className="ficha-fondo" onClick={onCerrar}>
      <article className="ficha" onClick={(e) => e.stopPropagation()} aria-labelledby="ficha-titulo">
        <button className="ficha-cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        {error && <p className="aviso">{error}</p>}
        {!l && !error && <p className="cargando">Cargando…</p>}
        {l && (
          <>
            <header className="ficha-cabecera">
              <Dias fecha={l.fecha_limite} estado={l.estado} />
              <div>
                <p className="ficha-organo">{l.organo}</p>
                <h2 id="ficha-titulo">{l.titulo}</h2>
                <p className="ficha-meta">
                  Exp. {l.expediente ?? '—'} · {TIPOS_CONTRATO[l.tipo_contrato ?? ''] ?? 'Contrato'} ·{' '}
                  {comunidad(l.nuts)}{l.lugar && l.lugar !== comunidad(l.nuts) ? ` (${l.lugar})` : ''}
                </p>
              </div>
            </header>

            <dl className="ficha-cifras">
              <div><dt>Presupuesto sin IVA</dt><dd className="num">{importe(l.presupuesto_sin_iva)}</dd></div>
              <div><dt>Valor estimado</dt><dd className="num">{importe(l.valor_estimado)}</dd></div>
              <div><dt>Duración</dt><dd>{duracion(l.duracion)}</dd></div>
              <div><dt>Fin del plazo</dt><dd>{fechaLarga(l.fecha_limite)}</dd></div>
              <div><dt>Garantía definitiva</dt><dd>{l.garantia_definitiva_pct != null ? `${l.garantia_definitiva_pct.toLocaleString('es-ES')} %` : '—'}</dd></div>
              <div><dt>Lotes</dt><dd>{l.lotes || 'Sin lotes'}</dd></div>
            </dl>

            {perfil && lectura !== undefined && (
              <PuedesPresentarte encaje={evaluar(l, lectura, perfil)} perfil={perfil} pdf={l.pcap_url} />
            )}

            <section>
              <h3>Criterios de adjudicación</h3>
              {l.criterios.length === 0 ? <p className="vacio">El feed no los trae: están en el pliego.</p> : (
                <ul className="criterios">
                  {l.criterios.map((c, i) => (
                    <li key={i}>
                      <span className="criterio-nombre">
                        {c.descripcion}
                        <small>{c.tipo === 'SUBJ' ? 'juicio de valor' : 'fórmula'}</small>
                      </span>
                      <span className="criterio-barra">
                        <i style={{ width: `${pesoTotal ? ((c.peso ?? 0) / pesoTotal) * 100 : 0}%` }}
                          className={c.tipo === 'SUBJ' ? 'subjetivo' : ''} />
                      </span>
                      <span className="criterio-peso num">{c.peso ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="lectura">
              <h3>Lo que pide el pliego</h3>
              <LoQuePide x={lectura} pdf={l.pcap_url} />
            </section>

            <section className="ficha-solvencia">
              <div>
                <h3>Solvencia económica según el anuncio</h3>
                {l.solvencia_economica.length ? <ul>{l.solvencia_economica.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  : <p className="vacio">Sin detalle en el feed.</p>}
              </div>
              <div>
                <h3>Solvencia técnica según el anuncio</h3>
                {l.solvencia_tecnica.length ? <ul>{l.solvencia_tecnica.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  : <p className="vacio">Sin detalle en el feed.</p>}
              </div>
            </section>

            <section>
              <h3>Documentos</h3>
              <p className="ficha-enlaces">
                {l.pcap_url && <a href={l.pcap_url} target="_blank" rel="noreferrer">Pliego administrativo (PCAP)</a>}
                {l.ppt_url && <a href={l.ppt_url} target="_blank" rel="noreferrer">Pliego técnico (PPT)</a>}
                {l.enlace && <a href={l.enlace} target="_blank" rel="noreferrer">Ficha en la Plataforma de Contratación</a>}
              </p>
              <p className="ficha-cpv">CPV {l.cpvs.join(' · ')}</p>
            </section>
          </>
        )}
      </article>
    </div>
  )
}

// --- Página ------------------------------------------------------------------------

export default function App() {
  const [f, setF] = useState<Filtros>({ q: '', ccaa: '', importe: '', plazo: 'abiertas', encaje: '' })
  const [limite, setLimite] = useState(POR_PAGINA)
  const [perfil, setPerfil] = usePerfil()
  const [editando, setEditando] = useState(false)
  const filtraEncaje = !!perfil && f.encaje !== ''
  const { filas: traidas, total: totalServidor, cargando, error } = useLicitaciones(f, filtraEncaje ? LIMITE_ENCAJE : limite)
  const hasta = useUltimaIngesta()
  const ficha = useFichaAbierta()

  // El encaje de cada fila se calcula aquí, con los requisitos que trae la consulta
  const encajes = useMemo(
    () => (perfil ? new Map(traidas.map((l) => [l.id, evaluar(l, l.extracciones, perfil)])) : null),
    [traidas, perfil])
  const filtradas = useMemo(() => {
    if (!filtraEncaje || !encajes || !perfil) return traidas
    return traidas.filter((l) => {
      if (!esDeTuActividad(l, perfil)) return false
      const v = encajes.get(l.id)!.veredicto
      return f.encaje === 'actividad' || (f.encaje === 'encaja' ? v === 'encaja' : v !== 'no')
    })
  }, [traidas, encajes, filtraEncaje, f.encaje, perfil])
  const filas = filtraEncaje ? filtradas.slice(0, limite) : filtradas
  const total = filtraEncaje ? filtradas.length : totalServidor

  const cambiar = (nuevo: Filtros) => { setF(nuevo); setLimite(POR_PAGINA) }
  const cambiarPerfil = (p: Perfil | null) => {
    setPerfil(p)
    if (!p && f.encaje) cambiar({ ...f, encaje: '' })
  }

  return (
    <>
      <header className="cabecera">
        <div className="cabecera-marca">
          <Reloj />
          <div>
            <h1>Radar de licitaciones</h1>
            <p>Contratos públicos de tecnología en España, ordenados por lo que cierra antes.</p>
          </div>
        </div>
        <div className="cabecera-lado">
          <SelectorPerfil perfil={perfil} set={cambiarPerfil} onEditar={() => setEditando(true)} />
          <p className="cabecera-datos">
            Plataforma de Contratación del Sector Público
            <b>{hasta ? `datos hasta el ${fechaLarga(hasta)}` : '…'}</b>
          </p>
        </div>
      </header>

      <main>
        <Filtrado f={f} set={cambiar} total={total} conPerfil={!!perfil} />
        {error && <p className="aviso">No se pudo consultar: {error}</p>}
        {!error && !cargando && filas.length === 0 && <p className="vacio vacio-grande">Nada con esos filtros.</p>}
        <div className={cargando ? 'panel-envoltorio cargando-panel' : 'panel-envoltorio'}>
          <Panel filas={filas} onAbrir={ficha.abrir} encajes={encajes} />
        </div>
        {total != null && filas.length < total && (
          <button className="mas" onClick={() => setLimite(limite + POR_PAGINA)}>
            Ver {Math.min(POR_PAGINA, total - filas.length)} más
          </button>
        )}
      </main>

      <footer className="pie">
        <p>Solo servicios TI y software (CPV 72 y 48). Datos abiertos de la Plataforma de Contratación, reutilizados conforme a la Ley 37/2007.</p>
        <p>Un proyecto de <a href="https://alvaroalcaraz.com">Álvaro Alcaraz</a>.</p>
      </footer>

      {ficha.id && <Ficha id={ficha.id} onCerrar={ficha.cerrar} perfil={perfil} />}
      {editando && (
        <EditorPerfil inicial={perfil ?? PERFIL_VACIO} onCerrar={() => setEditando(false)}
          onGuardar={(p) => { cambiarPerfil(p); setEditando(false) }} />
      )}
    </>
  )
}
