/**
 * alertEngine.js
 * Motor de cálculo de riesgo de helada y tormenta.
 * Recibe los datos del scraper y devuelve alertas estructuradas.
 */

// ─── Umbrales configurables ───────────────────────────────────────────────────
const UMBRALES = {
  helada: {
    // Temperatura bajo la cual se activa alerta
    alertaAgricola: 3,     // °C — daño en cultivos sensibles (vid, cítricos)
    alertaMeteoro: 0,      // °C — helada meteorológica oficial
    // Punto de rocío
    puntoRocioAlerta: 2,   // °C — por debajo hay riesgo de escarcha
    // Viento — por debajo la inversión térmica se forma fácil
    vientoCalma: 5,        // km/h
  },
  tormenta: {
    // Caída de presión
    caida1h: -1.5,         // hPa/h — alerta moderada
    caida3h: -3.0,         // hPa/h — alerta severa
    // Viento
    vientoFuerte: 50,      // km/h
    vientoTormenta: 70,    // km/h
    // Lluvia intensa
    lluviaIntensa: 10,     // mm/h
    lluviaExtrema: 30,     // mm/h
    // Humedad alta + presión cayendo = posible tormenta convectiva
    humedadCritica: 85,    // %
  },
};

// ─── Nivel de alerta ──────────────────────────────────────────────────────────
const NIVEL = { OK: "ok", VIGILANCIA: "vigilancia", ALERTA: "alerta", PELIGRO: "peligro" };

// ─── Cálculo de riesgo de helada ─────────────────────────────────────────────
function calcularRiesgoHelada(datos, historial = []) {
  const { temperatura, puntoRocio, humedad, viento, presion } = datos;
  let puntos = 0;
  const factores = [];

  // Factor 1: Temperatura actual
  if (temperatura !== null) {
    if (temperatura <= UMBRALES.helada.alertaMeteoro) {
      puntos += 40;
      factores.push({ factor: "Temperatura", valor: `${temperatura}°C`, impacto: "crítico", detalle: "Por debajo del umbral de helada" });
    } else if (temperatura <= UMBRALES.helada.alertaAgricola) {
      puntos += 25;
      factores.push({ factor: "Temperatura", valor: `${temperatura}°C`, impacto: "alto", detalle: "Zona de daño en cultivos sensibles" });
    } else if (temperatura <= 6) {
      puntos += 10;
      factores.push({ factor: "Temperatura", valor: `${temperatura}°C`, impacto: "moderado", detalle: "Temperatura baja, monitorear" });
    } else {
      factores.push({ factor: "Temperatura", valor: `${temperatura}°C`, impacto: "ninguno", detalle: "Nivel normal" });
    }
  }

  // Factor 2: Punto de rocío
  if (puntoRocio !== null) {
    if (puntoRocio <= UMBRALES.helada.puntoRocioAlerta) {
      puntos += 20;
      factores.push({ factor: "Punto de rocío", valor: `${puntoRocio}°C`, impacto: "alto", detalle: "Riesgo de escarcha en superficies" });
    } else if (puntoRocio <= 5) {
      puntos += 5;
      factores.push({ factor: "Punto de rocío", valor: `${puntoRocio}°C`, impacto: "leve", detalle: "Humedad baja, favorece enfriamiento" });
    } else {
      factores.push({ factor: "Punto de rocío", valor: `${puntoRocio}°C`, impacto: "ninguno", detalle: "Contenido de vapor suficiente" });
    }
  }

  // Factor 3: Viento (calma favorece inversión térmica)
  if (viento?.velocidad !== undefined) {
    if (viento.velocidad < UMBRALES.helada.vientoCalma) {
      puntos += 15;
      factores.push({ factor: "Viento", valor: `${viento.velocidad} km/h`, impacto: "moderado", detalle: "Calma — favorece inversión térmica superficial" });
    } else {
      factores.push({ factor: "Viento", valor: `${viento.velocidad} km/h`, impacto: "ninguno", detalle: "Mezcla de aire activa — reduce inversión" });
    }
  }

  // Factor 4: Presión alta (cielo despejado → mayor pérdida radiativa)
  if (presion?.valor !== undefined) {
    if (presion.valor > 1020 && presion.delta >= 0) {
      puntos += 10;
      factores.push({ factor: "Presión", valor: `${presion.valor} hPa`, impacto: "leve", detalle: "Alta presión → posible cielo despejado → mayor radiación nocturna" });
    } else {
      factores.push({ factor: "Presión", valor: `${presion.valor} hPa`, impacto: "ninguno", detalle: "Presión normal" });
    }
  }

  // Factor 5: Humedad baja (mayor pérdida de calor)
  if (humedad !== null) {
    if (humedad < 40) {
      puntos += 10;
      factores.push({ factor: "Humedad", valor: `${humedad}%`, impacto: "moderado", detalle: "Baja humedad — mayor enfriamiento radiativo" });
    } else {
      factores.push({ factor: "Humedad", valor: `${humedad}%`, impacto: "ninguno", detalle: "Humedad adecuada — retiene calor" });
    }
  }

  // Margen térmico sobre umbral
  const margen = temperatura !== null ? +(temperatura - UMBRALES.helada.alertaMeteoro).toFixed(1) : null;
  const porcentaje = Math.min(100, Math.round(puntos));

  // Nivel de alerta
  let nivel, mensaje;
  if (temperatura !== null && temperatura <= UMBRALES.helada.alertaMeteoro) {
    nivel = NIVEL.PELIGRO;
    mensaje = `HELADA EN CURSO — Temperatura ${temperatura}°C. Proteger cultivos inmediatamente.`;
  } else if (temperatura !== null && temperatura <= UMBRALES.helada.alertaAgricola) {
    nivel = NIVEL.ALERTA;
    mensaje = `Temperatura ${temperatura}°C — Riesgo de daño en cultivos sensibles. Activar protección.`;
  } else if (porcentaje >= 40) {
    nivel = NIVEL.VIGILANCIA;
    mensaje = `Condiciones favorables para helada en próximas horas. Monitorear.`;
  } else {
    nivel = NIVEL.OK;
    mensaje = `Sin riesgo de helada. Margen de ${margen}°C sobre umbral de 0°C.`;
  }

  return { tipo: "helada", nivel, porcentaje, margen, mensaje, factores };
}

// ─── Cálculo de riesgo de tormenta ───────────────────────────────────────────
function calcularRiesgoTormenta(datos, historialPresion = []) {
  const { presion, viento, humedad, lluviaHoy, promLluvia } = datos;
  let puntos = 0;
  const factores = [];

  // Factor 1: Caída de presión (el indicador más fiable)
  if (presion?.delta !== undefined) {
    const caida = presion.delta; // hPa (negativo = baja)
    if (caida <= UMBRALES.tormenta.caida3h) {
      puntos += 45;
      factores.push({ factor: "Presión (tendencia)", valor: `${caida > 0 ? "+" : ""}${caida} hPa/h`, impacto: "crítico", detalle: "Caída rápida — sistema de baja presión intenso en aproximación" });
    } else if (caida <= UMBRALES.tormenta.caida1h) {
      puntos += 25;
      factores.push({ factor: "Presión (tendencia)", valor: `${caida > 0 ? "+" : ""}${caida} hPa/h`, impacto: "moderado", detalle: "Presión en descenso — monitorear" });
    } else if (caida > 0.5) {
      factores.push({ factor: "Presión (tendencia)", valor: `+${caida} hPa/h`, impacto: "ninguno", detalle: "Presión subiendo — estabilidad atmosférica" });
    } else {
      factores.push({ factor: "Presión (tendencia)", valor: `${caida} hPa/h`, impacto: "ninguno", detalle: "Presión estable" });
    }
  }

  // Factor 2: Viento fuerte
  if (viento?.velocidad !== undefined) {
    if (viento.velocidad >= UMBRALES.tormenta.vientoTormenta) {
      puntos += 35;
      factores.push({ factor: "Viento", valor: `${viento.velocidad} km/h`, impacto: "crítico", detalle: "Viento de tormenta — peligro para estructuras y cultivos" });
    } else if (viento.velocidad >= UMBRALES.tormenta.vientoFuerte) {
      puntos += 20;
      factores.push({ factor: "Viento", valor: `${viento.velocidad} km/h`, impacto: "alto", detalle: "Viento fuerte" });
    } else {
      factores.push({ factor: "Viento", valor: `${viento.velocidad} km/h`, impacto: "ninguno", detalle: "Viento normal" });
    }
  }

  // Factor 3: Lluvia intensa en curso
  if (promLluvia !== null && promLluvia > 0) {
    if (promLluvia >= UMBRALES.tormenta.lluviaExtrema) {
      puntos += 30;
      factores.push({ factor: "Lluvia", valor: `${promLluvia} mm/h`, impacto: "crítico", detalle: "Lluvia extrema — riesgo de inundación y granizo" });
    } else if (promLluvia >= UMBRALES.tormenta.lluviaIntensa) {
      puntos += 15;
      factores.push({ factor: "Lluvia", valor: `${promLluvia} mm/h`, impacto: "alto", detalle: "Lluvia intensa" });
    } else {
      factores.push({ factor: "Lluvia", valor: `${promLluvia} mm/h`, impacto: "leve", detalle: "Llovizna" });
      puntos += 5;
    }
  } else {
    factores.push({ factor: "Lluvia", valor: "0.0 mm/h", impacto: "ninguno", detalle: "Sin precipitación" });
  }

  // Factor 4: Humedad alta + presión baja = convección posible
  if (humedad !== null && humedad >= UMBRALES.tormenta.humedadCritica) {
    puntos += 10;
    factores.push({ factor: "Humedad", valor: `${humedad}%`, impacto: "moderado", detalle: "Alta humedad — combustible para convección" });
  } else {
    factores.push({ factor: "Humedad", valor: `${humedad}%`, impacto: "ninguno", detalle: "Humedad normal" });
  }

  const porcentaje = Math.min(100, Math.round(puntos));

  let nivel, mensaje;
  if (porcentaje >= 70) {
    nivel = NIVEL.PELIGRO;
    mensaje = "TORMENTA SEVERA — Proteger maquinaria y cultivos. No trabajar a campo abierto.";
  } else if (porcentaje >= 40) {
    nivel = NIVEL.ALERTA;
    mensaje = "Tormenta probable en las próximas horas. Tomar precauciones.";
  } else if (porcentaje >= 20) {
    nivel = NIVEL.VIGILANCIA;
    mensaje = "Condiciones cambiantes. Monitorear tendencia de presión.";
  } else {
    nivel = NIVEL.OK;
    mensaje = "Sin riesgo de tormenta. Condiciones estables.";
  }

  return { tipo: "tormenta", nivel, porcentaje, mensaje, factores };
}

// ─── Tendencia general ────────────────────────────────────────────────────────
function calcularTendencia(datos) {
  const { presion, temperatura, humedad, viento } = datos;
  const tendencias = [];

  if (presion?.delta !== undefined) {
    if (presion.delta > 0.5) tendencias.push("Presión en alza — tendencia a estabilidad");
    else if (presion.delta < -0.5) tendencias.push("Presión en baja — posible cambio de tiempo");
    else tendencias.push("Presión estable");
  }

  if (temperatura !== null) {
    if (temperatura < 8) tendencias.push("Temperatura baja — noche fría probable");
    else if (temperatura > 25) tendencias.push("Temperatura elevada");
    else tendencias.push("Temperatura normal para la época");
  }

  if (humedad !== null) {
    if (humedad > 85) tendencias.push("Alta humedad — posible niebla nocturna");
    else if (humedad < 30) tendencias.push("Aire muy seco — déficit hídrico en cultivos");
  }

  return tendencias;
}

// ─── Evaluación completa ──────────────────────────────────────────────────────
function evaluarAlertas(datos) {
  const helada = calcularRiesgoHelada(datos);
  const tormenta = calcularRiesgoTormenta(datos);
  const tendencia = calcularTendencia(datos);

  // Nivel máximo global
  const prioridad = { ok: 0, vigilancia: 1, alerta: 2, peligro: 3 };
  const nivelGlobal =
    prioridad[helada.nivel] >= prioridad[tormenta.nivel]
      ? helada.nivel
      : tormenta.nivel;

  return {
    timestamp: datos.timestamp,
    nivelGlobal,
    alertas: { helada, tormenta },
    tendencia,
    datosRaw: datos,
  };
}

module.exports = { evaluarAlertas, UMBRALES, NIVEL };
