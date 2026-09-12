# Transcripción simulada · agente de WhatsApp de ANTE

Generada con `node agente/simular.ts`. Proveedor: **simulado** (determinista, sin red: no es el modelo real).
Twilio es un Twilio falso en 127.0.0.1; los números son de mentira. Nada salió a internet.

## 1 · Modo webhook: conversación de cinco vueltas

Cada mensaje llega como lo manda Twilio (POST `application/x-www-form-urlencoded` a `https://wa.ejemplo.test/twilio/whatsapp`, que el túnel entrega en `127.0.0.1:PUERTO/twilio/whatsapp`) y firmado con `X-Twilio-Signature`. El agente contesta 200 con TwiML vacío en el acto y la respuesta sale por la API REST.

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

**Aviso a Pablo (a ADMIN_WHATSAPP_TO):**

> 📅 Solicitud de sesión (asistente de ANTE)
> Cliente: whatsapp:+5215500000001
> Nombre: Laura Prueba
> Sesión: Estándar
> Fecha preferida: sábado 19 de septiembre en la mañana
>
> El asistente le dijo que tú confirmas disponibilidad y anticipo.

### Vuelta 5

**Cliente:**

> Perfecto, muchas gracias. Hasta luego

**ANTE (asistente automático):**

> Gracias a ti. Pablo te escribe por aquí para confirmar. Que estés muy bien.

## 2 · Firma mala y reintento de Twilio

- POST con `X-Twilio-Signature` inventada → **HTTP 403**, no se procesa.
- POST firmado sobre `http://127.0.0.1:…` (la URL local, no la pública) → **HTTP 403**.
- Twilio reintenta el webhook del último mensaje (mismo `MessageSid`) → **HTTP 200**, y no sale una segunda respuesta.

Lo que quedó en el registro (sin fecha): el número va enmascarado y el texto del mensaje no aparece.

```
{"nivel":"aviso","evento":"webhook.firma_invalida","de":"whatsapp:+521…0001","conFirma":true}
{"nivel":"aviso","evento":"webhook.firma_invalida","de":"whatsapp:+521…0001","conFirma":true}
```

## 3 · Modo sondeo: otro número

El agente no escucha nada: cada pocos segundos lista los mensajes entrantes en la API de Twilio (`GET …/Messages.json`) y contesta por la misma API.

**Cliente 2:**

> ¿Hacen fotos de boda a domicilio?

**ANTE (asistente automático):**

> Hola, soy el asistente automático de ANTE. Te ayudo con paquetes, precios y para apartar tu sesión; lo que yo no sepa, se lo paso a Pablo.
>
> Eso no lo tengo a la mano. Se lo paso a Pablo y él te escribe por aquí.

**Aviso a Pablo (a ADMIN_WHATSAPP_TO):**

> 🙋 El asistente de ANTE te pasa una conversación
> Cliente: whatsapp:+5215500000002
> Motivo: ¿Hacen fotos de boda a domicilio?
> Último mensaje: «¿Hacen fotos de boda a domicilio?»

**Cliente 2:**

> BAJA

**ANTE (asistente automático):**

> Listo: el asistente de ANTE ya no te escribirá a este número. Si cambias de opinión, escribe ALTA.

**Cliente 2:**

> ¿Sigues ahí?

_(sin respuesta: el número se dio de baja)_

## 4 · Gasto

6 llamadas al modelo · 11620 tokens de entrada · 321 de salida.
Con la tarifa pico de `deepseek-flash` (US$0.3 por millón de entrada sin caché, US$1.2 de salida) serían **US$0.0039** — el proveedor simulado no cobra: sus tokens son una estimación (uno cada 4 caracteres) para ejercitar el tope. Tope diario configurado: US$0.5.

## 5 · Comprobaciones

- ✔ vuelta 1: webhook firmado → HTTP 200
- ✔ vuelta 1: el agente contestó por la API REST
- ✔ vuelta 2: webhook firmado → HTTP 200
- ✔ vuelta 2: el agente contestó por la API REST
- ✔ vuelta 3: webhook firmado → HTTP 200
- ✔ vuelta 3: el agente contestó por la API REST
- ✔ vuelta 4: webhook firmado → HTTP 200
- ✔ vuelta 4: el agente contestó por la API REST
- ✔ vuelta 5: webhook firmado → HTTP 200
- ✔ vuelta 5: el agente contestó por la API REST
- ✔ se presentó como asistente automático en el primer mensaje
- ✔ no se volvió a presentar en la misma conversación
- ✔ la solicitud de agendar llegó a Pablo
- ✔ ningún marcador llegó al cliente
- ✔ petición con firma mala → HTTP 403
- ✔ petición firmada sobre la URL local en vez de la pública → HTTP 403
- ✔ ninguna de las dos se procesó (cero envíos)
- ✔ Twilio reintenta el último MessageSid → HTTP 200 y no se contesta dos veces
- ✔ tras BAJA ya no contesta (silencio)
- ✔ lo que no sabe se lo pasó a Pablo
