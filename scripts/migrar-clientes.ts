/**
 * Migración one-shot de los 7 clientes históricos a Supabase + R2.
 *
 * Decisiones aplicadas:
 *  - Cada cliente queda en estado='entregada' (ya recibieron entrega externa).
 *  - Las fotos se suben como tipo='final' a R2 bajo clientes/{codigo}/finales/.
 *  - Paquete asignado por cantidad de fotos (≤2 → Básico, 3-5 → Estándar, ≥6 → Completo).
 *  - JAVIER se omite a propósito: su URL viva no se toca hasta Fase 3.
 *
 * Uso:
 *   npm run migrate:clientes
 *
 * Idempotente: si una sesión con el mismo código ya existe, se actualiza
 * (o se omite si ya tiene fotos). Si una foto ya está en R2, se sobrescribe.
 */

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Database } from '../src/lib/database.types';

// ─── Configuración ─────────────────────────────────────────────
const SUPABASE_URL = mustEnv('PUBLIC_SUPABASE_URL');
const SUPABASE_SERVICE = mustEnv('SUPABASE_SERVICE_ROLE_KEY');
const R2_ACCOUNT_ID = mustEnv('R2_ACCOUNT_ID');
const R2_ACCESS_KEY_ID = mustEnv('R2_ACCESS_KEY_ID');
const R2_SECRET_ACCESS_KEY = mustEnv('R2_SECRET_ACCESS_KEY');
const R2_BUCKET_NAME = mustEnv('R2_BUCKET_NAME');

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

// ─── Datos a migrar ────────────────────────────────────────────
type ClienteSeed = {
  codigo: string;
  nombre: string;
  fotos: string[]; // rutas relativas a public/
};

const clientes: ClienteSeed[] = [
  {
    codigo: 'CHRISTIAN2025',
    nombre: 'Christian',
    fotos: range(1, 6).map((n) => `img/Christian${n}.jpg`),
  },
  {
    codigo: 'JON2024',
    nombre: 'Jonathan',
    fotos: ['img/Jona1.jpg', 'img/Jona3.jpg'],
  },
  {
    codigo: 'MAFER2025',
    nombre: 'Mafer',
    fotos: range(1, 2).map((n) => `img/Mafer${n}.jpg`),
  },
  {
    codigo: 'MICH2025',
    nombre: 'Mich',
    fotos: range(1, 7).map((n) => `img/Mich${n}.jpg`),
  },
  {
    codigo: 'MOOT',
    nombre: 'Moot',
    fotos: range(1, 6).map((n) => `img/MootMadrid2025_${n}.jpg`),
  },
  {
    codigo: 'RICARDITO',
    nombre: 'Ricardo',
    fotos: range(1, 2).map((n) => `img/Ricardo${n}.jpg`),
  },
  {
    codigo: 'VALERIA2024',
    nombre: 'Valeria',
    fotos: ['img/Valeria1.jpg'],
  },
  {
    codigo: 'JAVIERAMEZCUA2026',
    nombre: 'Javier Amezcua',
    fotos: [
      'img/Javier_1.jpg',
      'img/Javier_1-EditarAzul.jpg',
      'img/Javier_6.jpg',
      'img/Javier_6-EditarAzul.jpg',
      'img/Javier_8.jpg',
      'img/Javier_8-EditarAzul.jpg',
      'img/Javier_11.jpg',
      'img/Javier_13.jpg',
      'img/Javier_13-EditarAzul.jpg',
      'img/Javier_15.jpg',
      'img/Javier_15-EditarAzul.jpg',
      'img/Javier_17.jpg',
      'img/Javier_17-EditarAzul.jpg',
    ],
  },
];

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  log('━━━ Migración de clientes históricos ━━━');
  const paquetes = await loadPaquetes();
  log(`Paquetes en BD: ${paquetes.map((p) => `${p.nombre}(${p.fotos_incluidas})`).join(', ')}`);

  for (const cliente of clientes) {
    await migrarCliente(cliente, paquetes);
  }

  log('━━━ Migración completa ━━━');
}

async function migrarCliente(c: ClienteSeed, paquetes: PaqueteRow[]) {
  log(`\n→ ${c.codigo} (${c.nombre}, ${c.fotos.length} fotos)`);

  // Validar fotos en disco
  const publicDir = resolve(process.cwd(), 'public');
  const archivos = c.fotos.map((rel) => ({
    rel,
    abs: resolve(publicDir, rel),
    nombre: basename(rel),
  }));
  const faltantes = archivos.filter((a) => !existsSync(a.abs));
  if (faltantes.length) {
    warn(`  archivos faltantes: ${faltantes.map((f) => f.rel).join(', ')}`);
    return;
  }

  // Paquete por cantidad
  const paquete = elegirPaquete(c.fotos.length, paquetes);
  log(`  paquete asignado: ${paquete.nombre}`);

  // Upsert sesión
  const { data: sesion, error: errSesion } = await supabase
    .from('sesiones')
    .upsert(
      {
        codigo: c.codigo,
        nombre_cliente: c.nombre,
        paquete_id: paquete.id,
        limite_fotos: paquete.fotos_incluidas,
        estado: 'entregada',
        fecha_entrega: new Date().toISOString(),
      },
      { onConflict: 'codigo' },
    )
    .select()
    .single();

  if (errSesion || !sesion) {
    fail(`  error upsert sesión: ${errSesion?.message ?? 'sin datos'}`);
    return;
  }
  log(`  sesión id: ${sesion.id}`);

  // Si ya tiene fotos finales, no resubo
  const { count } = await supabase
    .from('fotos')
    .select('*', { count: 'exact', head: true })
    .eq('sesion_id', sesion.id)
    .eq('tipo', 'final');

  if ((count ?? 0) >= c.fotos.length) {
    log(`  ya tiene ${count} fotos en BD, omitiendo subida`);
    return;
  }

  // Subir cada foto a R2 e insertar en BD
  let i = 0;
  for (const archivo of archivos) {
    i++;
    const r2Key = `clientes/${c.codigo}/finales/${archivo.nombre}`;
    const buffer = await readFile(archivo.abs);

    await s3.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET_NAME,
        Key: r2Key,
        Body: buffer,
        ContentType: contentType(archivo.nombre),
      }),
    );
    log(`  ↑ ${archivo.nombre} → ${r2Key}`);

    const { error: errFoto } = await supabase.from('fotos').upsert(
      {
        sesion_id: sesion.id,
        r2_key: r2Key,
        tipo: 'final',
        orden: i,
        original_filename: archivo.nombre,
      },
      { onConflict: 'sesion_id,r2_key' },
    );
    if (errFoto) {
      fail(`    error insert foto: ${errFoto.message}`);
    }
  }

  log(`  ✓ ${c.codigo} migrado`);
}

// ─── Helpers ───────────────────────────────────────────────────
type PaqueteRow = { id: string; nombre: string; fotos_incluidas: number };

async function loadPaquetes(): Promise<PaqueteRow[]> {
  const { data, error } = await supabase
    .from('paquetes')
    .select('id, nombre, fotos_incluidas')
    .order('orden');
  if (error || !data) throw new Error(`No pude leer paquetes: ${error?.message}`);
  if (data.length === 0) {
    throw new Error(
      'Tabla paquetes vacía. Corre primero supabase/migrations/0001_init.sql en el SQL editor.',
    );
  }
  return data;
}

function elegirPaquete(numFotos: number, paquetes: PaqueteRow[]): PaqueteRow {
  // Ordenado por fotos_incluidas asc, escojo el más chico que cubra
  const ordenado = [...paquetes].sort((a, b) => a.fotos_incluidas - b.fotos_incluidas);
  return ordenado.find((p) => p.fotos_incluidas >= numFotos) ?? ordenado[ordenado.length - 1];
}

function range(from: number, to: number): number[] {
  const r: number[] = [];
  for (let i = from; i <= to; i++) r.push(i);
  return r;
}

function contentType(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'application/octet-stream';
}

function mustEnv(k: string): string {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing env var ${k}. Revisa .env.local`);
    process.exit(1);
  }
  return v;
}

function log(m: string) {
  console.log(m);
}
function warn(m: string) {
  console.warn(`⚠️  ${m}`);
}
function fail(m: string) {
  console.error(`✗ ${m}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
