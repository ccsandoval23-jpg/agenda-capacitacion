-- Etapa 5: control de qué correo se envió, para no repetir envíos
-- correo_estado guarda el estado ('inscrito' o 'lista_espera') del último correo enviado.
-- Así cada postulación recibe un correo por estado: al postularse y, si pasa de espera a inscrita, otro.
alter table public.postulaciones add column correo_estado text;
