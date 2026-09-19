-- =========================================================================
-- Casos 4, 5 y 6 comprobados con el identificador de usuario REAL emitido
-- por Supabase Auth (el "sub" del token JWT), que es exactamente lo que
-- auth.uid() devuelve en producción.
-- Se invoca desde tests/auth-real.sh con -v uid='<uuid>'.
-- =========================================================================
\pset tuples_only on
\pset format unaligned

set role authenticated;
select set_config('request.jwt.claim.sub', :uid, false);

insert into public.equipos (nombre, dinero_inicial, fecha_inicio, publico, owner_id)
  values ('Spartans 83-27', 10000, '2026-09-01', true, auth.uid());
select 'OK: CASO 5 · el usuario autenticado por Supabase crea su equipo';

insert into public.movimientos (equipo_id, concepto, tipo, cantidad, fecha, area, categoria, created_by)
  select id, 'Venta', 'ingreso', 2000, '2026-09-05', 'marketing', 'Merchandising', auth.uid()
  from public.equipos limit 1;
select 'OK: CASO 5 · registra movimientos bajo RLS';
select 'OK: CASO 5 · auth.uid() coincide con el "sub" del token: ' || (auth.uid() = :uid::uuid);

reset role; set role anon; select set_config('request.jwt.claim.sub', '', false);
select 'OK: CASO 4 · el visitante consulta: ' || count(*) || ' movimiento(s)' from public.movimientos;
do $$ begin
  begin
    insert into public.movimientos (equipo_id, concepto, tipo, cantidad, fecha)
      select id, 'Intruso', 'gasto', 999, '2026-09-05' from public.equipos limit 1;
    raise exception 'FALLO: el visitante pudo escribir';
  exception when insufficient_privilege then
    raise notice 'OK: CASO 4 · el visitante NO puede modificar datos protegidos';
  end;
end $$;

-- Con la sesión cerrada ya no hay identidad: RLS deja de conceder escritura.
reset role; set role authenticated; select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  begin
    insert into public.movimientos (equipo_id, concepto, tipo, cantidad, fecha)
      select id, 'SinSesion', 'gasto', 100, '2026-09-05' from public.equipos limit 1;
    raise exception 'FALLO: se pudo escribir sin sesión';
  exception when insufficient_privilege then
    raise notice 'OK: CASO 6 · cerrada la sesión, RLS deja de permitir escribir';
  end;
end $$;
reset role;
