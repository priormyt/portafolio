# PARA ROOT · el agente de WhatsApp de ANTE y el primer túnel de `kokoroco-central`

Escrito el 12 sep 2026 desde la Mac, **sin ssh**. Cada paso trae su comprobación y su vuelta atrás.
Se corre como root (`ssh root@100.93.106.86`), en orden.

**Qué se monta.** El pipeline que después usará KokoroCo:

```
Meta (Cloud API) ──HTTPS──► borde de Cloudflare ──túnel cloudflared-ante──► 127.0.0.1:9186  svc-ante
   POST firmado             wa.ante.photo            UNA ruta: /webhook/meta     verifica la firma sobre los
   (X-Hub-Signature-256)    + regla WAF (AS32934)                                bytes crudos, 200 en el acto,
                                                                                 contesta por la Graph API
```

Nada se ata a `0.0.0.0` y no se abre ningún puerto del módem: el túnel sale de la máquina hacia
Cloudflare. **Es exposición pública (una ruta) y la decidió Pablo** (12 sep: «sí vamos directo con
meta»).

**Dónde estamos (12 sep 2026, 10:37 CST).** El túnel **ya existe, corre y está habilitado** (paso 6,
hecho): desde fuera, `https://wa.ante.photo/webhook/meta` da **502** porque el agente todavía no
corre, y `/` y `/webhook/meta/x` dan **404**. Falta el agente: pasos 0–5 y 7–10. Lo que sigue sin
palabra de Pablo: `systemctl enable svc-ante` (paso 10).

`cloudflared` es el **primer túnel del servidor** y KokoroCo usará el mismo binario (con su propio
túnel y su propia unidad): por eso se instaló desde el repositorio apt de Cloudflare, como capa de
máquina (`capa-base-cloudflared.propuesta.yml`), y no a mano.

## 0 · Lo que trae Pablo: un `ante.env`

Paso por paso, con los nombres de las pantallas, en `agente/LEEME.md` § «Lo que hace Pablo». Pablo
junta **cinco líneas** en un solo archivo `ante.env`, `NOMBRE=valor`, sin comillas ni espacios
alrededor del `=`, y lo sube por `scp` a su casa (`~pablo-admin/ante.env`):

| Línea | Qué es | De dónde sale |
|---|---|---|
| `META_ACCESS_TOKEN=` | token permanente de un System User | Business Settings → System users → Generate token |
| `META_APP_SECRET=` | App Secret de la app | App settings → Basic → App secret |
| `META_PHONE_NUMBER_ID=` | el Phone number ID (sólo dígitos; no es secreto, pero es de su cuenta) | WhatsApp → API Setup, junto al número de prueba |
| `ADMIN_WHATSAPP_TO=` | el WhatsApp de Pablo, E.164: `+52…` | — |
| `DEEPSEEK_API_KEY=` | llave de DeepSeek | platform.deepseek.com |

`META_VERIFY_TOKEN` **no** lo trae Pablo: lo genera root en el paso 2 y se lo pasa. El túnel **no**
necesita nada de Pablo: su credencial ya está cifrada en la máquina (paso 6).

`ante.env` **nunca se hace `source`** (ejecutaría lo que traiga): root lo lee línea por línea con
`sed` y lo destruye al terminar el paso 4.

## 1 · El código en el clon del servidor

El servicio corre `/koko/srv/ante/app/agente/src/main.ts`. Ese clon es el taller de `dev-ante` (hay
una sesión de Claude Code trabajando ahí): **no le cambies la rama sin avisar**.

- **Lo normal:** esperar a que Pablo fusione el PR y traerlo:
  ```sh
  sudo -u dev-ante git -C /koko/srv/ante/app status --short   # debe salir vacío
  sudo -u dev-ante git -C /koko/srv/ante/app pull --ff-only origin main
  ```
- **Para probar antes de fusionar** (con el taller en paz):
  ```sh
  sudo -u dev-ante git -C /koko/srv/ante/app fetch origin mac/2026-09-12-agente-whatsapp
  sudo -u dev-ante git -C /koko/srv/ante/app switch --detach FETCH_HEAD
  ```

**Comprobación:**
```sh
sudo -u svc-ante test -r /koko/srv/ante/app/agente/src/main.ts && echo LEGIBLE
/usr/bin/node --version                                         # v24.x
sudo -u svc-ante /usr/bin/node --test '/koko/srv/ante/app/agente/pruebas/*.test.ts' 2>&1 | tail -8   # fail 0
```
Las pruebas no tocan la red (Meta y DeepSeek son falsos, en 127.0.0.1) y escriben sólo en `/tmp`.

**Vuelta atrás:** `sudo -u dev-ante git -C /koko/srv/ante/app switch main`.

## 2 · Sembrar las credenciales (cifradas con la llave de esta máquina)

```sh
install -d -m 0700 -o root -g root /etc/ante/credenciales     # ya existe: ahí está CLOUDFLARED_CRED.cred
install -m 0600 -o root -g root ~pablo-admin/ante.env /etc/ante/ante.env && shred -u ~pablo-admin/ante.env

valor() { sed -n "s/^$1=//p" /etc/ante/ante.env | head -n 1 | tr -d '\r\n'; }
for N in META_ACCESS_TOKEN META_APP_SECRET DEEPSEEK_API_KEY ADMIN_WHATSAPP_TO; do
  [ -n "$(valor "$N")" ] || { echo "FALTA $N en ante.env"; continue; }
  valor "$N" | systemd-creds encrypt --name="$N" - "/etc/ante/credenciales/$N.cred"
done

# El verify token lo genera root, y Pablo lo pega en Meta (paso 7).
openssl rand -hex 32 | tr -d '\n' > /etc/ante/META_VERIFY_TOKEN
systemd-creds encrypt --name=META_VERIFY_TOKEN /etc/ante/META_VERIFY_TOKEN /etc/ante/credenciales/META_VERIFY_TOKEN.cred
install -m 0400 -o pablo-admin -g "$(id -gn pablo-admin)" /etc/ante/META_VERIFY_TOKEN ~pablo-admin/META_VERIFY_TOKEN.txt
shred -u /etc/ante/META_VERIFY_TOKEN
```
**Comprobación** (longitudes y formas, **nunca** los valores):
```sh
for N in META_ACCESS_TOKEN META_APP_SECRET META_VERIFY_TOKEN DEEPSEEK_API_KEY ADMIN_WHATSAPP_TO; do
  printf '%-20s %s caracteres\n' "$N" "$(systemd-creds decrypt --name="$N" "/etc/ante/credenciales/$N.cred" - | wc -c)"
done
systemd-creds decrypt --name=ADMIN_WHATSAPP_TO /etc/ante/credenciales/ADMIN_WHATSAPP_TO.cred - | grep -Eq '^\+[0-9]{8,15}$' && echo ADMIN-E164-OK
systemd-creds decrypt --name=META_VERIFY_TOKEN /etc/ante/credenciales/META_VERIFY_TOKEN.cred - | grep -Eq '^[0-9a-f]{64}$' && echo VERIFY-OK
ls -l /etc/ante/credenciales       # seis .cred de root (cinco del agente + CLOUDFLARED_CRED); el directorio es 0700
```
**Vuelta atrás:** `rm /etc/ante/credenciales/<NOMBRE>.cred` (nunca `CLOUDFLARED_CRED.cred`: ése es
del túnel, paso 6) y Pablo vuelve a mandar su línea. Los `.cred` van cifrados con la llave de este
anfitrión (sin TPM): en una resurrección se re-siembran.

## 3 · El directorio de datos del agente

```sh
ls -ld /koko/srv/ante/datos          # svc-ante ante drwxr-x--- (lo creó el guion el 7 sep)
install -d -m 0700 -o svc-ante -g ante /koko/srv/ante/datos/agente
```
**Comprobación:** `sudo -u svc-ante test -w /koko/srv/ante/datos/agente && echo ESCRIBIBLE`. Ahí
vivirán `conversaciones/*.jsonl`, `vistos.jsonl`, `bajas.json`, `gasto.json`, `ventanas.json` y
`avisos-pendientes.jsonl`. Está bajo el dataset `koko/srv/ante`: entra solo al respaldo nocturno.

**Vuelta atrás:** `rm -r /koko/srv/ante/datos/agente` (con el servicio parado).

## 4 · La unidad del agente y su drop-in

```sh
cp -a /etc/systemd/system/svc-ante.service /root/svc-ante.service.plantilla-2026-09-12
install -m 0644 -o root -g root /koko/srv/ante/app/agente/despliegue/svc-ante.service /etc/systemd/system/svc-ante.service
install -d -m 0755 /etc/systemd/system/svc-ante.service.d
P=$(sed -n 's/^META_PHONE_NUMBER_ID=//p' /etc/ante/ante.env | head -n 1 | tr -d '\r\n')
if echo "$P" | grep -Eq '^[0-9]{5,20}$'; then
  sed "s/PONER_EL_PHONE_NUMBER_ID/$P/" /koko/srv/ante/app/agente/despliegue/svc-ante.meta.conf.ejemplo > /root/meta.conf
  install -m 0644 -o root -g root /root/meta.conf /etc/systemd/system/svc-ante.service.d/meta.conf && rm /root/meta.conf
else
  echo "PARO: META_PHONE_NUMBER_ID falta o no son sólo dígitos"
fi
systemd-analyze verify /etc/systemd/system/svc-ante.service
systemctl daemon-reload
```
**Comprobación** (lo que systemd CARGÓ, no lo que dice el archivo):
```sh
systemctl show svc-ante -p User -p ExecStart -p NoNewPrivileges -p ProtectSystem -p RestrictAddressFamilies -p MemoryMax
systemctl show svc-ante -p Environment | tr ' ' '\n' | grep -E '^(META_PHONE_NUMBER_ID|AGENTE_RUTA|AGENTE_HOST)='
systemd-analyze security svc-ante.service | tail -1
```
**Sólo si todo salió bien** (pasos 2 y 4): `shred -u /etc/ante/ante.env`.

**Vuelta atrás:**
```sh
install -m 0644 /root/svc-ante.service.plantilla-2026-09-12 /etc/systemd/system/svc-ante.service
rm -r /etc/systemd/system/svc-ante.service.d
systemctl daemon-reload
```

## 5 · Arrancar el agente (sin `enable`) y probarlo, desde dentro y por el túnel

```sh
systemctl start svc-ante
systemctl is-active svc-ante                                   # active
journalctl -u svc-ante -n 20 --no-pager -o cat                 # "evento":"arranque", "escucha":"127.0.0.1:9186/webhook/meta"
V=$(systemd-creds decrypt --name=META_VERIFY_TOKEN /etc/ante/credenciales/META_VERIFY_TOKEN.cred -)
curl -s "http://127.0.0.1:9186/webhook/meta?hub.mode=subscribe&hub.verify_token=$V&hub.challenge=123"; echo   # 123
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:9186/webhook/meta?hub.mode=subscribe&hub.verify_token=x&hub.challenge=123"   # 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST -d '{}' http://127.0.0.1:9186/webhook/meta                                              # 403 (sin firma)
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9186/otra                                                                    # 404
unset V
```
Y **de punta a punta, por el túnel** (antes de la regla WAF del paso 8, que bloquearía esto):
```sh
curl -s -o /dev/null -w '%{http_code}\n' https://wa.ante.photo/webhook/meta     # 403 (antes 502): ya contesta el agente
curl -s -o /dev/null -w '%{http_code}\n' https://wa.ante.photo/webhook/meta/x   # 404 del túnel: no llega al agente
journalctl -u svc-ante -n 5 --no-pager -o cat | grep webhook.verificacion        # "ok":false: fue el agente quien contestó
```
Si sale `"evento":"config"` y se detiene con código 78: falta algo (el mensaje dice qué, nunca el
valor). Si muere con `status=31/SYS` o un `EPERM` raro, es el filtro de llamadas al sistema: comenta
las dos líneas `SystemCallFilter=` y avisa (en la Mac no hay systemd para probarlo).

**Vuelta atrás:** `systemctl stop svc-ante` (el túnel sigue y vuelve a dar 502).

## 6 · El túnel — HECHO el 12 sep 2026 (10:37 CST)

Lo hizo un guion que **corrió Pablo** como root (el clasificador de la sesión de la Mac no la dejó
abrir un túnel público). **No es un túnel de token del panel: es un túnel administrado en local**
(`cloudflared tunnel login` + `tunnel create`). El guion no está en este repositorio; su receta,
paso por paso, con lo que quedó medido:

1. **Paquete:** `cloudflared` **2026.9.1**, del apt oficial (https://pkg.cloudflare.com/index.html,
   línea genérica `any main`; no hay línea para trixie). Llave `/usr/share/keyrings/cloudflare-main.gpg`,
   sha256 `1bd95f4082b320d541bee351560fc2765aa9f9cd8efa4c9e32135e63f252721d`, huella
   `CC94 B39C 77AE 7342 A68B 8962 8A68 2D30 8D4E 5E73`. **El paquete no trae unidad propia.**
2. **Login:** `HOME=/root cloudflared tunnel login`, autorizando la zona `ante.photo` (deja
   `/root/.cloudflared/cert.pem`).
3. **Túnel:** `cloudflared tunnel create ante-wa` (deja `/root/.cloudflared/<UUID>.json`).
4. **DNS:** `cloudflared tunnel route dns ante-wa wa.ante.photo`: CNAME con proxy.
5. **Credencial:** `systemd-creds encrypt --name=CLOUDFLARED_CRED /root/.cloudflared/<UUID>.json
   /etc/ante/credenciales/CLOUDFLARED_CRED.cred`, comprobando que el `TunnelID` descifrado coincide,
   y `shred -u` del JSON en claro.
6. **Configuración:** `/etc/cloudflared-ante/config.yml` (root, 0644) = `cloudflared-ante.config.yml.ejemplo`
   con el UUID real (el UUID vive **sólo** ahí). Validada con `cloudflared tunnel --config … ingress
   validate` y `ingress rule https://wa.ante.photo/webhook/meta` / `…/otra`.
7. **Usuario:** `useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin
   --user-group cloudflared-ante`. No es dueño de ningún fichero: su uid no necesita ser fijo.
8. **Unidad:** `/etc/systemd/system/cloudflared-ante.service` = `cloudflared-ante.service` de este
   directorio, byte por byte. La credencial entra por `LoadCredentialEncrypted=CLOUDFLARED_CRED:…` y
   cloudflared la lee con `--credentials-file %d/CLOUDFLARED_CRED` (`%d` = el directorio de
   credenciales de la unidad): nunca en claro en disco ni en `ps`. **Sin** `MemoryDenyWriteExecute=`,
   sin la segunda línea `SystemCallFilter=~…`, sin `KeyringMode=` ni `SystemCallErrorNumber=`: se
   quitaron por prudencia al desplegar, sin probar si rompían.
9. **Arranque:** `systemctl start cloudflared-ante` → 4 conexiones QUIC registradas. **Habilitada
   con `enable` por orden de Pablo.**
10. **Cert de la cuenta:** `shred -u /root/.cloudflared/cert.pem`.

**Comprobación** (se puede repetir cuando sea; nada de esto necesita el cert):
```sh
systemctl is-active cloudflared-ante; systemctl is-enabled cloudflared-ante     # active / enabled
journalctl -u cloudflared-ante -n 30 --no-pager -o cat | grep -c 'Registered tunnel connection'
ps -o args= -C cloudflared                  # --credentials-file /run/credentials/…, nada más
cloudflared tunnel --config /etc/cloudflared-ante/config.yml ingress rule https://wa.ante.photo/webhook/meta   # regla 0
cloudflared tunnel --config /etc/cloudflared-ante/config.yml ingress rule https://wa.ante.photo/otra           # regla 1 (404)
curl -s -o /dev/null -w '%{http_code}\n' https://wa.ante.photo/webhook/meta     # 502 sin agente; 403 con el agente
curl -s -o /dev/null -w '%{http_code}\n' https://wa.ante.photo/                 # 404
```
El GET de verificación de Meta trae query (`/webhook/meta?hub.mode=…`) y aun así entra por la regla
`^/webhook/meta$`: cloudflared compara sólo la ruta (`FindMatchingRule(req.Host, req.URL.Path)` en
`proxy/proxy.go` de cloudflare/cloudflared).

**Qué exige cambiarlo, ahora que el cert se destruyó:**
- **Otra ruta dentro de `wa.ante.photo`:** editar `/etc/cloudflared-ante/config.yml` y
  `systemctl restart cloudflared-ante`. Sin login: las reglas de ingress son locales.
- **Otro nombre, tocar el DNS, borrar o rehacer el túnel:** otro `HOME=/root cloudflared tunnel login`
  (o el panel de Cloudflare), y `shred -u` del cert al terminar.

**Vuelta atrás del túnel:**
```sh
systemctl disable --now cloudflared-ante
rm /etc/systemd/system/cloudflared-ante.service && systemctl daemon-reload
rm -r /etc/cloudflared-ante && rm /etc/ante/credenciales/CLOUDFLARED_CRED.cred
userdel cloudflared-ante
apt-get remove cloudflared && rm /etc/apt/sources.list.d/cloudflared.list /usr/share/keyrings/cloudflare-main.gpg && apt-get update   # sólo si KokoroCo no lo usa ya
```
Y **el túnel `ante-wa` y el CNAME `wa.ante.photo` siguen existiendo en la cuenta de Cloudflare**
hasta que se borren: en el panel (el túnel en Networking → Tunnels; el registro `wa` en el DNS de
`ante.photo`), o con otro login: `cloudflared tunnel delete ante-wa`. Si `delete` quita también el
CNAME, la documentación no lo dice: se comprueba en el DNS de `ante.photo` y se borra a mano si sigue.
Parado el servicio, `wa.ante.photo` deja de llegar a la máquina aunque el túnel exista.

## 7 · Meta: la URL del webhook (lo hace Pablo; root sólo mira)

Pablo, en su app → **WhatsApp → Configuration**: URL de callback `https://wa.ante.photo/webhook/meta`,
**Verify token** = el contenido de `~pablo-admin/META_VERIFY_TOKEN.txt`, **Verify and save**; luego
suscribe el campo **messages**. Root mira:
```sh
journalctl -u svc-ante -f -o cat | grep webhook.verificacion   # "ok":true
```
Y después: `shred -u ~pablo-admin/META_VERIFY_TOKEN.txt`.

## 8 · La regla WAF de refuerzo (la pone Pablo en el panel de Cloudflare)

Texto exacto en `agente/LEEME.md` § «La regla WAF». Sólo esa ruta y sólo desde la red de Meta
(AS32934); todo lo demás de `wa.ante.photo`, bloqueado en el borde. **Comprobación** desde el
servidor (que NO es de Meta): `curl -s -o /dev/null -w '%{http_code}\n' https://wa.ante.photo/webhook/meta`
→ ahora lo corta Cloudflare (403 del borde), y en `journalctl -u svc-ante` **no** aparece la petición.
Un mensaje real sigue entrando (paso 9). **Vuelta atrás:** desactivar la regla en el panel.

⚠ Si la verificación del paso 7 falla con la regla puesta, se desactiva un momento, se verifica y se
reactiva: Meta documenta que sus servidores de webhooks están en AS32934, pero no lo he visto en vivo.

## 9 · La prueba en vivo

Pablo, desde su teléfono (agregado como destinatario del número de prueba), escribe «Hola» al número
de prueba. En segundos le contesta el asistente:
```sh
journalctl -u svc-ante -f -o cat     # agente.modelo.ok → agente.respuesta "enviado":true
cat /koko/srv/ante/datos/agente/gasto.json
```
Luego: «¿Qué paquetes tienen?», «Quiero agendar, soy … el Estándar el sábado» (el aviso «Solicitud de
sesión» le llega como texto porque su ventana está abierta: acaba de escribir), una pregunta fuera
del conocimiento (aviso «te pasa una conversación») y «BAJA» (confirma y deja de contestar; «ALTA»
lo reactiva).

**Avisos pendientes:** si en el registro aparece `aviso_admin.NO_ENTREGADO`, el aviso está en
`/koko/srv/ante/datos/agente/avisos-pendientes.jsonl` y sale en cuanto Pablo le escriba cualquier
cosa al número. El arranque también lo dice (`"avisosPendientes": N`, nivel `error`).

## 10 · Pararlo, y dejar el agente encendido SÓLO con la palabra de Pablo

`cloudflared-ante` **ya está habilitado** (orden de Pablo, 12 sep). `svc-ante`, todavía no:
```sh
systemctl stop svc-ante              # parar el agente: el túnel sigue y da 502
systemctl enable --now svc-ante      # SÓLO con la palabra de Pablo
```
Vuelta atrás del `enable`: `systemctl disable --now svc-ante`. Mientras el agente esté parado y el
túnel arriba, Meta recibe 502 y reintenta (hasta días, según su documentación); cuando el agente
vuelve, la deduplicación por wamid evita contestar dos veces.

## 11 · Vuelta atrás completa

Del agente:
```sh
systemctl disable --now svc-ante 2>/dev/null; systemctl stop svc-ante
install -m 0644 /root/svc-ante.service.plantilla-2026-09-12 /etc/systemd/system/svc-ante.service
rm -r /etc/systemd/system/svc-ante.service.d
systemctl daemon-reload
rm -f /etc/ante/credenciales/{META_ACCESS_TOKEN,META_APP_SECRET,META_VERIFY_TOKEN,DEEPSEEK_API_KEY,ADMIN_WHATSAPP_TO}.cred /etc/ante/ante.env
rm -r /koko/srv/ante/datos/agente
```
Del túnel: la «Vuelta atrás del túnel» del paso 6, **incluido borrar el túnel y el CNAME** en el
panel o con otro login. Y en los paneles: la regla WAF, la URL del webhook en Meta, y revocar el
token del System User y la llave de DeepSeek.

---

Puertos en `127.0.0.1` que ya estaban ocupados: 139, 445, 5432, 5678, 8080, 9180, 9181, 9184, 34273.
Éste usa **9186** (agente) y **9187** (métricas de cloudflared).
