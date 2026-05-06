// Lista todas las páginas de la BD de Notion y separa las que ya están
// vinculadas a sesiones (notion_page_id en Supabase) vs. las "viejas" creadas
// manualmente que faltan por fusionar.

import { createClient } from '@supabase/supabase-js';

async function main() {
  const sb = createClient(process.env.PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const NOTION_TOKEN = process.env.NOTION_TOKEN!;
  const DB = process.env.NOTION_DATABASE_ID!;

  const { data: sesiones } = await sb.from('sesiones').select('id, codigo, nombre_cliente, notion_page_id');
  const linkedIds = new Set((sesiones ?? []).map((s) => s.notion_page_id).filter(Boolean));
  console.log('Páginas vinculadas (de Supabase):', linkedIds.size);

  const allPages: any[] = [];
  let cursor: string | undefined;
  do {
    const res = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ start_cursor: cursor, page_size: 100 }),
    });
    const j: any = await res.json();
    if (!res.ok) {
      console.error('Notion query falló:', j);
      process.exit(1);
    }
    allPages.push(...j.results);
    cursor = j.next_cursor ?? undefined;
  } while (cursor);

  console.log(`Total páginas en Notion: ${allPages.length}\n`);

  const old = allPages.filter((p) => !linkedIds.has(p.id));
  console.log(`════ Viejas (no vinculadas): ${old.length} ════\n`);

  for (const page of old) {
    const props = page.properties;
    const get = (name: string, getter: (p: any) => any) => getter(props[name]) ?? '';
    const rt = (p: any) => p?.rich_text?.[0]?.plain_text ?? '';
    const tt = (p: any) => p?.title?.[0]?.plain_text ?? '';
    const out = {
      id: page.id,
      Nombre: tt(props.Nombre),
      'Código': rt(props['Código']),
      Email: props.Email?.email ?? '',
      Teléfono: props['Teléfono']?.phone_number ?? '',
      'Handle IG': rt(props['Handle IG']),
      Ubicación: rt(props['Ubicación']),
      'Es Estudiante': props['Es Estudiante']?.checkbox ?? false,
      Estado: props.Estado?.status?.name ?? '',
      Origen: props.Origen?.select?.name ?? '',
      'Fecha Sesión': props['Fecha Sesión']?.date?.start ?? '',
      'Fecha Preferida': props['Fecha Preferida']?.date?.start ?? '',
      Notas: rt(props.Notas),
      'Notas Sesión': rt(props['Notas Sesión']),
      'Notas Técnicas': rt(props['Notas Técnicas']),
    };
    console.log(JSON.stringify(out, null, 2));
    console.log('---');
  }

  console.log('\n════ Vinculadas (ya en Supabase) ════');
  for (const s of sesiones ?? []) {
    console.log(`  ${s.codigo ?? '(lead)'} · ${s.nombre_cliente}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
