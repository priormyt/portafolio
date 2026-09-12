# PARA ROOT · el agente de WhatsApp de ANTE y el primer túnel de `kokoroco-central`

Escrito el 12 sep 2026, **sin ejecutar nada en el servidor**. Cada paso trae su comprobación y su
vuelta atrás. Se corre como root (`ssh root@100.93.106.86`), en orden.

**Qué se monta.** El pipeline que después usará KokoroCo:

```
Meta (Cloud API) ──HTTPS──► borde de Cloudflare ──túnel cloudflared-ante──► 127.0.0.1:9186  svc-ante
   POST firmado             wa.ante.photo            UNA ruta: /webhook/meta     verifica la firma sobre los
   (X-Hub-Signature-256)    + regla WAF (AS32934)                                bytes crudos, 200 en el acto,
                                                                                 contesta por la Graph API
```

Nada se ata a `0.0.0.0` y no se abre ningún puerto del módem: el túnel sale de la máquina hacia
Cloudflare. **Es exposición pública (una ruta) y la decidió Pablo** (12 sep: «sí vamos directo con
meta»). Lo que sigue sin su palabra: `systemctl enable` de las dos unidades (paso 10).

`cloudflared` es el **primer túnel del servidor** y KokoroCo usará el mismo binario (con su propio
túnel y su propia unidad): por eso se instala desde el repositorio apt de Cloudflare, como capa de
máquina (`capa-base-cloudflared.propuesta.yml`), y no a mano.

## 0 · Lo que tiene que haber hecho Pablo antes

Paso por paso, con los nombres de las pantallas, en `agente/LEEME.md` § «Lo que hace Pablo». Al
final, root necesita en `/etc/ante/` estos ficheros de una línea, sin comillas (como `/etc/ante` es
`root:root 0700`, Pablo los sube por `scp` a su casa y root los mueve con
`install -m 0600 -o root -g root ~pablo-admin/<NOMBRE> /etc/ante/<NOMBRE>`):

| Fichero | Qué es | De dónde sale |
|---|---|---|
| `META_ACCESS_TOKEN` | token permanente de un System User | Business Settings → System users → Generate token |
| `META_APP_SECRET` | App Secret de la app | App settings → Basic → App secret |
| `DEEPSEEK_API_KEY` | llave de DeepSeek | platform.deepseek.com |
| `ADMIN_WHATSAPP_TO` | el WhatsApp de Pablo, E.164: `+52…` | — |
| `CLOUDFLARED_TOKEN` | el token del túnel `ante-wa` | Cloudflare → Networking → Tunnels → Create a tunnel |

Y el **Phone number ID** (no es secreto, pero es de su cuenta): el número que muestra
WhatsApp → API Setup junto al número de prueba.

`META_VERIFY_TOKEN` **no** lo trae Pablo: lo genera root en el paso 2 y se lo pasa.

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
install -d -m 0700 -o root -g root /etc/ante/credenciales

# El verify token lo genera root, y Pablo lo pega en Meta (paso 7).
openssl rand -hex 32 > /etc/ante/META_VERIFY_TOKEN
install -m 0400 -o pablo-admin -g "$(id -gn pablo-admin)" /etc/ante/META_VERIFY_TOKEN ~pablo-admin/META_VERIFY_TOKEN.txt

for N in META_ACCESS_TOKEN META_APP_SECRET META_VERIFY_TOKEN DEEPSEEK_API_KEY ADMIN_WHATSAPP_TO CLOUDFLARED_TOKEN; do
  test -s "/etc/ante/$N" || { echo "FALTA /etc/ante/$N"; continue; }
  tr -d '\r\n' < "/etc/ante/$N" | systemd-creds encrypt --name="$N" - "/etc/ante/credenciales/$N.cred"
done
```
**Comprobación** (longitudes y formas, **nunca** los valores):
```sh
for N in META_ACCESS_TOKEN META_APP_SECRET META_VERIFY_TOKEN DEEPSEEK_API_KEY ADMIN_WHATSAPP_TO CLOUDFLARED_TOKEN; do
  printf '%-20s %s caracteres\n' "$N" "$(systemd-creds decrypt --name="$N" "/etc/ante/credenciales/$N.cred" - | wc -c)"
done
systemd-creds decrypt --name=ADMIN_WHATSAPP_TO /etc/ante/credenciales/ADMIN_WHATSAPP_TO.cred - | grep -Eq '^\+[0-9]{8,15}$' && echo ADMIN-E164-OK
systemd-creds decrypt --name=META_VERIFY_TOKEN /etc/ante/credenciales/META_VERIFY_TOKEN.cred - | grep -Eq '^[0-9a-f]{64}$' && echo VERIFY-OK
ls -l /etc/ante/credenciales       # seis .cred de root; el directorio es 0700
```
**Sólo si todo salió bien**, se destruyen los originales en claro (el verify token queda en la
casa de Pablo hasta el paso 7):
```sh
for N in META_ACCESS_TOKEN META_APP_SECRET META_VERIFY_TOKEN DEEPSEEK_API_KEY ADMIN_WHATSAPP_TO CLOUDFLARED_TOKEN; do shred -u "/etc/ante/$N"; done
# y los que hayan quedado en ~pablo-admin/ (salvo META_VERIFY_TOKEN.txt)
```
**Vuelta atrás:** `rm /etc/ante/credenciales/<NOMBRE>.cred` y Pablo vuelve a mandar el fichero. Los
`.cred` van cifrados con la llave de este anfitrión (sin TPM): en una resurrección se re-siembran.

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
install -m 0644 -o root -g root /koko/srv/ante/app/agente/despliegue/svc-ante.meta.conf.ejemplo /etc/systemd/system/svc-ante.service.d/meta.conf
editor /etc/systemd/system/svc-ante.service.d/meta.conf      # poner el Phone number ID de Pablo
systemd-analyze verify /etc/systemd/system/svc-ante.service
systemctl daemon-reload
```
**Comprobación** (lo que systemd CARGÓ, no lo que dice el archivo):
```sh
systemctl show svc-ante -p User -p ExecStart -p NoNewPrivileges -p ProtectSystem -p RestrictAddressFamilies -p MemoryMax
systemctl show svc-ante -p Environment | tr ' ' '\n' | grep -E '^(META_PHONE_NUMBER_ID|AGENTE_RUTA|AGENTE_HOST)='
systemd-analyze security svc-ante.service | tail -1
```
**Vuelta atrás:**
```sh
install -m 0644 /root/svc-ante.service.plantilla-2026-09-12 /etc/systemd/system/svc-ante.service
rm -r /etc/systemd/system/svc-ante.service.d
systemctl daemon-reload
```

## 5 · Arrancar el agente (sin `enable`) y probarlo desde dentro

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
Si sale `"evento":"config"` y se detiene con código 78: falta algo (el mensaje dice qué, nunca el
valor). Si muere con `status=31/SYS` o un `EPERM` raro, es el filtro de llamadas al sistema: comenta
las dos líneas `SystemCallFilter=` y avisa (en la Mac no hay systemd para probarlo).

**Vuelta atrás:** `systemctl stop svc-ante`.

## 6 · cloudflared: instalar, usuario propio, unidad, arrancar

**6.1 · El paquete, del repositorio apt oficial** (https://pkg.cloudflare.com/index.html, instrucciones
«Any Debian Based Distribution»; la página no trae una línea para trixie, sólo la genérica `any` y
bookworm):
```sh
mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
sha256sum /usr/share/keyrings/cloudflare-main.gpg      # anótalo en la capa (como docker.gpg y nodesource.gpg)
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | tee /etc/apt/sources.list.d/cloudflared.list
apt-get update && apt-get install cloudflared
cloudflared --version        # tiene que ser 2025.4.0 o posterior: --token-file no existe antes
```
**Vuelta atrás:** `apt-get remove cloudflared && rm /etc/apt/sources.list.d/cloudflared.list /usr/share/keyrings/cloudflare-main.gpg && apt-get update`.

Si `apt` instala un `cloudflared.service` propio del paquete, no se habilita ni se toca: se usa
`cloudflared-ante.service`. Tampoco se corre `cloudflared service install <token>`: esa unidad deja
el token en `ExecStart`, a la vista de `ps` (así lo muestra Cloudflare en
https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/as-a-service/linux/).

**6.2 · Usuario de sistema propio** (sin casa, sin login, sin grupos):
```sh
useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin --user-group cloudflared-ante
getent passwd cloudflared-ante     # comprobación
```
No es dueño de ningún fichero (el token lo entrega systemd como credencial), así que su uid no
necesita ser fijo. **Vuelta atrás:** `userdel cloudflared-ante`.

**6.3 · La unidad.** El token entra como credencial cifrada y `cloudflared` lo lee con
`--token-file %d/CLOUDFLARED_TOKEN` (`%d` = el directorio de credenciales de la unidad, según
`systemd.unit(5)`). No aparece ni en el archivo de unidad ni en `ps`.
```sh
install -m 0644 -o root -g root /koko/srv/ante/app/agente/despliegue/cloudflared-ante.service /etc/systemd/system/cloudflared-ante.service
systemd-analyze verify /etc/systemd/system/cloudflared-ante.service
systemctl daemon-reload
systemctl start cloudflared-ante
systemctl is-active cloudflared-ante
journalctl -u cloudflared-ante -n 30 --no-pager -o cat     # «Registered tunnel connection» (varias)
ps -o args= -C cloudflared                                  # se ve --token-file /run/credentials/…, NUNCA el token
```
En el panel de Cloudflare (Networking → Tunnels) el túnel `ante-wa` debe verse conectado (el
nombre exacto del estado no lo verifiqué en la documentación).

**6.4 · Comprobación de punta a punta** (antes de la regla WAF del paso 8, que bloquearía esto):
```sh
curl -s -o /dev/null -w '%{http_code}\n' https://wa.ante.photo/webhook/meta          # 403: llegó al agente (GET sin token)
curl -s -o /dev/null -w '%{http_code}\n' https://wa.ante.photo/cualquier-otra-cosa   # 404
journalctl -u svc-ante -n 5 --no-pager -o cat | grep webhook.verificacion             # "ok":false: fue el agente quien contestó
```
**Vuelta atrás:** `systemctl stop cloudflared-ante && rm /etc/systemd/system/cloudflared-ante.service && systemctl daemon-reload`.
Con el túnel parado, `wa.ante.photo` deja de llegar a la máquina.

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

## 10 · Pararlo, y dejarlo encendido SÓLO con la palabra de Pablo

```sh
systemctl stop cloudflared-ante svc-ante        # parar: primero el túnel
systemctl enable --now svc-ante cloudflared-ante   # SÓLO con la palabra de Pablo
```
Vuelta atrás del `enable`: `systemctl disable --now cloudflared-ante svc-ante`.

## 11 · Vuelta atrás completa

```sh
systemctl disable --now cloudflared-ante svc-ante 2>/dev/null; systemctl stop cloudflared-ante svc-ante
rm /etc/systemd/system/cloudflared-ante.service
install -m 0644 /root/svc-ante.service.plantilla-2026-09-12 /etc/systemd/system/svc-ante.service
rm -r /etc/systemd/system/svc-ante.service.d
systemctl daemon-reload
rm -f /etc/ante/credenciales/{META_ACCESS_TOKEN,META_APP_SECRET,META_VERIFY_TOKEN,DEEPSEEK_API_KEY,ADMIN_WHATSAPP_TO,CLOUDFLARED_TOKEN}.cred
rm -r /koko/srv/ante/datos/agente
userdel cloudflared-ante
apt-get remove cloudflared   # sólo si KokoroCo no lo usa ya
```
Y en los paneles: borrar el túnel `ante-wa` y su hostname en Cloudflare, la regla WAF, la URL del
webhook en Meta, y revocar el token del System User y la llave de DeepSeek.

---

Puertos en `127.0.0.1` que ya estaban ocupados: 139, 445, 5432, 5678, 8080, 9180, 9181, 9184, 34273.
Éste usa **9186** (agente) y **9187** (métricas de cloudflared).
