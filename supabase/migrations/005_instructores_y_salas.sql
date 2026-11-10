-- Etapa 7: catálogos de instructores y salas.
-- Los eventos siguen guardando el nombre (columnas "instructor" y "sala") para que el formulario público
-- y los correos no cambien; ahora además apuntan al catálogo con instructor_id y sala_id.

create table public.instructores (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null check (length(trim(nombre)) > 0),
  correo        text check (correo is null or correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  especialidad  text,
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);

create table public.salas (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (length(trim(nombre)) > 0),
  ubicacion  text not null check (length(trim(ubicacion)) > 0),
  tipo       text not null check (tipo in ('aula', 'laboratorio', 'auditorio', 'reuniones', 'virtual', 'otro')),
  capacidad  integer check (capacidad is null or capacidad > 0),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

create unique index instructores_nombre_uk on public.instructores (lower(trim(nombre)));
create unique index salas_nombre_uk on public.salas (lower(trim(nombre)));

alter table public.eventos
  add column instructor_id uuid references public.instructores(id) on delete set null,
  add column sala_id       uuid references public.salas(id) on delete set null;

-- Seguridad: solo el equipo autenticado. El público no lee estos catálogos
-- (ve el nombre a través de evento_publico, que usa las columnas de texto del evento).
alter table public.instructores enable row level security;
alter table public.salas enable row level security;

create policy instructores_equipo_todo on public.instructores
  for all to authenticated using (true) with check (true);
create policy salas_equipo_todo on public.salas
  for all to authenticated using (true) with check (true);

-- Si se renombra un instructor o una sala, los eventos que lo usan reflejan el nombre nuevo
create or replace function public.propagar_nombre_instructor()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.nombre is distinct from old.nombre then
    update eventos set instructor = new.nombre where instructor_id = new.id;
  end if;
  return new;
end;
$$;

create or replace function public.propagar_nombre_sala()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.nombre is distinct from old.nombre then
    update eventos set sala = new.nombre where sala_id = new.id;
  end if;
  return new;
end;
$$;

create trigger instructores_propagar_nombre
  after update of nombre on public.instructores
  for each row execute function public.propagar_nombre_instructor();

create trigger salas_propagar_nombre
  after update of nombre on public.salas
  for each row execute function public.propagar_nombre_sala();
