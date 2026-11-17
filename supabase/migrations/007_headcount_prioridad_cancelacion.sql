-- Etapa 9: headcount (nómina ficticia), público objetivo con prioridad en lista de espera
-- y cancelación de asistencia por parte del colaborador.

-- ============ HEADCOUNT ============
create table public.headcount (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null check (length(trim(nombre)) > 0),
  correo  text not null check (correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  area    text not null check (length(trim(area)) > 0),
  cargo   text not null check (length(trim(cargo)) > 0),
  activo  boolean not null default true
);
create unique index headcount_correo_uk on public.headcount (lower(correo));

alter table public.headcount enable row level security;
-- El público NO lee la tabla; solo usa las funciones de abajo. El equipo la ve y la gestiona según permisos.
create policy headcount_ver on public.headcount for select to authenticated using (tiene_permiso('eventos_ver'));
create policy headcount_gestiona on public.headcount for all to authenticated
  using (tiene_permiso('catalogos_gestionar')) with check (tiene_permiso('catalogos_gestionar'));

-- ============ PÚBLICO OBJETIVO DEL EVENTO ============
-- Listas vacías = dirigido a todos (sin prioridad).
alter table public.eventos
  add column areas_objetivo  text[] not null default '{}',
  add column cargos_objetivo text[] not null default '{}';

alter table public.postulaciones
  add column cargo text,
  add column prioridad smallint not null default 0;

-- Nivel de prioridad: 2 = cumple área y cargo, 1 = cumple solo uno, 0 = ninguno (o evento sin público objetivo).
-- Una lista vacía cuenta como "cumple" para esa dimensión.
create or replace function public.nivel_prioridad(p_areas text[], p_cargos text[], p_area text, p_cargo text)
returns smallint
language sql immutable set search_path = public as $$
  select case
    when cardinality(p_areas) = 0 and cardinality(p_cargos) = 0 then 0
    else (
      (case when cardinality(p_areas) = 0
              or lower(trim(p_area)) in (select lower(trim(x)) from unnest(p_areas) x) then 1 else 0 end)
      +
      (case when cardinality(p_cargos) = 0
              or lower(trim(p_cargo)) in (select lower(trim(x)) from unnest(p_cargos) x) then 1 else 0 end)
    )
  end::smallint;
$$;

-- ============ FUNCIONES PÚBLICAS ============

-- Autocompletar por correo
create or replace function public.buscar_headcount(p_correo text)
returns table (nombre text, area text, cargo text)
language sql stable security definer set search_path = public as $$
  select h.nombre, h.area, h.cargo from headcount h
  where lower(h.correo) = lower(trim(p_correo)) and h.activo
  limit 1;
$$;

-- Listas de áreas y cargos para los selectores del formulario público
create or replace function public.opciones_headcount()
returns table (areas text[], cargos text[])
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct area order by area), '{}'),
         coalesce(array_agg(distinct cargo order by cargo), '{}')
  from headcount where activo;
$$;

-- Evento público: ahora incluye a quién va dirigido
drop function public.evento_publico(uuid);
create function public.evento_publico(p_evento_id uuid)
returns table (
  id uuid, nombre text, descripcion text, fecha date, hora_inicio time,
  hora_fin time, sala text, instructor text, cupo_maximo integer,
  cupos_disponibles integer, estado text, areas_objetivo text[], cargos_objetivo text[]
)
language sql stable security definer set search_path = public as $$
  select e.id, e.nombre, e.descripcion, e.fecha, e.hora_inicio, e.hora_fin,
         e.sala, e.instructor, e.cupo_maximo,
         greatest(e.cupo_maximo - (
           select count(*)::int from postulaciones p
           where p.evento_id = e.id and p.estado = 'inscrito'), 0),
         e.estado, e.areas_objetivo, e.cargos_objetivo
  from eventos e
  where e.id = p_evento_id and e.estado = 'abierto';
$$;

-- Postulación con cargo y prioridad
drop function public.postularse(uuid, text, text, text);
create function public.postularse(
  p_evento_id uuid, p_nombre text, p_correo text, p_area text, p_cargo text default null
)
returns table (estado text, codigo text, posicion_espera integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_evento    eventos%rowtype;
  v_inscritos integer;
  v_estado    text;
  v_codigo    text;
  v_prio      smallint;
  v_creado    timestamptz;
  v_pos       integer := null;
begin
  select * into v_evento from eventos where id = p_evento_id for update;

  if not found or v_evento.estado <> 'abierto' then
    raise exception 'EVENTO_NO_DISPONIBLE';
  end if;

  if exists (select 1 from postulaciones
             where evento_id = p_evento_id and lower(correo) = lower(trim(p_correo))
               and estado <> 'cancelado') then
    raise exception 'YA_POSTULADO';
  end if;

  delete from postulaciones
   where evento_id = p_evento_id and lower(correo) = lower(trim(p_correo)) and estado = 'cancelado';

  select count(*) into v_inscritos from postulaciones
   where evento_id = p_evento_id and estado = 'inscrito';

  v_estado := case when v_inscritos < v_evento.cupo_maximo then 'inscrito' else 'lista_espera' end;
  v_prio   := nivel_prioridad(v_evento.areas_objetivo, v_evento.cargos_objetivo, p_area, p_cargo);

  insert into postulaciones (evento_id, nombre_completo, correo, area, cargo, prioridad, estado)
  values (p_evento_id, trim(p_nombre), lower(trim(p_correo)), trim(p_area), nullif(trim(p_cargo), ''), v_prio, v_estado)
  returning postulaciones.codigo, postulaciones.creado_en into v_codigo, v_creado;

  if v_estado = 'lista_espera' then
    -- Posición: primero mayor prioridad, y dentro de cada nivel por orden de llegada
    select count(*)::int into v_pos from postulaciones
     where evento_id = p_evento_id and estado = 'lista_espera'
       and (prioridad > v_prio or (prioridad = v_prio and creado_en <= v_creado));
  end if;

  return query select v_estado, v_codigo, v_pos;
end;
$$;

-- Cancelación por el colaborador (con su código secreto).
-- Si liberaba un cupo, pasa a inscrito el primero de la lista de espera (mayor prioridad, luego el más antiguo).
create or replace function public.cancelar_postulacion(p_codigo text)
returns table (fue_cancelada boolean, promovido_codigo text)
language plpgsql security definer set search_path = public as $$
declare
  v_p     postulaciones%rowtype;
  v_fecha date;
  v_sig   postulaciones%rowtype;
begin
  select * into v_p from postulaciones where codigo = p_codigo;
  if not found then raise exception 'NO_ENCONTRADA'; end if;

  if v_p.estado = 'cancelado' then
    return query select false, null::text;
    return;
  end if;

  -- Bloquea el evento para que dos cancelaciones simultáneas no promuevan a la misma persona
  select fecha into v_fecha from eventos where id = v_p.evento_id for update;
  if v_fecha < current_date then raise exception 'EVENTO_PASADO'; end if;

  update postulaciones set estado = 'cancelado' where id = v_p.id;

  if v_p.estado = 'inscrito' then
    select * into v_sig from postulaciones
     where evento_id = v_p.evento_id and estado = 'lista_espera'
     order by prioridad desc, creado_en asc
     limit 1 for update;
    if found then
      update postulaciones set estado = 'inscrito' where id = v_sig.id;
      return query select true, v_sig.codigo;
      return;
    end if;
  end if;

  return query select true, null::text;
end;
$$;

-- Permisos de ejecución
revoke all on function public.buscar_headcount(text) from public;
revoke all on function public.opciones_headcount() from public;
revoke all on function public.evento_publico(uuid) from public;
revoke all on function public.postularse(uuid, text, text, text, text) from public;
revoke all on function public.cancelar_postulacion(text) from public;
revoke all on function public.nivel_prioridad(text[], text[], text, text) from public;

grant execute on function public.buscar_headcount(text) to anon, authenticated;
grant execute on function public.opciones_headcount() to anon, authenticated;
grant execute on function public.evento_publico(uuid) to anon, authenticated;
grant execute on function public.postularse(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.cancelar_postulacion(text) to anon, authenticated;
