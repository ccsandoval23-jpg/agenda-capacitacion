-- Etapa 6: la asistencia solo existe para personas inscritas.
-- Si una postulación deja de estar inscrita (se cancela o vuelve a espera), su asistencia vuelve a "pendiente".
create or replace function public.normalizar_asistencia()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.estado <> 'inscrito' then
    new.asistencia := 'pendiente';
  end if;
  return new;
end;
$$;

create trigger postulaciones_normalizar_asistencia
  before insert or update of estado, asistencia on public.postulaciones
  for each row execute function public.normalizar_asistencia();
