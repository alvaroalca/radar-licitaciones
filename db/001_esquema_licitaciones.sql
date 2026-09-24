-- Esquema `licitaciones`: el radar de licitaciones públicas de TI.
-- Aplicado sobre alcaten-dev, el Postgres multiusos: un esquema propio, nunca tablas en
-- `public` (convención del proyecto: identity, training, flota, trading...).
--
-- Se aplica directamente (execute_sql o psql), NO con `supabase db push` ni `apply_migration`:
-- esos registran la versión en supabase_migrations del proyecto, y Alcaten, que es el dueño de
-- ese historial, dejaría de poder hacer push.
--
-- Quién hace qué:
--  - El motor (rol `radar_motor`, ver 002) escribe por conexión directa de Postgres.
--  - La web lee por PostgREST con la clave pública: RLS con política de solo lectura.
--    Requiere tener `licitaciones` en los esquemas expuestos de la API del proyecto.

create schema if not exists licitaciones;

-- ---------------------------------------------------------------------------
-- licitaciones: el estado más reciente de cada licitación de TI, tal como lo da el feed.
-- Solo TI (algún CPV 72 o 48): unas 560 al mes. El filtro por CPV principal se descartó
-- tras medirlo: no quita el ruido y sí quita TI real (24/09/2026, ver docs/STATUS.md).
-- ---------------------------------------------------------------------------
create table licitaciones.licitaciones (
    id                       text primary key,              -- id numérico de PLACSP
    expediente               text,
    titulo                   text        not null,
    estado                   text,                          -- PRE, PUB, EV, ADJ, RES, ANUL
    organo                   text,
    tipo_contrato            text,                          -- 1 suministros, 2 servicios...
    presupuesto_sin_iva      numeric(16, 2),
    valor_estimado           numeric(16, 2),
    duracion                 text,                          -- "12 MON", "2 ANN", "75 DAY"
    garantia_definitiva_pct  numeric(6, 2),
    cpvs                     text[]      not null,
    lotes                    integer     not null default 0,
    lugar                    text,
    nuts                     text,
    fecha_limite             date,
    enlace                   text,
    pcap_url                 text,
    ppt_url                  text,
    -- Lo que el feed trae estructurado. En jsonb y no en tablas aparte: la web lo lee entero
    -- con la ficha y así se evitan los embeds entre esquemas de PostgREST (PGRST200).
    criterios                jsonb       not null default '[]',
    solvencia_economica      text[]      not null default '{}',
    solvencia_tecnica        text[]      not null default '{}',
    -- <updated> de la entrada aplicada: una entrada más vieja nunca pisa a una más nueva
    actualizado              timestamptz not null,
    -- Primera vez que el radar vio la licitación publicada (estado PUB)
    publicada                timestamptz,
    busqueda                 tsvector generated always as (
        to_tsvector('spanish', coalesce(titulo, '') || ' ' || coalesce(organo, ''))
    ) stored
);

create index licitaciones_fecha_limite on licitaciones.licitaciones (fecha_limite);
create index licitaciones_estado       on licitaciones.licitaciones (estado);
create index licitaciones_nuts         on licitaciones.licitaciones (nuts);
create index licitaciones_busqueda     on licitaciones.licitaciones using gin (busqueda);
create index licitaciones_cpvs         on licitaciones.licitaciones using gin (cpvs);

-- ---------------------------------------------------------------------------
-- ingestas: una fila por ejecución del motor. Es lo que le deja retomar donde lo dejó:
-- si el ETag del ZIP no ha cambiado desde la última ingesta buena, no se descarga.
-- La web la lee para enseñar "datos hasta el día X".
-- ---------------------------------------------------------------------------
create table licitaciones.ingestas (
    id            bigint generated always as identity primary key,
    fuente        text        not null,     -- mes del ZIP, AAAAMM
    etag          text,
    inicio        timestamptz not null default now(),
    fin           timestamptz,
    entradas      integer,                  -- entradas del ZIP
    ti            integer,                  -- licitaciones de TI distintas en el ZIP
    nuevas        integer,
    actualizadas  integer,
    hasta         timestamptz,              -- <updated> más reciente visto
    error         text
);

-- ---------------------------------------------------------------------------
-- Seguridad. RLS explícito: el "automatic RLS" del proyecto solo cubre `public`.
-- ---------------------------------------------------------------------------
alter table licitaciones.licitaciones enable row level security;
alter table licitaciones.ingestas     enable row level security;

grant usage on schema licitaciones to anon, authenticated;
grant select on licitaciones.licitaciones, licitaciones.ingestas to anon, authenticated;

-- Todo lo que hay aquí es información pública de PLACSP: se lee sin sesión
create policy lectura_publica on licitaciones.licitaciones for select to anon, authenticated using (true);
create policy lectura_publica on licitaciones.ingestas     for select to anon, authenticated using (true);
