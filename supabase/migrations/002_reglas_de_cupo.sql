-- Etapa 4: la base de datos impide sobrecupos, incluso si el equipo reasigna a mano

-- Nadie puede pasar a "inscrito" si el cupo ya está lleno (insert o update)
create or replace function public.verificar_cupo()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cupo integer;
  v_inscritos integer;
begin
  if new.estado = 'inscrito' and (tg_op = 'INSERT' or old.estado is distinct from 'inscrito') then
    select cupo_maximo into v_cupo from eventos where id = new.evento_id for update;
    select count(*) into v_inscritos from postulaciones
     where evento_id = new.evento_id and estado = 'inscrito';
    if v_inscritos >= v_cupo then
      raise exception 'CUPO_LLENO';
    end if;
  end if;
  return new;
end;
$$;

create trigger postulaciones_verificar_cupo
  before insert or update of estado on public.postulaciones
  for each row execute function public.verificar_cupo();

-- No se puede bajar el cupo máximo por debajo de los ya inscritos
create or replace function public.verificar_cupo_evento()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_inscritos integer;
begin
  select count(*) into v_inscritos from postulaciones
   where evento_id = new.id and estado = 'inscrito';
  if new.cupo_maximo < v_inscritos then
    raise exception 'CUPO_MENOR_QUE_INSCRITOS';
  end if;
  return new;
end;
$$;

create trigger eventos_verificar_cupo
  before update of cupo_maximo on public.eventos
  for each row execute function public.verificar_cupo_evento();
