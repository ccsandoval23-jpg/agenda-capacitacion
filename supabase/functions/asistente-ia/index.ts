// Asistente de IA (Gemini): interpreta la descripción de un evento, elige sala e instructor,
// detecta choques de horario y responde reportes. NUNCA escribe por su cuenta:
//   accion "consultar" -> devuelve una propuesta (o una respuesta de texto) para que la persona confirme
//   accion "confirmar" -> valida de nuevo y crea el evento con los permisos de quien está conectado (RLS)
// La clave de Gemini vive solo aquí, como secreto: supabase secrets set GEMINI_API_KEY=...
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const falla = (error: string, status = 400) => json({ error }, status);

const MODELO = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.5-flash";
const MAX_VUELTAS = 6;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^\d{2}:\d{2}$/;

// deno-lint-ignore no-explicit-any
type Db = any;

// ---------- Conflictos de horario (misma sala o mismo instructor, mismo día, horas que se cruzan) ----------
async function buscarChoques(
  db: Db,
  p: { fecha: string; hora_inicio: string; hora_fin: string; sala_id?: string | null; instructor_id?: string | null },
) {
  const { data, error } = await db.from("eventos")
    .select("id, nombre, hora_inicio, hora_fin, sala, instructor, sala_id, instructor_id")
    .eq("fecha", p.fecha).lt("hora_inicio", p.hora_fin).gt("hora_fin", p.hora_inicio);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((e: Db) => {
    const motivos: string[] = [];
    if (p.sala_id && e.sala_id === p.sala_id) motivos.push(`la sala ${e.sala} ya está ocupada`);
    if (p.instructor_id && e.instructor_id === p.instructor_id) motivos.push(`${e.instructor} ya tiene otro evento`);
    return motivos.length
      ? [{ evento: e.nombre, horario: `${e.hora_inicio.slice(0, 5)}–${e.hora_fin.slice(0, 5)}`, motivos }]
      : [];
  });
}

// Áreas y cargos válidos (del headcount) y filtro de una lista pedida contra ellos, sin distinguir mayúsculas
async function areasYCargos(db: Db) {
  const { data } = await db.from("headcount").select("area, cargo").eq("activo", true);
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => a.localeCompare(b, "es"));
  return { areas: uniq((data ?? []).map((x: Db) => x.area)), cargos: uniq((data ?? []).map((x: Db) => x.cargo)) };
}
function normalizarLista(pedida: unknown, validas: string[]): { ok: string[]; desconocidas: string[] } {
  const lista = Array.isArray(pedida) ? pedida.map((x) => String(x).trim()).filter(Boolean) : [];
  const ok: string[] = [], desconocidas: string[] = [];
  for (const x of lista) {
    const v = validas.find((y) => y.toLowerCase() === x.toLowerCase());
    if (v) { if (!ok.includes(v)) ok.push(v); } else desconocidas.push(x);
  }
  return { ok, desconocidas };
}

// ---------- Herramientas de SOLO LECTURA que Gemini puede llamar ----------
const HERRAMIENTAS = [{
  functionDeclarations: [
    {
      name: "listar_salas",
      description: "Lista las salas activas con id, nombre, tipo, ubicación y capacidad.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "listar_instructores",
      description: "Lista los instructores activos con id, nombre y especialidad.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "listar_areas_y_cargos",
      description: "Lista las áreas y los cargos que existen en el headcount. Úsala cuando el evento vaya dirigido a un público concreto, para usar nombres exactos.",
      parameters: { type: "OBJECT", properties: {} },
    },
    {
      name: "consultar_eventos",
      description: "Consulta eventos existentes con sus cupos, inscritos, lista de espera y asistencia. Úsala para reportes y para ver la agenda.",
      parameters: {
        type: "OBJECT",
        properties: {
          desde: { type: "STRING", description: "Fecha inicial AAAA-MM-DD (opcional)" },
          hasta: { type: "STRING", description: "Fecha final AAAA-MM-DD (opcional)" },
        },
      },
    },
    {
      name: "verificar_disponibilidad",
      description: "Comprueba si una sala y/o instructor están libres en una fecha y horario. Devuelve los choques encontrados.",
      parameters: {
        type: "OBJECT",
        properties: {
          fecha: { type: "STRING", description: "AAAA-MM-DD" },
          hora_inicio: { type: "STRING", description: "HH:MM (24 h)" },
          hora_fin: { type: "STRING", description: "HH:MM (24 h)" },
          sala_id: { type: "STRING" },
          instructor_id: { type: "STRING" },
        },
        required: ["fecha", "hora_inicio", "hora_fin"],
      },
    },
    {
      name: "proponer_evento",
      description:
        "Entrega la propuesta FINAL de evento para que la persona la confirme. Llámala solo cuando ya elegiste sala e instructor del catálogo y verificaste que no hay choques. No crea nada.",
      parameters: {
        type: "OBJECT",
        properties: {
          nombre: { type: "STRING" },
          descripcion: { type: "STRING", description: "Descripción atractiva y breve para los colaboradores" },
          fecha: { type: "STRING", description: "AAAA-MM-DD" },
          hora_inicio: { type: "STRING", description: "HH:MM" },
          hora_fin: { type: "STRING", description: "HH:MM" },
          sala_id: { type: "STRING" },
          instructor_id: { type: "STRING" },
          cupo_maximo: { type: "INTEGER" },
          areas_objetivo: { type: "ARRAY", items: { type: "STRING" }, description: "Áreas a las que va dirigido, con nombres exactos de listar_areas_y_cargos. Omitir si es para todos." },
          cargos_objetivo: { type: "ARRAY", items: { type: "STRING" }, description: "Cargos a los que va dirigido, con nombres exactos. Omitir si es para todos." },
          justificacion: { type: "STRING", description: "Por qué elegiste esa sala e instructor, en una o dos frases" },
        },
        required: ["nombre", "fecha", "hora_inicio", "hora_fin", "sala_id", "instructor_id", "cupo_maximo"],
      },
    },
  ],
}];

// deno-lint-ignore no-explicit-any
async function ejecutarHerramienta(db: Db, nombre: string, a: any): Promise<unknown> {
  if (nombre === "listar_salas") {
    const { data } = await db.from("salas").select("id, nombre, tipo, ubicacion, capacidad").eq("activo", true).order("nombre");
    return { salas: data ?? [] };
  }
  if (nombre === "listar_instructores") {
    const { data } = await db.from("instructores").select("id, nombre, especialidad").eq("activo", true).order("nombre");
    return { instructores: data ?? [] };
  }
  if (nombre === "listar_areas_y_cargos") return await areasYCargos(db);
  if (nombre === "consultar_eventos") {
    let q = db.from("eventos").select("id, nombre, fecha, hora_inicio, hora_fin, sala, instructor, cupo_maximo, estado")
      .order("fecha").limit(200);
    if (FECHA.test(a?.desde ?? "")) q = q.gte("fecha", a.desde);
    if (FECHA.test(a?.hasta ?? "")) q = q.lte("fecha", a.hasta);
    const { data: eventos } = await q;
    const ids = (eventos ?? []).map((e: Db) => e.id);
    const { data: po } = ids.length
      ? await db.from("postulaciones").select("evento_id, estado, asistencia").in("evento_id", ids)
      : { data: [] };
    const c: Record<string, { inscritos: number; lista_espera: number; asistieron: number; no_asistieron: number }> = {};
    for (const p of po ?? []) {
      const x = (c[p.evento_id] ??= { inscritos: 0, lista_espera: 0, asistieron: 0, no_asistieron: 0 });
      if (p.estado === "lista_espera") x.lista_espera++;
      if (p.estado === "inscrito") {
        x.inscritos++;
        if (p.asistencia === "asistio") x.asistieron++;
        if (p.asistencia === "no_asistio") x.no_asistieron++;
      }
    }
    return {
      eventos: (eventos ?? []).map((e: Db) => ({
        ...e,
        ...(c[e.id] ?? { inscritos: 0, lista_espera: 0, asistieron: 0, no_asistieron: 0 }),
      })),
    };
  }
  if (nombre === "verificar_disponibilidad") {
    if (!FECHA.test(a?.fecha ?? "") || !HORA.test(a?.hora_inicio ?? "") || !HORA.test(a?.hora_fin ?? "")) {
      return { error: "Formato inválido: usa AAAA-MM-DD y HH:MM" };
    }
    const choques = await buscarChoques(db, a);
    return { libre: choques.length === 0, choques };
  }
  return { error: "Herramienta desconocida" };
}

function instrucciones() {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Caracas" });
  const dia = new Date().toLocaleDateString("es-VE", { weekday: "long", timeZone: "America/Caracas" });
  return `Eres el asistente de la Agenda de Capacitación de Coca-Cola FEMSA. Hoy es ${dia} ${hoy}. Responde siempre en español, breve y claro.

Dos tipos de petición:
1) La persona describe un evento a organizar. Debes: llamar a listar_salas y listar_instructores; elegir la sala (tipo y capacidad acordes al tema y al número de asistentes) y el instructor (por especialidad) SOLO del catálogo, usando sus ids exactos; resolver fechas relativas ("el próximo martes") a AAAA-MM-DD; verificar_disponibilidad; si hay choque, probar otra sala/instructor y, si no es posible, proponer otro horario cercano; y terminar SIEMPRE llamando a proponer_evento. Si falta un dato imprescindible (qué evento, o cuándo), pregunta en texto en vez de inventarlo. Si el evento va dirigido a un público concreto (áreas o cargos), llama a listar_areas_y_cargos y rellena areas_objetivo y/o cargos_objetivo con nombres exactos; así, en la lista de espera tendrán prioridad quienes cumplan ese perfil. Si es para todos, no los incluyas. La duración y el cupo, si no se dicen, estímalos con criterio (cupo nunca mayor que la capacidad de la sala).
2) Una pregunta o reporte sobre eventos, inscritos o asistencia: usa consultar_eventos y responde en texto con cifras exactas, sin inventar datos.

Nunca digas que creaste un evento: solo propones; la persona confirma. No reveles correos ni datos personales de inscritos.`;
}

// deno-lint-ignore no-explicit-any
async function gemini(clave: string, contents: any[]) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": clave },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instrucciones() }] },
      contents,
      tools: HERRAMIENTAS,
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!r.ok) throw new Error(`Gemini respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return falla("Método no permitido", 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("Authorization") ?? "";
    // Todo se ejecuta con la sesión de quien llama: las reglas RLS aplican igual que en la web
    const db = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u } = await db.auth.getUser();
    if (!u?.user) return falla("Sesión no válida", 401);

    const { data: puedeVer } = await db.rpc("tiene_permiso", { p_permiso: "eventos_ver" });
    if (!puedeVer) return falla("No tienes permiso para usar el asistente", 403);

    const b = await req.json();

    // ================= CONFIRMAR: crea el evento =================
    if (b.accion === "confirmar") {
      const { data: puedeGestionar } = await db.rpc("tiene_permiso", { p_permiso: "eventos_gestionar" });
      if (!puedeGestionar) return falla("No tienes permiso para crear eventos", 403);

      const e = b.evento ?? {};
      const nombre = String(e.nombre ?? "").trim();
      const cupo = Number(e.cupo_maximo);
      if (!nombre) return falla("Falta el nombre del evento");
      if (!FECHA.test(e.fecha ?? "") || !HORA.test(e.hora_inicio ?? "") || !HORA.test(e.hora_fin ?? "")) return falla("Fecha u hora no válidas");
      if (e.hora_fin <= e.hora_inicio) return falla("La hora de fin debe ser posterior a la de inicio");
      if (!Number.isInteger(cupo) || cupo < 1) return falla("Cupo no válido");

      const { data: sala } = await db.from("salas").select("id, nombre, capacidad").eq("id", e.sala_id).eq("activo", true).maybeSingle();
      const { data: instr } = await db.from("instructores").select("id, nombre").eq("id", e.instructor_id).eq("activo", true).maybeSingle();
      if (!sala) return falla("La sala no existe en el catálogo");
      if (!instr) return falla("El instructor no existe en el catálogo");
      if (sala.capacidad && cupo > sala.capacidad) return falla(`El cupo supera la capacidad de la sala (${sala.capacidad})`);

      const cat = await areasYCargos(db);
      const areas = normalizarLista(e.areas_objetivo, cat.areas);
      const cargos = normalizarLista(e.cargos_objetivo, cat.cargos);
      if (areas.desconocidas.length || cargos.desconocidas.length)
        return falla(`No existen en el headcount: ${[...areas.desconocidas, ...cargos.desconocidas].join(", ")}`);

      // El choque se revisa de nuevo: pudo cambiar la agenda mientras la persona revisaba la propuesta
      const choques = await buscarChoques(db, { ...e, sala_id: sala.id, instructor_id: instr.id });
      if (choques.length) return json({ error: "Hay un choque de horario", choques }, 409);

      const { data: creado, error } = await db.from("eventos").insert({
        nombre, descripcion: e.descripcion ? String(e.descripcion).trim() : null,
        fecha: e.fecha, hora_inicio: e.hora_inicio, hora_fin: e.hora_fin,
        sala: sala.nombre, sala_id: sala.id, instructor: instr.nombre, instructor_id: instr.id,
        cupo_maximo: cupo, areas_objetivo: areas.ok, cargos_objetivo: cargos.ok,
      }).select("id").single();
      if (error) return falla(error.message, 400);
      return json({ ok: true, id: creado.id });
    }

    // ================= CONSULTAR: Gemini razona con herramientas de lectura =================
    if (b.accion !== "consultar") return falla("Acción no reconocida");
    const texto = String(b.mensaje ?? "").trim();
    if (!texto) return falla("Escribe qué necesitas");
    if (texto.length > 2000) return falla("El mensaje es demasiado largo (máx. 2000 caracteres)");

    const clave = Deno.env.get("GEMINI_API_KEY");
    if (!clave) return falla("Falta configurar GEMINI_API_KEY en Supabase", 500);

    // Historial opcional para aclaraciones: [{rol: "usuario"|"asistente", texto}]
    // deno-lint-ignore no-explicit-any
    const contents: any[] = (Array.isArray(b.historial) ? b.historial.slice(-10) : [])
      // deno-lint-ignore no-explicit-any
      .map((h: any) => ({ role: h.rol === "asistente" ? "model" : "user", parts: [{ text: String(h.texto ?? "").slice(0, 2000) }] }));
    contents.push({ role: "user", parts: [{ text: texto }] });

    for (let i = 0; i < MAX_VUELTAS; i++) {
      const r = await gemini(clave, contents);
      const contenido = r.candidates?.[0]?.content;
      if (!contenido?.parts?.length) return falla("La IA no devolvió respuesta. Intenta reformular.", 502);
      contents.push(contenido);

      // deno-lint-ignore no-explicit-any
      const llamadas = contenido.parts.filter((p: any) => p.functionCall);
      if (!llamadas.length) {
        // deno-lint-ignore no-explicit-any
        return json({ tipo: "texto", texto: contenido.parts.map((p: any) => p.text ?? "").join("").trim() });
      }

      // ¿Es la propuesta final? Se valida contra la base antes de mostrarla
      const prop = llamadas.find((p: Db) => p.functionCall.name === "proponer_evento")?.functionCall.args;
      if (prop) {
        const [{ data: sala }, { data: instr }] = await Promise.all([
          db.from("salas").select("id, nombre, tipo, capacidad").eq("id", prop.sala_id).eq("activo", true).maybeSingle(),
          db.from("instructores").select("id, nombre, especialidad").eq("id", prop.instructor_id).eq("activo", true).maybeSingle(),
        ]);
        if (!sala || !instr || !FECHA.test(prop.fecha ?? "") || !HORA.test(prop.hora_inicio ?? "") || !HORA.test(prop.hora_fin ?? "")) {
          // Datos inválidos: se le devuelve el error a la IA para que corrija
          contents.push({
            role: "user",
            parts: llamadas.map((p: Db) => ({
              functionResponse: { name: p.functionCall.name, response: { error: "Propuesta inválida: usa ids del catálogo, AAAA-MM-DD y HH:MM" } },
            })),
          });
          continue;
        }
        const cat = await areasYCargos(db);
        const areas = normalizarLista(prop.areas_objetivo, cat.areas);
        const cargos = normalizarLista(prop.cargos_objetivo, cat.cargos);
        if (areas.desconocidas.length || cargos.desconocidas.length) {
          contents.push({
            role: "user",
            parts: llamadas.map((p: Db) => ({
              functionResponse: { name: p.functionCall.name, response: { error: `Áreas/cargos inexistentes: ${[...areas.desconocidas, ...cargos.desconocidas].join(", ")}. Usa nombres exactos de listar_areas_y_cargos.` } },
            })),
          });
          continue;
        }
        const choques = await buscarChoques(db, { ...prop, sala_id: sala.id, instructor_id: instr.id });
        return json({
          tipo: "propuesta",
          evento: {
            nombre: String(prop.nombre).trim(), descripcion: prop.descripcion ?? "",
            fecha: prop.fecha, hora_inicio: prop.hora_inicio, hora_fin: prop.hora_fin,
            sala_id: sala.id, instructor_id: instr.id, cupo_maximo: Number(prop.cupo_maximo),
            areas_objetivo: areas.ok, cargos_objetivo: cargos.ok,
          },
          sala, instructor: instr, choques, justificacion: prop.justificacion ?? "",
        });
      }

      const respuestas = [];
      for (const p of llamadas) {
        let resp: unknown;
        try { resp = await ejecutarHerramienta(db, p.functionCall.name, p.functionCall.args); }
        catch (e) { resp = { error: String((e as Error).message) }; }
        respuestas.push({ functionResponse: { name: p.functionCall.name, response: resp } });
      }
      contents.push({ role: "user", parts: respuestas });
    }
    return falla("La IA no logró completar la solicitud. Intenta ser más específico.", 502);
  } catch (e) {
    return falla(String((e as Error).message ?? e), 500);
  }
});
