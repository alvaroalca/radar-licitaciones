# CLAUDE.md — Radar de licitaciones

Radar de licitaciones públicas para PYMEs: lee el feed abierto de la Plataforma de Contratación del Sector Público (PLACSP), analiza los pliegos con un LLM y dice a cada empresa qué concursos le encajan y qué le exigen. Pieza de portfolio con vocación de ser útil de verdad. Estado vivo en `docs/STATUS.md`.

## Decisiones cerradas (24/09/2026)

- **Stack:** React (Vite) + Node en TypeScript. Node 24 ejecuta `.ts` directamente, sin build: los imports llevan extensión `.ts` y solo vale sintaxis borrable (`erasableSyntaxOnly`).
- **El LLM lee, el código decide.** El LLM extrae campos del pliego, cada uno con la página de donde sale. El "encaja / no encaja" lo calculan reglas deterministas. Evals con pliegos anotados a mano, incluido un control negativo: un dato que el pliego no pide sale `null`, nunca inventado.
- **El lector es el LLM que prefiera cada cual** (25/09/2026). Hay dos vías:
  - En directo con Ollama (`qwen3:4b` cabe en 8 GB). Números y trampas en `docs/STATUS.md`.
  - Con cualquier otro LLM, en dos pasos: `--preparar` deja instrucciones y páginas en `data/lectura/<id>.txt`, el lector escribe `<id>.json` y `--importar` lo valida y lo guarda.
  - **En este proyecto lee Claude**, para no cargar la GPU de Álvaro, con `node scripts/lector/claude.ts`: una llamada `claude -p` por pliego. **Nunca con subagentes en lote**, que reenvían su contexto en cada turno y gastaron unas 30 veces lo necesario (25/09/2026). La promo y el portfolio dicen que el LLM es intercambiable.
  - Al pliego no se le manda entero: se seleccionan sus páginas relevantes (`src/pliegos/paginas.ts`).
- **Alcance v1:** servicios TI (CPV 72 y 48), toda España.
- **Escaparate siempre encendido, motor encendible.** La web es estática y lee de Supabase en solo lectura, así que funciona con el motor apagado. El motor (Node: ingesta y lectura de pliegos) se enciende cuando se quiere y al arrancar retoma desde la última actualización vista.
- **Base de datos:** esquema `licitaciones` en `alcaten-dev`, con su propio rol de Postgres. Nada en `public`.
  - **El SQL vive en `db/` y se aplica directamente** (MCP `execute_sql` o SQL Editor), nunca con `supabase db push` ni con `apply_migration`. Esos registran la versión en el historial de migraciones de alcaten-dev, que es de Alcaten, y su siguiente `db push` fallaría.
  - **El motor escribe con el rol `radar_motor`** por el pooler de sesión (`RADAR_DSN` en `.env`, ver `.env.ejemplo`). ⚠️ El host es **`aws-1-eu-north-1`**. Con `aws-0` el pooler responde `tenant/user … not found`, aunque la cadena de bot-trading use `aws-0`. RLS activado, con una política `motor_escribe` por tabla. Mismo patrón que `bot_trading`.
  - **La contraseña del rol no pasa por la IA:** la pone Álvaro en el SQL Editor a partir del `.env`.
  - **La web lee con la clave publicable** (`web/.env.local`) y la política `lectura_publica`. Requiere que `licitaciones` esté entre los esquemas expuestos de la Data API.
- **Fuente de la ingesta:** el ZIP del mes en curso, que PLACSP regenera cada madrugada con unos 3 días de retraso. Se descarga condicionado al ETag. El feed Atom en directo no sirve: el 24/09 su página raíz seguía en el 08/09.
- **Filtro TI = algún CPV 72 o 48** (`src/placsp/ti.ts`). El CPV principal no quita el ruido y sí quita TI real (medido). La relevancia es cosa del perfil de cada empresa, no de la ingesta.
- **Encaje (fase 3):** el perfil de empresa vive en el navegador (`localStorage`, sin login) con tres ejemplos ficticios. El veredicto sale de reglas fijas en `web/src/lib/encaje.ts`, incluida la referencia legal de la LCSP (art. 87.3 a) cuando el pliego no fija el volumen de negocio.
- **Web:** React + Vite en `web/`, solo en localhost (para demos y el vídeo). Referencia visual: los paneles de salidas de los ferrocarriles suizos (SBB). Blanco, azul `#2D327D`, rojo `#EB0000` solo para lo que cierra en 3 días o menos, y Barlow Condensed.

## Reglas de acceso a PLACSP

- `contrataciondelestado.es` tiene `robots.txt` con `User-agent: * / Disallow: /` (genérico, no nombra a nadie). **El feed Atom y los ZIP mensuales son el canal de reutilización publicado: esos se leen.**
- **Nunca se recorre HTML del portal.** Los pliegos (PDF) se bajan **solo** para licitaciones de TI abiertas (`npm run extraer`), o una concreta con `--id`. Siempre con caché, pausa entre descargas y el user-agent `radar-licitaciones/<versión> (+https://alvaroalcaraz.com)`.

## Datos del feed (verificado)

- Atom con CODICE 2.07, unas 500 entradas y ~16 MB por página, paginado con `rel="next"`. Cada entrada es **una actualización**: la misma licitación reaparece con cada cambio de estado (`PRE`, `PUB`, `EV`, `ADJ`, `RES`, `ANUL`).
- El feed ya trae estructurados el CPV, el presupuesto, el plazo, los criterios de adjudicación con su peso y la descripción de la solvencia exigida. Los **umbrales concretos** (cifra de negocio mínima, clasificación, experiencia) viven en el PCAP.
- ZIP mensual: `https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3_AAAAMM.zip`.
- Parser: `src/placsp/entrada.ts`.

## Comandos

```bash
npm run motor                 # ingesta: mes en curso (y el anterior si nunca se ingirió)
npm run motor -- 202608       # meses concretos
npm run extraer               # lee con Ollama los pliegos de hasta 20 abiertas (--limite=N, --id=X)
npm run extraer -- --preparar --limite=300   # otro LLM, paso 1: data/lectura/<id>.txt
npm run extraer -- --importar                # paso 2: valida y guarda data/lectura/<id>.json (--modelo=…, por defecto claude-opus-5-5)
npm run revalidar             # reaplica los validadores a lo ya leído, sin GPU
cd web && npm run dev         # la web en local
npm run fase0 -- 202608 40   # mide un mes y una muestra de 40 pliegos TI → data/fase0/
node scripts/fase2/probar-extraccion.ts 8   # banco de extracción (RADAR_MODELO=… para otro modelo) → data/fase2/
npm run typecheck
```

`data/` está fuera de git (ZIP, pliegos cacheados e informes).
