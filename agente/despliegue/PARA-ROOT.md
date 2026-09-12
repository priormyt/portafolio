# PARA ROOT · poner a prueba el agente de WhatsApp de ANTE en `kokoroco-central`

Escrito el 12 sep 2026, **sin ejecutar nada en el servidor**. Cada paso trae su comprobación y su
vuelta atrás. Se corre como root (`ssh root@100.93.106.86`), en orden. Nada de esto abre un puerto
ni publica nada: en modo **sondeo** el servicio sólo sale a `api.twilio.com` y `api.deepseek.com`.

Lo que **no** hace esta guía: `systemctl enable` (dejarlo encendido para siempre es palabra de
Pablo: su comando va aparte, en el paso 8) ni el túnel del modo webhook (§ «Para pasar a webhook»).

## 0 · Antes de empezar: lo que tiene que haber hecho Pablo

1. Cuenta de Twilio con el Sandbox de WhatsApp activo, y su teléfono unido al Sandbox mandando
   `join <código>` al +1 415 523 8886. **La unión caduca a los 3 días** («The Sandbox session
   expires three days after joining», https://www.twilio.com/docs/whatsapp/sandbox): antes de cada
   tanda de pruebas, volver a unirse.
2. En la consola de Twilio, Sandbox → *When a message comes in*: que no conteste nada por su cuenta
   (vacío o sin respuesta automática). Si ahí hay una respuesta de demostración, el cliente verá dos
   respuestas: la de Twilio y la del agente.
3. Cuatro ficheros de una sola línea, sin comillas, en `/etc/ante/` (como `/etc/ante` es
   `root:root 0700`, Pablo los sube por `scp` a su casa y root los mueve con
   `install -m 0600 -o root -g root ~pablo-admin/<NOMBRE> /etc/ante/<NOMBRE>`):

   | Fichero | Qué es | Forma |
   |---|---|---|
   | `/etc/ante/TWILIO_ACCOUNT_SID` | SID de la cuenta | `AC` + 32 hex |
   | `/etc/ante/TWILIO_AUTH_TOKEN` | Auth Token de la cuenta | 32 caracteres |
   | `/etc/ante/DEEPSEEK_API_KEY` | llave de la API de DeepSeek | `sk-…` |
   | `/etc/ante/ADMIN_WHATSAPP_TO` | el WhatsApp de Pablo, a donde llegan los avisos | `whatsapp:+52…` |

   Si en vez de eso dejó un solo fichero en la forma de `.env.example` (`NOMBRE=valor` por renglón),
   el paso 2 trae la variante.

## 1 · El código en el clon del servidor

El servicio corre `/koko/srv/ante/app/agente/src/main.ts`. Ese clon es el taller de `dev-ante`
(hay una sesión de Claude Code trabajando ahí): **no cambies su rama sin avisarle**.

- **Lo normal:** esperar a que Pablo fusione el PR a `main` y traerlo:
  ```sh
  sudo -u dev-ante git -C /koko/srv/ante/app status --short   # debe salir vacío
  sudo -u dev-ante git -C /koko/srv/ante/app pull --ff-only origin main
  ```
- **Para probar antes de fusionar** (sólo con el taller en paz):
  ```sh
  sudo -u dev-ante git -C /koko/srv/ante/app fetch origin mac/2026-09-12-agente-whatsapp
  sudo -u dev-ante git -C /koko/srv/ante/app switch --detach FETCH_HEAD
  ```

**Comprobación:**
```sh
sudo -u svc-ante test -r /koko/srv/ante/app/agente/src/main.ts && echo LEGIBLE
/usr/bin/node --version        # v24.x
sudo -u svc-ante /usr/bin/node --test '/koko/srv/ante/app/agente/pruebas/*.test.ts' 2>&1 | tail -8
```
Las pruebas tienen que salir con `fail 0`: no tocan la red (usan un Twilio y un DeepSeek falsos en
127.0.0.1) y escriben sólo en `/tmp`.

**Vuelta atrás:** `sudo -u dev-ante git -C /koko/srv/ante/app switch main`.

## 2 · Sembrar las credenciales (cifradas con la llave de esta máquina)

```sh
install -d -m 0700 -o root -g root /etc/ante/credenciales
for N in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN DEEPSEEK_API_KEY ADMIN_WHATSAPP_TO; do
  test -s "/etc/ante/$N" || { echo "FALTA /etc/ante/$N"; continue; }
  tr -d '\r\n' < "/etc/ante/$N" | systemd-creds encrypt --name="$N" - "/etc/ante/credenciales/$N.cred"
done
```
Variante, si Pablo dejó un solo fichero `NOMBRE=valor` (p. ej. `/etc/ante/ante.env`): en el bucle,
cambia la línea de `tr` por
`grep -E "^$N=" /etc/ante/ante.env | head -1 | cut -d= -f2- | tr -d '\r\n"' | systemd-creds encrypt --name="$N" - "/etc/ante/credenciales/$N.cred"`.

**Comprobación** (imprime longitudes y formas, **nunca** los valores):
```sh
for N in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN DEEPSEEK_API_KEY ADMIN_WHATSAPP_TO; do
  printf '%-20s %s caracteres\n' "$N" "$(systemd-creds decrypt --name="$N" "/etc/ante/credenciales/$N.cred" - | wc -c)"
done
systemd-creds decrypt --name=TWILIO_ACCOUNT_SID /etc/ante/credenciales/TWILIO_ACCOUNT_SID.cred - | grep -Eq '^AC[0-9a-f]{32}$' && echo SID-FORMA-OK
systemd-creds decrypt --name=ADMIN_WHATSAPP_TO /etc/ante/credenciales/ADMIN_WHATSAPP_TO.cred - | grep -Eq '^whatsapp:\+[0-9]{8,15}$' && echo ADMIN-FORMA-OK
ls -l /etc/ante/credenciales    # cuatro .cred de root; el directorio es 0700
```
**Sólo si todo salió bien**, se destruyen los originales en claro:
```sh
for N in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN DEEPSEEK_API_KEY ADMIN_WHATSAPP_TO; do shred -u "/etc/ante/$N"; done
# y, si existió, también ~pablo-admin/<NOMBRE> y /etc/ante/ante.env
```
**Vuelta atrás:** `rm /etc/ante/credenciales/<NOMBRE>.cred` y Pablo vuelve a mandar el fichero.
Los `.cred` no se pueden traer de un respaldo a otra máquina (van cifrados con la llave de ésta):
en una resurrección se re-siembran igual.

## 3 · El directorio de datos del agente

```sh
ls -ld /koko/srv/ante/datos          # svc-ante ante drwxr-x--- (lo creó el guion el 7 sep)
install -d -m 0700 -o svc-ante -g ante /koko/srv/ante/datos/agente
```
**Comprobación:** `sudo -u svc-ante test -w /koko/srv/ante/datos/agente && echo ESCRIBIBLE`.
Ahí vivirán `conversaciones/*.jsonl`, `vistos.jsonl`, `bajas.json`, `gasto.json` y `sondeo.json`.
Está bajo el dataset `koko/srv/ante`, así que entra solo al respaldo nocturno.

**Vuelta atrás:** `rm -r /koko/srv/ante/datos/agente` (con el servicio parado).

## 4 · La unidad

```sh
cp -a /etc/systemd/system/svc-ante.service /root/svc-ante.service.plantilla-2026-09-12
install -m 0644 -o root -g root /koko/srv/ante/app/agente/despliegue/svc-ante.service /etc/systemd/system/svc-ante.service
systemd-analyze verify /etc/systemd/system/svc-ante.service
systemctl daemon-reload
```
**Comprobación** (lo que systemd CARGÓ, no lo que dice el archivo):
```sh
systemctl show svc-ante -p User -p Group -p ExecStart -p NoNewPrivileges -p ProtectSystem -p ProtectHome -p RestrictAddressFamilies -p MemoryMax -p LoadCredentialEncrypted
systemd-analyze security svc-ante.service | tail -1     # la nota global; que no diga UNSAFE
```
**Vuelta atrás:**
```sh
install -m 0644 /root/svc-ante.service.plantilla-2026-09-12 /etc/systemd/system/svc-ante.service
systemctl daemon-reload
```

## 5 · Arrancar para la prueba (sin `enable`)

```sh
systemctl start svc-ante
systemctl is-active svc-ante                       # active
journalctl -u svc-ante -n 30 --no-pager -o cat
```
En el registro (una línea JSON por evento) tiene que aparecer `"evento":"arranque"` con
`"modo":"sondeo"`, `"proveedorActivo":"deepseek:deepseek-flash"` y `"avisosAlAdmin":"sí"`. Ninguna
línea lleva secretos ni números completos (van como `whatsapp:+521…1234`) ni el texto de los
mensajes.

Si sale `"evento":"config"` y el servicio se detiene con código 78: falta algo (el mensaje dice
qué, nunca el valor). Por `RestartPreventExitStatus=78` no se queda reintentando.

Si muere con `status=31/SYS` o un `EPERM` raro al arrancar, es el filtro de llamadas al sistema:
comenta las dos líneas `SystemCallFilter=` de la unidad, `daemon-reload`, `restart`, y avisa (el
filtro se probó sólo en papel: en la Mac no hay systemd).

## 6 · La prueba en vivo

Pablo, desde su teléfono unido al Sandbox, escribe «Hola» al +1 415 523 8886. En 5 a 10 segundos le
contesta el asistente, presentándose. Mientras:
```sh
journalctl -u svc-ante -f -o cat     # sondeo.entregados → agente.modelo.ok → agente.respuesta "enviado":true
cat /koko/srv/ante/datos/agente/gasto.json     # tokens y dólares del día
```
Luego: «¿Qué paquetes tienen?», «Quiero agendar, soy … el Estándar el sábado» (le llega a Pablo el
aviso «Solicitud de sesión»), una pregunta que no esté en el conocimiento (aviso «te pasa una
conversación»), y «BAJA» (confirma y deja de contestar; «ALTA» lo reactiva).

**Si pasan 30 segundos y en el registro no aparece `sondeo.entregados`:** la hipótesis del modo
sondeo falló en el Sandbox. La documentación de Twilio confirma que los mensajes entrantes son
recursos `Message` con `direction: inbound` que se pueden consultar por la API, pero no dice en
ningún lado, para el Sandbox en particular, que queden listados sin webhook. Se para (paso 7), se
anota en el PR, y la alternativa es el modo webhook, que necesita un túnel público: lo decide Pablo.

## 7 · Pararlo

```sh
systemctl stop svc-ante
systemctl is-active svc-ante        # inactive
```
Parado no hace nada: no escucha, no consulta, no gasta. Los datos quedan en
`/koko/srv/ante/datos/agente` (30 días como mucho; el propio agente borra lo más viejo).

## 8 · Dejarlo encendido — SÓLO con la palabra de Pablo

```sh
systemctl enable --now svc-ante
```
Vuelta atrás: `systemctl disable --now svc-ante`.

## 9 · Vuelta atrás completa

```sh
systemctl disable --now svc-ante 2>/dev/null; systemctl stop svc-ante
install -m 0644 /root/svc-ante.service.plantilla-2026-09-12 /etc/systemd/system/svc-ante.service
systemctl daemon-reload
rm -f /etc/ante/credenciales/{TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN,DEEPSEEK_API_KEY,ADMIN_WHATSAPP_TO}.cred
rm -r /koko/srv/ante/datos/agente
```
Y revocar en Twilio y en DeepSeek las llaves sembradas, si ya no se van a usar.

---

## Para pasar a webhook (NO ejecutar: es exposición pública y la decide Pablo)

Medido el 12 sep 2026 por la sesión que lanzó este trabajo: en el servidor **no hay `cloudflared`**
ni túnel alguno. El modo webhook es más inmediato (Twilio avisa en el acto, sin consultar cada 5 s),
pero exige una URL pública que llegue a `127.0.0.1:9186`. Lo que haría falta:

1. **Instalar `cloudflared`** (paquete de Cloudflare para Debian) como `pablo-admin` con sudo, y
   **crear un túnel con nombre** en la cuenta de Cloudflare de Pablo:
   `cloudflared tunnel login` · `cloudflared tunnel create ante-wa`.
2. **Un hostname en la zona `ante.photo`**, p. ej. `wa.ante.photo`, apuntado al túnel
   (`cloudflared tunnel route dns ante-wa wa.ante.photo`), con esta regla de ingreso en su
   `config.yml` — una sola ruta, lo demás 404:
   ```yaml
   tunnel: ante-wa
   credentials-file: /etc/cloudflared/ante-wa.json
   ingress:
     - hostname: wa.ante.photo
       path: ^/twilio/whatsapp$
       service: http://127.0.0.1:9186
     - service: http_status:404
   ```
   (9186 está libre: los ocupados en 127.0.0.1 son 139, 445, 5432, 5678, 8080, 9180, 9181, 9184 y 34273.)
   Ojo: `ante.photo` es la zona del sitio de producción; un registro DNS nuevo no toca el sitio,
   pero se hace con cuidado.
3. **En la unidad:** `Environment=AGENTE_MODO=webhook` y
   `Environment=AGENTE_URL_PUBLICA=https://wa.ante.photo/twilio/whatsapp` — **idéntica** a la que se
   ponga en Twilio: la firma se calcula sobre esa URL, no sobre la de 127.0.0.1. `daemon-reload` y
   `restart`. `RestrictAddressFamilies` no cambia (el servidor escucha en AF_INET de loopback).
4. **En la consola de Twilio** (Sandbox → *When a message comes in*): esa misma URL, método POST.
5. **Comprobación:** `curl -s https://wa.ante.photo/twilio/whatsapp -X POST -d x=1` → `403 firma
   inválida` (bien: nadie sin el Auth Token entra). Un WhatsApp real → 200 y respuesta.
6. **Vuelta atrás:** borrar la URL en Twilio, `AGENTE_MODO=sondeo`, `cloudflared tunnel delete
   ante-wa` y el registro DNS.

El agente acepta sólo la ruta de `AGENTE_URL_PUBLICA`, rechaza con 403 lo que no venga firmado por
Twilio y contesta 200 con TwiML vacío en el acto; la respuesta sale por la API REST.
