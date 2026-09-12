# Agente de WhatsApp de ANTE

Un asistente automático que contesta el WhatsApp de ANTE: dice qué paquetes hay y cuánto cuestan,
junta los datos para apartar una sesión y se los pasa a Pablo, y todo lo que no sabe se lo pasa a
Pablo también. Es el **piloto del pipeline que va a usar KokoroCo**; Pablo, 12 sep 2026: «sí vamos
directo con meta o lo que sea que vayamos a usar en el día a día con kokoroco, tiene que quedar el
mismo pipeline para probarlo».

```
Meta (WhatsApp Cloud API) ──HTTPS──► borde de Cloudflare ──túnel cloudflared-ante──► 127.0.0.1:9186
   POST firmado                      wa.ante.photo             UNA ruta: /webhook/meta     svc-ante (este programa)
   X-Hub-Signature-256               + regla WAF: sólo AS32934                             firma sobre los bytes crudos,
                                                                                           200 en el acto, responde por
                                                                                           la Graph API · DeepSeek Flash
```

Corre en el servidor `kokoroco-central` (compartimento `ante`). **No forma parte del sitio**:
`tsconfig.json` lo excluye y nada de `src/` lo importa (el aviso al admin del sitio,
`src/lib/whatsapp.ts`, no se tocó). Node 24 sin dependencias (sin `npm install`): `node:http`,
`fetch`, `node:crypto`, `node:test` y ficheros; TypeScript con la eliminación de tipos nativa de
Node. Probado con Node 22.23 y 26.7 (en el servidor hay 24.20).

## Igual al pipeline de KokoroCo, y lo que difiere a propósito

**Igual** (S474, S476 del plano de KokoroCo):
- Meta **directa**, sin intermediario (S476 descartó uno tipo Twilio).
- La ruta se autentica **sólo** por la firma HMAC-SHA256 de los **bytes crudos**, comprobada antes
  de parsear; Meta no manda token de identidad.
- **200 en el acto** e ingesta **idempotente** (deduplicación por el `id` del mensaje, el wamid).
- **Una sola ruta** pública, por un **túnel de Cloudflare**, a un **proceso aparte** que sólo sirve
  el webhook; nada en `0.0.0.0`, ni el módem ni Tailscale se tocan.
- La regla de Cloudflare que sólo acepta esa ruta y sólo desde la red de Meta es **refuerzo, no
  condición**: el candado es la firma.
- El precio también es el mismo: **Cloudflare ve el contenido de los mensajes**, y el aviso de
  privacidad tendrá que nombrar a Meta y a Cloudflare (decisión 4).

**Difiere a propósito:**
- **Nombre propio del túnel, `wa.ante.photo`.** En KokoroCo el webhook entra con el mismo nombre de
  la tienda (V4). El sitio de ANTE es un Worker de Cloudflare, no un proceso en la máquina: no hay
  un nombre de la máquina que compartir.
- **Sin rol de base.** KokoroCo registra el mensaje con un rol de base propio que sólo puede
  hacer eso; ANTE guarda JSON Lines en su dataset.
- **Sin evento de la puerta única del log.** El nombre del hecho «llegó un mensaje de un cliente» es
  ⛔SP145, de KokoroCo, y sigue abierta: ANTE no lo acuña.
- **Aquí el mismo proceso contesta.** En KokoroCo la ruta sólo registra y devuelve 200 (S474); en el
  piloto, el proceso que recibe también llama al modelo y responde por la Graph API.

## Con quién habla, en dos pasos

1. **Primero, el número de prueba** que da Meta for Developers al crear la app (pantalla
   *WhatsApp → API Setup*). Sólo le puede escribir a los números que Pablo agregue como destinatarios
   en esa pantalla. **Cuántos admite no lo encontré en la documentación oficial**: el resumen de un
   buscador dice «up to 5», pero no está en el texto de las páginas de Meta que abrí.
2. **Después, y es decisión aparte de Pablo:** el número real de ANTE en **coexistencia**, la app
   WhatsApp Business y la Cloud API a la vez. Meta lo documenta
   (https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users):
   «They can still send messages on a one-to-one basis using the WhatsApp Business app, and WhatsApp
   keeps messaging history between both apps in sync», con límites: «business phone numbers that are
   in use with both the WhatsApp Business app and Cloud API have a fixed throughput of 20 mps», y
   funciones de la app que se desactivan.

## Verlo funcionar, en un minuto

```sh
node agente/simular.ts
```
Levanta una Graph API falsa en `127.0.0.1` que **exige la ventana de 24 h** como Meta, arranca el
agente con secretos falsos y le hace lo que haría Meta a través del túnel: la verificación GET
(buena y mala), cinco vueltas firmadas, una firma mala, una firma sobre JSON re-serializado, el
mismo wamid dos veces, un payload de `statuses`, un aviso a Pablo con su ventana cerrada (queda
pendiente) y lo que pasa cuando Pablo escribe, y otro cliente que pregunta algo que el agente no
sabe y luego escribe BAJA. Transcripción: [`ejemplos/transcripcion-simulada.md`](ejemplos/transcripcion-simulada.md).
Sin `DEEPSEEK_API_KEY` usa el proveedor **simulado** (reglas fijas, sin red).

Las pruebas:
```sh
node --test 'agente/**/*.test.ts'
```
(`node --test agente/` no sirve: Node 22 y 26 toman el directorio como un archivo.) No tocan la red.

## Cómo está hecho

| Archivo | Qué hace |
|---|---|
| `src/main.ts` | Arranca: configuración, servidor en 127.0.0.1, poda de lo viejo cada 6 h. |
| `src/webhook.ts` | La única ruta: GET de verificación, POST firmado, 404 a todo lo demás. |
| `src/firma.ts` | `X-Hub-Signature-256` sobre los bytes crudos, en tiempo constante. |
| `src/meta.ts` | Enviar texto y plantillas por la Graph API. |
| `src/avisos.ts` | Avisos a Pablo con la regla de la ventana de 24 h (texto, plantilla o pendiente). |
| `src/agente.ts` | El núcleo: las compuertas en orden. |
| `src/modelo.ts` | Proveedores `deepseek` y `simulado`. |
| `src/salida.ts` | Validación de lo que el modelo escribió, y los marcadores de acción. |
| `src/historial.ts`, `src/estado.ts`, `src/gasto.ts` | Historial, deduplicación, bajas, límites, tope de gasto. |
| `conocimiento.md` | **Lo único que el agente sabe**, escrito desde el sitio con la ruta de cada dato. |
| `despliegue/` | Las dos unidades de systemd (la del túnel, tal como quedó desplegada), el config del túnel y el drop-in de ejemplo, la guía para root y dos propuestas de capa. |

### Qué garantiza el código (y no el modelo)

- **Sólo entra lo que firmó Meta:** HMAC-SHA256 con el App Secret sobre los bytes tal como llegan
  (una re-serialización del JSON da 403), comparado en tiempo constante; sin firma → 403 y el
  mensaje ni se apunta. Una sola ruta: lo demás, 404.
- **No inventa cifras.** Toda cantidad en pesos y todo porcentaje tiene que estar en
  `conocimiento.md`; si no, la respuesta no sale y pasa a Pablo. Una prueba compara la tabla de
  paquetes con `src/lib/precios.ts`.
- **El modelo sólo escribe texto.** Para agendar o pasar a Pablo escribe un marcador; el código lo
  quita y manda el aviso, siempre al mismo destino.
- **Salida limpia:** formato de WhatsApp, nunca Markdown; sólo enlaces de `ante.photo`; tope de
  4096 caracteres (`text.body`: «Maximum 4096 characters»).
- **Tope de gasto diario** (US$0.50), reservando el peor caso antes de cada llamada y a tarifa pico;
  tiempo máximo por llamada (20 s), `max_tokens` 400, un reintento corto.
- **Deduplicación por wamid**, en disco: Meta reintenta y avisa que eso puede duplicar.
- **Límites:** 20 mensajes por número por hora y 200 en total. **BAJA/STOP** se respeta siempre;
  **ALTA** reactiva. Los `statuses` (entregado, leído) se ignoran; lo que no es texto recibe una
  respuesta fija (una reacción, nada).
- **Se presenta como asistente automático de ANTE** en el primer mensaje de cada conversación.
- **Privacidad:** historial por número podado (12 vueltas, 8000 caracteres) y **30 días** de
  retención; ficheros 0600. El registro nunca lleva secretos, ni texto de mensajes, ni números completos.

### Avisos a Pablo: el hueco, con nombre

Con la Cloud API, un mensaje que **inicia el negocio** fuera de la ventana de 24 h del destinatario
tiene que ser una **plantilla aprobada**; el error de Meta es el 131047: «More than 24 hours have
passed since the recipient last replied to the sender number» → «Send the recipient a template
message instead» (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes). El
aviso a Pablo es justo eso. Así que el agente lleva la cuenta de la última vez que Pablo le escribió
al número y:

- **(a)** si su ventana está abierta (24 h menos 30 min de margen), el aviso va como **texto**;
- **(b)** si no, y están puestas `AGENTE_PLANTILLA_AVISO` y `AGENTE_PLANTILLA_IDIOMA`, va como
  **plantilla de utilidad**, con el aviso resumido en una línea como su único parámetro;
- **(c)** si no hay ni ventana ni plantilla, **no llega**: queda en
  `datos/agente/avisos-pendientes.jsonl`, el registro lo marca con nivel `error`
  (`aviso_admin.NO_ENTREGADO`) y **sale en cuanto Pablo escriba cualquier cosa** al número.

No hay correo ni otro canal de respaldo: **eso lo decide Pablo** (decisión 9). Plantilla sugerida,
si la quiere (categoría *Utility*, idioma `es_MX`, nombre `aviso_asistente`):
«Aviso del asistente de ANTE: {{1}}». Meta la tiene que aprobar.

## Variables

Secretos — de `$CREDENTIALS_DIRECTORY/<NOMBRE>` (systemd `LoadCredentialEncrypted`) y, sólo en
desarrollo, de variables de entorno:

| Nombre | Qué es |
|---|---|
| `META_ACCESS_TOKEN` | token permanente de un System User de Meta |
| `META_APP_SECRET` | App Secret de la app: con él se comprueba la firma |
| `META_VERIFY_TOKEN` | lo genera root con `openssl rand -hex 32`; Pablo lo pega en Meta |
| `DEEPSEEK_API_KEY` | llave de DeepSeek |
| `ADMIN_WHATSAPP_TO` | el WhatsApp de Pablo en E.164 (`+52…`), a donde van los avisos. Va como secreto porque el repo es público |

No secretos (por omisión entre paréntesis): `META_PHONE_NUMBER_ID` (obligatorio, en el drop-in),
`META_GRAPH_VERSION` (`v26.0`), `AGENTE_RUTA` (`/webhook/meta`), `AGENTE_HOST`/`AGENTE_PUERTO`
(`127.0.0.1`/`9186`, sólo loopback), `AGENTE_DATOS` (`agente/.datos`; en el servidor
`/koko/srv/ante/datos/agente`), `AGENTE_PLANTILLA_AVISO` + `AGENTE_PLANTILLA_IDIOMA` (sin plantilla),
`AGENTE_PROVEEDOR` (`deepseek` si hay llave, si no `simulado`), `AGENTE_MODELO` (`deepseek-flash`),
`AGENTE_TOPE_DIARIO_USD` (`0.5`), `AGENTE_PRECIO_ENTRADA_USD_MTOK` / `…_ENTRADA_CACHE_…` /
`…_SALIDA_…` (`0.3`/`0.006`/`1.2`, tarifa pico), `AGENTE_MAX_TOKENS` (`400`), `AGENTE_TIEMPO_MODELO_MS`
(`20000`), `AGENTE_PRESENTARSE` (`si`), `AGENTE_PRESENTACION`, `AGENTE_NOMBRE_HUMANO` (`Pablo`),
`AGENTE_CONVERSACION_HORAS` (`12`), `AGENTE_LIMITE_POR_NUMERO_HORA`/`AGENTE_LIMITE_GLOBAL_HORA`
(`20`/`200`), `AGENTE_VUELTAS`/`AGENTE_HISTORIAL_CARACTERES` (`12`/`8000`), `AGENTE_RETENCION_DIAS`
(`30`); y para pruebas `META_GRAPH_BASE`, `DEEPSEEK_API_BASE`, `AGENTE_CONOCIMIENTO`, `AGENTE_ZONA_HORARIA`.

## Lo verificado (12 sep 2026), con su fuente

**Meta**
- **Versión de la Graph API: v26.0**, la más reciente: «Introducing Graph API v26.0 and Marketing API
  v26.0», 29 jul 2026 (https://developers.facebook.com/blog/post/2026/07/29/introducing-graph-api-v26-and-marketing-api-v26/). Configurable.
- **Verificación (GET):** «Verify that the `hub.verify_token` value matches the string you set in the
  Verify Token field … Respond with the `hub.challenge` value.» (https://developers.facebook.com/docs/graph-api/webhooks/getting-started)
- **Firma (POST):** «We sign all Event Notification payloads with a SHA256 signature and include the
  signature in the request's X-Hub-Signature-256 header, preceded with sha256=» y «Generate a SHA256
  signature using the payload and your app's App Secret» (misma página). La página no habla de
  escapes unicode; firmar los bytes crudos es lo único que no depende de cómo se re-serialice.
- **Forma del payload:** `object: whatsapp_business_account`, `entry[].changes[].value` con
  `metadata.phone_number_id`, `contacts[]`, `messages[]` (`from`, `id`, `timestamp`, `type`,
  `text.body`) y `statuses[]` (https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/components).
  «Webhook payloads can be up to 3 MB» (https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/overview):
  el agente acepta hasta 4 MB. Lotes: «a **maximum** of 1000 updates» (getting-started).
- **Envío:** `POST https://graph.facebook.com/<API_VERSION>/<WHATSAPP_BUSINESS_PHONE_NUMBER_ID>/messages`
  con `Authorization: Bearer`, `to` = «WhatsApp user phone number» (ejemplo `+16505551234`),
  `text.body` «Maximum 4096 characters»
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/text-messages).
  Plantillas: `type: "template"`, `template: {name, language: {code}, components}`
  (https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages).
- **Reintentos — dos páginas de Meta dicen cosas distintas:** la genérica, «we will retry
  immediately, then try a few more times with decreasing frequency over the next 36 hours»
  (getting-started); la de WhatsApp, «Meta retries delivery with decreasing frequency until the
  request succeeds, for up to 7 days» y «These retries can result in duplicate webhook notifications»
  (webhooks/overview). Para el código da igual: deduplica por wamid (30 días).
- **Cuánto espera Meta la respuesta:** **no confirmado**; ninguna de las dos páginas da un número.
  Las dos piden responder 200 («Your endpoint should respond to all Event Notifications with
  200 OK HTTPS»): el agente contesta 200 antes de procesar.
- **México:** «For Brazil and Mexico, the extra added prefix of the phone number may be modified by
  the Cloud API» (https://developers.facebook.com/docs/whatsapp/cloud-api/reference/phone-numbers/).
  Por eso `521…` y `52…` cuentan como el mismo número al reconocer a Pablo.
- **Red de Meta:** «You can get the IP addresses of Meta's webhook servers by running … `whois -h
  whois.radb.net — '-i origin AS32934'`» (webhooks/overview). ASN 32934 = «Meta», «Also Known As
  Facebook, Instagram, WhatsApp, Messenger» (https://www.peeringdb.com/net/979).
- **Token de System User:** «access the Business settings panel and then click System Users» y
  «click the Generate token button», con los permisos «business_management,
  whatsapp_business_management, whatsapp_business_messaging»
  (https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens/).
- **Destinatarios del número de prueba:** **no confirmado** (ver «Con quién habla»).

**Cloudflare**
- **Instalar:** `curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee
  /usr/share/keyrings/cloudflare-main.gpg` y `deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg]
  https://pkg.cloudflare.com/cloudflared any main` en `/etc/apt/sources.list.d/cloudflared.list`
  (https://pkg.cloudflare.com/index.html; hay línea `any` y línea bookworm, no trixie).
- **Lo que quedó en la máquina (medido el 12 sep, 10:37 CST):** `cloudflared` 2026.9.1; llave
  sha256 `1bd95f4082b320d541bee351560fc2765aa9f9cd8efa4c9e32135e63f252721d` (huella
  `CC94 B39C 77AE 7342 A68B 8962 8A68 2D30 8D4E 5E73`); el paquete **no trae unidad propia**. Túnel
  `ante-wa` **administrado en local**, CNAME `wa.ante.photo` con proxy. Desde fuera, sin el agente:
  `/webhook/meta` → 502, `/` → 404, `/webhook/meta/x` → 404. Detalle en `despliegue/PARA-ROOT.md`, paso 6.
- **Túnel administrado en local:** `cloudflared tunnel login` «Prompts a browser window where you can
  authenticate your tunnel to your Cloudflare account»; `tunnel create` «Creates a tunnel, registers it
  with the Cloudflare edge and generates a credential file to run this tunnel»; `tunnel route dns`
  «Creates a DNS CNAME record hostname that points to the tunnel»
  (https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/tunnel-useful-commands/).
  Si `tunnel delete` borra también el CNAME, esa página no lo dice.
- **La credencial desde archivo:** `--credentials-file`, «Filepath at which to read/write the tunnel
  credentials» (`cmd/cloudflared/tunnel/subcommands.go` de https://github.com/cloudflare/cloudflared).
  El túnel se toma del argumento o de la clave `tunnel:` del config, no del archivo de credenciales
  (mismo archivo): por eso el config lleva el UUID.
- **La ruta única:** en el config, «You can also enter regular expressions for the path key», con
  sintaxis de Go, y la última regla tiene que atrapar todo
  (https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/).
  Se compara sólo la ruta, sin la query: `FindMatchingRule(req.Host, req.URL.Path)` en
  `proxy/proxy.go` del mismo repositorio. Así el GET de verificación de Meta (con `?hub.…`) entra.
- **systemd:** `%d` = «Credentials directory … the value of the `$CREDENTIALS_DIRECTORY` environment
  variable» (fuente de `systemd.unit(5)`, https://github.com/systemd/systemd/blob/main/man/systemd.unit.xml).
- **Regla WAF:** «Security rules» → «Create rule» → «Custom rules», «Rule name», «Choose action»,
  «Deploy» (https://developers.cloudflare.com/waf/custom-rules/create-dashboard/). Campo
  `ip.src.asnum`: «The 16-bit or 32-bit integer representing the Autonomous System (AS) number
  associated with the client IP address»; reemplaza a `ip.geoip.asnum`
  (https://developers.cloudflare.com/ruleset-engine/rules-language/fields/reference/ip.src.asnum/).
  Si el plan Free lo permite en reglas personalizadas **no lo confirmé**.

### La regla WAF (texto exacto para el panel)

Nombre: `ANTE wa: solo webhook de Meta` · Acción: **Block** · Expresión (con *Edit expression*):
```
(http.host eq "wa.ante.photo" and not (http.request.uri.path eq "/webhook/meta" and ip.src.asnum eq 32934))
```
Bloquea en el borde todo lo que vaya a `wa.ante.photo` salvo la ruta del webhook desde la red de Meta.

## Costo esperado

El modelo: el mensaje de sistema ronda 7,200 caracteres (unos 2,000 tokens) y DeepSeek cobra la parte
repetida como caché, así que una vuelta cuesta del orden de US$0.001 (lo real queda en `gasto.json`).
WhatsApp: no verifiqué la página de precios de Meta en esta vuelta; lo citado antes (de la página de
Twilio) es que Meta no cobra los mensajes libres dentro de la ventana de servicio. Cloudflare Tunnel
en el plan de Pablo: no verificado.

## Lo que hace Pablo, paso por paso

Los nombres entre comillas salen de la documentación; los marcados con † no los encontré citados
textualmente y pueden llamarse un poco distinto en su pantalla.

**El túnel de Cloudflare ya está hecho** (12 sep, `wa.ante.photo` → `/webhook/meta`, habilitado):
en Cloudflare a Pablo sólo le queda la regla WAF (paso 8).

**Meta y DeepSeek: cinco cosas en un solo archivo `ante.env`**, una por línea, `NOMBRE=valor`, sin
comillas:
```
META_ACCESS_TOKEN=…
META_APP_SECRET=…
META_PHONE_NUMBER_ID=…
ADMIN_WHATSAPP_TO=+52…
DEEPSEEK_API_KEY=…
```
1. En developers.facebook.com: «Create App», caso de uso «Connect with customers through WhatsApp».
2. En la app, «WhatsApp» → «API Setup»: queda el número de prueba. El **Phone number ID** va a
   `META_PHONE_NUMBER_ID`; en «To», agregar su propio teléfono y confirmarlo con el código que llega.
3. En Business Settings (Meta Business Suite): «System Users» → crear uno, asignarle la app, y
   «Generate token» con «business_management», «whatsapp_business_management» y
   «whatsapp_business_messaging». El token va a `META_ACCESS_TOKEN`.
4. En la app, App settings → Basic† → **App Secret**: va a `META_APP_SECRET`.
5. Su WhatsApp en E.164 (`+52…`) va a `ADMIN_WHATSAPP_TO`, y la llave de DeepSeek a `DEEPSEEK_API_KEY`.
6. Subir `ante.env` por `scp` a su casa en el servidor (`~pablo-admin/ante.env`) y avisar a root.

**Root hace los pasos 1–5 de `PARA-ROOT.md`** (lee `ante.env` sin ejecutarlo, cifra los secretos,
escribe el Phone number ID en el drop-in, destruye el archivo y arranca el agente). Después, Pablo:

7. En la app de Meta, «WhatsApp» → «Configuration»: Callback URL† `https://wa.ante.photo/webhook/meta`,
   «Verify Token» = el que root le dejó en `~pablo-admin/META_VERIFY_TOKEN.txt`, «Verify and save»†;
   luego, en los campos del webhook, suscribir «messages»†.
8. En Cloudflare, «Security rules» → «Create rule» → «Custom rules»: la regla WAF de arriba, acción
   Block, «Deploy».
9. Desde su teléfono, escribir «Hola» al número de prueba. Si responde, el pipeline está completo.
10. Si quiere los avisos fuera de su ventana de 24 h: crear la plantilla `aviso_asistente` (arriba) y,
    cuando la aprueben, pasarle el nombre y el idioma a root para el drop-in.

## Lo que decide Pablo (cada una se contesta con una palabra)

1. **Llave de DeepSeek:** ¿la abre para el agente? — *sí / no*
2. **Modelo:** «V4 Flash» se retiró y su nombre lo atiende DeepSeek-V4.1-Flash (`deepseek-flash`) al mismo precio; ¿vale ése? — *sí / no*
3. **Presentación:** ¿se presenta como «asistente automático de ANTE» en el primer mensaje? (hoy: sí) — *sí / no*
4. **Privacidad:** ¿pueden los mensajes de los clientes pasar por Meta y Cloudflare y procesarse en DeepSeek (China)? El aviso de privacidad (`src/pages/aviso-privacidad.astro`, líneas 20, 25-30 y 46) sólo habla de teléfono y correo y de «proveedores de servicios técnicos (por ejemplo, proveedores de correo electrónico)». No lo edité. — *sí / no*
5. **Tope:** ¿US$0.50 al día de modelo? — *sí / otra cifra*
6. **Su nombre:** el sitio nunca lo nombra; ¿el agente dice «Pablo» a los clientes? — *sí / no*
7. **Horario:** el sitio dice «Lunes a sábado, 9:00 a 18:00» (`agendar.astro:73`) y también «Contáctanos para verificar disponibilidad» (`contacto.astro:41`); ¿cuál vale? Mientras, el agente no da horario. — *el primero / el segundo*
8. **Plantilla de avisos:** ¿crea `aviso_asistente` para que los avisos le lleguen aunque no haya escrito en 24 h? Sin ella, esperan a que escriba. — *sí / no*
9. **Otro canal para los avisos** (correo, por ejemplo) cuando no hay ventana ni plantilla. — *sí / no*
10. **Regla WAF:** ¿la pone (refuerzo, no condición)? — *sí / no*
11. **Encender el agente para siempre** (`systemctl enable svc-ante`) después de la prueba; `cloudflared-ante` ya lo habilitó el 12 sep. — *sí / no*
12. **Número real en coexistencia** (paso 2 de «Con quién habla»), cuando el de prueba funcione. — *sí / no*

## Límites conocidos

- El túnel existe y responde (502 mientras el agente no corra), pero no hay número de Meta todavía:
  todo lo de Meta está probado contra falsos.
- La comparación en tiempo constante no la puede vigilar una prueba funcional (es una propiedad de
  tiempos): la cuida la revisión del código.
- Los `SystemCallFilter=` de `svc-ante` no se pudieron probar: en la Mac no hay systemd.
  `PARA-ROOT.md` dice qué hacer si estorban. En `cloudflared-ante` se quitaron
  `MemoryDenyWriteExecute=` y la lista negra de llamadas al desplegar, por prudencia y sin probar si
  rompían: queda `SystemCallFilter=@system-service`.
- La regla WAF supone que Meta llama desde AS32934, como documenta; no lo he visto en vivo.
- El proveedor simulado no conversa: la calidad se ve con el modelo real.
- Los mensajes de Pablo al número también reciben respuesta del asistente y cuentan para los
  límites y el gasto, a propósito: así prueba lo que vería un cliente (y de paso abre su ventana de 24 h).
- A una reacción (👍) no le contesta nada; a cualquier otro mensaje que no sea texto, la respuesta fija.
