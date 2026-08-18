/**
 * scraper.js
 * Lee la estación Galileo (UTN Concordia) y extrae las variables meteorológicas.
 * Fuente: https://galileo.frcon.utn.edu.ar
 */

const https = require("https");
const http  = require("http");

function fetchUrl(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const req = lib.get(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AlertaHeladas/1.0)" },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve(data));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout conectando con ${url}`));
    });
    req.on("error", reject);
  });
}

// Decodifica entidades HTML numéricas y nombradas
function decode(str) {
  return str
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .trim();
}

// Extrae pares { label → valor } del widget "Condiciones actuales"
function parseCurrentWidget(html) {
  // Aislar el bloque del widget actual para no confundir con otras tablas
  const start = html.indexOf("id='current_widget'");
  const end   = html.indexOf("id='hilo_widget'");
  const section = (start !== -1 && end !== -1) ? html.slice(start, end) : html;

  const pairs = {};
  const rowRe = /<td class="label">([\s\S]*?)<\/td>\s*<td class="data">([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = rowRe.exec(section)) !== null) {
    const label = decode(m[1].replace(/<[^>]+>/g, ""));
    const value = decode(m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " "));
    if (label && value) pairs[label] = value;
  }
  return pairs;
}

// Parsers individuales
function parseFloat1(s) {
  if (!s) return null;
  const m = s.match(/([-\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

function parseTemp(s) { return parseFloat1(s); }

function parsePct(s) {
  if (!s) return null;
  const m = s.match(/([\d.]+)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

function parsePressure(s) {
  if (!s) return null;
  // "1025.6 hPa (1.2)" o "1025.6 hPa (-0.5)"
  const m = s.match(/([\d.]+)\s*hPa\s*\(([-\d.]+)\)/);
  if (!m) {
    const m2 = s.match(/([\d.]+)\s*hPa/);
    return m2 ? { valor: parseFloat(m2[1]), delta: 0 } : null;
  }
  return { valor: parseFloat(m[1]), delta: parseFloat(m[2]) };
}

function parseWind(s) {
  if (!s) return null;
  // "3 km/h SE (135°)" o "Calma"
  if (/calma/i.test(s)) return { velocidad: 0, direccionTexto: "Calma", direccionGrados: 0 };
  const m = s.match(/([\d.]+)\s*km\/h\s+(\S+)\s*\((\d+)/i);
  return m ? { velocidad: parseFloat(m[1]), direccionTexto: m[2], direccionGrados: parseInt(m[3]) } : null;
}

function parseMm(s) {
  if (!s) return null;
  const m = s.match(/([\d.]+)\s*mm/);
  return m ? parseFloat(m[1]) : null;
}

async function fetchStationData() {
  const url  = "https://galileo.frcon.utn.edu.ar/index.html";
  const html = await fetchUrl(url);
  const p    = parseCurrentWidget(html);

  const data = {
    timestamp:        new Date().toISOString(),
    fuente:           url,
    temperatura:      parseTemp(p["Temperatura externa"]),
    indiceCalor:      parseTemp(p["Índice de calor"]),
    sensacionTermica: parseTemp(p["Factor de sensación térmica"]),
    puntoRocio:       parseTemp(p["Punto de rocío"]),
    humedad:          parsePct(p["Humedad externa"]),
    presion:          parsePressure(p["Barómetro"]),
    viento:           parseWind(p["Viento"]),
    lluviaHoy:        parseMm(p["La lluvia de hoy"]),
    promLluvia:       parseMm(p["Promedio de lluvia"]),
    radiacion:        parseFloat1(p["Radiación"]),
    uv:               (p["Índice ultravioleta (UV)"] || "").includes("N/A") ? null : parseFloat1(p["Índice ultravioleta (UV)"]),
  };

  return data;
}

module.exports = { fetchStationData };
