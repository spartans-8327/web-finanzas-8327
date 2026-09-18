# Mis Finanzas — Spartans 83-27

Herramienta web pública para el control financiero y la lista de compras del
equipo de robótica **Spartans 83-27**.

Combina dos módulos relacionados:

* **Finanzas** — ingresos, gastos, saldo, historial mensual y reportes.
* **Compras** — qué necesita el equipo, qué ya se compró y qué ya se registró
  como gasto.

Cualquier persona puede **consultar** la información del equipo. Solo la cuenta
del equipo, tras iniciar sesión, puede **modificarla**.

---

## 1. Arquitectura

```text
Navegador (HTML + CSS + JavaScript vanilla)
        │
        ├─ core.js    lógica pura: saldo, resúmenes, validaciones, exportación
        ├─ data.js    acceso a datos: Supabase Auth + PostgreSQL
        └─ script.js  interfaz, navegación y render
        │
        ▼
   Supabase (PostgreSQL + Auth + Row Level Security)
```

No hay backend propio, ni framework, ni proceso de compilación: son archivos
estáticos que se pueden abrir con cualquier servidor web.

| Archivo | Para qué sirve |
| --- | --- |
| `index.html` | Estructura de la aplicación y de los formularios |
| `style.css` | Identidad visual (tema oscuro tipo HUD técnico) |
| `core.js` | Lógica financiera pura, sin DOM ni red (es la parte que se prueba) |
| `data.js` | Sesión y CRUD contra Supabase |
| `script.js` | Interfaz, navegación, render y exportación |
| `config.js` | URL y clave pública de Supabase |
| `schema.sql` | Tablas, índices y políticas de seguridad |
| `tests/core.test.js` | 149 pruebas de la lógica financiera |
| `tests/ui.test.js` | 120 pruebas end-to-end en un navegador real |
| `tests/rls.test.sql` | Pruebas de las políticas de seguridad contra PostgreSQL |

---

## 2. Configurar Supabase

### 2.1 Crear el proyecto

1. Entra a [supabase.com](https://supabase.com) y crea un proyecto.
2. Espera a que termine de aprovisionarse la base de datos.

### 2.2 Crear las tablas y las políticas

1. Abre **SQL Editor → New query**.
2. Pega el contenido completo de `schema.sql`.
3. Pulsa **Run**.

Esto crea cuatro tablas (`equipos`, `equipo_miembros`, `movimientos`,
`compras`), sus índices, y activa Row Level Security con estas reglas:

| Operación | Visitante (`anon`) | Cuenta del equipo (`authenticated`) |
| --- | --- | --- |
| Leer datos de un equipo público | ✅ | ✅ |
| Crear / editar / eliminar | ❌ | ✅ solo en sus equipos |

La seguridad vive en la base de datos, no en los botones: aunque alguien
manipule el HTML, PostgreSQL rechaza cualquier escritura sin sesión válida.

### 2.3 Crear la cuenta del equipo

1. **Authentication → Users → Add user**.
2. Correo y contraseña del equipo (por ejemplo `equipo@spartans8327.mx`).
3. Marca **Auto Confirm User** para no tener que confirmar el correo.

### 2.4 Colocar las claves públicas

1. **Project Settings → API**.
2. Copia **Project URL** y la clave **anon / public**.
3. Pégalas en `config.js`:

```js
window.SUPABASE_CONFIG = {
  url: 'https://xxxxxxxxxxxx.supabase.co',
  anonKey: 'eyJhbGciOi...'
};
```

La clave `anon` está diseñada para vivir en el navegador: por sí sola no
concede ningún permiso, porque quien decide qué se puede leer o escribir son
las políticas de RLS.

> **Nunca** coloques aquí la `service_role key`, contraseñas ni tokens
> administrativos: esa clave ignora RLS y daría control total de la base.

---

## 3. Ejecutar en local

No hace falta instalar nada, pero sí un servidor web (abrir el archivo con
`file://` bloquea la sesión de Supabase):

```bash
# con Python
python3 -m http.server 8000

# o con Node
npx http-server -p 8000
```

Abre `http://localhost:8000`.

**Modo local de prueba:** si `config.js` todavía tiene los valores de ejemplo,
la aplicación arranca guardando en el navegador y lo avisa en pantalla. Sirve
para revisar la interfaz; **no** sincroniza entre dispositivos. En cuanto
pongas las claves reales, la fuente de verdad pasa a ser Supabase.

---

## 4. Desplegar

Al ser archivos estáticos sirve cualquier hosting:

**GitHub Pages** — Settings → Pages → Source: `main` / carpeta raíz.
La página queda en `https://spartans-8327.github.io/web-finanzas-8327/`.

**Netlify o Vercel** — arrastra la carpeta o conecta el repositorio; no
configures comando de build ni carpeta de salida.

Después del despliegue, en Supabase ve a **Authentication → URL Configuration**
y agrega la URL del sitio a *Site URL* / *Redirect URLs*.

---

## 5. Usar la aplicación

### Primera vez

1. Entra al sitio y pulsa **Iniciar sesión** con la cuenta del equipo.
2. Escribe con cuánto dinero comienza el equipo y pulsa **Comenzar**.

### Día a día

* **Registrar movimiento** — concepto, ingreso o gasto, cantidad, fecha, área y
  categoría. El saldo se recalcula solo; nunca se escribe a mano.
* **Agregar producto** — lo que el equipo necesita, con su precio estimado y su
  área. Marcar un producto como comprado **no** mueve el saldo.
* **Registrar como gasto** — cuando ya se sabe el precio real. Ese es el momento
  en que el dinero sale del saldo, con el importe que confirmes.
* **Historial** — resumen mes por mes y filtros combinables sobre todo el
  historial.
* **Reportes** — gastos por área y categoría, comparación entre meses,
  evolución del saldo y exportación.

### Exportar a Excel

Desde el botón **Excel** del encabezado, desde **Historial** o desde
**Reportes**. Se descarga un `.xlsx` real llamado
`finanzas-spartans-AAAA-MM-DD.xlsx` con cinco hojas:

1. **Resumen** — dinero inicial, ingresos, gastos, saldo y fecha de exportación.
2. **Movimientos** — id, fecha, concepto, tipo, área, categoría, cantidad, saldo
   después, compra relacionada y notas.
3. **Compras** — id, producto, cantidad, precio estimado, precio real, área,
   categoría, estado, fechas, movimiento relacionado y si ya se registró.
4. **Resumen por área** — las cinco áreas con gastos, ingresos y balance.
5. **Resumen por categoría** — total gastado por categoría.

Puedes exportar **todo**, **el periodo que estás viendo** o **un rango de fechas
y área** concretos, útil para entregar las cuentas de una competencia.

---

## 6. Modelo de datos

```text
equipos ──┬── equipo_miembros ── auth.users
          │
          ├── movimientos ──┐
          │                 │  relación bidireccional
          └── compras   ────┘
```

* Una **compra** y su **movimiento** son entidades relacionadas pero
  independientes: eliminar la compra conserva el gasto en el historial, y
  eliminar el movimiento libera la compra para volver a registrarla.
* `registrado_como_gasto` + `movimiento_id` evitan gastos duplicados: si el
  producto ya generó uno, la aplicación avisa y exige confirmación extra.
* El saldo **no se almacena**: se reconstruye siempre desde el dinero inicial
  más el historial ordenado por fecha, así que editar o borrar un movimiento
  recalcula automáticamente todos los saldos posteriores.

Aunque hoy exista una sola cuenta, `equipo_miembros` permite agregar más
usuarios autorizados sin rehacer la aplicación.

---

## 7. Ejecutar las pruebas

```bash
# Lógica financiera (Node, sin dependencias)
node tests/core.test.js

# Interfaz completa en un navegador real (requiere playwright y xlsx)
npm install playwright xlsx
NODE_PATH=$(npm root -g) node tests/ui.test.js

# Políticas de seguridad contra un PostgreSQL local
# (simula el esquema auth y los roles anon / authenticated de Supabase)
psql -f tests/rls.test.sql
```

`tests/ui.test.js` recorre el caso obligatorio completo: dinero inicial,
ingresos, gastos, compras, precio estimado contra precio real, duplicados,
edición, eliminación, historial mensual, filtros, exportación real a Excel,
persistencia, modo público y comportamiento en móvil, tablet y escritorio.
