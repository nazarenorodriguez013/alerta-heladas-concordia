# 🌡 Sistema de Alertas Meteorológicas — Concordia

Monitoreo automático de la estación **Galileo (UTN Regional Concordia)**
con alertas de **helada y tormenta** para productores agrícolas.

---

## Arquitectura

```
Estación Galileo ──scraper──► alertEngine ──► notificaciones
      (cada 10 min)                │                 │
                                   ▼                 ▼
                             server.js API        SMS/Push
                                   │
                             frontend/index.html
                          (Web app para celulares)
```

---

## Archivos

```
alerta-heladas/
├── backend/
│   ├── server.js          ← Servidor HTTP + daemon de monitoreo
│   ├── scraper.js         ← Lee galileo.frcon.utn.edu.ar
│   ├── alertEngine.js     ← Calcula riesgo de helada y tormenta
│   └── notificaciones.js  ← SMS (Twilio) + Push (Firebase FCM)
├── frontend/
│   └── index.html         ← Web app completa (móvil, sin instalar nada)
└── package.json
```

---

## Instalación

### 1. Requisitos
- Node.js 18+
- Cuenta Twilio para SMS (opcional — funciona en modo simulado sin ella)
- Proyecto Firebase para push notifications (opcional)

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

Crear archivo `.env` en la raíz (o exportar en el shell):

```bash
# Puerto del servidor
PORT=3000

# Intervalo de consulta a la estación (minutos)
INTERVALO_MIN=10

# ── SMS via Twilio (opcional) ──────────────────────
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+549345XXXXXXX

# ── Push via Firebase FCM (opcional) ──────────────
FIREBASE_CREDENTIALS_PATH=/ruta/al/serviceAccount.json
FIREBASE_PROJECT_ID=mi-proyecto-firebase
```

Si no se configuran Twilio/Firebase, el sistema **funciona igual** pero
imprime las notificaciones en consola en lugar de enviarlas (modo simulado).

### 4. Configurar destinatarios

Editar `backend/destinatarios.json` (se crea automáticamente en el primer arranque):

```json
[
  {
    "nombre": "Juan Pérez",
    "telefono": "+549345XXXXXXX",
    "fcmToken": null,
    "alertas": ["helada", "tormenta"],
    "nivelMinimo": "vigilancia",
    "activo": true
  }
]
```

| Campo | Valores | Descripción |
|-------|---------|-------------|
| `alertas` | `["helada"]`, `["tormenta"]`, o ambas | Tipos de alerta a recibir |
| `nivelMinimo` | `vigilancia` / `alerta` / `peligro` | Umbral mínimo para notificar |
| `fcmToken` | string o null | Token FCM de la app en el celular del productor |

### 5. Arrancar el servidor

```bash
# Desarrollo (consulta cada 1 min)
npm run dev

# Producción
npm start

# Con PM2 (reinicio automático ante caídas)
pm2 start backend/server.js --name alerta-heladas
pm2 save
pm2 startup
```

---

## API REST

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/estado` | GET | Última lectura + evaluación completa |
| `/api/alertas` | GET | Solo alertas activas (respuesta liviana) |
| `/api/historial?n=48` | GET | Últimas N lecturas |
| `/health` | GET | Healthcheck |
| `/api/test-alerta` | POST | Dispara notificación de prueba |

### Ejemplo de respuesta `/api/alertas`

```json
{
  "timestamp": "2026-05-21T20:15:00.000Z",
  "nivelGlobal": "ok",
  "alertas": {
    "helada": {
      "nivel": "ok",
      "porcentaje": 8,
      "margen": 10.6,
      "mensaje": "Sin riesgo de helada. Margen de 10.6°C sobre umbral de 0°C.",
      "factores": [...]
    },
    "tormenta": {
      "nivel": "vigilancia",
      "porcentaje": 20,
      "mensaje": "Condiciones cambiantes. Monitorear tendencia de presión.",
      "factores": [...]
    }
  }
}
```

---

## Web App (Frontend)

Abrir `frontend/index.html` en cualquier celular.
En la pantalla **Sensores → URL del backend** ingresar `http://IP-DEL-SERVIDOR:3000`.

La app funciona sin backend en modo demo con los últimos datos hardcodeados.

Para que los productores la usen sin configuración:
1. Subir `index.html` a cualquier hosting estático (GitHub Pages, Netlify, etc.)
2. Cambiar la URL del API en el `localStorage` o hardcodearla en el código

---

## Umbrales de alerta (configurables en `alertEngine.js`)

### Helada
| Umbral | Valor | Nivel |
|--------|-------|-------|
| Temperatura ≤ 0°C | helada meteorológica | PELIGRO |
| Temperatura ≤ 3°C | daño en cultivos sensibles | ALERTA |
| Punto de rocío ≤ 2°C | escarcha en superficies | contribuye |
| Viento < 5 km/h | inversión térmica probable | contribuye |

### Tormenta
| Umbral | Valor | Nivel |
|--------|-------|-------|
| Presión cae ≥ 3 hPa/h | sistema intenso | ALERTA/PELIGRO |
| Presión cae ≥ 1.5 hPa/h | cambio de tiempo | VIGILANCIA |
| Viento ≥ 70 km/h | tormenta | PELIGRO |
| Viento ≥ 50 km/h | viento fuerte | ALERTA |
| Lluvia ≥ 30 mm/h | lluvia extrema | PELIGRO |
| Lluvia ≥ 10 mm/h | lluvia intensa | ALERTA |

---

## Limitaciones conocidas (sensor gaps)

| Fenómeno | Cobertura | Motivo |
|----------|-----------|--------|
| Helada agronómica | ✅ Completa | Temp + rocío + humedad + viento |
| Tormenta convectiva | ✅ Parcial | Presión + viento + lluvia |
| Rayos | ❌ No disponible | Sensor no instalado |
| Granizo | ❌ No disponible | Sin granizómetro |

---

## Licencia
MIT — Libre uso y modificación.
