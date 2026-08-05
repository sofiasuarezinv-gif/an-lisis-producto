# Análisis de Productos — Dashboard

Dashboard para investigar productos (dropshipping). Cualquier persona, desde cualquier PC, agrega productos y quedan **guardados para siempre** en una base de datos en la nube.

- **Agregar producto**: obligatorios (Foto, Nombre, ID, Precio proveedor, Stock, Nombre proveedor, Número proveedor) + secciones opcionales (Info principal, Filtro, Competencia, Análisis de mercado, Proveedores, Combo).
- **Productos**: lista con búsqueda; clic en un producto para ver/editar/eliminar.
- **Respaldo**: botones para exportar/importar todo en un archivo JSON.

## Cómo correrlo local (para probar)
```
npm install
node server.js
```
Abre http://localhost:4000 — sin `DATABASE_URL` usa un archivo local `products.json` (solo pruebas).

## Desplegar en Render (permanente, multi-usuario)

1. **Base de datos gratis (Neon):** crea una cuenta en https://neon.tech → New Project → copia la **Connection string** (empieza con `postgresql://…`).
2. **Sube este código a un repo de GitHub** (tu cuenta personal).
3. **Render:** New → **Web Service** → conecta el repo.
   - Build command: `npm install`
   - Start command: `node server.js`
4. En **Environment** del servicio agrega la variable:
   - `DATABASE_URL` = la connection string de Neon.
5. Deploy. La tabla se crea sola. Desde ahí, todo lo que guardes queda permanente.

> Sin `DATABASE_URL`, Render usaría un archivo temporal que se borra en cada redeploy — **por eso es obligatorio configurar la base** para producción.
