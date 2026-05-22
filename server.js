/**
 * server.js
 * Servidor HTTP + daemon de monitoreo.
 *
 * Endpoints:
 *   GET /api/estado       → Última lectura + evaluación completa
 *   GET /api/historial    → Últimas N lecturas (default: 48)
 *   GET /api/alertas      → Solo las alertas activas
 *   GET /health           → Healthcheck para monitoreo externo
 *   POST /api/test-alerta → Dispara una notificación de prueba
 *
 * Arrancar: node server.js
 * Con PM2:  pm2 start server.js --name alerta-heladas
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { fetchStationData } = require("./scraper");
const { evaluarAlertas } = require("./alertEngine");
const { despacharAlertas } = require("./notificaciones");

// ─── Configuración ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const INTERVALO_MS = (parseInt(process.env.INTERVALO_MIN) || 10) * 60 * 1000;
const HISTORIAL_MAX = 288; // 48 hs a lectura cada 10 min
const HISTORIAL_PATH = path.join(__dirname, "historial.json");

// ─── Estado en memoria ────────────────────────────────────────────────────────
let ultimaLectura = null;
let historial = cargarHistorial();

function cargarHistorial() {
  if (!fs.existsSync(HISTORIAL_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORIAL_PATH, "utf8"));
  } catch {
    return [];
  }
}

function guardarHistorial() {
  fs.writeFileSync(HISTORIAL_PATH, JSON.stringify(historial, null, 2));
}

// ─── Ciclo principal de monitoreo ─────────────────────────────────────────────
async function cicloMonitoreo() {
  console.log(`[${new Date().toISOString()}] Consultando estación...`);

  try {
    const datos = await fetchStationData();
    const evaluacion = evaluarAlertas(datos);

    ultimaLectura = evaluacion;

    // Guardar en historial
    historial.push({
      timestamp: datos.timestamp,
      temperatura: datos.temperatura,
      humedad: datos.humedad,
      presion: datos.presion?.valor,
      viento: datos.viento?.velocidad,
      puntoRocio: datos.puntoRocio,
      lluviaHoy: datos.lluviaHoy,
      nivelHelada: evaluacion.alertas.helada.nivel,
      nivelTormenta: evaluacion.alertas.tormenta.nivel,
    });

    // Mantener tamaño máximo
    if (historial.length > HISTORIAL_MAX) {
      historial = historial.slice(-HISTORIAL_MAX);
    }
    guardarHistorial();

    // Despachar notificaciones si hay alertas
    const resultados = await despacharAlertas(evaluacion);
    if (resultados.length > 0) {
      console.log(`[notif] ${resultados.length} notificación(es) enviadas`);
    }

    const { nivelGlobal } = evaluacion;
    const t = datos.temperatura;
    const p = datos.presion?.valor;
    console.log(`[OK] Temp: ${t}°C | Presión: ${p} hPa | Nivel: ${nivelGlobal.toUpperCase()}`);

  } catch (err) {
    console.error(`[ERROR] Ciclo de monitoreo:`, err.message);
  }
}

// ─── Servidor HTTP ────────────────────────────────────────────────────────────
function jsonResponse(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(data, null, 2));
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const ruta = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
    return res.end();
  }

  // ── GET /health
  if (ruta === "/health") {
    return jsonResponse(res, {
      ok: true,
      uptime: process.uptime(),
      ultimaLectura: ultimaLectura?.timestamp ?? null,
      historialEntradas: historial.length,
    });
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

  // ── GET /api/historial?n=48
  if (ruta === "/api/historial" && req.method === "GET") {
    const n = Math.min(parseInt(url.searchParams.get("n") || "48"), HISTORIAL_MAX);
    return jsonResponse(res, { entradas: historial.slice(-n) });
  }

  // ── POST /api/test-alerta
  if (ruta === "/api/test-alerta" && req.method === "POST") {
    if (!ultimaLectura) return jsonResponse(res, { error: "Sin datos aún" }, 503);
    // Fuerza nivel alerta para prueba
    const evalTest = JSON.parse(JSON.stringify(ultimaLectura));
    evalTest.alertas.helada.nivel = "alerta";
    evalTest.alertas.helada.mensaje = "PRUEBA — Alerta de helada simulada para verificar notificaciones";
    const r = await despacharAlertas(evalTest);
    return jsonResponse(res, { ok: true, notificaciones: r });
  }

  // ── Servir index.html en /
  if ((ruta === "/" || ruta === "/index.html") && req.method === "GET") {
    const htmlPath = path.join(__dirname, "index.html");
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(fs.readFileSync(htmlPath));
    }
  }

  // ── 404
  jsonResponse(res, { error: "Ruta no encontrada" }, 404);
});

// ─── Arranque ─────────────────────────────────────────────────────────────────
servidor.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🌡  Alerta Heladas Concordia`);
  console.log(`   Local:      http://localhost:${PORT}`);

  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`   Celular:    http://${net.address}:${PORT}  ← abrí esto en el celular`);
      }
    }
  }
  console.log(`   Intervalo:  ${INTERVALO_MS / 60000} min\n`);

  cicloMonitoreo();
  setInterval(cicloMonitoreo, INTERVALO_MS);
});

process.on("SIGTERM", () => {
  console.log("Apagando servidor...");
  servidor.close(() => process.exit(0));
});
