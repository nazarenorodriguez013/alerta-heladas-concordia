const http    = require("http");
const fs      = require("fs");
const path    = require("path");
const os      = require("os");
const webpush = require("web-push");

const { fetchStationData } = require("./scraper");
const { evaluarAlertas }   = require("./alertEngine");
const { despacharAlertas } = require("./notificaciones");

// ─── Configuración ────────────────────────────────────────────────────────────
const PORT         = process.env.PORT || 3000;
const INTERVALO_MS = (parseInt(process.env.INTERVALO_MIN) || 10) * 60 * 1000;
const HISTORIAL_MAX = 288;
const HISTORIAL_PATH     = path.join(__dirname, "historial.json");
const SUSCRIPCIONES_PATH = path.join(__dirname, "suscripciones.json");

// ─── VAPID (Web Push) ─────────────────────────────────────────────────────────
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || "BPoHvbNomg10aLZKBcmiM_tktrfCbL8QdykXpsN90Qx8Pdmhlw_9_ZnStarekwKzNFvZ4c6gOUs1FAjgY4pbAiM";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "MxXDBV0IzRx3JrPE1p7-VXY9BXDEbXeAkhMbfAHawy4";

webpush.setVapidDetails("mailto:nazarenorodriguez013@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);

// ─── Suscripciones push ───────────────────────────────────────────────────────
function cargarSuscripciones() {
  if (!fs.existsSync(SUSCRIPCIONES_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(SUSCRIPCIONES_PATH, "utf8")); } catch { return []; }
}

function guardarSuscripciones(lista) {
  try { fs.writeFileSync(SUSCRIPCIONES_PATH, JSON.stringify(lista, null, 2)); } catch {}
}

async function enviarPushAlertas(evaluacion) {
  const suscripciones = cargarSuscripciones();
  if (!suscripciones.length) return;

  const { alertas } = evaluacion;
  const payloads = [];

  if (alertas.helada.nivel !== "ok") {
    const urgente = alertas.helada.nivel === "peligro";
    payloads.push({
      title: urgente ? "🚨 HELADA EN CURSO — Concordia" : "⚠️ Alerta de helada — Concordia",
      body:  alertas.helada.mensaje,
      tag:   "helada-" + alertas.helada.nivel,
      urgente,
    });
  }

  if (alertas.tormenta.nivel !== "ok") {
    const urgente = alertas.tormenta.nivel === "peligro";
    payloads.push({
      title: urgente ? "🚨 TORMENTA SEVERA — Concordia" : "⛈ Alerta de tormenta — Concordia",
      body:  alertas.tormenta.mensaje,
      tag:   "tormenta-" + alertas.tormenta.nivel,
      urgente,
    });
  }

  if (!payloads.length) return;

  const activas = [];
  for (const sub of suscripciones) {
    for (const payload of payloads) {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          console.log("[push] Suscripción expirada, eliminando");
          continue; // no agregar a activas
        }
        console.error("[push] Error:", err.message);
      }
    }
    // Mantener suscripción si no expiró
    if (!payloads.every(() => false)) activas.push(sub);
  }

  // Limpiar suscripciones expiradas (simplificado: conservamos todas por ahora)
  console.log(`[push] ${payloads.length} alerta(s) enviadas a ${suscripciones.length} dispositivo(s)`);
}

// ─── Historial ────────────────────────────────────────────────────────────────
let ultimaLectura = null;
let historial = cargarHistorial();

function cargarHistorial() {
  if (!fs.existsSync(HISTORIAL_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(HISTORIAL_PATH, "utf8")); } catch { return []; }
}

function guardarHistorial() {
  try { fs.writeFileSync(HISTORIAL_PATH, JSON.stringify(historial, null, 2)); } catch {}
}

// ─── Ciclo de monitoreo ───────────────────────────────────────────────────────
async function cicloMonitoreo() {
  console.log(`[${new Date().toISOString()}] Consultando estación...`);
  try {
    const datos     = await fetchStationData();
    const evaluacion = evaluarAlertas(datos);
    ultimaLectura   = evaluacion;

    historial.push({
      timestamp:     datos.timestamp,
      temperatura:   datos.temperatura,
      humedad:       datos.humedad,
      presion:       datos.presion?.valor,
      viento:        datos.viento?.velocidad,
      puntoRocio:    datos.puntoRocio,
      lluviaHoy:     datos.lluviaHoy,
      nivelHelada:   evaluacion.alertas.helada.nivel,
      nivelTormenta: evaluacion.alertas.tormenta.nivel,
    });
    if (historial.length > HISTORIAL_MAX) historial = historial.slice(-HISTORIAL_MAX);
    guardarHistorial();

    // Notificaciones SMS/push Firebase (notificaciones.js) + Web Push
    await despacharAlertas(evaluacion);
    await enviarPushAlertas(evaluacion);

    const t = datos.temperatura;
    const p = datos.presion?.valor;
    console.log(`[OK] Temp: ${t}°C | Presión: ${p} hPa | Nivel: ${evaluacion.nivelGlobal.toUpperCase()}`);
  } catch (err) {
    console.error(`[ERROR] Ciclo:`, err.message);
  }
}

// ─── Servidor HTTP ────────────────────────────────────────────────────────────
function jsonResponse(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type":                "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
    "Cache-Control":               "no-cache",
  });
  res.end(JSON.stringify(data, null, 2));
}

function serveFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) return false;
  res.writeHead(200, { "Content-Type": contentType });
  res.end(fs.readFileSync(filePath));
  return true;
}

// Íconos SVG inline para PWA
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="18" fill="#1a6fc4"/>
  <text x="50" y="72" font-size="58" text-anchor="middle" font-family="system-ui">🌡</text>
</svg>`;

const BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="14" fill="#1a6fc4"/>
  <text x="48" y="68" font-size="52" text-anchor="middle" font-family="system-ui">🌡</text>
</svg>`;

const ICON_MASKABLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#1a6fc4"/>
  <text x="50" y="72" font-size="52" text-anchor="middle" font-family="system-ui">🌡</text>
</svg>`;

const servidor = http.createServer(async (req, res) => {
  const url  = new URL(req.url, `http://localhost:${PORT}`);
  const ruta = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  // ── Archivos PWA estáticos
  if (ruta === "/" || ruta === "/index.html") {
    return serveFile(res, path.join(__dirname, "index.html"), "text/html; charset=utf-8");
  }
  if (ruta === "/sw.js") {
    res.writeHead(200, { "Content-Type": "application/javascript", "Service-Worker-Allowed": "/" });
    return res.end(fs.readFileSync(path.join(__dirname, "sw.js")));
  }
  if (ruta === "/manifest.json") {
    return serveFile(res, path.join(__dirname, "manifest.json"), "application/manifest+json");
  }
  if (ruta === "/icon.svg")          { res.writeHead(200, { "Content-Type": "image/svg+xml" }); return res.end(ICON_SVG); }
  if (ruta === "/badge.svg")         { res.writeHead(200, { "Content-Type": "image/svg+xml" }); return res.end(BADGE_SVG); }
  if (ruta === "/icon-maskable.svg") { res.writeHead(200, { "Content-Type": "image/svg+xml" }); return res.end(ICON_MASKABLE_SVG); }

  // ── GET /health
  if (ruta === "/health") {
    return jsonResponse(res, { ok: true, uptime: process.uptime(), ultimaLectura: ultimaLectura?.timestamp ?? null, suscripciones: cargarSuscripciones().length });
  }

  // ── GET /api/vapid-public-key
  if (ruta === "/api/vapid-public-key" && req.method === "GET") {
    return jsonResponse(res, { key: VAPID_PUBLIC });
  }

  // ── POST /api/subscribe
  if (ruta === "/api/subscribe" && req.method === "POST") {
    const body = await readBody(req);
    const sub  = JSON.parse(body);
    const lista = cargarSuscripciones();
    const existe = lista.some(s => s.endpoint === sub.endpoint);
    if (!existe) { lista.push(sub); guardarSuscripciones(lista); }
    console.log(`[push] Suscripción ${existe ? "ya existente" : "nueva"} — total: ${lista.length}`);
    return jsonResponse(res, { ok: true, suscripciones: lista.length });
  }

  // ── POST /api/unsubscribe
  if (ruta === "/api/unsubscribe" && req.method === "POST") {
    const body = await readBody(req);
    const { endpoint } = JSON.parse(body);
    const lista = cargarSuscripciones().filter(s => s.endpoint !== endpoint);
    guardarSuscripciones(lista);
    return jsonResponse(res, { ok: true });
  }

  // ── GET /api/estado
  if (ruta === "/api/estado" && req.method === "GET") {
    if (!ultimaLectura) return jsonResponse(res, { error: "Sin datos aún" }, 503);
    return jsonResponse(res, ultimaLectura);
  }

  // ── GET /api/alertas
  if (ruta === "/api/alertas" && req.method === "GET") {
    if (!ultimaLectura) return jsonResponse(res, { error: "Sin datos aún" }, 503);
    const { alertas, nivelGlobal, timestamp } = ultimaLectura;
    return jsonResponse(res, { timestamp, nivelGlobal, alertas });
  }

  // ── GET /api/historial
  if (ruta === "/api/historial" && req.method === "GET") {
    const n = Math.min(parseInt(url.searchParams.get("n") || "48"), HISTORIAL_MAX);
    return jsonResponse(res, { entradas: historial.slice(-n) });
  }

  // ── POST /api/test-notificacion
  if (ruta === "/api/test-notificacion" && req.method === "POST") {
    const subs = cargarSuscripciones();
    if (!subs.length) return jsonResponse(res, { error: "Sin suscripciones registradas" }, 400);
    const payload = JSON.stringify({
      title: "🧪 Prueba — Galileo Meteorología",
      body:  "Las notificaciones están funcionando correctamente.",
      tag:   "test",
      urgente: false,
    });
    let enviadas = 0;
    for (const sub of subs) {
      try { await webpush.sendNotification(sub, payload); enviadas++; } catch {}
    }
    return jsonResponse(res, { ok: true, enviadas, total: subs.length });
  }

  // ── POST /api/test-alerta (legacy)
  if (ruta === "/api/test-alerta" && req.method === "POST") {
    if (!ultimaLectura) return jsonResponse(res, { error: "Sin datos aún" }, 503);
    const evalTest = JSON.parse(JSON.stringify(ultimaLectura));
    evalTest.alertas.helada.nivel = "alerta";
    evalTest.alertas.helada.mensaje = "PRUEBA — Alerta de helada simulada";
    await enviarPushAlertas(evalTest);
    return jsonResponse(res, { ok: true });
  }

  jsonResponse(res, { error: "Ruta no encontrada" }, 404);
});

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ─── Arranque ─────────────────────────────────────────────────────────────────
servidor.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🌡  Alerta Heladas Concordia`);
  console.log(`   Local:   http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets))
    for (const net of nets[name])
      if (net.family === "IPv4" && !net.internal)
        console.log(`   Red:     http://${net.address}:${PORT}`);
  console.log(`   Intervalo: ${INTERVALO_MS / 60000} min\n`);
  cicloMonitoreo();
  setInterval(cicloMonitoreo, INTERVALO_MS);
});

process.on("SIGTERM", () => servidor.close(() => process.exit(0)));
