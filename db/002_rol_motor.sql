-- Rol dedicado del motor: escribe solo en el esquema `licitaciones`. Nada de contraseña
-- maestra ni de service_role para un proceso de servidor (convención de alcaten-dev; mismo
-- patrón que `bot_trading` sobre `trading`).
--
-- La contraseña NO va aquí. Se pone aparte y vive en el `.env` del repo (fuera de git):
--   alter role radar_motor password '...';
-- Conexión por el pooler de sesión (puerto 5432), usuario `radar_motor.<ref del proyecto>`, host `aws-1-eu-north-1.pooler.supabase.com` (con `aws-0` no lo encuentra).

create role radar_motor login noinherit;

grant usage on schema licitaciones to radar_motor;
grant select, insert, update on licitaciones.licitaciones, licitaciones.ingestas to radar_motor;
grant usage on all sequences in schema licitaciones to radar_motor;

-- RLS está activo y el rol no es dueño de las tablas: sin estas políticas no podría escribir
create policy motor_escribe on licitaciones.licitaciones for all to radar_motor using (true) with check (true);
create policy motor_escribe on licitaciones.ingestas     for all to radar_motor using (true) with check (true);
