/* =========================================================================
   Pruebas end-to-end de la interfaz con un navegador real (Chromium).
   Recorre el caso obligatorio del §45 y las pruebas §46-§51.

   Ejecutar:  NODE_PATH=$(npm root -g) node tests/ui.test.js
   ========================================================================= */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RAIZ = path.join(__dirname, '..');
const PUERTO = 8931;
const SCRATCH = process.env.SCRATCH || '/tmp';
const XLSX_LOCAL = path.join(SCRATCH, 'node_modules/xlsx/dist/xlsx.full.min.js');

let pasadas = 0, fallidas = 0;
const fallos = [];
const erroresConsola = [];

function check(nombre, ok, detalle) {
  if (ok) { pasadas++; console.log('  ✓ ' + nombre); }
  else { fallidas++; fallos.push(nombre + (detalle ? ' → ' + detalle : '')); console.log('  ✗ ' + nombre + (detalle ? ' → ' + detalle : '')); }
}
function igual(nombre, actual, esperado) {
  check(nombre, actual === esperado, 'obtenido "' + actual + '", esperado "' + esperado + '"');
}
function bloque(t) { console.log('\n' + t); }

/* ---------- Servidor estático ---------- */
const TIPOS = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
function servidor() {
  return http.createServer((req, res) => {
    let ruta = decodeURIComponent(req.url.split('?')[0]);
    if (ruta === '/') ruta = '/index.html';
    const archivo = path.join(RAIZ, ruta);
    if (!archivo.startsWith(RAIZ) || !fs.existsSync(archivo)) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(archivo)] || 'application/octet-stream' });
    res.end(fs.readFileSync(archivo));
  });
}

(async () => {
  const srv = servidor();
  await new Promise(r => srv.listen(PUERTO, r));

  const navegador = await chromium.launch();
  const contexto = await navegador.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true
  });
  const page = await contexto.newPage();

  // El entorno de pruebas no alcanza los CDN: se sirve SheetJS desde disco
  // y se bloquean fuentes y supabase-js (la app debe caer a modo local).
  await page.route('**/xlsx.full.min.js', route => {
    route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(XLSX_LOCAL) });
  });
  await page.route('**/fonts.googleapis.com/**', r => r.abort());
  await page.route('**/fonts.gstatic.com/**', r => r.abort());
  await page.route('**/supabase-js@**', r => r.abort());

  page.on('console', m => { if (m.type() === 'error') erroresConsola.push(m.text()); });
  page.on('pageerror', e => erroresConsola.push('PAGEERROR: ' + e.message));

  const url = 'http://localhost:' + PUERTO + '/';

  /* ---------- Helpers de interacción ---------- */
  const saldo = () => page.textContent('#saldoDisponible').then(t => t.trim());
  const visible = sel => page.isVisible(sel);

  /*
    Estas pruebas corren en MODO DEMOSTRACIÓN (sin proyecto de Supabase), que
    no pide contraseña a propósito. La autenticación real, con contraseñas
    verificadas, se prueba en tests/auth-real.sh contra un GoTrue auténtico.
  */
  async function login(usuario = 'Spartans8327') {
    const botonLogin = (await page.isVisible('#btnSesionVacio')) ? '#btnSesionVacio' : '#btnSesion';
    await page.click(botonLogin);
    await page.waitForSelector('#modalLogin:not([hidden])');
    await page.fill('#loginUsuario', usuario);
    await page.click('#btnEntrar');
    await page.waitForSelector('#modalLogin', { state: 'hidden', timeout: 5000 });
  }

  async function nuevoMovimiento({ concepto, tipo, cantidad, fecha, area, categoria, notas }) {
    await page.click('#vistaInicio [data-accion="nuevo-movimiento"]');
    await page.waitForSelector('#modalMovimiento:not([hidden])');
    await page.click(`#selectorTipo .seg[data-tipo="${tipo}"]`);
    await page.fill('#movimientoConcepto', concepto);
    await page.fill('#movimientoCantidad', String(cantidad));
    await page.fill('#movimientoFecha', fecha);
    await page.selectOption('#movimientoArea', area);
    await page.selectOption('#movimientoCategoria', categoria);
    if (notas) await page.fill('#movimientoNotas', notas);
    await page.click('#btnGuardarMovimiento');
    await page.waitForSelector('#modalMovimiento', { state: 'hidden', timeout: 5000 });
  }

  async function nuevoProducto({ nombre, cantidad, precio, area, categoria }) {
    await page.click('#vistaCompras [data-accion="nuevo-producto"]');
    await page.waitForSelector('#modalProducto:not([hidden])');
    await page.fill('#productoNombre', nombre);
    await page.fill('#productoCantidad', String(cantidad));
    await page.fill('#productoPrecio', String(precio));
    await page.selectOption('#productoArea', area);
    await page.selectOption('#productoCategoria', categoria);
    await page.click('#btnGuardarProducto');
    await page.waitForSelector('#modalProducto', { state: 'hidden', timeout: 5000 });
  }

  // Las tarjetas de compra se repiten en varias vistas (Inicio muestra las
  // pendientes), así que siempre se busca dentro de la vista visible.
  function tarjeta(nombre) {
    return page.locator('.vista:not([hidden]) .tarjeta-compra', { hasText: nombre }).first();
  }
  function tarjetas() {
    return page.locator('.vista:not([hidden]) .tarjeta-compra');
  }

  try {
    /* =====================================================================
       ARRANQUE Y ACCESO PÚBLICO
       ===================================================================== */
    bloque('ARRANQUE Y MODO PÚBLICO');
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForSelector('#pantallaCarga', { state: 'detached', timeout: 8000 });

    // Partimos siempre de un estado limpio
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(600);

    check('La aplicación carga sin bloquearse', await visible('#pantallaSinDatos'));
    check('Un visitante sin datos ve el aviso de "sin información publicada"',
      (await page.textContent('#pantallaSinDatos')).includes('Todavía no hay información publicada'));
    check('Se detecta el modo demostración y se avisa', await visible('#avisoModo'));
    check('El aviso explica que no se verifica ninguna credencial',
      /no se verifica ninguna credencial/i.test(await page.textContent('#avisoModoTexto')));

    /* =====================================================================
       §36 LOGIN Y §11 DINERO INICIAL
       ===================================================================== */
    bloque('§36 LOGIN · §11 DINERO INICIAL');
    await login();
    check('Tras entrar aparece la pantalla de dinero inicial', await visible('#pantallaInicio'));
    igual('El indicador distingue la demostración de una sesión real',
      (await page.textContent('#chipSesionTexto')).trim(), 'Modo demostración');

    // Validaciones del dinero inicial
    await page.click('#formDineroInicial button[type=submit]');
    check('Rechaza dinero inicial vacío con mensaje visible', await visible('#errorDineroInicial'));
    await page.fill('#inputDineroInicial', '-500');
    await page.click('#formDineroInicial button[type=submit]');
    check('Rechaza dinero inicial negativo',
      (await page.textContent('#errorDineroInicial')).includes('negativo'));

    await page.fill('#inputDineroInicial', '10000');
    await page.click('#formDineroInicial button[type=submit]');
    await page.waitForSelector('#app:not([hidden])', { timeout: 5000 });
    igual('§45 Dinero inicial $10,000 → saldo mostrado', await saldo(), '$10,000');

    /* =====================================================================
       §45 CASO OBLIGATORIO — MOVIMIENTOS
       ===================================================================== */
    bloque('§45 CASO OBLIGATORIO EN LA INTERFAZ');
    await nuevoMovimiento({ concepto: 'Venta', tipo: 'ingreso', cantidad: 2000, fecha: '2026-09-05', area: 'marketing', categoria: 'Merchandising' });
    igual('Ingreso Venta $2,000 → saldo', await saldo(), '$12,000');

    await nuevoMovimiento({ concepto: 'Transporte', tipo: 'gasto', cantidad: 100, fecha: '2026-09-10', area: 'general', categoria: 'Transporte' });
    igual('Gasto Transporte $100 → saldo', await saldo(), '$11,900');

    check('La actividad reciente muestra los movimientos',
      (await page.textContent('#actividadReciente')).includes('Venta'));
    check('El movimiento inicial aparece en la actividad',
      (await page.textContent('#actividadReciente')).includes('Dinero inicial'));

    /* ---- Compras ---- */
    await page.click('.nav-item[data-vista="compras"]');
    await page.waitForSelector('#vistaCompras:not([hidden])');
    await nuevoProducto({ nombre: 'Pintura', cantidad: 2, precio: 500, area: 'diseno', categoria: 'Materiales' });
    await nuevoProducto({ nombre: 'Cable', cantidad: 3, precio: 180, area: 'programacion', categoria: 'Electrónica' });
    await nuevoProducto({ nombre: 'Tornillos', cantidad: 1, precio: 120, area: 'mecanica', categoria: 'Materiales' });

    igual('Se crearon 3 productos', await tarjetas().count(), 3);
    igual('§24 Total pendiente estimado', (await page.textContent('#comprasPendientes')).trim(), '$800');
    check('Las compras se agrupan por área',
      (await page.locator('#contenedorCompras .grupo-area').count()) === 3);

    // §19 Marcar comprado no mueve el saldo
    await tarjeta('Cable').locator('.compra-check').click();
    await page.waitForTimeout(400);
    check('"Cable" queda marcado como comprado',
      (await tarjeta('Cable').getAttribute('class')).includes('comprado'));
    await page.click('.nav-item[data-vista="inicio"]');
    igual('§19 Marcar como comprado NO altera el saldo', await saldo(), '$11,900');

    // §20-§21 Registrar como gasto con precio real
    await page.click('.nav-item[data-vista="compras"]');
    await tarjeta('Cable').locator('[data-gasto]').click();
    await page.waitForSelector('#modalGasto:not([hidden])');
    igual('El formulario precarga el concepto', await page.inputValue('#gastoConcepto'), 'Cable');
    igual('El formulario precarga el precio estimado', await page.inputValue('#gastoPrecioReal'), '180');
    igual('El formulario precarga el área', await page.inputValue('#gastoArea'), 'programacion');
    igual('El formulario precarga la categoría', await page.inputValue('#gastoCategoria'), 'Electrónica');

    await page.fill('#gastoPrecioReal', '170');
    await page.waitForTimeout(150);
    check('Se anticipa el impacto en el saldo antes de confirmar',
      (await page.textContent('#gastoTotalAviso')).includes('$11,730'));
    await page.fill('#gastoFecha', '2026-09-12');
    await page.click('#btnConfirmarGasto');
    await page.waitForSelector('#modalGasto', { state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(400);

    await page.click('.nav-item[data-vista="inicio"]');
    igual('§45 RESULTADO FINAL: saldo tras registrar $170', await saldo(), '$11,730');
    check('El historial contiene el gasto "Cable"',
      (await page.textContent('#actividadReciente')).includes('Cable'));

    await page.click('.nav-item[data-vista="compras"]');
    check('§45 La compra "Cable" permanece marcada',
      (await tarjeta('Cable').getAttribute('class')).includes('registrado'));
    check('La tarjeta muestra el precio real', (await tarjeta('Cable').textContent()).includes('$170'));
    check('La tarjeta conserva el estimado tachado', (await tarjeta('Cable').textContent()).includes('$180'));

    /* =====================================================================
       §47 DUPLICADOS
       ===================================================================== */
    bloque('§47 PREVENCIÓN DE DUPLICADOS');
    await tarjeta('Cable').locator('[data-gasto]').click();
    await page.waitForSelector('#modalDuplicado:not([hidden])', { timeout: 4000 });
    check('Avisa que el producto ya fue registrado como gasto',
      (await page.textContent('#modalDuplicado h3')).includes('ya fue registrado'));
    check('Ofrece cancelar', await page.isVisible('#modalDuplicado [data-cerrar]'));
    check('Ofrece registrar otro gasto de forma explícita', await page.isVisible('#btnRegistrarOtroGasto'));
    await page.click('#modalDuplicado .btn-ghost[data-cerrar]');
    await page.waitForTimeout(250);
    await page.click('.nav-item[data-vista="inicio"]');
    igual('Cancelar no creó ningún movimiento nuevo', await saldo(), '$11,730');

    /* =====================================================================
       §48 PRECIO ESTIMADO VS REAL
       ===================================================================== */
    bloque('§48 PRECIO ESTIMADO VS PRECIO REAL');
    await page.click('.nav-item[data-vista="compras"]');
    await tarjeta('Pintura').locator('.compra-check').click();
    await page.waitForTimeout(350);
    await tarjeta('Pintura').locator('[data-gasto]').click();
    await page.waitForSelector('#modalGasto:not([hidden])');
    await page.fill('#gastoPrecioReal', '430');
    await page.click('#btnConfirmarGasto');
    await page.waitForSelector('#modalGasto', { state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.click('.nav-item[data-vista="inicio"]');
    igual('Se registra el precio real $430 y no el estimado $500', await saldo(), '$11,300');

    /* =====================================================================
       §46 EDICIÓN Y ELIMINACIÓN
       ===================================================================== */
    bloque('§46 EDICIÓN Y ELIMINACIÓN');
    await page.click('.nav-item[data-vista="historial"]');
    await page.click('#tabsHistorial .seg[data-vista-hist="completo"]');
    await page.waitForTimeout(300);

    const filaTransporte = page.locator('#tablaCompleta tr', { hasText: 'Transporte' }).first();
    await filaTransporte.locator('[data-editar-mov]').click();
    await page.waitForSelector('#modalMovimiento:not([hidden])');
    igual('El formulario de edición precarga la cantidad', await page.inputValue('#movimientoCantidad'), '100');
    await page.fill('#movimientoCantidad', '200');
    await page.click('#btnGuardarMovimiento');
    await page.waitForSelector('#modalMovimiento', { state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.click('.nav-item[data-vista="inicio"]');
    igual('§46-A Editar Transporte $100 → $200 recalcula el saldo', await saldo(), '$11,200');

    // Verificar que los saldos POSTERIORES también se recalcularon
    await page.click('.nav-item[data-vista="historial"]');
    await page.click('#tabsHistorial .seg[data-vista-hist="completo"]');
    await page.waitForTimeout(300);
    const saldoTrasCable = await page.locator('#tablaCompleta tr', { hasText: 'Cable' }).first()
      .locator('td').nth(6).textContent();
    igual('§15 Los saldos posteriores se recalculan en cascada', saldoTrasCable.trim(), '$11,630');

    // Restaurar a 100
    await page.locator('#tablaCompleta tr', { hasText: 'Transporte' }).first().locator('[data-editar-mov]').click();
    await page.waitForSelector('#modalMovimiento:not([hidden])');
    await page.fill('#movimientoCantidad', '100');
    await page.click('#btnGuardarMovimiento');
    await page.waitForSelector('#modalMovimiento', { state: 'hidden' });
    await page.waitForTimeout(400);

    // §46-D eliminar compra sin gasto asociado
    await page.click('.nav-item[data-vista="compras"]');
    await tarjeta('Tornillos').locator('[data-eliminar-compra]').click();
    await page.waitForSelector('#modalConfirmar:not([hidden])');
    check('Pide confirmación antes de eliminar un producto',
      (await page.textContent('#tituloConfirmar')).includes('eliminar este producto'));
    await page.click('#btnConfirmarAccion');
    await page.waitForSelector('#modalConfirmar', { state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(400);
    igual('§46-D La compra sin gasto se elimina', await tarjetas().count(), 2);

    // §46-E eliminar compra CON gasto asociado
    await tarjeta('Pintura').locator('[data-eliminar-compra]').click();
    await page.waitForSelector('#modalConfirmar:not([hidden])');
    check('§46-E Advierte explícitamente sobre el movimiento ligado',
      await page.isVisible('#detalleConfirmar') &&
      (await page.textContent('#detalleConfirmar')).includes('se conservará'));
    await page.click('#btnConfirmarAccion');
    await page.waitForSelector('#modalConfirmar', { state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.click('.nav-item[data-vista="inicio"]');
    igual('§46-E El movimiento financiero NO se borra con la compra', await saldo(), '$11,300');

    // §23 el movimiento sobrevive y queda visible en el historial
    await page.click('.nav-item[data-vista="historial"]');
    await page.click('#tabsHistorial .seg[data-vista-hist="completo"]');
    await page.waitForTimeout(300);
    check('§23 El gasto de la compra eliminada sigue en el historial',
      (await page.textContent('#tablaCompleta')).includes('Pintura'));

    // Eliminar un movimiento y comprobar reconstrucción
    await page.locator('#tablaCompleta tr', { hasText: 'Transporte' }).first().locator('[data-eliminar-mov]').click();
    await page.waitForSelector('#modalConfirmar:not([hidden])');
    check('Pide confirmación antes de eliminar un movimiento',
      (await page.textContent('#tituloConfirmar')).includes('eliminar este movimiento'));
    await page.click('#btnConfirmarAccion');
    await page.waitForSelector('#modalConfirmar', { state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.click('.nav-item[data-vista="inicio"]');
    igual('§46-B Eliminar Transporte reconstruye el saldo', await saldo(), '$11,400');

    // Restaurar el movimiento para el resto de las pruebas
    await nuevoMovimiento({ concepto: 'Transporte', tipo: 'gasto', cantidad: 100, fecha: '2026-09-10', area: 'general', categoria: 'Transporte' });
    igual('Saldo restaurado para continuar', await saldo(), '$11,300');

    /* =====================================================================
       §50 HISTORIAL MENSUAL
       ===================================================================== */
    bloque('§50 HISTORIAL MENSUAL');
    await nuevoMovimiento({ concepto: 'Donación agosto', tipo: 'ingreso', cantidad: 3000, fecha: '2026-08-05', area: 'general', categoria: 'Otros' });
    await nuevoMovimiento({ concepto: 'Motores', tipo: 'gasto', cantidad: 4500, fecha: '2026-08-20', area: 'mecanica', categoria: 'Fabricación' });
    await nuevoMovimiento({ concepto: 'Gasolina', tipo: 'gasto', cantidad: 300, fecha: '2026-10-02', area: 'general', categoria: 'Transporte' });

    await page.click('.nav-item[data-vista="historial"]');
    await page.click('#tabsHistorial .seg[data-vista-hist="mensual"]');
    await page.waitForTimeout(300);

    // Navegar hasta agosto
    while (!(await page.textContent('#etiquetaMes')).includes('Agosto')) {
      if (await page.isDisabled('#btnMesAnterior')) break;
      await page.click('#btnMesAnterior');
      await page.waitForTimeout(150);
    }
    igual('Se navega a Agosto 2026', (await page.textContent('#etiquetaMes')).trim(), 'Agosto 2026');
    igual('Agosto: ingresos', (await page.textContent('#mesIngresos')).trim(), '+$3,000');
    igual('Agosto: gastos', (await page.textContent('#mesGastos')).trim(), '-$4,500');
    igual('Agosto: saldo final', (await page.textContent('#mesSaldoFinal')).trim(), '$8,500');
    check('Agosto muestra gastos por área', (await page.textContent('#mesPorArea')).includes('Mecánica'));

    await page.click('#btnMesSiguiente');
    await page.waitForTimeout(250);
    igual('Se navega a Septiembre 2026', (await page.textContent('#etiquetaMes')).trim(), 'Septiembre 2026');
    igual('§27 Septiembre inicia con el saldo final de agosto',
      (await page.textContent('#mesInicial')).trim(), '$8,500');
    igual('Septiembre: saldo final', (await page.textContent('#mesSaldoFinal')).trim(), '$9,800');

    await page.click('#btnMesSiguiente');
    await page.waitForTimeout(250);
    igual('Se navega a Octubre 2026', (await page.textContent('#etiquetaMes')).trim(), 'Octubre 2026');
    igual('Octubre arrastra el saldo de septiembre', (await page.textContent('#mesInicial')).trim(), '$9,800');
    igual('Octubre: saldo final', (await page.textContent('#mesSaldoFinal')).trim(), '$9,500');
    check('§30 El botón "mes siguiente" se bloquea al final del historial',
      await page.isDisabled('#btnMesSiguiente'));

    /* =====================================================================
       §32 FILTROS
       ===================================================================== */
    bloque('§32 FILTROS');
    await page.click('#tabsHistorial .seg[data-vista-hist="completo"]');
    await page.waitForTimeout(250);
    const filasTotales = await page.locator('#tablaCompleta tbody tr').count();
    check('El historial completo muestra todos los movimientos + el inicial', filasTotales === 8, 'filas: ' + filasTotales);

    await page.click('#filtroTipo .seg[data-tipo="gasto"]');
    await page.waitForTimeout(200);
    igual('Filtro por gastos', await page.locator('#tablaCompleta tbody tr').count(), 5);

    await page.selectOption('#filtroArea', 'general');
    await page.waitForTimeout(200);
    igual('Filtros combinados (gasto + área General)', await page.locator('#tablaCompleta tbody tr').count(), 2);

    await page.fill('#filtroDesde', '2026-10-01');
    await page.waitForTimeout(200);
    igual('Filtros combinados con rango de fechas', await page.locator('#tablaCompleta tbody tr').count(), 1);
    check('Se informa el resultado del filtrado',
      (await page.textContent('#resultadoFiltros')).includes('1 movimiento'));

    await page.click('#btnLimpiarFiltros');
    await page.waitForTimeout(200);
    igual('Limpiar filtros restaura el historial', await page.locator('#tablaCompleta tbody tr').count(), 8);

    /* =====================================================================
       §51 EXPORTACIÓN A EXCEL
       ===================================================================== */
    bloque('§51 EXPORTACIÓN A EXCEL');
    const descarga = await Promise.race([
      page.waitForEvent('download', { timeout: 10000 }),
      (async () => { await page.click('#btnExportarRapido'); return null; })().then(() => page.waitForEvent('download', { timeout: 10000 }))
    ]);
    const destino = path.join(os.tmpdir(), 'export-prueba.xlsx');
    await descarga.saveAs(destino);
    check('El archivo se descarga', fs.existsSync(destino));
    check('El nombre del archivo es correcto',
      /^finanzas-spartans-\d{4}-\d{2}-\d{2}\.xlsx$/.test(descarga.suggestedFilename()),
      descarga.suggestedFilename());

    const XLSX = require(path.join(SCRATCH, 'node_modules/xlsx'));
    const libro = XLSX.readFile(destino);
    check('Es un archivo Excel real y abre correctamente', libro.SheetNames.length > 0);
    check('Contiene las 5 hojas requeridas',
      ['Resumen', 'Movimientos', 'Compras', 'Resumen por área', 'Resumen por categoría']
        .every(h => libro.SheetNames.includes(h)), libro.SheetNames.join(' | '));

    const movs = XLSX.utils.sheet_to_json(libro.Sheets['Movimientos'], { header: 1 });
    igual('Hoja Movimientos: no faltan movimientos', movs.length - 1, 8);
    const filaCable = movs.find(f => f[2] === 'Cable');
    check('Hoja Movimientos: el gasto de Cable aparece en negativo', filaCable && filaCable[6] === -170,
      filaCable ? String(filaCable[6]) : 'no encontrada');
    check('Hoja Movimientos: incluye el área', filaCable && filaCable[4] === 'Programación');
    check('Hoja Movimientos: incluye la categoría', filaCable && filaCable[5] === 'Electrónica');

    const resumenHoja = XLSX.utils.sheet_to_json(libro.Sheets['Resumen'], { header: 1 });
    const filaSaldo = resumenHoja.find(f => f[0] === 'Saldo disponible');
    check('Hoja Resumen: el saldo coincide con la aplicación', filaSaldo && filaSaldo[1] === 9500,
      filaSaldo ? String(filaSaldo[1]) : 'no encontrada');

    const comprasHoja = XLSX.utils.sheet_to_json(libro.Sheets['Compras'], { header: 1 });
    check('Hoja Compras: incluye las compras vigentes', comprasHoja.length - 1 === 1, String(comprasHoja.length - 1));
    check('Hoja Compras: distingue estimado y real',
      comprasHoja[1] && comprasHoja[1][3] === 180 && comprasHoja[1][4] === 170);

    const areasHoja = XLSX.utils.sheet_to_json(libro.Sheets['Resumen por área'], { header: 1 });
    const filaMec = areasHoja.find(f => f[0] === 'Mecánica');
    check('Hoja por área: los montos coinciden', filaMec && filaMec[1] === 4500, filaMec ? String(filaMec[1]) : '—');

    /* =====================================================================
       §49 PERSISTENCIA
       ===================================================================== */
    bloque('§49 PERSISTENCIA');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });
    igual('Tras recargar el navegador el saldo se conserva', await saldo(), '$9,500');
    check('Tras recargar la sesión sigue abierta',
      (await page.textContent('#chipSesionTexto')).includes('Modo demostración'));
    await page.click('.nav-item[data-vista="compras"]');
    igual('Tras recargar las compras se conservan', await tarjetas().count(), 1);

    /* =====================================================================
       §35 MODO PÚBLICO (SOLO LECTURA)
       ===================================================================== */
    bloque('§35 MODO PÚBLICO');
    await page.click('#btnSesion'); // cerrar sesión
    await page.waitForTimeout(700);
    igual('Al cerrar sesión el chip vuelve a modo consulta',
      (await page.textContent('#chipSesionTexto')).trim(), 'Modo consulta');
    igual('§35 La información sigue consultándose sin sesión', await saldo(), '$9,500');
    check('El botón "Registrar movimiento" queda oculto para el público',
      !(await page.isVisible('#vistaInicio [data-accion="nuevo-movimiento"]')));

    await page.click('.nav-item[data-vista="compras"]');
    await page.waitForTimeout(300);
    igual('El público ve las compras', await tarjetas().count(), 1);
    igual('El público no tiene botones de eliminar', await page.locator('.vista:not([hidden]) [data-eliminar-compra]').count(), 0);
    igual('El público no tiene botones de editar', await page.locator('.vista:not([hidden]) [data-editar-compra]').count(), 0);
    check('El checkbox de compras queda deshabilitado para el público',
      await page.locator('.vista:not([hidden]) .compra-check').first().isDisabled());

    await page.click('.nav-item[data-vista="historial"]');
    await page.click('#tabsHistorial .seg[data-vista-hist="completo"]');
    await page.waitForTimeout(250);
    igual('El público no puede editar movimientos', await page.locator('.vista:not([hidden]) [data-editar-mov]').count(), 0);
    igual('El público no puede eliminar movimientos', await page.locator('.vista:not([hidden]) [data-eliminar-mov]').count(), 0);
    check('El público sí puede exportar', await page.isVisible('#btnExportarRapido'));

    await page.click('.nav-item[data-vista="reportes"]');
    await page.waitForTimeout(250);
    check('La zona de riesgo se oculta al público', !(await page.isVisible('#panelPeligro')));

    // Intento de escritura desde el modo público
    await login();
    await page.waitForTimeout(600);

    /* =====================================================================
       VISTAS POR ÁREA Y REPORTES
       ===================================================================== */
    bloque('VISTAS POR ÁREA Y REPORTES');
    await page.click('.nav-item[data-area="mecanica"]');
    await page.waitForSelector('#vistaArea:not([hidden])');
    igual('La vista de área muestra el nombre correcto', (await page.textContent('#areaNombre')).trim(), 'Mecánica');
    igual('La vista de área calcula sus gastos', (await page.textContent('#areaGastos')).trim(), '-$4,500');
    check('La vista de área describe su función',
      (await page.textContent('#areaDescripcion')).length > 20);

    await page.click('.nav-item[data-area="programacion"]');
    await page.waitForTimeout(250);
    igual('Cambiar de área actualiza el contenido', (await page.textContent('#areaNombre')).trim(), 'Programación');
    igual('Los gastos del área de programación son correctos', (await page.textContent('#areaGastos')).trim(), '-$170');
    check('El porcentaje del gasto del equipo se calcula',
      /%$/.test((await page.textContent('#areaPorcentaje')).trim()));

    await page.click('.nav-item[data-vista="reportes"]');
    await page.waitForTimeout(300);
    check('Reportes: gastos por área con datos reales',
      (await page.textContent('#reporteAreas')).includes('$4,500'));
    check('Reportes: gráfico de meses presente', (await page.locator('.mes-columna').count()) >= 3);
    check('Reportes: evolución del saldo dibujada', (await page.locator('#reporteSaldo svg').count()) === 1);

    // Insignias de navegación
    const badgeCompras = await page.locator('[data-badge="compras"]').textContent();
    igual('La navegación muestra las compras pendientes', badgeCompras.trim(), '0');

    /* =====================================================================
       ACCESO CON USUARIO Y CONTRASEÑA (6 casos obligatorios)
       ===================================================================== */
    bloque('ACCESO: USUARIO + CONTRASEÑA');

    // Estas comprobaciones miran botones de la vista Inicio: hay que estar
    // en ella para que "no visible" signifique "sin permiso" y no "otra vista".
    await page.click('.nav-item[data-vista="inicio"]');
    await page.waitForSelector('#vistaInicio:not([hidden])');
    check('Punto de partida: con sesión, las acciones de edición se ven',
      await page.isVisible('#vistaInicio [data-accion="nuevo-movimiento"]'));

    // La pantalla de acceso no debe pedir ni mostrar ningún correo.
    await page.click('#btnSesion'); // cerrar sesión para partir del modo público
    await page.waitForTimeout(700);
    await page.click('#btnSesion');
    await page.waitForSelector('#modalLogin:not([hidden])');

    igual('La etiqueta del primer campo es "Usuario"',
      (await page.textContent('#formLogin label:first-of-type')).trim().split('\n')[0].trim(), 'Usuario');
    check('Existe el campo de usuario', await page.isVisible('#loginUsuario'));
    igual('No existe ningún campo de correo', await page.locator('#loginEmail').count(), 0);
    igual('El campo no es de tipo email', await page.getAttribute('#loginUsuario', 'type'), 'text');
    igual('El marcador de posición es el nombre de usuario',
      await page.getAttribute('#loginUsuario', 'placeholder'), 'Spartans8327');
    check('La pantalla de acceso no menciona ningún correo',
      !/@/.test(await page.textContent('#modalLogin')));

    // --- El modo demostración no simula una verificación de contraseña ---
    check('En demostración se advierte que no se verifica ninguna credencial',
      await page.isVisible('#avisoLoginDemo'));
    check('El aviso remite a configurar config.js',
      (await page.textContent('#avisoLoginDemo')).includes('config.js'));
    check('En demostración NO se muestra el campo de contraseña',
      !(await page.isVisible('#campoPassword')));
    check('El campo de contraseña queda además deshabilitado',
      await page.isDisabled('#loginPassword'));
    igual('El botón anuncia que se entra en modo demostración',
      (await page.textContent('#btnEntrar')).trim(), 'Entrar en modo demostración');

    // --- Caso 2 (adaptado): un usuario no configurado se rechaza ---
    await page.fill('#loginUsuario', 'UsuarioQueNoExiste');
    await page.click('#btnEntrar');
    await page.waitForTimeout(700);
    check('Caso 2: un usuario no configurado se rechaza',
      await page.isVisible('#modalLogin') && await page.isVisible('#errorLogin'));
    check('Caso 2: no se crea sesión',
      (await page.textContent('#chipSesionTexto')).includes('Modo consulta'));

    // Usuario vacío
    await page.fill('#loginUsuario', '');
    await page.click('#btnEntrar');
    await page.waitForTimeout(300);
    check('Usuario vacío se rechaza con mensaje propio',
      (await page.textContent('#errorLogin')).includes('usuario'));

    // --- Caso 4: sin autenticar, solo consulta ---
    await page.click('#modalLogin [data-cerrar]');
    await page.waitForTimeout(300);
    igual('Caso 4: el visitante consulta el saldo', await saldo(), '$9,500');
    check('Caso 4: el visitante no puede registrar movimientos',
      !(await page.isVisible('#vistaInicio [data-accion=\"nuevo-movimiento\"]')));

    // --- Caso 1 (adaptado): el usuario configurado entra ---
    await login('Spartans8327');
    await page.waitForTimeout(600);
    igual('Caso 1: se abre la sesión de demostración, señalada como tal',
      (await page.textContent('#chipSesionTexto')).trim(), 'Modo demostración');
    check('Caso 1: vuelven las funciones de edición',
      await page.isVisible('#vistaInicio [data-accion=\"nuevo-movimiento\"]'));
    igual('Caso 1: los datos siguen visibles', await saldo(), '$9,500');

    // --- Caso 5: el usuario autenticado opera con normalidad ---
    await nuevoMovimiento({ concepto: 'Prueba de acceso', tipo: 'ingreso', cantidad: 50,
      fecha: '2026-09-20', area: 'general', categoria: 'Otros' });
    igual('Caso 5: el usuario autenticado puede escribir', await saldo(), '$9,550');

    // El correo técnico no aparece por ninguna parte de la interfaz.
    igual('El pie muestra el usuario y advierte que no hay autenticación real',
      (await page.textContent('#pieEstado')).trim(),
      'Demostración: Spartans8327 · sin autenticación real');
    check('Ninguna pantalla visible muestra el correo técnico',
      !(await page.evaluate(() => document.body.innerText)).includes('@spartans8327.app'));

    // El nombre visible sobrevive a la recarga (se deriva del correo).
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });
    check('Tras recargar se conserva la sesión y el nombre de usuario',
      (await page.textContent('#pieEstado')).includes('Spartans8327'));

    // Deshacer el movimiento de prueba para no alterar el resto de la suite.
    await page.click('.nav-item[data-vista=\"historial\"]');
    await page.click('#tabsHistorial .seg[data-vista-hist=\"completo\"]');
    await page.waitForTimeout(300);
    await page.locator('#tablaCompleta tr', { hasText: 'Prueba de acceso' }).first()
      .locator('[data-eliminar-mov]').click();
    await page.waitForSelector('#modalConfirmar:not([hidden])');
    await page.click('#btnConfirmarAccion');
    await page.waitForSelector('#modalConfirmar', { state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(400);
    await page.click('.nav-item[data-vista=\"inicio\"]');
    igual('El estado queda como estaba antes de la prueba', await saldo(), '$9,500');

    // --- Caso 6: cerrar sesión ---
    await page.click('#btnSesion');
    await page.waitForTimeout(700);
    igual('Caso 6: la sesión se cierra',
      (await page.textContent('#chipSesionTexto')).trim(), 'Modo consulta');
    check('Caso 6: las funciones protegidas dejan de estar disponibles',
      !(await page.isVisible('#vistaInicio [data-accion=\"nuevo-movimiento\"]')));
    igual('Caso 6: el pie deja de mostrar la sesión',
      (await page.textContent('#pieEstado')).trim(), 'Consulta pública · solo lectura');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('#app:not([hidden])', { timeout: 8000 });
    check('Caso 6: la sesión no revive al recargar',
      (await page.textContent('#chipSesionTexto')).includes('Modo consulta'));

    // Volver a entrar para el resto de las pruebas.
    await login();
    await page.waitForTimeout(600);

    /* =====================================================================
       §42 VALIDACIONES EN LA INTERFAZ
       ===================================================================== */
    bloque('§42 VALIDACIONES EN LA INTERFAZ');
    await page.click('.nav-item[data-vista="inicio"]');
    await page.click('#vistaInicio [data-accion="nuevo-movimiento"]');
    await page.waitForSelector('#modalMovimiento:not([hidden])');
    await page.click('#btnGuardarMovimiento');
    check('Sin concepto muestra error visible', await page.isVisible('#errorMovimiento'));
    check('El mensaje de error es claro',
      (await page.textContent('#errorMovimiento')).includes('concepto'));

    await page.fill('#movimientoConcepto', 'Prueba');
    await page.fill('#movimientoCantidad', '0');
    await page.click('#btnGuardarMovimiento');
    check('Cantidad cero se rechaza',
      (await page.textContent('#errorMovimiento')).includes('mayor que cero'));

    await page.fill('#movimientoCantidad', '-10');
    await page.click('#btnGuardarMovimiento');
    check('Cantidad negativa se rechaza',
      (await page.textContent('#errorMovimiento')).includes('mayor que cero'));

    await page.fill('#movimientoFecha', '');
    await page.fill('#movimientoCantidad', '50');
    await page.click('#btnGuardarMovimiento');
    check('Fecha vacía se rechaza', (await page.textContent('#errorMovimiento')).includes('fecha'));
    await page.click('#modalMovimiento [data-cerrar]');
    await page.waitForTimeout(200);

    await page.click('.nav-item[data-vista="compras"]');
    await page.click('#vistaCompras [data-accion="nuevo-producto"]');
    await page.waitForSelector('#modalProducto:not([hidden])');
    await page.click('#btnGuardarProducto');
    check('Producto sin nombre se rechaza', await page.isVisible('#errorProducto'));
    await page.fill('#productoNombre', 'Prueba');
    await page.fill('#productoCantidad', '0');
    await page.fill('#productoPrecio', '100');
    await page.click('#btnGuardarProducto');
    check('Cantidad de producto cero se rechaza',
      (await page.textContent('#errorProducto')).includes('mayor que cero'));
    await page.click('#modalProducto [data-cerrar]');
    await page.waitForTimeout(200);

    /* =====================================================================
       §62 RESPONSIVE
       ===================================================================== */
    bloque('§62 RESPONSIVE');
    for (const [nombre, ancho, alto] of [['Móvil', 390, 844], ['Tablet', 820, 1180], ['Escritorio', 1440, 900]]) {
      await page.setViewportSize({ width: ancho, height: alto });
      await page.waitForTimeout(350);
      for (const vista of ['inicio', 'compras', 'historial', 'reportes']) {
        await page.click(`.nav-item[data-vista="${vista}"]`);
        await page.waitForTimeout(250);
        const desborde = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(`${nombre} · ${vista}: sin desbordamiento horizontal`, desborde <= 1, 'desborde ' + desborde + 'px');
      }
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('.nav-item[data-vista="inicio"]');
    await page.waitForTimeout(300);
    check('Móvil: el botón flotante de acción es visible', await page.isVisible('#fabAccion'));
    const saldoLegible = await page.evaluate(() => {
      const n = document.getElementById('saldoDisponible');
      return n.getBoundingClientRect().width <= window.innerWidth;
    });
    check('Móvil: el saldo cabe en pantalla', saldoLegible);

    // Modal en móvil
    await page.click('#fabAccion');
    await page.waitForSelector('#modalMovimiento:not([hidden])');
    const modalCabe = await page.evaluate(() => {
      const m = document.querySelector('#modalMovimiento .modal').getBoundingClientRect();
      return m.width <= window.innerWidth && m.left >= 0;
    });
    check('Móvil: el modal cabe en pantalla', modalCabe);
    await page.click('#modalMovimiento [data-cerrar]');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);

    /* =====================================================================
       CAPTURAS
       ===================================================================== */
    bloque('CAPTURAS DE PANTALLA');
    const dirCap = path.join(SCRATCH, 'capturas');
    fs.mkdirSync(dirCap, { recursive: true });
    for (const vista of ['inicio', 'compras', 'historial', 'reportes']) {
      await page.click(`.nav-item[data-vista="${vista}"]`);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(dirCap, vista + '.png'), fullPage: true });
    }
    await page.click('.nav-item[data-area="mecanica"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(dirCap, 'area.png'), fullPage: true });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('.nav-item[data-vista="inicio"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(dirCap, 'movil-inicio.png'), fullPage: true });
    await page.click('.nav-item[data-vista="compras"]');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(dirCap, 'movil-compras.png'), fullPage: true });
    console.log('  → capturas en ' + dirCap);

    /* ---- Errores de consola ---- */
    bloque('CONSOLA DEL NAVEGADOR');
    const relevantes = erroresConsola.filter(e =>
      !/net::ERR|Failed to load resource|fonts\.|supabase-js/i.test(e));
    check('Sin errores de JavaScript en consola', relevantes.length === 0, relevantes.slice(0, 4).join(' | '));

  } catch (e) {
    fallidas++;
    fallos.push('EXCEPCIÓN: ' + e.message);
    console.log('\n✗ EXCEPCIÓN: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
    try { await page.screenshot({ path: path.join(SCRATCH, 'fallo.png'), fullPage: true }); } catch (_) {}
  } finally {
    await navegador.close();
    srv.close();
  }

  console.log('\n' + '='.repeat(62));
  console.log('RESULTADO UI: ' + pasadas + ' pasadas, ' + fallidas + ' fallidas');
  if (fallos.length) { console.log('\nFALLOS:'); fallos.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(62));
  process.exit(fallidas ? 1 : 0);
})();
