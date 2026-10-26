/**
 * Sube una carpeta de JPG como fotos favoritas o preview (solo perfil amigos).
 *
 * Uso:
 *   npm run subir:carpeta -- --codigo X --tipo favorita|preview --dir "<carpeta>" [--dry-run]
 *
 * Requiere macOS (usa `sips`). Idempotente: una foto cuyo r2_key ya existe
 * conserva su orden y se sobrescribe.
 */

import { readFile, readdir, stat, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import type { Database } from '../src/lib/database.types';

const MAX_ORIGINAL = 30 * 1024 * 1024;

type Tipo = 'favorita' | 'preview';

const args = parseArgs(process.argv.slice(2));
const codigo = (args.codigo ?? '').trim().toUpperCase();
const tipo = args.tipo as Tipo;
const dir = args.dir ? resolve(args.dir) : '';
const dryRun = args['dry-run'] === 'true';

if (!codigo || !dir || (tipo !== 'favorita' && tipo !== 'preview')) {
  console.error('Uso: npm run subir:carpeta -- --codigo X --tipo favorita|preview --dir "<carpeta>" [--dry-run]');
  process.exit(1);
}

async function main() {
  const supabase = createClient<Database>(mustEnv('PUBLIC_SUPABASE_URL'), mustEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: sesion, error: errSesion } = await supabase
    .from('sesiones')
    .select('id, codigo, tipo_perfil')
    .eq('codigo', codigo)
    .maybeSingle();
  if (errSesion) throw errSesion;
  if (!sesion) {
    console.error(`No existe la sesión ${codigo}.`);
    process.exit(1);
  }

  if (tipo === 'preview' && (sesion.tipo_perfil ?? 'cliente') !== 'amigos') {
    console.error(
      `${codigo} es un perfil de cliente: sus previews necesitan marca de agua. ` +
        'Súbelas desde el admin; este script solo sube previews a perfiles "amigos".',
    );
    process.exit(1);
  }

  const nombres = (await readdir(dir))
    .filter((n) => !n.startsWith('.') && /\.jpe?g$/i.test(n))
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }));
  if (nombres.length === 0) {
    console.error(`No hay .jpg/.jpeg en ${dir}`);
    process.exit(1);
  }

  const { data: existentes, error: errEx } = await supabase
    .from('fotos')
    .select('r2_key, orden')
    .eq('sesion_id', sesion.id)
    .eq('tipo', tipo);
  if (errEx) throw errEx;
  const ordenPorKey = new Map((existentes ?? []).map((f) => [f.r2_key, f.orden ?? 0]));
  let siguiente = (existentes ?? []).reduce((m, f) => Math.max(m, f.orden ?? 0), 0) + 1;

  console.log(`${codigo} · ${tipo} · ${nombres.length} archivos en ${dir}${dryRun ? ' (dry-run)' : ''}`);

  const s3 = dryRun ? null : crearS3();
  const bucket = dryRun ? '' : mustEnv('R2_BUCKET_NAME');
  const tmp = await mkdtemp(join(tmpdir(), 'subir-carpeta-'));
  let ok = 0;
  let fallidas = 0;

  try {
    for (const nombre of nombres) {
      const origen = join(dir, nombre);
      const base = nombre.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'foto';
      const safeName = `${base}.jpg`;
      const keyWeb =
        tipo === 'favorita'
          ? `clientes/${codigo}/favoritas/web/${safeName}`
          : `clientes/${codigo}/previews/${safeName}`;
      const keyOriginal = tipo === 'favorita' ? `clientes/${codigo}/favoritas/original/${safeName}` : null;
      const orden = ordenPorKey.get(keyWeb) ?? siguiente++;

      try {
        const web = join(tmp, `web-${base}.jpg`);
        const maxWeb = tipo === 'favorita' ? 1800 : 2000;
        const calidadWeb = tipo === 'favorita' ? 85 : 84;
        sips(origen, web, maxWeb, calidadWeb);
        const { width, height } = medir(web);

        let originalPath: string | null = null;
        if (tipo === 'favorita') {
          if ((await stat(origen)).size <= MAX_ORIGINAL) {
            originalPath = origen;
          } else {
            originalPath = join(tmp, `orig-${base}.jpg`);
            sips(origen, originalPath, 6000, 92);
          }
        }

        if (dryRun) {
          console.log(`  [dry] ${nombre} -> ${keyWeb}${keyOriginal ? ` + ${keyOriginal}` : ''} · orden ${orden} · ${width}x${height}`);
          ok++;
          continue;
        }

        if (keyOriginal && originalPath) {
          await put(s3!, bucket, keyOriginal, await readFile(originalPath), false);
        }
        await put(s3!, bucket, keyWeb, await readFile(web), true);

        const { error } = await supabase.from('fotos').upsert(
          {
            sesion_id: sesion.id,
            r2_key: keyWeb,
            ...(keyOriginal ? { r2_key_original: keyOriginal } : {}),
            tipo,
            orden,
            original_filename: safeName,
            width,
            height,
          },
          { onConflict: 'sesion_id,r2_key' },
        );
        if (error) {
          const msg = error.message;
          if (/enum|foto_tipo|r2_key_original/i.test(msg)) {
            throw new Error(`${msg} — falta aplicar la migración 0007_fotos_favoritas.sql en la BD.`);
          }
          throw new Error(msg);
        }
        console.log(`  ✓ ${nombre} · orden ${orden} · ${width}x${height}`);
        ok++;
      } catch (err) {
        console.error(`  ✗ ${nombre}: ${err instanceof Error ? err.message : err}`);
        fallidas++;
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  console.log(`\nResumen: ${ok} ${dryRun ? 'simuladas' : 'subidas'}, ${fallidas} fallidas.`);
  if (fallidas > 0) process.exit(1);
}

function sips(entrada: string, salida: string, maxDim: number, calidad: number) {
  execFileSync(
    'sips',
    ['-Z', String(maxDim), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(calidad), entrada, '--out', salida],
    { stdio: 'pipe' },
  );
}

function medir(archivo: string): { width: number; height: number } {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', archivo], { encoding: 'utf8' });
  const width = parseInt(/pixelWidth:\s*(\d+)/.exec(out)?.[1] ?? '', 10);
  const height = parseInt(/pixelHeight:\s*(\d+)/.exec(out)?.[1] ?? '', 10);
  if (!width || !height) throw new Error(`No se pudieron leer las dimensiones de ${basename(archivo)}`);
  return { width, height };
}

function crearS3(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${mustEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: mustEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: mustEnv('R2_SECRET_ACCESS_KEY'),
    },
  });
}

async function put(s3: S3Client, bucket: string, key: string, body: Buffer, publico: boolean) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: 'image/jpeg',
      ...(publico ? { CacheControl: 'public, max-age=86400' } : {}),
    }),
  );
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    if (k === 'dry-run') out[k] = 'true';
    else out[k] = argv[++i] ?? '';
  }
  return out;
}

function mustEnv(k: string): string {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing env var ${k}. Revisa .env.local`);
    process.exit(1);
  }
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
