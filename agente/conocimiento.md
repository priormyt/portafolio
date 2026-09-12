<!--
  Conocimiento del asistente de WhatsApp de ANTE.

  Es lo ÚNICO que el agente sabe. Se escribió leyendo el propio sitio (rama main,
  db251b2, 12 sep 2026). Cada dato lleva su ruta en un comentario como éste; los
  comentarios se quitan antes de mandar el texto al modelo.

  Reglas para editarlo:
  - Si cambias un precio en src/lib/precios.ts, cámbialo aquí también: la prueba
    agente/pruebas/conocimiento.test.ts se pone en rojo hasta que coincidan.
  - Toda cantidad en pesos y todo porcentaje que el agente diga tiene que aparecer
    en este archivo; si no, su respuesta se descarta (agente/src/salida.ts).
  - Aquí no van teléfonos ni correos: el repositorio es público y el cliente ya
    está escribiendo al WhatsApp del estudio.
-->

# ANTE · lo que el asistente sabe

## Qué es ANTE

ANTE es un estudio de fotografía de retrato en Coyoacán, Ciudad de México. «La imagen honesta.» Retratos que reflejan el carácter de cada persona: luz cuidada, dirección suave, un resultado que perdura.
<!-- fuente: src/pages/index.astro:38-40 -->

Qué se hace: retrato profesional para perfiles y equipos (fotografía corporativa para LinkedIn, perfiles de empresa y presentaciones), retrato personal y editorial, y books de fotos para portafolio, castings, redes o perfiles profesionales. Para ejecutivos, artistas, emprendedores y cualquier persona que quiera una foto que la represente.
<!-- fuente: src/pages/nosotros.astro:48 · src/pages/index.astro:393, 432 · src/pages/fotografia-corporativa.astro:85-86 -->

Filosofía: en oposición a la prisa y al exceso. En un mundo de imágenes saturadas, el estudio elige la pausa, la luz precisa y el encuadre esencial. Valores: calidad, honestidad, empatía, respeto a la individualidad, humanidad.
<!-- fuente: src/pages/nosotros.astro:19-34, 54 -->

Dirección del estudio: Av. del Convento 34, San Diego Churubusco, Coyoacán, 04120, Ciudad de México. Las sesiones que describe el sitio son en el estudio, con luz montada.
<!-- fuente: src/pages/contacto.astro:37 · src/pages/fotografia-corporativa.astro:86, 153 -->

## Paquetes

Precios en pesos mexicanos. Estudiantes: 50% de descuento con credencial vigente, en cualquier paquete. Anticipo: 50% del precio para apartar la fecha; el resto se paga el día de la sesión.

| Paquete | Precio | Estudiantes | Anticipo | Fotos editadas | Sesión | Looks |
|---|---|---|---|---|---|---|
| Básico | $1,800 MXN | $900 MXN | $900 MXN | 2 | 30 min | 1 |
| Estándar | $2,400 MXN | $1,200 MXN | $1,200 MXN | 5 | 60 min | 2 |
| Completo | $3,000 MXN | $1,500 MXN | $1,500 MXN | 10 | 90 min | 3 |
<!-- fuente: src/lib/precios.ts:24-49 (PAQUETES), :52 (DESCUENTO_ESTUDIANTE = 0.5), :54 (ANTICIPO = 0.5) · src/pages/index.astro:220-246 -->
<!-- La columna «Anticipo» es el 50% del precio normal: es la cuenta de la regla del sitio, no una cifra publicada. El anticipo con precio de estudiante NO está publicado: por eso no aparece. -->

Para quién es cada uno (copy del sitio):
- Básico: una foto de perfil que aguante años.
- Estándar: perfil, presentaciones y algo de dónde escoger.
- Completo: material completo para portafolio, prensa y redes.
<!-- fuente: src/lib/precios.ts:31, 39, 47 -->

Todos los paquetes incluyen dirección de pose durante toda la sesión (no hace falta saber posar), iluminación de estudio controlada y edición profesional de color, luz y retoque de las fotos seleccionadas.
<!-- fuente: src/pages/index.astro:214-215 · src/pages/fotografia-corporativa.astro:128-130, 21 · src/pages/contacto.astro:70 -->

Los precios completos están en https://www.ante.photo/#precios

## Equipos y empresas

Los paquetes individuales son por persona. Para equipos completos el precio depende del número de personas: se cotiza aparte (eso lo hace Pablo). Se fotografía a todo el equipo con la misma luz y el mismo encuadre para que la imagen de la empresa sea una sola. Más información: https://www.ante.photo/fotografia-corporativa
<!-- fuente: src/pages/fotografia-corporativa.astro:13, 25, 109-111, 132 · src/pages/index.astro:247 -->

## Entrega

- Entrega digital en 3 a 5 días hábiles, en alta resolución, ya editada y lista para usarse en impreso o en pantalla.
- Impresiones o fotolibros: 7 a 10 días adicionales. Su precio no está publicado.
- No se entregan archivos RAW.
<!-- fuente: src/pages/contacto.astro:49, 66, 82 · src/pages/index.astro:246 · src/pages/fotografia-corporativa.astro:17, 118 -->

## Pagos y cambios

- 50% para reservar y 50% el día de la sesión. Se acepta transferencia, tarjeta y efectivo. Los datos para pagar los da Pablo en persona.
- Reprogramar: sin costo con 48 horas de anticipación. Con menos tiempo puede haber una tarifa de reprogramación (el monto no está publicado).
<!-- fuente: src/pages/contacto.astro:45, 74, 78. «Los datos para pagar los da Pablo» es regla del asistente (no pedir ni dar datos bancarios por aquí), no texto del sitio. -->

## Agendar

- Cómo se aparta: se junta nombre, paquete y fecha preferida; Pablo confirma la disponibilidad, el horario y el anticipo por WhatsApp.
- El formulario del sitio pide la fecha preferida con al menos 48 horas de anticipación.
- También se puede dejar la solicitud en https://www.ante.photo/agendar
- El estudio contesta en menos de 24 horas.
<!-- fuente: src/pages/fotografia-corporativa.astro:142-148 · src/pages/agendar.astro:52-53, 119 · src/pages/contacto.astro:22, 62 -->

## Horario y disponibilidad

El asistente NO ve la agenda. La disponibilidad y los horarios los confirma Pablo.
<!-- fuente: el sitio da dos versiones y no se deben mezclar: src/pages/agendar.astro:73 y src/pages/fotografia-corporativa.astro:180 dicen «Lunes a sábado, 9:00 a 18:00»; src/pages/contacto.astro:41 dice «Contáctanos para verificar disponibilidad». Hasta que Pablo diga cuál vale, el asistente no da horario. -->

## Otras páginas útiles

- Galería de trabajo reciente: https://www.ante.photo/galeria
- Sobre el estudio: https://www.ante.photo/nosotros
- Clientes con sesión: su galería privada se abre con el código de sesión en https://www.ante.photo/clientes (si el código no funciona, lo resuelve Pablo).
- Renta de foro en la Ciudad de México (Foro Colibrí): https://www.ante.photo/mas
- Aviso de privacidad: https://www.ante.photo/aviso-privacidad
<!-- fuente: src/pages/galeria.astro:15-16 · src/pages/nosotros.astro:10-11 · src/pages/clientes.astro:10-17 · src/pages/mas.astro:14-18 · src/pages/aviso-privacidad.astro:10 -->

## Lo que el asistente NO sabe (se lo pasa a Pablo)

Disponibilidad y horarios; cotización de equipos; precio de impresiones o fotolibros; monto de la tarifa de reprogramación; anticipo con precio de estudiante; fotos extra fuera del paquete; sesiones fuera del estudio, a domicilio o en exteriores; bodas, eventos o cualquier servicio que no esté arriba; maquillaje, peinado o vestuario; facturas; problemas con pagos, entregas o con el código de la galería; quejas.
