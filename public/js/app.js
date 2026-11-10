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

const ICONOS = {
  panel: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  eventos: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/><path d="M8 14.5h2M14 14.5h2M8 17.5h2"/></svg>',
  salir: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
};

function montarEncabezado(activo) {
  const enlaces = [
    ["panel.html", "Panel", "panel", ICONOS.panel],
    ["eventos.html", "Eventos", "eventos", ICONOS.eventos],
  ];
  const el = document.getElementById("encabezado");
  el.className = "sidebar";
  document.body.classList.add("con-menu");
  el.innerHTML = `
    <div class="sidebar-logo"><img width="160" src="img/logo.png" alt="Coca-Cola FEMSA"></div>
    <div class="marca">Agenda de Capacitación<small>Centro de Capacitación y Aprendizaje</small></div>
    <nav class="nav">
      ${enlaces.map(([href, texto, id, ico]) => `<a href="${href}" class="${id === activo ? "activo" : ""}"><span class="ico">${ico}</span>${texto}</a>`).join("")}
    </nav>
    <button class="salir" id="btn-salir">${ICONOS.salir}Cerrar sesión</button>`;
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
