// Lógica compartida: cliente de Supabase, sesión, encabezado y utilidades
const sb = window.supabase.createClient(CONFIG.url, CONFIG.anonKey);

// Permisos disponibles (deben coincidir con la restricción de la tabla roles)
const PERMISOS_CAT = [
  ["eventos_ver", "Ver panel, eventos e inscritos", "Consultar el panel, la lista de eventos, inscritos y lista de espera."],
  ["eventos_gestionar", "Gestionar eventos", "Crear, editar y eliminar eventos."],
  ["inscritos_gestionar", "Gestionar inscritos", "Cancelar postulaciones e inscribir desde la lista de espera."],
  ["asistencia_registrar", "Registrar asistencia", "Marcar asistencia manualmente o con el código QR."],
  ["catalogos_gestionar", "Gestionar instructores y salas", "Crear, editar y eliminar instructores y salas."],
  ["usuarios_gestionar", "Gestionar usuarios y roles", "Crear usuarios y cambiar permisos. Solo el rol Administrador."],
];
let PERFIL = null;
let PERMISOS = new Set();
const puede = (permiso) => PERMISOS.has(permiso);

async function requerirSesion(permiso) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    const destino = location.pathname.split("/").pop() + location.search;
    location.href = "index.html?volver=" + encodeURIComponent(destino);
    return null;
  }
  const { data: perfil, error } = await sb.from("perfiles").select("nombre, correo, rol, activo").eq("user_id", session.user.id).maybeSingle();
  if (error) {
    // La tabla de perfiles aún no existe (migración 006 pendiente): se comporta como antes
    PERFIL = { nombre: session.user.email, correo: session.user.email, rol: "admin", rolNombre: "Administrador" };
    PERMISOS = new Set(PERMISOS_CAT.map((p) => p[0]));
  } else if (!perfil || !perfil.activo) {
    await sb.auth.signOut();
    location.href = "index.html?sin_acceso=1";
    return null;
  } else {
    const { data: rol } = await sb.from("roles").select("nombre, permisos").eq("clave", perfil.rol).maybeSingle();
    PERFIL = { ...perfil, rolNombre: rol?.nombre ?? perfil.rol };
    PERMISOS = new Set(perfil.rol === "admin" ? PERMISOS_CAT.map((p) => p[0]) : (rol?.permisos ?? []));
  }
  if (permiso && !puede(permiso)) {
    montarEncabezado("");
    document.querySelector("main").innerHTML =
      '<div class="tarjeta vacio"><h2>No tienes permiso para ver esta sección</h2><p>Pide al administrador que revise tu rol.</p><p><a class="btn" href="panel.html">Volver al inicio</a></p></div>';
    return null;
  }
  return session;
}

const TIPOS_SALA = { aula: "Aula", laboratorio: "Laboratorio / cómputo", auditorio: "Auditorio", reuniones: "Sala de reuniones", virtual: "Virtual", otro: "Otro" };

const ICONOS = {
  panel: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
  eventos: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/><path d="M8 14.5h2M14 14.5h2M8 17.5h2"/></svg>',
  instructores: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>',
  salas: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M2 21h20"/><path d="M16 9h2a2 2 0 0 1 2 2v10"/><circle cx="12" cy="13" r=".8" fill="currentColor"/></svg>',
  usuarios: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>',
  salir: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/></svg>',
};

function montarEncabezado(activo) {
  const enlaces = [
    ["panel.html", "Panel", "panel", ICONOS.panel, "eventos_ver"],
    ["eventos.html", "Eventos", "eventos", ICONOS.eventos, "eventos_ver"],
    ["instructores.html", "Instructores", "instructores", ICONOS.instructores, "catalogos_gestionar"],
    ["salas.html", "Salas", "salas", ICONOS.salas, "catalogos_gestionar"],
    ["usuarios.html", "Usuarios", "usuarios", ICONOS.usuarios, "usuarios_gestionar"],
  ].filter((e) => puede(e[4]));
  const el = document.getElementById("encabezado");
  el.className = "sidebar";
  document.body.classList.add("con-menu");
  el.innerHTML = `
    <div class="sidebar-logo"><img width="160" src="img/logo.png" alt="Coca-Cola FEMSA"></div>
    <div class="marca">Agenda de Capacitación<small>Centro de Capacitación y Aprendizaje</small></div>
    <nav class="nav">
      ${enlaces.map(([href, texto, id, ico]) => `<a href="${href}" class="${id === activo ? "activo" : ""}"><span class="ico">${ico}</span>${texto}</a>`).join("")}
    </nav>
    ${PERFIL ? `<div class="sidebar-usuario"><strong>${esc(PERFIL.nombre)}</strong><span>${esc(PERFIL.rolNombre)}</span></div>` : ""}
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
