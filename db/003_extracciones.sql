-- extracciones: lo que un modelo local leyó en el pliego administrativo (PCAP) de cada
-- licitación, ya depurado por el código (src/pliegos/validar.ts). Una fila por licitación.
-- Tabla aparte de `licitaciones` para que la ingesta del feed nunca pise una lectura.
-- Se aplica directamente, como 001 y 002 (ver la cabecera de 001).

create table licitaciones.extracciones (
    licitacion_id     text primary key references licitaciones.licitaciones (id) on delete cascade,
    estado            text not null check (estado in ('hecha', 'escaneado', 'sin_pdf', 'error')),
    -- El PCAP leído: si el órgano publica otro pliego, la URL cambia y se vuelve a leer
    pliego_url        text not null,
    modelo            text,
    -- { campo: [ { ...valores, pagina, cita } ] }, solo lo que pasó los filtros
    requisitos        jsonb not null default '{}',
    propuestos        integer,
    aceptados         integer,
    descartados       integer,
    paginas_enviadas  integer[],
    paginas_total     integer,
    segundos          numeric(8, 1),
    detalle           text,
    fecha             timestamptz not null default now()
);

alter table licitaciones.extracciones enable row level security;

grant select on licitaciones.extracciones to anon, authenticated;
create policy lectura_publica on licitaciones.extracciones for select to anon, authenticated using (true);

grant select, insert, update on licitaciones.extracciones to radar_motor;
create policy motor_escribe on licitaciones.extracciones for all to radar_motor using (true) with check (true);
