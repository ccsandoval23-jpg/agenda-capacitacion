// Gestión de usuarios del equipo (solo administradores).
// Crear cuentas requiere la clave de servicio, que nunca sale de esta función.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const falla = (error: string, status = 400) => json({ error }, status);

const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return falla("Método no permitido", 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("Authorization") ?? "";

    // 1. ¿Quién llama? Debe ser un administrador activo.
    const quien = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await quien.auth.getUser();
    if (!u?.user) return falla("Sesión no válida", 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: yo } = await admin.from("perfiles").select("rol, activo").eq("user_id", u.user.id).maybeSingle();
    if (!yo || !yo.activo || yo.rol !== "admin") return falla("Solo los administradores pueden gestionar usuarios", 403);

    const b = await req.json();
    const accion = b.accion;

    // Cuántos administradores activos hay (para no quedarse sin ninguno)
    const adminsActivos = async (excluyendo?: string) => {
      const { data } = await admin.from("perfiles").select("user_id").eq("rol", "admin").eq("activo", true);
      return (data ?? []).filter((x) => x.user_id !== excluyendo).length;
    };

    const rolValido = async (rol: unknown) => {
      if (typeof rol !== "string") return false;
      const { data } = await admin.from("roles").select("clave").eq("clave", rol).maybeSingle();
      return !!data;
    };

    if (accion === "listar") {
      const { data: perfiles, error } = await admin.from("perfiles").select("*").order("nombre");
      if (error) return falla(error.message, 500);
      const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const acceso = new Map((lista?.users ?? []).map((x) => [x.id, x.last_sign_in_at]));
      return json({ usuarios: perfiles.map((p) => ({ ...p, ultimo_acceso: acceso.get(p.user_id) ?? null })) });
    }

    if (accion === "crear") {
      const nombre = String(b.nombre ?? "").trim();
      const correo = String(b.correo ?? "").trim().toLowerCase();
      const clave = String(b.clave ?? "");
      if (!nombre) return falla("Falta el nombre");
      if (!CORREO.test(correo)) return falla("Correo no válido");
      if (clave.length < 8) return falla("La contraseña debe tener al menos 8 caracteres");
      if (!(await rolValido(b.rol))) return falla("Rol no válido");

      const { data: nuevo, error } = await admin.auth.admin.createUser({
        email: correo, password: clave, email_confirm: true, user_metadata: { nombre },
      });
      if (error || !nuevo.user) {
        const ya = /already|registered|exists/i.test(error?.message ?? "");
        return falla(ya ? "Ya existe un usuario con ese correo" : (error?.message ?? "No se pudo crear"), ya ? 409 : 400);
      }
      const { error: e2 } = await admin.from("perfiles").insert({ user_id: nuevo.user.id, nombre, correo, rol: b.rol });
      if (e2) {
        await admin.auth.admin.deleteUser(nuevo.user.id);
        return falla(e2.message, 500);
      }
      return json({ ok: true });
    }

    const id = String(b.user_id ?? "");
    if (!/^[0-9a-f-]{36}$/.test(id)) return falla("Usuario no válido");
    const { data: objetivo } = await admin.from("perfiles").select("*").eq("user_id", id).maybeSingle();
    if (!objetivo) return falla("No se encontró el usuario", 404);

    if (accion === "actualizar") {
      const cambios: Record<string, unknown> = {};
      if (b.nombre !== undefined) {
        const n = String(b.nombre).trim();
        if (!n) return falla("Falta el nombre");
        cambios.nombre = n;
      }
      if (b.rol !== undefined) {
        if (!(await rolValido(b.rol))) return falla("Rol no válido");
        cambios.rol = b.rol;
      }
      if (b.activo !== undefined) cambios.activo = !!b.activo;

      const quedaAdminActivo = (cambios.rol ?? objetivo.rol) === "admin" && (cambios.activo ?? objetivo.activo);
      if (objetivo.rol === "admin" && objetivo.activo && !quedaAdminActivo) {
        if (id === u.user.id) return falla("No puedes quitarte tu propio acceso de administrador");
        if ((await adminsActivos(id)) < 1) return falla("Debe quedar al menos un administrador activo");
      }

      if (b.clave !== undefined && b.clave !== "") {
        if (String(b.clave).length < 8) return falla("La contraseña debe tener al menos 8 caracteres");
        const { error } = await admin.auth.admin.updateUserById(id, { password: String(b.clave) });
        if (error) return falla(error.message);
      }
      if (cambios.activo !== undefined) {
        await admin.auth.admin.updateUserById(id, { ban_duration: cambios.activo ? "none" : "876000h" });
      }
      if (Object.keys(cambios).length) {
        const { error } = await admin.from("perfiles").update(cambios).eq("user_id", id);
        if (error) return falla(error.message, 500);
      }
      return json({ ok: true });
    }

    if (accion === "eliminar") {
      if (id === u.user.id) return falla("No puedes eliminar tu propia cuenta");
      if (objetivo.rol === "admin" && objetivo.activo && (await adminsActivos(id)) < 1)
        return falla("Debe quedar al menos un administrador activo");
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return falla(error.message, 500);
      return json({ ok: true });
    }

    return falla("Acción no reconocida");
  } catch (e) {
    return falla(String((e as Error).message ?? e), 500);
  }
});
