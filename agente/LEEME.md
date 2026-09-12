# Agente de WhatsApp de ANTE

Un asistente automático que contesta el WhatsApp de ANTE: dice qué paquetes hay y cuánto cuestan,
junta los datos para apartar una sesión y se los pasa a Pablo, y todo lo que no sabe se lo pasa a
Pablo también. Es el **piloto** que pidió Pablo para ver cómo trabaja un agente de WhatsApp, con
ANTE porque es de bajo riesgo. Corre en el servidor `kokoroco-central` (compartimento `ante`, unidad
`svc-ante.service`); **no forma parte del sitio**: `tsconfig.json` lo excluye y nada de `src/` lo importa.

Node 24 sin dependencias (sin `npm install`): `node:http`, `fetch`, `node:crypto`, `node:test` y
ficheros. TypeScript con la eliminación de tipos nativa de Node. Probado con Node 22.23 y 26.7 (en
el servidor hay 24.20).

## Con quién habla hoy

Con el **Sandbox de Twilio**: contesta en el número compartido de Twilio (+1 415 523 8886), **no** en
el WhatsApp de ANTE que publica el sitio. Y el Sandbox sólo habla con quien antes le escribió
`join <código>`: «You can only message end users who have joined your Sandbox»
(https://www.twilio.com/docs/whatsapp/sandbox). Un cliente que escriba hoy al WhatsApp de ANTE **no**
llega al agente; en la prueba hablan con él Pablo y quien él invite a unirse. Eso es lo que la hace de
bajo riesgo. Para que conteste el número real de ANTE hay que darlo de alta en la plataforma de
WhatsApp Business por Twilio (qué pasa entonces con ese número en la app del teléfono no lo verifiqué:
se revisa antes): es la decisión 12.

## Verlo funcionar, en un minuto

```sh
node agente/simular.ts
```
Levanta un Twilio falso en `127.0.0.1`, arranca el agente con un token falso y le manda una
conversación de cinco vueltas firmada como la firmaría Twilio, una petición con firma mala, un
reintento de Twilio y, en modo sondeo, un segundo número que pregunta algo que el agente no sabe y
luego escribe BAJA. Escribe la transcripción en
[`ejemplos/transcripcion-simulada.md`](ejemplos/transcripcion-simulada.md). Sin
`DEEPSEEK_API_KEY` usa el proveedor **simulado** (reglas fijas, sin red); con la llave, el modelo real.

Las pruebas:
```sh
node --test 'agente/**/*.test.ts'
```
(`node --test agente/` no sirve: Node 22 y 26 toman el directorio como un archivo y fallan; hay que
darle el patrón.) No tocan la red: Twilio y DeepSeek son falsos, en `127.0.0.1`.

## Cómo está hecho

```
WhatsApp del cliente ──► Twilio ──┬─ modo sondeo: el agente pregunta cada 5 s  GET …/Messages.json
                                  └─ modo webhook: Twilio llama  POST https://<túnel>/twilio/whatsapp
                                                      │
                                   agente/src/agente.ts (el mismo núcleo para los dos)
   duplicado → otro número → BAJA/ALTA → dado de baja → límites → sólo foto → tope de gasto
            → modelo (DeepSeek o simulado) → validación de la salida → envío por la API REST
            → avisos a Pablo (Twilio REST a ADMIN_WHATSAPP_TO, como src/lib/whatsapp.ts)
```

| Archivo | Qué hace |
|---|---|
| `src/main.ts` | Arranca: lee la configuración, elige el modo, poda los datos viejos cada 6 h. |
| `src/config.ts` | Variables de entorno y secretos (`$CREDENTIALS_DIRECTORY` primero). |
| `src/agente.ts` | El núcleo: las compuertas de arriba, en ese orden. |
| `src/sondeo.ts` / `src/webhook.ts` | Los dos modos de entrada. |
| `src/firma.ts` | `X-Twilio-Signature`, con el algoritmo de la documentación de Twilio. |
| `src/twilio.ts` | Enviar y listar mensajes por la API REST. |
| `src/modelo.ts` | Proveedores `deepseek` y `simulado`. |
| `src/salida.ts` | Validación de lo que el modelo escribió, y los marcadores de acción. |
| `src/historial.ts`, `src/estado.ts`, `src/gasto.ts` | Historial, deduplicación, bajas, límites y tope de gasto. |
| `conocimiento.md` | **Lo único que el agente sabe**, escrito desde el sitio con la ruta de cada dato. |
| `despliegue/` | La unidad de systemd, la guía para root y la propuesta para la capa del servidor. |

### Qué garantiza el código (y no el modelo)

- **No inventa cifras.** Toda cantidad en pesos y todo porcentaje de una respuesta tiene que estar
  en `conocimiento.md`; si no, la respuesta no sale y la conversación pasa a Pablo. Una prueba
  compara la tabla de paquetes con `src/lib/precios.ts`: si cambia un precio del sitio y no el
  conocimiento, se pone en rojo.
- **El modelo sólo escribe texto.** No tiene herramientas. Para agendar o pasar a Pablo escribe un
  marcador (`[[AGENDAR|nombre=…|sesion=…|fecha=…]]`, `[[PASAR|motivo=…]]`); el código lo quita del
  mensaje y manda el aviso, siempre al mismo destino. Un marcador ilegible se trata como «pasar a Pablo».
- **Salida limpia:** formato de WhatsApp (`*negrita*`, `_cursiva_`), nunca Markdown; sólo enlaces de
  `ante.photo`; tope de 1,600 caracteres, que es el de Twilio («Can be up to 1,600 characters in
  length», https://www.twilio.com/docs/messaging/api/message-resource).
- **Tope de gasto diario** (US$0.50 por omisión). Antes de cada llamada se reserva el peor caso; si
  no cabe, no se llama al modelo: el cliente recibe un mensaje fijo y Pablo un aviso (una vez por
  número y día). Se cobra siempre a tarifa pico, así el tope es una cota superior.
- **Tiempo máximo por llamada** (20 s), `max_tokens` acotado (400) y un solo reintento corto.
- **Deduplicación por `MessageSid`**, en disco: Twilio reintenta y el sondeo vuelve a ver lo mismo.
- **Límites:** 20 mensajes por número por hora y 200 en total (en memoria: un reinicio los vacía).
- **BAJA / STOP** (el mensaje entero): la baja se respeta siempre; confirma una sola vez (dentro del
  límite por número, para que alternar BAJA/ALTA no dispare envíos pagados) y no vuelve a contestar
  ni a guardar lo que escriba ese número. **ALTA** lo reactiva.
- **Se presenta como asistente automático de ANTE** en el primer mensaje de cada conversación
  (tras 12 h de silencio empieza otra). Es una frase fija que pone el código, no el modelo.
- **Privacidad:** historial por número en JSON Lines, podado a las últimas 12 vueltas y 8,000
  caracteres, y **30 días** de retención (lo más viejo se borra solo). Ficheros 0600. El registro
  nunca lleva secretos, ni el texto de los mensajes, ni números completos (`whatsapp:+521…1234`).

## Los dos modos

- **`sondeo`** (por omisión, el de la prueba). El servicio no escucha nada: cada `AGENTE_SONDEO_MS`
  lista los mensajes entrantes en la API de Twilio y contesta por la misma API. **Cero exposición
  pública.** Al primer arranque no contesta lo que llegó antes; tras un reinicio, contesta lo que
  llegó mientras estuvo apagado (hasta 60 min atrás).
  *Qué dice la documentación:* los entrantes son recursos `Message` con `direction` = «inbound»
  («Incoming messages»), y del `MessageSid` que llega al webhook dice «May be used to later retrieve
  this message from the REST API» (https://www.twilio.com/docs/messaging/guides/webhook-request); la
  lista se filtra por `DateSent` (días GMT: «YYYY-MM-DD», «>=YYYY-MM-DD») y viene «sorted by the
  `DateSent` field, with the most recent messages appearing first»
  (https://www.twilio.com/docs/messaging/api/message-resource). **Lo que no dice** en ningún lado
  es, para el Sandbox en particular, que los entrantes queden listados sin un webhook útil. Por eso
  la primera prueba real es la comprobación (`despliegue/PARA-ROOT.md`, paso 6).
- **`webhook`**. Servidor en `127.0.0.1:9186` (nunca `0.0.0.0`: la configuración se niega). Verifica
  `X-Twilio-Signature` como dice https://www.twilio.com/docs/usage/security (URL completa + parámetros
  POST en orden alfabético, nombre y valor sin separadores, HMAC-SHA1 con el Auth Token, Base64) y
  el ejemplo resuelto de esa página es una prueba. Compara en tiempo constante. La URL que se firma
  es la **pública** (`AGENTE_URL_PUBLICA`), la del túnel, no la de 127.0.0.1. Contesta 200 con TwiML
  vacío en el acto y la respuesta sale por la API REST; firma mala → 403 sin tocar el mensaje.
  Necesita un túnel público que hoy no existe: ver `despliegue/PARA-ROOT.md` § «Para pasar a webhook».

## Variables

Secretos — de `$CREDENTIALS_DIRECTORY/<NOMBRE>` (systemd `LoadCredentialEncrypted`) y, sólo en
desarrollo, de variables de entorno:

| Nombre | Qué es |
|---|---|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | La cuenta de Twilio (las mismas que usa `src/lib/whatsapp.ts`). |
| `DEEPSEEK_API_KEY` | Llave de DeepSeek. Sin ella el proveedor es `simulado`, salvo que `AGENTE_PROVEEDOR=deepseek` la exija (así está la unidad). |
| `ADMIN_WHATSAPP_TO` | El WhatsApp de Pablo, a donde llegan los avisos. Va como secreto porque el repo es público. |

El resto (con su valor por omisión):

| Variable | Por omisión | |
|---|---|---|
| `AGENTE_MODO` | `sondeo` | `sondeo` o `webhook` |
| `TWILIO_WHATSAPP_FROM` | — (obligatoria) | nuestro número, `whatsapp:+…` (Sandbox: `whatsapp:+14155238886`) |
| `AGENTE_DATOS` | `agente/.datos` | en el servidor, `/koko/srv/ante/datos/agente` |
| `AGENTE_PROVEEDOR` | `deepseek` si hay llave, si no `simulado` | |
| `AGENTE_MODELO` | `deepseek-flash` | ver «Lo verificado» |
| `AGENTE_TOPE_DIARIO_USD` | `0.5` | día de la Ciudad de México |
| `AGENTE_PRECIO_ENTRADA_USD_MTOK` / `…_ENTRADA_CACHE_…` / `…_SALIDA_…` | `0.3` / `0.006` / `1.2` | tarifa pico de `deepseek-flash` |
| `AGENTE_MAX_TOKENS` | `400` (máximo 1000) | |
| `AGENTE_TIEMPO_MODELO_MS` | `20000` | |
| `AGENTE_SONDEO_MS` | `5000` | |
| `AGENTE_SONDEO_ATRASO_MAX_MIN` | `60` | tras un apagón, hasta cuánto atrás contesta |
| `AGENTE_HOST` / `AGENTE_PUERTO` | `127.0.0.1` / `9186` | sólo loopback |
| `AGENTE_URL_PUBLICA` | — | obligatoria en webhook; idéntica a la de la consola de Twilio |
| `AGENTE_PRESENTARSE` | `si` | `no` quita la presentación |
| `AGENTE_PRESENTACION` | «Hola, soy el asistente automático de ANTE…» | `{humano}` se reemplaza |
| `AGENTE_NOMBRE_HUMANO` | `Pablo` | cómo nombra el agente a quien confirma |
| `AGENTE_CONVERSACION_HORAS` | `12` | silencio tras el que se vuelve a presentar |
| `AGENTE_LIMITE_POR_NUMERO_HORA` / `AGENTE_LIMITE_GLOBAL_HORA` | `20` / `200` | |
| `AGENTE_VUELTAS` / `AGENTE_HISTORIAL_CARACTERES` | `12` / `8000` | poda del historial |
| `AGENTE_RETENCION_DIAS` | `30` | |
| `AGENTE_ENVIO_INTERVALO_MS` | `3000` | el Sandbox manda «one message every three seconds» |
| `TWILIO_API_BASE`, `DEEPSEEK_API_BASE`, `AGENTE_CONOCIMIENTO`, `AGENTE_ZONA_HORARIA` | | para pruebas |

Para correrlo a mano en desarrollo (contra Twilio de verdad, con llaves en el entorno):
`AGENTE_DATOS=/tmp/ante TWILIO_WHATSAPP_FROM=whatsapp:+14155238886 node agente/src/main.ts`.

## Lo verificado (12 sep 2026), con su fuente

- **DeepSeek.** «DeepSeek V4 Flash» ya no existe como tal: «The legacy names `deepseek-v4-flash` and
  `deepseek-v4-flash-vision-exp` are still accepted, but the corresponding models have been retired,
  their requests are served by the DeepSeek-V4.1-Flash model and billed at the Flash price». El id
  vigente es **`deepseek-flash`** (DeepSeek-V4.1-Flash, 1M de contexto). Precio por millón de tokens,
  valle / pico: entrada con caché **US$0.003 / 0.006**, sin caché **US$0.15 / 0.30**, salida
  **US$0.60 / 1.20**; pico = «01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday»
  (https://api-docs.deepseek.com/quick_start/pricing/). API: `POST /chat/completions`, `thinking`
  `enabled|disabled` — «Thinking mode is enabled by default» (https://api-docs.deepseek.com/guides/thinking_mode/),
  así que el agente lo apaga. Datos: «we directly collect, process and store your Personal Data in
  People's Republic of China» (https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html).
- **Twilio, costo.** «Twilio's per-message fee for WhatsApp is $0.005, inbound or outbound» y
  «During a customer service window, Meta does not charge for utility template messages or free-form
  messages» (https://www.twilio.com/en-us/whatsapp/pricing). El Sandbox: «Sandbox messages are billed
  at standard Twilio API for WhatsApp pricing» y «Twilio free trial accounts include 100 WhatsApp
  messages as part of their trial free units» (https://www.twilio.com/docs/whatsapp/sandbox). No
  encontré una tarifa distinta para México.
- **Twilio, Sandbox.** Unirse: «send `join <your sandbox code>` to the Sandbox number»; caduca: «three
  days after joining»; «You can only message end users who have joined your Sandbox»; «For
  business-initiated messages from the Sandbox, you can use only pre-approved templates»; ventana:
  «When a user sends your business a message, it opens a 24-hour customer service window»
  (https://www.twilio.com/docs/whatsapp/sandbox).
- **No confirmado:** cuánto espera Twilio la respuesta de un webhook de mensajería (la documentación
  sólo da 15 s para llamadas de voz); por eso el agente contesta en el acto y procesa aparte.

## Costo esperado de la prueba

Cada vuelta son dos mensajes de Twilio (entra y sale): **US$0.01**. El modelo: el mensaje de
sistema ronda 7,200 caracteres (unos 2,000 tokens) y DeepSeek cobra la parte repetida como caché, así
que una vuelta cuesta del orden de **US$0.001** (lo real queda en `gasto.json`). Twilio domina el costo.

## Lo que tiene que decidir o hacer Pablo

Cada una se contesta con una palabra:

1. **Twilio:** ¿usamos tu cuenta con el Sandbox para la prueba, uniéndote con «join <código>» desde tu teléfono y repitiéndolo cada 3 días? — *sí / no*
2. **Llave:** ¿abres una llave de DeepSeek para el agente y la dejas en `/etc/ante/`? — *sí / no*
3. **Modelo:** «V4 Flash» se retiró y su nombre lo atiende DeepSeek-V4.1-Flash (`deepseek-flash`) al mismo precio; ¿vale ése? — *sí / no*
4. **Privacidad:** ¿pueden los mensajes de los clientes ir a proveedores fuera de México (DeepSeek procesa y guarda en China; Twilio es de EE. UU.)? El aviso de privacidad (`src/pages/aviso-privacidad.astro`, líneas 20, 25-30 y 46) sólo habla de teléfono y correo y de «proveedores de servicios técnicos (por ejemplo, proveedores de correo electrónico)»; no menciona WhatsApp, un asistente automático ni transferencias al extranjero. — *sí / no*
5. **Presentación:** ¿se presenta como «asistente automático de ANTE» en el primer mensaje? (hoy: sí) — *sí / no*
6. **Tope:** ¿US$0.50 al día de modelo? — *sí / otra cifra*
7. **Tu nombre:** el sitio nunca te nombra; ¿el agente dice «Pablo» a los clientes? — *sí / no*
8. **Horario:** el sitio dice «Lunes a sábado, 9:00 a 18:00» (`agendar.astro:73`, `fotografia-corporativa.astro:180`) y también «Contáctanos para verificar disponibilidad» (`contacto.astro:41`); ¿cuál vale? Mientras, el agente no da horario. — *el primero / el segundo*
9. **Avisos:** en el Sandbox, un aviso a tu WhatsApp fuera de tu ventana de 24 h puede no llegar; ¿te basta escribirle al Sandbox una vez al día mientras dure la prueba? — *sí / no*
10. **Encenderlo para siempre** (`systemctl enable`) después de la prueba. — *sí / no*
11. **Webhook:** ¿túnel público en `wa.ante.photo` para el modo webhook? (hoy: no; sondeo) — *sí / no*
12. **Número real:** ¿pasar el WhatsApp de ANTE a la plataforma de WhatsApp Business por Twilio para que lo atienda el agente (los avisos a Pablo necesitarían plantillas aprobadas, y hay que revisar antes qué pasa con ese número en la app del teléfono)? Hasta entonces sólo habla quien se une al Sandbox. — *sí / no*

## Límites conocidos

- El modo sondeo en el Sandbox está confirmado a nivel de API, no probado en vivo (ver arriba).
- El filtro de llamadas al sistema de la unidad (`SystemCallFilter=`) no se pudo probar: en la Mac no
  hay systemd. `PARA-ROOT.md` dice qué hacer si estorba.
- Sólo texto: a una foto sin texto le contesta que por ahora sólo lee texto.
- El proveedor simulado no conversa: sirve para ver el circuito. La calidad de las respuestas se ve
  con el modelo real.
- Para producción (número propio de WhatsApp Business, fuera del Sandbox) hacen falta plantillas
  aprobadas para cualquier mensaje que inicie el negocio, como los avisos a Pablo.
