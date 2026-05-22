/**
 * notificaciones.js
 * Despacha alertas por SMS (Twilio) y/o push (Firebase FCM).
 * Lleva registro de notificaciones enviadas para evitar spam.
 *
 * Dependencias: npm install twilio firebase-admin
 */

const fs = require("fs");
const path = require("path");

// ─── Configuración (via variables de entorno) ─────────────────────────────────
const CONFIG = {
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_FROM_NUMBER, // ej: "+549345XXXXXXX"
  },
  firebase: {
    credentialsPath: process.env.FIREBASE_CREDENTIALS_PATH, // ruta al JSON de service account
    projectId: process.env.FIREBASE_PROJECT_ID,
  },
};

// ─── Destinatarios (productores) ─────────────────────────────────────────────
// Cargar desde archivo JSON para gestión sin redeployment
const DESTINATARIOS_PATH = path.join(__dirname, "destinatarios.json");

function cargarDestinatarios() {
  if (!fs.existsSync(DESTINATARIOS_PATH)) {
    console.warn("[notif] destinatarios.json no encontrado. Creando ejemplo...");
    const ejemplo = [
      {
        nombre: "Juan Pérez",
        telefono: "+549345XXXXXXX",
        fcmToken: null,
        alertas: ["helada", "tormenta"],
        nivelMinimo: "vigilancia", // ok | vigilancia | alerta | peligro
        activo: true,
      },
      {
        nombre: "María González",
        telefono: "+549345YYYYYYY",
        fcmToken: null,
        alertas: ["helada"],
        nivelMinimo: "alerta",
        activo: true,
      },
    ];
    fs.writeFileSync(DESTINATARIOS_PATH, JSON.stringify(ejemplo, null, 2));
    return ejemplo;
  }
  return JSON.parse(fs.readFileSync(DESTINATARIOS_PATH, "utf8"));
}

// ─── Anti-spam: log de alertas enviadas ──────────────────────────────────────
const LOG_PATH = path.join(__dirname, "alertas_enviadas.json");

function cargarLog() {
  if (!fs.existsSync(LOG_PATH)) return {};
  return JSON.parse(fs.readFileSync(LOG_PATH, "utf8"));
}

function guardarLog(log) {
  fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

/**
 * Retorna true si ya se envió una alerta del mismo tipo y nivel
 * en los últimos `minutos` minutos (evita spam).
 */
function yaEnviada(log, tipo, nivel, minutos = 120) {
  const key = `${tipo}_${nivel}`;
  if (!log[key]) return false;
  const hace = Date.now() - new Date(log[key]).getTime();
  return hace < minutos * 60 * 1000;
}

function registrarEnvio(log, tipo, nivel) {
  log[`${tipo}_${nivel}`] = new Date().toISOString();
  guardarLog(log);
}

// ─── SMS via Twilio ───────────────────────────────────────────────────────────
async function enviarSMS(telefono, mensaje) {
  if (!CONFIG.twilio.accountSid || !CONFIG.twilio.authToken) {
    console.log(`[SMS-SIMULADO] → ${telefono}: ${mensaje}`);
    return { ok: true, simulado: true };
  }
  try {
    const twilio = require("twilio")(CONFIG.twilio.accountSid, CONFIG.twilio.authToken);
    const result = await twilio.messages.create({
      body: mensaje,
      from: CONFIG.twilio.from,
      to: telefono,
    });
    console.log(`[SMS] Enviado a ${telefono} — SID: ${result.sid}`);
    return { ok: true, sid: result.sid };
  } catch (err) {
    console.error(`[SMS] Error enviando a ${telefono}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ─── Push via Firebase FCM ────────────────────────────────────────────────────
let firebaseAdmin = null;

function inicializarFirebase() {
  if (firebaseAdmin) return firebaseAdmin;
  if (!CONFIG.firebase.credentialsPath) {
    console.warn("[FCM] Sin credenciales Firebase — push deshabilitado");
    return null;
  }
  const admin = require("firebase-admin");
  const serviceAccount = JSON.parse(fs.readFileSync(CONFIG.firebase.credentialsPath, "utf8"));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  firebaseAdmin = admin;
  return admin;
}

async function enviarPush(fcmToken, titulo, cuerpo, datos = {}) {
  const admin = inicializarFirebase();
  if (!admin || !fcmToken) {
    console.log(`[PUSH-SIMULADO] "${titulo}": ${cuerpo}`);
    return { ok: true, simulado: true };
  }
  try {
    const result = await admin.messaging().send({
      token: fcmToken,
      notification: { title: titulo, body: cuerpo },
      data: { ...datos, click_action: "FLUTTER_NOTIFICATION_CLICK" },
      android: { priority: "high", notification: { sound: "default", channelId: "alertas_meteo" } },
      apns: { payload: { aps: { sound: "default", badge: 1 } } },
    });
    console.log(`[PUSH] Enviado — MessageID: ${result}`);
    return { ok: true, messageId: result };
  } catch (err) {
    console.error(`[PUSH] Error:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ─── Formateo de mensajes ─────────────────────────────────────────────────────
const EMOJIS = { ok: "✅", vigilancia: "👁", alerta: "⚠️", peligro: "🚨" };

function formatearMensajeSMS(alerta, datosRaw) {
  const emoji = EMOJIS[alerta.nivel] || "⚠️";
  const hora = new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
  const tipo = alerta.tipo === "helada" ? "HELADA" : "TORMENTA";

  let msg = `${emoji} ALERTA ${tipo} — Concordia ${hora}\n`;
  msg += `${alerta.mensaje}\n`;

  if (alerta.tipo === "helada" && datosRaw.temperatura !== null) {
    msg += `Temp: ${datosRaw.temperatura}°C | Rocío: ${datosRaw.puntoRocio}°C | HR: ${datosRaw.humedad}%`;
  } else if (alerta.tipo === "tormenta") {
    msg += `Presión: ${datosRaw.presion?.valor} hPa (${datosRaw.presion?.delta > 0 ? "+" : ""}${datosRaw.presion?.delta}) | Viento: ${datosRaw.viento?.velocidad} km/h`;
  }

  msg += `\ngalileo.frcon.utn.edu.ar`;
  return msg;
}

// ─── Dispatcher principal ─────────────────────────────────────────────────────
const PRIORIDAD = { ok: 0, vigilancia: 1, alerta: 2, peligro: 3 };

async function despacharAlertas(evaluacion) {
  const { alertas, datosRaw } = evaluacion;
  const log = cargarLog();
  const destinatarios = cargarDestinatarios();
  const resultados = [];

  for (const [tipo, alerta] of Object.entries(alertas)) {
    if (alerta.nivel === "ok") continue;

    // Anti-spam: no reenviar la misma alerta en 2 horas
    if (yaEnviada(log, tipo, alerta.nivel)) {
      console.log(`[notif] Alerta ${tipo}/${alerta.nivel} ya enviada recientemente. Saltando.`);
      continue;
    }

    for (const dest of destinatarios) {
      if (!dest.activo) continue;
      if (!dest.alertas.includes(tipo)) continue;
      if (PRIORIDAD[alerta.nivel] < PRIORIDAD[dest.nivelMinimo]) continue;

      const mensaje = formatearMensajeSMS(alerta, datosRaw);
      const titulo = `${EMOJIS[alerta.nivel]} Alerta ${tipo === "helada" ? "Helada" : "Tormenta"}`;

      // SMS
      if (dest.telefono) {
        const r = await enviarSMS(dest.telefono, mensaje);
        resultados.push({ dest: dest.nombre, tipo, canal: "sms", ...r });
      }

      // Push
      if (dest.fcmToken) {
        const r = await enviarPush(dest.fcmToken, titulo, alerta.mensaje, {
          tipo,
          nivel: alerta.nivel,
          temperatura: String(datosRaw.temperatura ?? ""),
        });
        resultados.push({ dest: dest.nombre, tipo, canal: "push", ...r });
      }
    }

    registrarEnvio(log, tipo, alerta.nivel);
  }

  return resultados;
}

module.exports = { despacharAlertas };
