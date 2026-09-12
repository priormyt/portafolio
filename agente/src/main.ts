// Punto de entrada: `node agente/src/main.ts`.
// Node 24 quita los tipos por su cuenta; aquí sólo hay sintaxis borrable.

import http from 'node:http';
import path from 'node:path';
import { Agente } from './agente.ts';
import { asegurarDir } from './almacen.ts';
import type { Config } from './config.ts';
import { cargarConfig, resumenConfig } from './config.ts';
import { cargarConocimiento } from './conocimiento.ts';
import { Bajas, Limites, Vistos } from './estado.ts';
import { Gasto } from './gasto.ts';
import { Historial } from './historial.ts';
import type { Proveedor } from './modelo.ts';
import { crearDeepSeek, crearSimulado } from './modelo.ts';
import { registrar } from './registro.ts';
import { Sondeo } from './sondeo.ts';
import type { Mensajeria } from './twilio.ts';
import { ClienteTwilio } from './twilio.ts';
import { crearServidorWebhook, escuchar } from './webhook.ts';

export interface Instancia {
  agente: Agente;
  config: Config;
  servidor?: http.Server;
  puerto?: number;
  sondeo?: Sondeo;
  detener(): Promise<void>;
}

export interface OpcionesInicio {
  /** Sustituye al proveedor que diga la configuración (pruebas). */
  proveedor?: Proveedor;
  twilio?: Mensajeria;
  reloj?: () => Date;
}

export async function iniciar(config: Config, opciones: OpcionesInicio = {}): Promise<Instancia> {
  asegurarDir(config.datos);
  const conocimiento = cargarConocimiento(config.conocimiento);
  const twilio =
    opciones.twilio ??
    new ClienteTwilio({
      base: config.twilio.base,
      sid: config.twilio.sid,
      token: config.twilio.token,
      desde: config.twilio.desde,
      intervaloEnvioMs: config.twilio.intervaloEnvioMs,
    });
  const proveedor =
    opciones.proveedor ??
    (config.proveedor === 'deepseek' && config.deepseek.llave
      ? crearDeepSeek({
          base: config.deepseek.base,
          llave: config.deepseek.llave,
          modelo: config.modelo,
          maxTokens: config.maxTokens,
          tiempoMs: config.tiempoModeloMs,
        })
      : crearSimulado(conocimiento, config.humano));

  const historial = new Historial(config.datos, {
    vueltas: config.vueltas,
    caracteres: config.caracteresHistorial,
    retencionDias: config.retencionDias,
  });
  const vistos = new Vistos(config.datos, config.retencionDias);
  const agente = new Agente({
    config,
    twilio,
    proveedor,
    conocimiento,
    historial,
    vistos,
    bajas: new Bajas(config.datos),
    limites: new Limites(config.limitePorNumeroHora, config.limiteGlobalHora),
    gasto: new Gasto(config.datos, config.topeDiarioUsd, config.precios, config.zonaHoraria),
    reloj: opciones.reloj,
  });

  // Retención de 30 días (o lo configurado): al arrancar y cada 6 horas.
  const podar = () => {
    const borradas = historial.aplicarRetencion();
    vistos.compactar();
    if (borradas) registrar('info', 'retencion', { entradasBorradas: borradas });
  };
  podar();
  const temporizadorPoda = setInterval(podar, 6 * 3_600_000);
  temporizadorPoda.unref();

  const instancia: Instancia = {
    agente,
    config,
    async detener() {
      clearInterval(temporizadorPoda);
      await instancia.sondeo?.detener();
      if (instancia.servidor) await new Promise<void>((r) => instancia.servidor!.close(() => r()));
      await agente.esperarInactividad();
    },
  };

  if (config.modo === 'webhook') {
    instancia.servidor = crearServidorWebhook(agente, config);
    instancia.puerto = await escuchar(instancia.servidor, config);
  } else {
    instancia.sondeo = new Sondeo(agente, twilio, config, opciones.reloj);
    instancia.sondeo.iniciar();
  }
  registrar('info', 'arranque', { ...resumenConfig(config), proveedorActivo: proveedor.nombre, puerto: instancia.puerto });
  return instancia;
}

async function principal(): Promise<void> {
  let config: Config;
  try {
    config = cargarConfig();
  } catch (e) {
    registrar('error', 'config', { error: String((e as Error).message) });
    process.exit(78); // EX_CONFIG: systemd no lo reintenta en bucle con StartLimit*
  }
  const instancia = await iniciar(config);
  let apagando = false;
  const apagar = async (senal: string) => {
    if (apagando) return;
    apagando = true;
    registrar('info', 'apagado', { senal });
    const limite = setTimeout(() => process.exit(0), 15_000);
    limite.unref();
    await instancia.detener();
    process.exit(0);
  };
  process.on('SIGTERM', () => void apagar('SIGTERM'));
  process.on('SIGINT', () => void apagar('SIGINT'));
}

const esPrincipal = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? '');
if (esPrincipal) {
  principal().catch((e) => {
    registrar('error', 'fatal', { error: String((e as Error)?.message ?? e) });
    process.exit(1);
  });
}
