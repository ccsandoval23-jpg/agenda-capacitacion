// Envía el correo de confirmación de una postulación (inscrito o lista de espera).
// Se identifica la postulación por su código secreto. Cada estado se envía una sola vez.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const esc = (t: unknown) =>
  String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const REMITENTE = "Agenda de Capacitación <onboarding@resend.dev>";

function plantilla(p: any, ev: any, siteUrl: string) {
  const fecha = new Date(ev.fecha + "T00:00:00Z").toLocaleDateString("es-VE", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  const horario = `${ev.hora_inicio.slice(0, 5)} – ${ev.hora_fin.slice(0, 5)}`;
  const inscrito = p.estado === "inscrito";
  const enlaceQr = `${siteUrl}/qr.html?c=${p.codigo}`;

  const titulo = inscrito ? "¡Tu cupo está confirmado!" : "Estás en lista de espera";
  const mensaje = inscrito
    ? "Quedaste inscrito en la siguiente formación. El día del evento, presenta tu código QR personal para registrar tu asistencia."
    : "Por ahora los cupos de esta formación están completos y quedaste en lista de espera. Si se libera un cupo, el equipo te inscribirá y recibirás otro correo.";
  const boton = inscrito
    ? `<p style="margin:28px 0 8px"><a href="${esc(enlaceQr)}" style="background:#e61a27;color:#fff;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:999px;display:inline-block">Ver mi código QR</a></p>`
    : "";

  const html = `<!doctype html><html lang="es"><body style="margin:0;background:#f4f4f4;font-family:Helvetica,Arial,sans-serif;color:#1c1c1c">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#e61a27;color:#fff;padding:18px 24px;border-radius:14px 14px 0 0;font-weight:800;font-size:18px">Agenda de Capacitación</div>
    <div style="background:#fff;padding:28px 24px;border-radius:0 0 14px 14px">
      <h1 style="margin:0 0 12px;font-size:22px">${titulo}</h1>
      <p style="margin:0 0 18px;line-height:1.5">Hola ${esc(p.nombre_completo)}, ${mensaje}</p>
      <table style="width:100%;border-collapse:collapse;font-size:15px">
        <tr><td style="padding:8px 0;color:#6b6b6b;width:96px">Formación</td><td style="padding:8px 0;font-weight:700">${esc(ev.nombre)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b6b">Fecha</td><td style="padding:8px 0;font-weight:700">${esc(fecha)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b6b">Horario</td><td style="padding:8px 0;font-weight:700">${esc(horario)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b6b">Sala</td><td style="padding:8px 0;font-weight:700">${esc(ev.sala)}</td></tr>
        <tr><td style="padding:8px 0;color:#6b6b6b">Instructor</td><td style="padding:8px 0;font-weight:700">${esc(ev.instructor)}</td></tr>
      </table>
      ${boton}
      <p style="margin:24px 0 0;color:#6b6b6b;font-size:13px">Si no solicitaste esta postulación, puedes ignorar este mensaje.</p>
    </div>
  </div></body></html>`;

  return { asunto: inscrito ? `Cupo confirmado: ${ev.nombre}` : `Lista de espera: ${ev.nombre}`, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { codigo } = await req.json();
    if (typeof codigo !== "string" || !/^[0-9a-f]{32}$/.test(codigo)) return json({ enviado: false, motivo: "codigo_invalido" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: p } = await sb
      .from("postulaciones")
      .select("id, nombre_completo, correo, estado, correo_estado, codigo, eventos(nombre, fecha, hora_inicio, hora_fin, sala, instructor)")
      .eq("codigo", codigo)
      .maybeSingle();

    if (!p) return json({ enviado: false, motivo: "no_encontrada" }, 404);
    if (p.estado === "cancelado") return json({ enviado: false, motivo: "cancelada" });

    // Reserva el envío para este estado: si otra llamada ya lo reservó, no se repite
    const anterior = p.correo_estado;
    const { data: reservada } = await sb
      .from("postulaciones")
      .update({ correo_estado: p.estado })
      .eq("id", p.id)
      .or(`correo_estado.is.null,correo_estado.neq.${p.estado}`)
      .select("id");
    if (!reservada?.length) return json({ enviado: false, motivo: "ya_enviado" });

    const siteUrl = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
    const { asunto, html } = plantilla(p, p.eventos, siteUrl);

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: REMITENTE, to: [p.correo], subject: asunto, html }),
    });

    if (!resp.ok) {
      console.error("Resend rechazó el envío", resp.status, await resp.text());
      await sb.from("postulaciones").update({ correo_estado: anterior, correo_enviado: false }).eq("id", p.id);
      return json({ enviado: false, motivo: "fallo_envio" });
    }

    await sb.from("postulaciones").update({ correo_enviado: true }).eq("id", p.id);
    return json({ enviado: true });
  } catch (e) {
    console.error(e);
    return json({ enviado: false, motivo: "error" }, 500);
  }
});
