# ANTE
Sitio estático que muestra el trabajo de retrato del estudio ANTE.

## Deploy
Cada push a `main` construye y despliega el Worker `ante` en Cloudflare
(`.github/workflows/deploy.yml`). El nombre del Worker está fijado en
`wrangler.json`: no se hereda de `package.json`.
