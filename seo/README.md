# Workspace SEO — ANTE

Contexto persistente para el trabajo de SEO de `www.ante.photo`. Todo lo que el agente
necesita saber para no arrancar desde cero en cada conversación vive aquí.

Última actualización: 2026-07-27

---

## Proyecto OpenSEO

| Campo | Valor |
| --- | --- |
| Project ID | `9bcc76c1-434b-459c-b8cb-5cb6dd786e9b` |
| Dashboard | https://app.openseo.so/p/9bcc76c1-434b-459c-b8cb-5cb6dd786e9b |
| Dominio | `ante.photo` |
| Mercado | México (`locationCode` 2484), español (`es`) |
| Search Console | **Conectado** (verificado 2026-07-27), propiedad `https://www.ante.photo/` |
| Créditos | **0** al 2026-07-27 — las herramientas de research (keywords, SERP, backlinks, audit) no corren hasta recargar |

Herramientas que **no** consumen créditos: `whoami`, `list_projects`, `get_search_console_performance`,
`save_keywords` / `list_saved_keywords`.

---

## Alcance del sitio

- **Dominio principal:** `https://www.ante.photo`
- **Stack:** Astro estático, adapter Cloudflare, `build.format: 'file'`. Repo: `priormyt/portafolio`.
- **Sitemap:** `/sitemap-index.xml` (generado por `@astrojs/sitemap`, filtrado a las públicas).
  El viejo `/sitemap.xml` da 301 vía `public/_redirects`.
- **Idioma/mercado:** español, Ciudad de México.
- **Estado:** sitio establecido, sin migración ni caída conocida.

### Páginas públicas e indexables (7)

| URL | Rol | Title actual |
| --- | --- | --- |
| `/` | Home / conversión | ANTE \| Estudio de Fotografía Profesional en CDMX |
| `/agendar` | Conversión (formulario) | Agendar sesión \| ANTE Estudio de Fotografía |
| `/contacto` | Conversión (WhatsApp/mail) | Contacto \| ANTE Estudio de Fotografía en CDMX |
| `/galeria` | Portafolio | Galería de Retratos \| ANTE Estudio de Fotografía CDMX |
| `/nosotros` | Confianza / marca | Nosotros \| ANTE Estudio de Fotografía en CDMX |
| `/mas` | Foro Colibrí (renta de foro) | Foro Colibrí · Renta de Foro en CDMX \| ANTE Estudio |
| `/aviso-privacidad` | Legal | Aviso de Privacidad \| ANTE Estudio Fotográfico |

### Fuera del índice a propósito

`/admin`, `/clientes` y las galerías privadas por código, `/404`. Están excluidas del
sitemap por el filtro en `astro.config.mjs`. **No proponer contenido ni links hacia ahí.**

### Estado técnico conocido

- `robots.txt` permite explícitamente GPTBot, Google-Extended, anthropic-ai, ClaudeBot,
  PerplexityBot, Applebot-Extended (decisión deliberada: sí a los buscadores de IA).
- Structured data en `/`: `PhotographyBusiness`, `FAQPage`, `Service` con `hasOfferCatalog`
  y precio desde 900 MXN.
- **No hay blog ni biblioteca de contenido.** La superficie indexable son 7 URLs.

---

## Objetivos

Prioridad declarada por el usuario (2026-07-27):

1. **Más sesiones agendadas.** Leads de personas buscando retrato en CDMX.
   Métrica: envíos de `/agendar` + clics a WhatsApp desde orgánico.
2. **Clientes corporativos.** Empresas que necesitan headshots de equipo.
   Ticket más alto. Intención tipo "fotos corporativas empresa CDMX", "headshots LinkedIn".

No priorizados por ahora (no descartados): renta de Foro Colibrí (`/mas`) y
visibilidad de marca / mapa.

Falta definir: meta numérica y plazo. Convertir a algo medible cuando haya baseline de GSC,
p. ej. "duplicar clics no-marca a `/agendar` en 6 meses" o "top 10 en 15 términos de intención
de compra en CDMX".

---

## Posicionamiento

**Evidencia (tomado del sitio, no inferido):**

- Propuesta: "La imagen honesta." Retrato honesto y minimalista.
- Servicios: retrato corporativo (LinkedIn, perfiles), retrato personal/editorial,
  fotografía para equipos y empresas.
- Precio de entrada: paquetes desde $900 MXN. Edición incluida, entrega en 3–5 días.
- Contacto: WhatsApp +52 55 1238 8782, contacto@ante.photo. Respuesta < 24 h.
- Zona: Ciudad de México.
- Negocio adyacente: Foro Colibrí, renta de foro fotográfico en CDMX (`/mas`).

**Inferencia (a validar con el usuario):**

- El diferenciador parece ser estético (limpio, honesto, sin artificio) más que precio o velocidad.
- El precio de entrada bajo sugiere que el retrato personal es puerta de entrada y el
  corporativo es donde está el margen.

**Pendiente de contestar:**

- ¿Quién es el mejor cliente y cuál es el mal-fit?
- ¿Contra quién se pierde una cotización? (competidores reales, no genéricos)
- ¿Qué temas o públicos NO se quieren atacar? (¿bodas? ¿eventos? ¿XV años?)
- ¿Hay Google Business Profile activo y verificado? Para un estudio local pesa tanto o
  más que el sitio.

---

## Preferencias de trabajo

- **Idioma:** todo el contenido y los entregables en español de México.
- **Voz:** sobria y directa, alineada al tono del sitio. Nada de copy inflado ni superlativos.
- **Créditos:** confirmar con el usuario antes de correr lotes de research grandes.
  Con 0 créditos, priorizar lo que sea gratis (GSC, análisis del propio sitio).

---

## Estructura de carpetas

```
seo/
  README.md        ← este archivo, el contexto vivo
  gsc/             ← exports CSV de Search Console (ignorados por git)
  keywords/        ← listas y clusters
  competidores/    ← notas por competidor
  contenido/       ← briefs y borradores
  reportes/        ← resultados de audits y seguimiento
```

---

## Bitácora

- **2026-07-27** — Workspace creado. Proyecto OpenSEO `ANTE` creado (México/es).
  GSC sin conectar, 0 créditos. Objetivos definidos: sesiones agendadas + corporativo.
- **2026-07-27** — Arreglos técnicos (sin commitear):
  - `/agendar` agregado al nav global y al mapa de breadcrumbs de `Layout.astro`.
    Antes solo se enlazaba desde el home y su breadcrumb decía "Página".
  - `/mas`: el `<video>` pedía `/Dawn Timelapse Video.mp4`, que **no existe** (404 confirmado
    en producción). Se eliminó el video y su JS de fallback; ahora es imagen de fondo directa.
  - `Fondo4.png` (6.1 MB) → `Fondo4.jpg` 1920px (294 KB). El PNG original se conservó.
  - `Mich1.jpg` (3.3 MB, 2000×3000) → 1400×2100 (520 KB). Recuperable con `git checkout`.
  - `width`/`height` en las 17 imágenes del home, contra CLS.
  - Pendiente medir: no hay baseline de Core Web Vitals previo. Verificar en PageSpeed
    después de desplegar.

### Baseline de Search Console (25 abr – 25 jul 2026)

**19 clics, ~5,200 impresiones.** Punto de partida real, para comparar más adelante.

| Página | Impresiones | Clics | Posición |
| --- | --- | --- | --- |
| `/` | 4,223 | 14 | 6.9 |
| `/contacto` | 567 | 0 | 7.0 |
| `/nosotros` | 174 | 0 | 7.5 |
| `/galeria` | 167 | 2 | 40.3 |
| `/galeria.html` | 38 | 3 | 17.6 |
| `/agendar`, `/mas` | 0 | 0 | — |

Notas sobre estos datos:

- Las URLs `.html` son residuo del índice viejo. **Cloudflare ya hace 301** de `/galeria.html`
  a `/galeria` (verificado con curl), así que se consolidan solas. No hay nada que arreglar.
- La mayoría de las impresiones del home vienen de consultas anonimizadas por GSC. Las visibles
  son casi todas "estudio fotográfico cerca de mí" en posición 1–4 con **0 clics**: son
  búsquedas donde el paquete de mapas se lleva el clic. **La palanca ahí es Google Business
  Profile, no el sitio.**
- **Coyoacán / Copilco aparecen repetidamente** ("estudio fotografico coyoacan" pos. 2.1,
  "foto estudio coyoacan" 30 impresiones, "estudio fotografico copilco"). El sitio **nunca
  menciona esas colonias** — solo dice CDMX. Sin confirmar dónde está el estudio, no se puede
  escribir. **Pregunta abierta y prioritaria.**
- "book de fotos", "book fotográfico", "book profesional": posiciones 2–5 con volumen mínimo.
  Es el término mexicano y el sitio no lo usaba.
- Corporativo (objetivo #2): "fotografía corporativa cdmx" pos. 38.5, "fotografía corporativa
  méxico" pos. 47. Prácticamente no existe.

- **2026-07-27** — Cambios para CTR y captación:
  - Titles reescritos usando el lenguaje real de las consultas ("estudio fotográfico", no
    "estudio de fotografía") y con precio en el del home.
  - FAQ nueva sobre books de fotos, visible y en el `FAQPage` schema.
  - `/galeria` tenía solo un `h1`: se agregó párrafo de intro y CTA a `/agendar`.
  - Teléfono actualizado a **+52 55 1238 8782** en todo el sitio, plantillas de correo
    y `.env.example`. **Pendiente:** cambiar `ADMIN_WHATSAPP_TO` en el entorno de Cloudflare
    y el número en `legacy_html/` si esos archivos siguen sirviendo para algo.
