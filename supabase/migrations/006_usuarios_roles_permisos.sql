-- Etapa 8: usuarios del equipo con roles y permisos.
-- Los permisos se aplican en la base de datos (RLS), no solo en la interfaz.

-- ============ ROLES Y PERFILES ============

create table public.roles (
  clave        text primary key,
  nombre       text not null,
  descripcion  text,
  permisos     text[] not null default '{}',
  check (permisos <@ array['eventos_ver', 'eventos_gestionar', 'inscritos_gestionar',
                           'asistencia_registrar', 'catalogos_gestionar', 'usuarios_gestionar']::text[])
);

insert into public.roles (clave, nombre, descripcion, permisos) values
  ('admin', 'Administrador', 'Acceso total, incluida la gestión de usuarios y roles.',
     array['eventos_ver', 'eventos_gestionar', 'inscritos_gestionar', 'asistencia_registrar', 'catalogos_gestionar', 'usuarios_gestionar']),
  ('coordinador', 'Coordinador', 'Gestiona eventos, inscritos, asistencia, instructores y salas.',
     array['eventos_ver', 'eventos_gestionar', 'inscritos_gestionar', 'asistencia_registrar', 'catalogos_gestionar']),
  ('operador', 'Operador de asistencia', 'Consulta eventos y registra la asistencia (QR o manual).',
     array['eventos_ver', 'asistencia_registrar']),
  ('consulta', 'Consulta', 'Solo puede ver eventos, inscritos y el panel.',
     array['eventos_ver']);

create table public.perfiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null check (length(trim(nombre)) > 0),
  correo     text not null,
  rol        text not null references public.roles(clave),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

-- Quienes ya tenían cuenta antes de esta etapa quedan como administradores
insert into public.perfiles (user_id, nombre, correo, rol)
select id, coalesce(nullif(raw_user_meta_data->>'nombre', ''), split_part(email, '@', 1)), email, 'admin'
from auth.users
where email is not null
on conflict (user_id) do nothing;

-- ============ FUNCIÓN DE PERMISOS ============

create or replace function public.tiene_permiso(p_permiso text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from perfiles pf join roles r on r.clave = pf.rol
    where pf.user_id = auth.uid()
      and pf.activo
      and (r.clave = 'admin' or p_permiso = any (r.permisos))
  );
$$;

revoke all on function public.tiene_permiso(text) from public;
grant execute on function public.tiene_permiso(text) to authenticated;

-- ============ SEGURIDAD POR FILA ============

alter table public.roles enable row level security;
alter table public.perfiles enable row level security;

-- Roles: todo el equipo los lee; solo quien gestiona usuarios edita los permisos (el rol admin no se toca)
create policy roles_lee on public.roles for select to authenticated using (true);
create policy roles_edita on public.roles for update to authenticated
  using (tiene_permiso('usuarios_gestionar') and clave <> 'admin')
  with check (tiene_permiso('usuarios_gestionar') and clave <> 'admin');

-- Perfiles: cada persona ve el suyo; quien gestiona usuarios ve todos. Las escrituras las hace la Edge Function.
create policy perfiles_lee on public.perfiles for select to authenticated
  using (user_id = auth.uid() or tiene_permiso('usuarios_gestionar'));

-- Eventos
drop policy if exists eventos_equipo_todo on public.eventos;
create policy eventos_ver on public.eventos for select to authenticated using (tiene_permiso('eventos_ver'));
create policy eventos_crea on public.eventos for insert to authenticated with check (tiene_permiso('eventos_gestionar'));
create policy eventos_edita on public.eventos for update to authenticated
  using (tiene_permiso('eventos_gestionar')) with check (tiene_permiso('eventos_gestionar'));
create policy eventos_borra on public.eventos for delete to authenticated using (tiene_permiso('eventos_gestionar'));

-- Postulaciones
drop policy if exists postulaciones_equipo_todo on public.postulaciones;
create policy postulaciones_ver on public.postulaciones for select to authenticated using (tiene_permiso('eventos_ver'));
create policy postulaciones_crea on public.postulaciones for insert to authenticated with check (tiene_permiso('inscritos_gestionar'));
create policy postulaciones_edita on public.postulaciones for update to authenticated
  using (tiene_permiso('inscritos_gestionar') or tiene_permiso('asistencia_registrar'))
  with check (tiene_permiso('inscritos_gestionar') or tiene_permiso('asistencia_registrar'));
create policy postulaciones_borra on public.postulaciones for delete to authenticated using (tiene_permiso('inscritos_gestionar'));

-- Quien solo puede registrar asistencia no puede cambiar nada más de una postulación
create or replace function public.restringir_edicion_postulaciones()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not tiene_permiso('inscritos_gestionar') then
    if (new.evento_id, new.nombre_completo, new.correo, new.area, new.estado, new.codigo)
       is distinct from (old.evento_id, old.nombre_completo, old.correo, old.area, old.estado, old.codigo) then
      raise exception 'SIN_PERMISO';
    end if;
  end if;
  return new;
end;
$$;

create trigger postulaciones_restringir_edicion
  before update on public.postulaciones
  for each row execute function public.restringir_edicion_postulaciones();

-- Instructores y salas
drop policy if exists instructores_equipo_todo on public.instructores;
create policy instructores_ver on public.instructores for select to authenticated using (tiene_permiso('eventos_ver'));
create policy instructores_gestiona on public.instructores for all to authenticated
  using (tiene_permiso('catalogos_gestionar')) with check (tiene_permiso('catalogos_gestionar'));

drop policy if exists salas_equipo_todo on public.salas;
create policy salas_ver on public.salas for select to authenticated using (tiene_permiso('eventos_ver'));
create policy salas_gestiona on public.salas for all to authenticated
  using (tiene_permiso('catalogos_gestionar')) with check (tiene_permiso('catalogos_gestionar'));
