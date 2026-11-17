-- Datos de demostración (ficticios). Ejecutar DESPUÉS de la migración 007. Se puede repetir sin duplicar.
-- Todos los correos usan @ejemplo.com: no pertenecen a personas reales.

insert into public.headcount (nombre, correo, area, cargo) values
  ('Valeria Rojas', 'valeria.rojas@ejemplo.com', 'Ventas', 'Ejecutivo'),
  ('Andrés Fuentes', 'andres.fuentes@ejemplo.com', 'Ventas', 'Ejecutivo'),
  ('Mariana Pineda', 'mariana.pineda@ejemplo.com', 'Ventas', 'Ejecutivo'),
  ('Luis Mendoza', 'luis.mendoza@ejemplo.com', 'Ventas', 'Supervisor'),
  ('Sofía Herrera', 'sofia.herrera@ejemplo.com', 'Ventas', 'Coordinador'),
  ('Carlos Guerrero', 'carlos.guerrero@ejemplo.com', 'Ventas', 'Gerente'),
  ('Daniela Paredes', 'daniela.paredes@ejemplo.com', 'Logística', 'Operador'),
  ('Miguel Montero', 'miguel.montero@ejemplo.com', 'Logística', 'Operador'),
  ('Paola Medina', 'paola.medina@ejemplo.com', 'Logística', 'Analista'),
  ('Javier Salazar', 'javier.salazar@ejemplo.com', 'Logística', 'Supervisor'),
  ('Gabriela Silva', 'gabriela.silva@ejemplo.com', 'Logística', 'Coordinador'),
  ('Ricardo Aguilar', 'ricardo.aguilar@ejemplo.com', 'Producción', 'Operador'),
  ('Camila Ortega', 'camila.ortega@ejemplo.com', 'Producción', 'Operador'),
  ('Fernando Vargas', 'fernando.vargas@ejemplo.com', 'Producción', 'Operador'),
  ('Isabella Peña', 'isabella.pena@ejemplo.com', 'Producción', 'Supervisor'),
  ('Diego Navarro', 'diego.navarro@ejemplo.com', 'Producción', 'Analista'),
  ('Lucía Castillo', 'lucia.castillo@ejemplo.com', 'Recursos Humanos', 'Analista'),
  ('Sebastián Rivas', 'sebastian.rivas@ejemplo.com', 'Recursos Humanos', 'Analista'),
  ('Natalia Cabrera', 'natalia.cabrera@ejemplo.com', 'Recursos Humanos', 'Coordinador'),
  ('Héctor Romero', 'hector.romero@ejemplo.com', 'Recursos Humanos', 'Gerente'),
  ('Andrea Rojas', 'andrea.rojas@ejemplo.com', 'Finanzas', 'Analista'),
  ('Raúl Fuentes', 'raul.fuentes@ejemplo.com', 'Finanzas', 'Analista'),
  ('Mónica Pineda', 'monica.pineda@ejemplo.com', 'Finanzas', 'Coordinador'),
  ('Tomás Mendoza', 'tomas.mendoza@ejemplo.com', 'Finanzas', 'Gerente'),
  ('Patricia Herrera', 'patricia.herrera@ejemplo.com', 'Tecnología', 'Analista'),
  ('Esteban Guerrero', 'esteban.guerrero@ejemplo.com', 'Tecnología', 'Analista'),
  ('Carolina Paredes', 'carolina.paredes@ejemplo.com', 'Tecnología', 'Coordinador'),
  ('Rafael Montero', 'rafael.montero@ejemplo.com', 'Tecnología', 'Supervisor')
on conflict (lower(correo)) do nothing;

insert into public.instructores (nombre, correo, especialidad) values
  ('Laura Benítez', 'laura.benitez@ejemplo.com', 'Ofimática y análisis de datos'),
  ('Ernesto Villalba', 'ernesto.villalba@ejemplo.com', 'Liderazgo y gestión de equipos'),
  ('Patricia Lugo', 'patricia.lugo@ejemplo.com', 'Seguridad industrial'),
  ('Marcos Dávila', 'marcos.davila@ejemplo.com', 'Técnicas de venta')
on conflict (lower(trim(nombre))) do nothing;

insert into public.salas (nombre, ubicacion, tipo, capacidad) values
  ('Aula Burbuja', 'Piso 1, Centro de Capacitación', 'aula', 25),
  ('Laboratorio Digital', 'Piso 2, Centro de Capacitación', 'laboratorio', 20),
  ('Auditorio Central', 'Planta baja', 'auditorio', 80),
  ('Sala Reuniones B', 'Piso 2, Edificio administrativo', 'reuniones', 10)
on conflict (lower(trim(nombre))) do nothing;

-- Eventos de ejemplo con fechas relativas a hoy. El primero ya viene con cupos llenos y lista de espera
-- para probar la prioridad (dirigido a Ejecutivos del área de Ventas).
do $$
declare
  v_ev1 uuid; v_ev2 uuid; v_ev3 uuid;
begin
  if exists (select 1 from eventos where nombre like '%(demo)') then return; end if;

  insert into eventos (nombre, descripcion, fecha, hora_inicio, hora_fin, sala, sala_id, instructor, instructor_id, cupo_maximo, areas_objetivo, cargos_objetivo)
  select 'Técnicas de negociación (demo)', 'Taller práctico de negociación para la fuerza de ventas.',
         current_date + 7, '09:00', '12:00', s.nombre, s.id, i.nombre, i.id, 4, array['Ventas'], array['Ejecutivo']
  from salas s, instructores i where s.nombre = 'Aula Burbuja' and i.nombre = 'Marcos Dávila'
  returning id into v_ev1;

  insert into eventos (nombre, descripcion, fecha, hora_inicio, hora_fin, sala, sala_id, instructor, instructor_id, cupo_maximo)
  select 'Excel avanzado (demo)', 'Tablas dinámicas, funciones y automatización. Abierto a todo el personal.',
         current_date + 10, '14:00', '17:00', s.nombre, s.id, i.nombre, i.id, 20
  from salas s, instructores i where s.nombre = 'Laboratorio Digital' and i.nombre = 'Laura Benítez'
  returning id into v_ev2;

  insert into eventos (nombre, descripcion, fecha, hora_inicio, hora_fin, sala, sala_id, instructor, instructor_id, cupo_maximo, areas_objetivo, cargos_objetivo)
  select 'Liderazgo de equipos (demo)', 'Para quienes coordinan o supervisan personas.',
         current_date + 14, '09:00', '13:00', s.nombre, s.id, i.nombre, i.id, 30, '{}', array['Supervisor','Coordinador','Gerente']
  from salas s, instructores i where s.nombre = 'Auditorio Central' and i.nombre = 'Ernesto Villalba'
  returning id into v_ev3;

  -- Evento 1: 4 cupos llenos con personas ajenas al público objetivo y 3 en espera (llegaron antes los que NO cumplen el perfil)
  insert into postulaciones (evento_id, nombre_completo, correo, area, cargo, prioridad, estado, creado_en)
  select v_ev1, h.nombre, h.correo, h.area, h.cargo,
         nivel_prioridad(array['Ventas'], array['Ejecutivo'], h.area, h.cargo),
         x.estado, now() - (x.orden || ' hours')::interval
  from (values
    ('logistica', 'inscrito', 20), ('produccion', 'inscrito', 19), ('finanzas', 'inscrito', 18), ('tecnologia', 'inscrito', 17),
    ('espera_ajeno', 'lista_espera', 10), ('espera_ventas_otro_cargo', 'lista_espera', 9), ('espera_ejecutivo_ventas', 'lista_espera', 8)
  ) as x(clave, estado, orden)
  join lateral (
    select * from headcount hh where
      case x.clave
        when 'logistica' then hh.area = 'Logística' and hh.cargo = 'Operador'
        when 'produccion' then hh.area = 'Producción' and hh.cargo = 'Operador'
        when 'finanzas' then hh.area = 'Finanzas' and hh.cargo = 'Analista'
        when 'tecnologia' then hh.area = 'Tecnología' and hh.cargo = 'Analista'
        when 'espera_ajeno' then hh.area = 'Recursos Humanos' and hh.cargo = 'Analista'
        when 'espera_ventas_otro_cargo' then hh.area = 'Ventas' and hh.cargo = 'Supervisor'
        when 'espera_ejecutivo_ventas' then hh.area = 'Ventas' and hh.cargo = 'Ejecutivo'
      end
    order by hh.correo limit 1
  ) h on true;

  -- Evento 2: algunos inscritos
  insert into postulaciones (evento_id, nombre_completo, correo, area, cargo, estado)
  select v_ev2, nombre, correo, area, cargo, 'inscrito' from headcount where area in ('Finanzas', 'Recursos Humanos') order by correo limit 6;
end $$;
