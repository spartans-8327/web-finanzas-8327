-- =========================================================================
-- Pruebas de las políticas de seguridad (Row Level Security).
-- Simula localmente lo que Supabase provee: el esquema auth, auth.uid()
-- y los roles anon / authenticated.
-- =========================================================================
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema auth to anon, authenticated;
grant select on auth.users to anon, authenticated;

\i schema.sql

-- Dos cuentas: la del equipo y una ajena.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'equipo@spartans8327.mx'),
  ('22222222-2222-2222-2222-222222222222', 'ajeno@ejemplo.com')
on conflict do nothing;

\echo '--- Como CUENTA DEL EQUIPO ---'
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

insert into public.equipos (nombre, dinero_inicial, fecha_inicio, publico, owner_id)
  values ('Spartans 83-27', 10000, '2026-09-01', true, auth.uid());
\echo 'OK: la cuenta del equipo crea su equipo'

select 'OK: el propietario queda registrado como miembro automáticamente: ' || count(*)
  from public.equipo_miembros where user_id = auth.uid();

insert into public.movimientos (equipo_id, concepto, tipo, cantidad, fecha, area, categoria, created_by)
  select id, 'Venta', 'ingreso', 2000, '2026-09-05', 'marketing', 'Merchandising', auth.uid()
  from public.equipos limit 1;
\echo 'OK: la cuenta del equipo registra movimientos'

insert into public.compras (equipo_id, nombre, cantidad, precio_estimado, area, categoria, created_by)
  select id, 'Cable', 3, 180, 'programacion', 'Electrónica', auth.uid() from public.equipos limit 1;
\echo 'OK: la cuenta del equipo registra compras'

\echo '--- Restricciones de integridad ---'
do $$ begin
  begin
    insert into public.movimientos (equipo_id, concepto, tipo, cantidad, fecha)
      select id, 'Malo', 'gasto', -50, '2026-09-05' from public.equipos limit 1;
    raise exception 'FALLO: se aceptó una cantidad negativa';
  exception when check_violation then raise notice 'OK: la base rechaza cantidades negativas';
  end;
  begin
    insert into public.movimientos (equipo_id, concepto, tipo, cantidad, fecha, area)
      select id, 'Malo', 'gasto', 50, '2026-09-05', 'cocina' from public.equipos limit 1;
    raise exception 'FALLO: se aceptó un área inexistente';
  exception when check_violation then raise notice 'OK: la base rechaza áreas inexistentes';
  end;
  begin
    insert into public.movimientos (equipo_id, concepto, tipo, cantidad, fecha)
      select id, 'Malo', 'transferencia', 50, '2026-09-05' from public.equipos limit 1;
    raise exception 'FALLO: se aceptó un tipo inválido';
  exception when check_violation then raise notice 'OK: la base rechaza tipos de movimiento inválidos';
  end;
end $$;

\echo '--- Como VISITANTE PÚBLICO (anon) ---'
reset role; set role anon; set request.jwt.claim.sub = '';

select 'OK: el visitante LEE el equipo público: ' || count(*) from public.equipos;
select 'OK: el visitante LEE los movimientos: ' || count(*) from public.movimientos;
select 'OK: el visitante LEE las compras: ' || count(*) from public.compras;

do $$ begin
  begin
    insert into public.movimientos (equipo_id, concepto, tipo, cantidad, fecha)
      select id, 'Hackeo', 'ingreso', 999999, '2026-09-05' from public.equipos limit 1;
    raise exception 'FALLO DE SEGURIDAD: un visitante pudo crear un movimiento';
  exception when insufficient_privilege then raise notice 'OK: el visitante NO puede crear movimientos';
  end;
  begin
    update public.movimientos set cantidad = 1;
    if found then raise exception 'FALLO DE SEGURIDAD: un visitante pudo editar';
    end if;
    raise notice 'OK: el visitante NO puede editar movimientos';
  exception when insufficient_privilege then raise notice 'OK: el visitante NO puede editar movimientos';
  end;
  begin
    delete from public.movimientos;
    if found then raise exception 'FALLO DE SEGURIDAD: un visitante pudo eliminar';
    end if;
    raise notice 'OK: el visitante NO puede eliminar movimientos';
  exception when insufficient_privilege then raise notice 'OK: el visitante NO puede eliminar movimientos';
  end;
  begin
    delete from public.compras;
    if found then raise exception 'FALLO DE SEGURIDAD: un visitante pudo borrar compras';
    end if;
    raise notice 'OK: el visitante NO puede eliminar compras';
  exception when insufficient_privilege then raise notice 'OK: el visitante NO puede eliminar compras';
  end;
  begin
    update public.equipos set dinero_inicial = 0;
    if found then raise exception 'FALLO DE SEGURIDAD: un visitante pudo cambiar el saldo inicial';
    end if;
    raise notice 'OK: el visitante NO puede cambiar el dinero inicial';
  exception when insufficient_privilege then raise notice 'OK: el visitante NO puede cambiar el dinero inicial';
  end;
end $$;

\echo '--- Como OTRA CUENTA AUTENTICADA (no miembro) ---'
reset role; set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$ begin
  begin
    insert into public.movimientos (equipo_id, concepto, tipo, cantidad, fecha)
      select id, 'Intruso', 'gasto', 500, '2026-09-05' from public.equipos limit 1;
    raise exception 'FALLO DE SEGURIDAD: una cuenta ajena pudo escribir en el equipo';
  exception when insufficient_privilege then raise notice 'OK: una cuenta ajena NO puede escribir en el equipo';
  end;
  begin
    update public.compras set nombre = 'robado';
    if found then raise exception 'FALLO DE SEGURIDAD: una cuenta ajena pudo editar compras';
    end if;
    raise notice 'OK: una cuenta ajena NO puede editar las compras del equipo';
  exception when insufficient_privilege then raise notice 'OK: una cuenta ajena NO puede editar las compras del equipo';
  end;
end $$;

\echo '--- Equipo NO público: invisible para el visitante ---'
reset role; set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.equipos set publico = false;
reset role; set role anon; set request.jwt.claim.sub = '';
select 'OK: equipos visibles para el visitante cuando el equipo es privado: ' || count(*) from public.equipos;
select 'OK: movimientos visibles para el visitante cuando el equipo es privado: ' || count(*) from public.movimientos;
reset role;
\echo '--- FIN ---'

-- =========================================================================
-- §23 INDEPENDENCIA ENTRE COMPRAS Y MOVIMIENTOS A NIVEL DE BASE DE DATOS
-- =========================================================================
\echo '--- §23 Relación compra <-> movimiento ---'
reset role; set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.equipos set publico = true;

-- Ligar la compra existente con un gasto, como hace la aplicación.
with m as (
  insert into public.movimientos (equipo_id, concepto, tipo, cantidad, fecha, area, categoria, compra_id, created_by)
  select c.equipo_id, c.nombre, 'gasto', 170, '2026-09-12', c.area, c.categoria, c.id, auth.uid()
  from public.compras c limit 1
  returning id, compra_id
)
update public.compras c
   set estado = 'comprado', precio_real = 170, registrado_como_gasto = true, movimiento_id = m.id
  from m where c.id = m.compra_id;
\echo 'OK: la compra queda ligada a su movimiento'

-- Al borrar la COMPRA, el movimiento financiero debe sobrevivir.
delete from public.compras;
select 'OK: el movimiento sobrevive al borrado de la compra: ' || count(*) || ' movimiento(s)'
  from public.movimientos where tipo = 'gasto';
select 'OK: la referencia huérfana queda en NULL, no rota: ' || count(*)
  from public.movimientos where tipo = 'gasto' and compra_id is null;

-- Al borrar el MOVIMIENTO, la compra debe quedar liberada, no borrada.
insert into public.compras (equipo_id, nombre, cantidad, precio_estimado, area, categoria, created_by)
  select id, 'Tornillos', 10, 120, 'mecanica', 'Materiales', auth.uid() from public.equipos limit 1;
with m as (
  insert into public.movimientos (equipo_id, concepto, tipo, cantidad, fecha, area, categoria, compra_id, created_by)
  select c.equipo_id, c.nombre, 'gasto', 120, '2026-09-14', c.area, c.categoria, c.id, auth.uid()
  from public.compras c where c.nombre = 'Tornillos'
  returning id, compra_id
)
update public.compras c set registrado_como_gasto = true, movimiento_id = m.id
  from m where c.id = m.compra_id;
delete from public.movimientos where concepto = 'Tornillos';
select 'OK: la compra sobrevive al borrado del movimiento: ' || count(*) from public.compras;
select 'OK: la compra queda liberada (movimiento_id nulo): ' || count(*)
  from public.compras where movimiento_id is null;

-- Borrar el equipo sí debe arrastrar todo lo suyo (reiniciar datos).
delete from public.equipos;
select 'OK: reiniciar el equipo elimina sus movimientos: ' || count(*) from public.movimientos;
select 'OK: reiniciar el equipo elimina sus compras: ' || count(*) from public.compras;
reset role;
