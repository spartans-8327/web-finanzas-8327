-- =========================================================================
-- MIS FINANZAS — SPARTANS 83-27
-- Esquema de Supabase (PostgreSQL) + Row Level Security
--
-- Ejecutar completo en:  Supabase → SQL Editor → New query → Run
-- Es idempotente: se puede volver a ejecutar sin romper nada.
-- =========================================================================

-- ------------------------------------------------------------------------
-- 1. TABLA: equipos (configuración financiera)
--    Una fila por equipo. Hoy existe una sola (Spartans 83-27), pero la
--    estructura permite agregar más equipos y más usuarios sin rehacer
--    la aplicación.
-- ------------------------------------------------------------------------
create table if not exists public.equipos (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null default 'Spartans 83-27',
  dinero_inicial numeric(14,2) not null default 0 check (dinero_inicial >= 0),
  fecha_inicio   date not null default current_date,
  publico        boolean not null default true,   -- permite la consulta pública de solo lectura
  owner_id       uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);

-- ------------------------------------------------------------------------
-- 2. TABLA: equipo_miembros (quién puede editar)
--    Permite agregar más usuarios autorizados en el futuro.
-- ------------------------------------------------------------------------
create table if not exists public.equipo_miembros (
  equipo_id  uuid not null references public.equipos(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  rol        text not null default 'editor' check (rol in ('propietario', 'editor')),
  created_at timestamptz not null default now(),
  primary key (equipo_id, user_id)
);

-- ------------------------------------------------------------------------
-- 3. TABLA: movimientos
-- ------------------------------------------------------------------------
create table if not exists public.movimientos (
  id          uuid primary key default gen_random_uuid(),
  equipo_id   uuid not null references public.equipos(id) on delete cascade,
  concepto    text not null check (length(trim(concepto)) > 0),
  tipo        text not null check (tipo in ('ingreso', 'gasto')),
  cantidad    numeric(14,2) not null check (cantidad > 0),
  fecha       date not null,
  area        text not null default 'general'
              check (area in ('mecanica', 'programacion', 'diseno', 'marketing', 'general')),
  categoria   text not null default 'Otros',
  notas       text,
  compra_id   uuid,                                -- compra que originó el gasto (si aplica)
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

-- ------------------------------------------------------------------------
-- 4. TABLA: compras (lista de necesidades del equipo)
-- ------------------------------------------------------------------------
create table if not exists public.compras (
  id                    uuid primary key default gen_random_uuid(),
  equipo_id             uuid not null references public.equipos(id) on delete cascade,
  nombre                text not null check (length(trim(nombre)) > 0),
  cantidad              integer not null default 1 check (cantidad > 0),
  precio_estimado       numeric(14,2) not null default 0 check (precio_estimado >= 0),
  precio_real           numeric(14,2) check (precio_real >= 0),
  area                  text not null default 'general'
                        check (area in ('mecanica', 'programacion', 'diseno', 'marketing', 'general')),
  categoria             text not null default 'Otros',
  estado                text not null default 'pendiente' check (estado in ('pendiente', 'comprado')),
  notas                 text,
  fecha_compra          date,
  registrado_como_gasto boolean not null default false,
  movimiento_id         uuid references public.movimientos(id) on delete set null,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users(id) on delete set null
);

-- Relación inversa movimiento → compra (se agrega después para evitar
-- la dependencia circular en la creación de las tablas).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'movimientos_compra_id_fkey'
  ) then
    alter table public.movimientos
      add constraint movimientos_compra_id_fkey
      foreign key (compra_id) references public.compras(id) on delete set null;
  end if;
end $$;

create index if not exists idx_movimientos_equipo_fecha on public.movimientos (equipo_id, fecha);
create index if not exists idx_compras_equipo           on public.compras (equipo_id, estado);

-- ------------------------------------------------------------------------
-- 5. FUNCIONES AUXILIARES DE PERMISOS
--    security definer para poder leer equipo_miembros sin caer en
--    recursión de políticas.
-- ------------------------------------------------------------------------
create or replace function public.es_miembro(p_equipo uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.equipo_miembros m
    where m.equipo_id = p_equipo and m.user_id = auth.uid()
  );
$$;

create or replace function public.es_publico(p_equipo uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select e.publico from public.equipos e where e.id = p_equipo), false);
$$;

-- Al crear un equipo, su creador queda registrado automáticamente como
-- propietario para que no dependa de una inserción manual.
create or replace function public.registrar_propietario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is not null then
    insert into public.equipo_miembros (equipo_id, user_id, rol)
    values (new.id, new.owner_id, 'propietario')
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists trg_registrar_propietario on public.equipos;
create trigger trg_registrar_propietario
  after insert on public.equipos
  for each row execute function public.registrar_propietario();

-- Mantiene updated_at al día sin depender del cliente.
create or replace function public.tocar_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_movimientos_updated on public.movimientos;
create trigger trg_movimientos_updated
  before update on public.movimientos
  for each row execute function public.tocar_updated_at();

-- ------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY
--    La seguridad real vive aquí, no en los botones de la interfaz:
--      · anon           → solo SELECT de equipos marcados como públicos
--      · authenticated  → SELECT/INSERT/UPDATE/DELETE solo en sus equipos
-- ------------------------------------------------------------------------
alter table public.equipos          enable row level security;
alter table public.equipo_miembros  enable row level security;
alter table public.movimientos      enable row level security;
alter table public.compras          enable row level security;

-- ---- equipos ----
drop policy if exists equipos_select on public.equipos;
create policy equipos_select on public.equipos
  for select to anon, authenticated
  using (publico = true or public.es_miembro(id));

drop policy if exists equipos_insert on public.equipos;
create policy equipos_insert on public.equipos
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists equipos_update on public.equipos;
create policy equipos_update on public.equipos
  for update to authenticated
  using (public.es_miembro(id))
  with check (public.es_miembro(id));

drop policy if exists equipos_delete on public.equipos;
create policy equipos_delete on public.equipos
  for delete to authenticated
  using (owner_id = auth.uid());

-- ---- equipo_miembros ----
drop policy if exists miembros_select on public.equipo_miembros;
create policy miembros_select on public.equipo_miembros
  for select to authenticated
  using (user_id = auth.uid() or public.es_miembro(equipo_id));

drop policy if exists miembros_insert on public.equipo_miembros;
create policy miembros_insert on public.equipo_miembros
  for insert to authenticated
  with check (public.es_miembro(equipo_id));

drop policy if exists miembros_delete on public.equipo_miembros;
create policy miembros_delete on public.equipo_miembros
  for delete to authenticated
  using (public.es_miembro(equipo_id));

-- ---- movimientos ----
drop policy if exists movimientos_select on public.movimientos;
create policy movimientos_select on public.movimientos
  for select to anon, authenticated
  using (public.es_publico(equipo_id) or public.es_miembro(equipo_id));

drop policy if exists movimientos_insert on public.movimientos;
create policy movimientos_insert on public.movimientos
  for insert to authenticated
  with check (public.es_miembro(equipo_id));

drop policy if exists movimientos_update on public.movimientos;
create policy movimientos_update on public.movimientos
  for update to authenticated
  using (public.es_miembro(equipo_id))
  with check (public.es_miembro(equipo_id));

drop policy if exists movimientos_delete on public.movimientos;
create policy movimientos_delete on public.movimientos
  for delete to authenticated
  using (public.es_miembro(equipo_id));

-- ---- compras ----
drop policy if exists compras_select on public.compras;
create policy compras_select on public.compras
  for select to anon, authenticated
  using (public.es_publico(equipo_id) or public.es_miembro(equipo_id));

drop policy if exists compras_insert on public.compras;
create policy compras_insert on public.compras
  for insert to authenticated
  with check (public.es_miembro(equipo_id));

drop policy if exists compras_update on public.compras;
create policy compras_update on public.compras
  for update to authenticated
  using (public.es_miembro(equipo_id))
  with check (public.es_miembro(equipo_id));

drop policy if exists compras_delete on public.compras;
create policy compras_delete on public.compras
  for delete to authenticated
  using (public.es_miembro(equipo_id));

-- ------------------------------------------------------------------------
-- 7. PERMISOS DE TABLA
--    RLS filtra las filas, pero los roles necesitan además el permiso
--    sobre la tabla. Se declara de forma explícita para no depender de
--    los privilegios por omisión del proyecto.
-- ------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.equipos, public.movimientos, public.compras to anon;
grant select, insert, update, delete
  on public.equipos, public.equipo_miembros, public.movimientos, public.compras
  to authenticated;

-- =========================================================================
-- FIN DEL ESQUEMA
--
-- Después de ejecutar esto:
--   1. Crea la cuenta del equipo en Authentication → Users → Add user.
--   2. Entra a la aplicación con esa cuenta: la pantalla "¿Con cuánto dinero
--      comienzas?" creará automáticamente la fila de la tabla equipos y
--      registrará a esa cuenta como propietaria.
-- =========================================================================
