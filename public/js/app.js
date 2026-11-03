// Lógica compartida: cliente de Supabase, sesión, encabezado y utilidades
const sb = window.supabase.createClient(CONFIG.url, CONFIG.anonKey);

async function requerirSesion() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    const destino = location.pathname.split("/").pop() + location.search;
    location.href = "index.html?volver=" + encodeURIComponent(destino);
    return null;
  }
  return session;
}

function montarEncabezado(activo) {
  const enlaces = [
    ["panel.html", "Panel", "panel"],
    ["eventos.html", "Eventos", "eventos"],
  ];
  const el = document.getElementById("encabezado");
  el.className = "topbar";
  el.innerHTML = `
    <div class="topbar-inner">
      <div class="marca">Agenda de Capacitación<small>Centro de Capacitación y Aprendizaje</small></div>
      <nav class="nav">
        ${enlaces.map(([href, texto, id]) => `<a href="${href}" class="${id === activo ? "activo" : ""}">${texto}</a>`).join("")}
      </nav>
      <button class="salir" id="btn-salir">Cerrar sesión</button>
    </div>`;
  document.getElementById("btn-salir").addEventListener("click", async () => {
    await sb.auth.signOut();
    location.href = "index.html";
  });
}

// Página a la que volver tras iniciar sesión; solo se aceptan páginas internas (nunca otro sitio)
function destinoTrasLogin() {
  const v = new URLSearchParams(location.search).get("volver") || "";
  return /^[a-z0-9_-]+\.html(\?[A-Za-z0-9_=&%.-]*)?$/i.test(v) ? v : "panel.html";
}

function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatearFecha(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-VE", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function formatearHora(h) {
  return h ? h.slice(0, 5) : "";
}

// Trae eventos con sus conteos de postulaciones (inscritos, lista de espera, asistencia)
async function cargarEventosConConteos() {
  const [ev, po] = await Promise.all([
    sb.from("eventos").select("*").order("fecha", { ascending: true }).order("hora_inicio", { ascending: true }),
    sb.from("postulaciones").select("evento_id, estado, asistencia"),
  ]);
  if (ev.error) throw ev.error;
  if (po.error) throw po.error;
  const mapa = {};
  for (const p of po.data) {
    const c = (mapa[p.evento_id] ??= { inscritos: 0, espera: 0, asistio: 0, no_asistio: 0 });
    if (p.estado === "inscrito") {
      c.inscritos++;
      if (p.asistencia === "asistio") c.asistio++;
      if (p.asistencia === "no_asistio") c.no_asistio++;
    } else if (p.estado === "lista_espera") {
      c.espera++;
    }
  }
  return ev.data.map((e) => ({ ...e, ...(mapa[e.id] ?? { inscritos: 0, espera: 0, asistio: 0, no_asistio: 0 }) }));
}

function barraOcupacion(inscritos, cupo) {
  const pct = Math.min(100, Math.round((inscritos / cupo) * 100));
  return `<div class="barra ${inscritos >= cupo ? "llena" : ""}"><span style="width:${pct}%"></span></div>
          <div class="barra-texto">${inscritos} / ${cupo} cupos (${pct}%)</div>`;
}

function mostrarAviso(id, tipo, mensaje) {
  const el = document.getElementById(id);
  el.className = `aviso aviso-${tipo} visible`;
  el.textContent = mensaje;
}
