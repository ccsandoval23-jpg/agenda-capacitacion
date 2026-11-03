# Agenda de Capacitación

Aplicación web para que el equipo de Capacitación y Aprendizaje de Recursos Humanos gestione los eventos formativos de su centro de capacitación desde un solo lugar: **crear eventos, abrir postulaciones con un enlace público, controlar cupos, manejar una lista de espera, confirmar por correo y registrar la asistencia con un código QR personal.**

> Proyecto final de IA Aplicada (UCAB). Es un prototipo: usa **únicamente datos ficticios**.

## El problema

Hoy cada evento implica crear un formulario desde cero, revisar una y otra vez cuántos cupos quedan, atender a quienes quedan fuera, reemplazar cancelaciones a mano y registrar la asistencia por separado. Resultado: tiempo perdido, información dispersa, riesgo de sobrecupos y pocos datos para medir la participación.

## Qué hace

| Para quién | Qué permite |
|---|---|
| **Equipo** (con inicio de sesión) | Crear y editar eventos, copiar el enlace público, ver inscritos y lista de espera, cancelar, inscribir a quien sigue, registrar asistencia (QR o manual) y ver indicadores. |
| **Colaboradores** (sin cuenta) | Postularse desde el celular con un enlace, recibir la confirmación por correo y ver su código QR personal. |

Flujo principal: *crear evento → compartir enlace → postulación (inscrito o lista de espera) → correo con QR → el día del evento se escanea el QR → asistencia registrada.*

## Pantallas

| Archivo | Pantalla |
|---|---|
| `index.html` | Inicio de sesión del equipo |
| `panel.html` | Panel con indicadores (eventos próximos, ocupación, lista de espera, asistencia) |
| `eventos.html` | Lista de eventos con ocupación |
| `evento-form.html` | Crear/editar evento y enlace público |
| `inscritos.html` | Inscritos, lista de espera, cancelación, reasignación y asistencia |
| `postular.html` | Formulario público de postulación |
| `qr.html` | «Mi código QR» (público, con el código secreto) |
| `verificar.html` | Verificación por QR (solo equipo con sesión) |

## Arquitectura

- **Interfaz:** HTML, CSS y JavaScript sin framework, adaptable a celular. Carpeta `public/`.
- **Supabase:** base de datos PostgreSQL, autenticación del equipo, seguridad por fila (RLS) y una Edge Function.
- **Correo:** la función `enviar-confirmacion` usa [Resend](https://resend.com).
- **QR:** generado en el navegador con `qrcode-generator`.
- **Hosting:** sitio estático (Cloudflare Pages).

### Decisiones de diseño

- **El cupo lo decide la base de datos, no la página.** La función `postularse` bloquea la fila del evento y decide «inscrito» o «lista de espera» de forma atómica; un disparador impide sobrecupos incluso al reasignar a mano.
- **Datos personales protegidos.** El público no puede leer postulaciones; solo puede ejecutar funciones concretas (`evento_publico`, `postularse`, `obtener_postulacion`). El equipo autenticado gestiona todo.
- **Sin duplicados.** Un mismo correo no puede postularse dos veces al mismo evento.
- **Correo idempotente.** Cada postulación recibe un correo por estado (al postularse y, si pasa de espera a inscrita, otro); se registra si fue enviado.
- **Reasignación manual** desde la lista de espera: más simple y seguro de probar que una promoción automática.

## Estructura

```
public/                       sitio web (lo único que se publica)
supabase/migrations/          SQL, en orden: esquema, reglas de cupo, control de correo, asistencia
supabase/functions/           Edge Function enviar-confirmacion
```

## Puesta en marcha

1. Crear un proyecto en [Supabase](https://supabase.com) y ejecutar en orden los archivos de `supabase/migrations/`.
2. Crear el usuario del equipo en *Authentication → Users*.
3. Desplegar la función `supabase/functions/enviar-confirmacion` y definir los secretos `RESEND_API_KEY` y `SITE_URL` (URL pública del sitio).
4. Completar `public/js/config.js` con la URL del proyecto y la clave **anon** (es pública por diseño; la seguridad la dan las reglas RLS).
5. Servir `public/` como sitio estático. En local: `cd public && python3 -m http.server 8000`.

**Nunca** se debe publicar la clave `service_role`, el token de acceso de Supabase ni la API key de Resend: van en `.env.local` (ignorado por git) o como secretos del servicio.

## Limitaciones del prototipo

- Con el remitente de pruebas de Resend (`onboarding@resend.dev`) solo se pueden enviar correos a la dirección de la propia cuenta; para escribir a otros destinatarios hay que verificar un dominio.
- No incluye recordatorios automáticos, otros canales (WhatsApp), integración con sistemas internos, choques de horario entre salas, ni niveles de permisos dentro del equipo.
