-- Agenda de Capacitación · Etapa 1: tablas, seguridad y lógica de cupo

create extension if not exists pgcrypto;

-- ============ TABLAS ============

create table public.eventos (
  id           uuid primary key default gen_random_uuid(),
  nombre       text not null check (length(trim(nombre)) > 0),
  descripcion  text,
  fecha        date not null,
  hora_inicio  time not null,
  hora_fin     time not null,
  sala         text not null,
  instructor   text not null,
  cupo_maximo  integer not null check (cupo_maximo > 0),
  estado       text not null default 'abierto' check (estado in ('abierto', 'cerrado')),
  creado_en    timestamptz not null default now(),
  check (hora_fin > hora_inicio)
);

create table public.postulaciones (
  id               uuid primary key default gen_random_uuid(),
  evento_id        uuid not null references public.eventos(id) on delete cascade,
  nombre_completo  text not null check (length(trim(nombre_completo)) > 0),
  correo           text not null check (correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  area             text not null,
  estado           text not null check (estado in ('inscrito', 'lista_espera', 'cancelado')),
  asistencia       text not null default 'pendiente' check (asistencia in ('pendiente', 'asistio', 'no_asistio')),
  creado_en        timestamptz not null default now(),
  codigo           text not null unique default encode(gen_random_bytes(16), 'hex'),
  correo_enviado   boolean not null default false
);

-- Una persona no puede postularse dos veces al mismo evento
create unique index postulaciones_evento_correo_uk
  on public.postulaciones (evento_id, lower(correo));

create index postulaciones_evento_estado_idx
  on public.postulaciones (evento_id, estado, creado_en);

-- ============ SEGURIDAD POR FILA ============

alter table public.eventos enable row level security;
alter table public.postulaciones enable row level security;

-- Eventos: cualquiera ve los abiertos; el equipo autenticado gestiona todo
create policy eventos_publico_lee_abiertos on public.eventos
  for select to anon using (estado = 'abierto');

create policy eventos_equipo_todo on public.eventos
  for all to authenticated using (true) with check (true);

-- Postulaciones: solo el equipo autenticado. El público NO lee ni inserta directo.
create policy postulaciones_equipo_todo on public.postulaciones
  for all to authenticated using (true) with check (true);

-- ============ FUNCIONES PÚBLICAS (SECURITY DEFINER) ============

-- Datos del evento + cupos disponibles, sin exponer quién está postulado
create or replace function public.evento_publico(p_evento_id uuid)
returns table (
  id uuid, nombre text, descripcion text, fecha date, hora_inicio time,
  hora_fin time, sala text, instructor text, cupo_maximo integer,
  cupos_disponibles integer, estado text
)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre, e.descripcion, e.fecha, e.hora_inicio, e.hora_fin,
         e.sala, e.instructor, e.cupo_maximo,
         greatest(e.cupo_maximo - (
           select count(*)::int from postulaciones p
           where p.evento_id = e.id and p.estado = 'inscrito'), 0),
         e.estado
  from eventos e
  where e.id = p_evento_id and e.estado = 'abierto';
$$;

-- Postulación: la base decide "inscrito" o "lista_espera" de forma atómica
create or replace function public.postularse(
  p_evento_id uuid, p_nombre text, p_correo text, p_area text
)
returns table (estado text, codigo text, posicion_espera integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_evento    eventos%rowtype;
  v_inscritos integer;
  v_estado    text;
  v_codigo    text;
  v_pos       integer := null;
begin
  -- Bloquea la fila del evento: dos postulaciones simultáneas se procesan en fila
  select * into v_evento from eventos where id = p_evento_id for update;

  if not found or v_evento.estado <> 'abierto' then
    raise exception 'EVENTO_NO_DISPONIBLE';
  end if;

  if exists (select 1 from postulaciones
             where evento_id = p_evento_id and lower(correo) = lower(trim(p_correo))
               and estado <> 'cancelado') then
    raise exception 'YA_POSTULADO';
  end if;

  -- Si había una postulación cancelada del mismo correo, se elimina para permitir reintentar
  delete from postulaciones
   where evento_id = p_evento_id and lower(correo) = lower(trim(p_correo)) and estado = 'cancelado';

  select count(*) into v_inscritos from postulaciones
   where evento_id = p_evento_id and estado = 'inscrito';

  v_estado := case when v_inscritos < v_evento.cupo_maximo then 'inscrito' else 'lista_espera' end;

  insert into postulaciones (evento_id, nombre_completo, correo, area, estado)
  values (p_evento_id, trim(p_nombre), lower(trim(p_correo)), trim(p_area), v_estado)
  returning postulaciones.codigo into v_codigo;

  if v_estado = 'lista_espera' then
    select count(*)::int into v_pos from postulaciones
     where evento_id = p_evento_id and estado = 'lista_espera';
  end if;

  return query select v_estado, v_codigo, v_pos;
end;
$$;

-- "Mi código QR": el colaborador consulta su postulación con su código secreto
create or replace function public.obtener_postulacion(p_codigo text)
returns table (
  nombre_completo text, estado text, evento_nombre text, fecha date,
  hora_inicio time, hora_fin time, sala text
)
language sql stable security definer set search_path = public as $$
  select p.nombre_completo, p.estado, e.nombre, e.fecha, e.hora_inicio, e.hora_fin, e.sala
  from postulaciones p join eventos e on e.id = p.evento_id
  where p.codigo = p_codigo;
$$;

-- ============ PERMISOS DE EJECUCIÓN ============

revoke all on function public.evento_publico(uuid) from public;
revoke all on function public.postularse(uuid, text, text, text) from public;
revoke all on function public.obtener_postulacion(text) from public;

grant execute on function public.evento_publico(uuid) to anon, authenticated;
grant execute on function public.postularse(uuid, text, text, text) to anon, authenticated;
grant execute on function public.obtener_postulacion(text) to anon, authenticated;
