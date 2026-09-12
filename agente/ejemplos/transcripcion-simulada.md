# Transcripción simulada · agente de WhatsApp de ANTE (Meta Cloud API)

Generada con `node agente/simular.ts`. Proveedor del modelo: **simulado** (determinista, sin red: no es el modelo real).
La Graph API es una falsa en 127.0.0.1 que **exige la ventana de 24 h** como Meta (texto libre fuera de ella → error 131047). Los números y los secretos son de mentira. Nada salió a internet.

Todo entra por UNA ruta: `/webhook/meta` en `127.0.0.1`, que es lo que el túnel de Cloudflare manda desde `https://wa.ante.photo/webhook/meta`.

## 1 · Verificación de la suscripción (GET)

- `hub.mode=subscribe`, `hub.verify_token` correcto, `hub.challenge=1158201444` → **HTTP 200**, cuerpo `1158201444` (texto plano).
- Mismo GET con otro token → **HTTP 403**.

## 2 · Conversación de cinco vueltas (POST firmados)

Cada mensaje llega con la forma de la Cloud API (`entry[].changes[].value.messages[]`) y con `X-Hub-Signature-256: sha256=<hex>` calculada sobre los bytes exactos del cuerpo. El agente contesta 200 en el acto y la respuesta sale por `POST /v26.0/<PHONE_NUMBER_ID>/messages`.

**Pablo no le ha escrito al número de ANTE en las últimas 24 h y no hay plantilla configurada**: el aviso de la vuelta 4 no puede salir y queda pendiente.

### Vuelta 1

**Cliente:**

> Hola, buenas noches

**ANTE (asistente automático):**

> Hola, soy el asistente automático de ANTE. Te ayudo con paquetes, precios y para apartar tu sesión; lo que yo no sepa, se lo paso a Pablo.
>
> ¿En qué te ayudo? Te puedo contar de los paquetes y precios, o pasar tu solicitud para apartar una sesión.

### Vuelta 2

**Cliente:**

> ¿Qué sesiones tienen y cuánto cuestan?

**ANTE (asistente automático):**

> Hay tres paquetes, todos en el estudio de Coyoacán y con dirección de pose, iluminación de estudio y edición profesional:
> - *Básico*: $1,800 MXN · 2 fotos editadas · 30 min · 1 look
> - *Estándar*: $2,400 MXN · 5 fotos editadas · 60 min · 2 looks
> - *Completo*: $3,000 MXN · 10 fotos editadas · 90 min · 3 looks
>
> Con credencial de estudiante vigente es 50% menos en cualquiera. Se aparta con 50% de anticipo y el resto se paga el día de la sesión.
> Los ves completos en https://www.ante.photo/#precios

### Vuelta 3

**Cliente:**

> ¿Tienen lugar el sábado 19 de septiembre en la mañana?

**ANTE (asistente automático):**

> La agenda no la veo desde aquí: la disponibilidad sólo la confirma Pablo. Si quieres apartar el sábado 19 de septiembre en la mañana, dime tu nombre y qué paquete te interesa y le paso la solicitud.

### Vuelta 4

**Cliente:**

> Quiero agendar. Soy Laura Prueba y me interesa el Estándar

**ANTE (asistente automático):**

> Listo, Laura Prueba. Ya le pasé a Pablo tu solicitud: paquete *Estándar*, sábado 19 de septiembre en la mañana.
> Él te confirma la disponibilidad y el anticipo por este mismo WhatsApp.

_Aviso a Pablo: **no se mandó**. Su ventana de 24 h está cerrada y no hay `AGENTE_PLANTILLA_AVISO`, así que quedó en `avisos-pendientes.jsonl` (1 pendiente) y el registro lo marca con nivel `error`:_

```
{"nivel":"error","evento":"aviso_admin.NO_ENTREGADO","motivo":"ventana de 24 h cerrada y sin AGENTE_PLANTILLA_AVISO","pendientes":1,"queHacer":"que Pablo escriba cualquier cosa al número de ANTE: se manda al instante"}
```

### Vuelta 5

**Cliente:**

> Perfecto, muchas gracias. Hasta luego

**ANTE (asistente automático):**

> Gracias a ti. Pablo te escribe por aquí para confirmar. Que estés muy bien.

## 3 · Firma, re-serialización, reintentos y statuses

- Firma inventada → **HTTP 403**; sin cabecera → **HTTP 403**. No se procesa nada.
- El mismo mensaje con **otros espacios** (JSON re-serializado) y la firma del original → **HTTP 403**: la firma se comprueba sobre los bytes que llegan, no sobre el JSON reconstruido.
- POST bien firmado a `/otra/ruta` → **HTTP 404**: hay una sola ruta.
- Meta reintenta el mensaje de la vuelta 5 (mismo `id`, el wamid) → **HTTP 200** y no sale una segunda respuesta.
- Un payload de `statuses` (el cliente leyó) → **HTTP 200** y se ignora.

Lo que quedó en el registro (sin fecha): ni el texto, ni números completos, ni secretos.

```
{"nivel":"aviso","evento":"webhook.firma_invalida","conFirma":true,"bytes":492}
{"nivel":"aviso","evento":"webhook.firma_invalida","conFirma":false,"bytes":492}
{"nivel":"aviso","evento":"webhook.firma_invalida","conFirma":true,"bytes":953}
{"nivel":"info","evento":"webhook.ignorados","estados":1,"ajenos":0}
```

## 4 · Pablo le escribe al número de ANTE

Eso abre su ventana de 24 h: el aviso pendiente sale en ese momento, y después su propio mensaje recibe respuesta como el de cualquiera.

**Pablo:**

> Hola, soy Pablo, probando

**Aviso a Pablo (el que estaba pendiente):**

> (aviso pendiente del 2026-09-12 15:31 UTC)
> 📅 Solicitud de sesión (asistente de ANTE)
> Cliente: +5215500000001
> Nombre: Laura Prueba
> Sesión: Estándar
> Fecha preferida: sábado 19 de septiembre en la mañana
>
> El asistente le dijo que tú confirmas disponibilidad y anticipo.

**ANTE (asistente automático):**

> Hola, soy el asistente automático de ANTE. Te ayudo con paquetes, precios y para apartar tu sesión; lo que yo no sepa, se lo paso a Pablo.
>
> ¿En qué te ayudo? Te puedo contar de los paquetes y precios, o pasar tu solicitud para apartar una sesión.

## 5 · Otro cliente: una pregunta que el agente no sabe, y BAJA

Ahora la ventana de Pablo está abierta: el aviso le llega como texto.

**Cliente 2:**

> ¿Hacen fotos de boda a domicilio?

**ANTE (asistente automático):**

> Hola, soy el asistente automático de ANTE. Te ayudo con paquetes, precios y para apartar tu sesión; lo que yo no sepa, se lo paso a Pablo.
>
> Eso no lo tengo a la mano. Se lo paso a Pablo y él te escribe por aquí.

**Aviso a Pablo:**

> 🙋 El asistente de ANTE te pasa una conversación
> Cliente: +5215500000002
> Motivo: ¿Hacen fotos de boda a domicilio?
> Último mensaje: «¿Hacen fotos de boda a domicilio?»

**Cliente 2:**

> BAJA

**ANTE (asistente automático):**

> Listo: el asistente de ANTE ya no te escribirá a este número. Si cambias de opinión, escribe ALTA.

**Cliente 2:**

> ¿Sigues ahí?

_(sin respuesta: el número se dio de baja)_

## 6 · Gasto del modelo

7 llamadas · 13425 tokens de entrada · 348 de salida. A tarifa pico de `deepseek-flash` serían **US$0.0044** — el proveedor simulado no cobra: sus tokens son una estimación (uno cada 4 caracteres) para ejercitar el tope. Tope diario: US$0.5.

## 7 · Comprobaciones

- ✔ verificación GET con el token bueno → HTTP 200, devuelve el challenge
- ✔ verificación GET con otro token → HTTP 403
- ✔ vuelta 1: POST firmado → HTTP 200
- ✔ vuelta 1: el agente contestó por la Graph API
- ✔ vuelta 2: POST firmado → HTTP 200
- ✔ vuelta 2: el agente contestó por la Graph API
- ✔ vuelta 3: POST firmado → HTTP 200
- ✔ vuelta 3: el agente contestó por la Graph API
- ✔ vuelta 4: POST firmado → HTTP 200
- ✔ vuelta 4: el agente contestó por la Graph API
- ✔ vuelta 5: POST firmado → HTTP 200
- ✔ vuelta 5: el agente contestó por la Graph API
- ✔ se presentó como asistente automático en el primer mensaje
- ✔ no se volvió a presentar en la misma conversación
- ✔ ningún marcador llegó al cliente
- ✔ con la ventana de Pablo cerrada no se intentó texto libre (cero rechazos 131047)
- ✔ el aviso de la solicitud quedó en pendientes
- ✔ POST con firma inventada → HTTP 403
- ✔ POST sin X-Hub-Signature-256 → HTTP 403
- ✔ POST con los bytes re-serializados (otros espacios) y la firma del original → HTTP 403
- ✔ POST bien firmado a otra ruta → HTTP 404
- ✔ ninguno de los cuatro se procesó (cero envíos)
- ✔ Meta reintenta el último mensaje (mismo wamid) → HTTP 200 y no se contesta dos veces
- ✔ payload de statuses («read») → HTTP 200 y se ignora
- ✔ al escribir Pablo, salió el aviso pendiente con la solicitud
- ✔ no quedan avisos pendientes
- ✔ tras BAJA ya no contesta (silencio)
- ✔ lo que no sabe se lo pasó a Pablo, como texto (ventana abierta)
