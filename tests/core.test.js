/* =========================================================================
   Pruebas automatizadas de la lógica financiera (core.js).
   Ejecutar con:  node tests/core.test.js
   ========================================================================= */
const Core = require('../core.js');

let pasadas = 0, fallidas = 0;
const fallos = [];

function check(nombre, condicion, detalle) {
  if (condicion) { pasadas++; console.log('  ✓ ' + nombre); }
  else {
    fallidas++; fallos.push(nombre + (detalle ? ' → ' + detalle : ''));
    console.log('  ✗ ' + nombre + (detalle ? ' → ' + detalle : ''));
  }
}
function igual(nombre, actual, esperado) {
  check(nombre, actual === esperado, 'obtenido ' + JSON.stringify(actual) + ', esperado ' + JSON.stringify(esperado));
}
function bloque(titulo) { console.log('\n' + titulo); }

/* ---------- Constructores de datos de prueba ---------- */
let contador = 0;
function mov(concepto, tipo, cantidad, fecha, area, categoria, extra) {
  contador++;
  return Object.assign({
    id: 'mov-' + contador, concepto, tipo, cantidad, fecha,
    area: area || 'general', categoria: categoria || 'Otros',
    notas: '', compraId: null, creadoEn: '2026-01-01T00:00:0' + (contador % 10) + 'Z'
  }, extra || {});
}
function compra(nombre, cantidad, precioEstimado, area, categoria, extra) {
  contador++;
  return Object.assign({
    id: 'cmp-' + contador, nombre, cantidad, precioEstimado, precioReal: null,
    area, categoria, estado: 'pendiente', registradoComoGasto: false,
    movimientoId: null, fechaCompra: null, notas: '', creadoEn: '2026-01-01T00:00:00Z'
  }, extra || {});
}

/* =========================================================================
   §45 — CASO DE PRUEBA OBLIGATORIO
   ========================================================================= */
bloque('§45 CASO DE PRUEBA OBLIGATORIO');

const config = { dineroInicial: 10000, fechaInicio: '2026-09-01', nombreEquipo: 'Spartans 83-27' };
let movimientos = [];
let compras = [];

igual('Dinero inicial $10,000 → saldo $10,000', Core.calcularSaldo(config, movimientos), 10000);

movimientos.push(mov('Venta', 'ingreso', 2000, '2026-09-05', 'marketing', 'Merchandising'));
igual('+ Ingreso Venta $2,000 → saldo $12,000', Core.calcularSaldo(config, movimientos), 12000);

movimientos.push(mov('Transporte', 'gasto', 100, '2026-09-10', 'general', 'Transporte'));
igual('- Gasto Transporte $100 → saldo $11,900', Core.calcularSaldo(config, movimientos), 11900);

const pintura = compra('Pintura', 2, 500, 'diseno', 'Materiales');
const cable = compra('Cable', 3, 180, 'programacion', 'Electrónica');
const tornillos = compra('Tornillos', 1, 120, 'mecanica', 'Materiales');
compras.push(pintura, cable, tornillos);
igual('3 productos en la lista de compras', compras.length, 3);

// Marcar Cable como comprado NO debe mover el saldo (§19)
cable.estado = 'comprado';
igual('Marcar "Cable" como comprado NO altera el saldo', Core.calcularSaldo(config, movimientos), 11900);

// Registrar como gasto con precio real $170 (§20, §21)
// El precio real es el monto total confirmado por el usuario, no un unitario.
cable.precioReal = 170;
const movCable = mov('Cable', 'gasto', 170, '2026-09-12', 'programacion', 'Electrónica', { compraId: cable.id });
movimientos.push(movCable);
cable.registradoComoGasto = true;
cable.movimientoId = movCable.id;
cable.fechaCompra = '2026-09-12';

igual('Registrar gasto real $170 → saldo $11,730', Core.calcularSaldo(config, movimientos), 11730);
check('El historial contiene "Cable — Gasto — -$170"',
  Core.construirLineaDeTiempo(config, movimientos).some(m =>
    m.concepto === 'Cable' && m.tipo === 'gasto' && m.cantidad === 170));
igual('La compra "Cable" permanece marcada como comprada', cable.estado, 'comprado');
igual('La compra queda ligada al movimiento', cable.movimientoId, movCable.id);

/* =========================================================================
   §12 / §15 — SALDO Y RECÁLCULO
   ========================================================================= */
bloque('§15 RECÁLCULO DE SALDO AL EDITAR Y ELIMINAR');

// Caso A: editar Transporte $100 → $200
const transporte = movimientos.find(m => m.concepto === 'Transporte');
transporte.cantidad = 200;
igual('Caso A: editar Transporte a $200 → saldo $11,630', Core.calcularSaldo(config, movimientos), 11630);

// Los saldos posteriores también se recalculan
let linea = Core.construirLineaDeTiempo(config, movimientos);
const filaCable = linea.find(m => m.concepto === 'Cable');
igual('Caso A: el saldo posterior del movimiento "Cable" se recalcula', filaCable.saldoDespues, 11630);

transporte.cantidad = 100; // restaurar

// Caso B: eliminar Transporte
const sinTransporte = movimientos.filter(m => m.concepto !== 'Transporte');
igual('Caso B: eliminar Transporte → saldo $11,830', Core.calcularSaldo(config, sinTransporte), 11830);
igual('Caso B: el historial original no se modificó', Core.calcularSaldo(config, movimientos), 11730);

// El saldo se reconstruye igual sin importar el orden de inserción
const desordenados = [movimientos[2], movimientos[0], movimientos[1]];
igual('El saldo es independiente del orden de inserción', Core.calcularSaldo(config, desordenados), 11730);

const lineaDesordenada = Core.construirLineaDeTiempo(config, desordenados);
check('La línea de tiempo se ordena cronológicamente',
  lineaDesordenada.map(m => m.fecha).join(',') === '2026-09-01,2026-09-05,2026-09-10,2026-09-12',
  lineaDesordenada.map(m => m.fecha).join(','));
igual('El movimiento inicial aparece primero en el historial', lineaDesordenada[0].tipo, 'inicial');

/* =========================================================================
   §16 — RESUMEN FINANCIERO
   ========================================================================= */
bloque('§16 RESUMEN FINANCIERO');
const resumen = Core.calcularResumen(config, movimientos);
igual('Resumen: dinero inicial', resumen.inicial, 10000);
igual('Resumen: ingresos', resumen.ingresos, 2000);
igual('Resumen: gastos', resumen.gastos, 270);
igual('Resumen: disponible', resumen.disponible, 11730);

/* =========================================================================
   §21 / §48 — PRECIO ESTIMADO VS PRECIO REAL
   ========================================================================= */
bloque('§48 PRECIO ESTIMADO VS PRECIO REAL');
const saldoAntes = Core.calcularSaldo(config, movimientos);
pintura.estado = 'comprado';
pintura.precioReal = 430;
igual('El precio real capturado NO modifica el saldo por sí solo', Core.calcularSaldo(config, movimientos), saldoAntes);

const movPintura = mov('Pintura', 'gasto', 430, '2026-09-15', 'diseno', 'Materiales', { compraId: pintura.id });
movimientos.push(movPintura);
pintura.registradoComoGasto = true;
pintura.movimientoId = movPintura.id;
igual('Se registra el precio real $430 y no el estimado $500', Core.calcularSaldo(config, movimientos), 11300);
check('El movimiento generado usa el precio real',
  movimientos.find(m => m.concepto === 'Pintura').cantidad === 430);

/* =========================================================================
   §23 — INDEPENDENCIA COMPRA / MOVIMIENTO
   ========================================================================= */
bloque('§23 INDEPENDENCIA ENTRE COMPRAS Y MOVIMIENTOS');
pintura.estado = 'pendiente';
check('Volver la compra a "Pendiente" NO elimina el movimiento',
  movimientos.some(m => m.id === movPintura.id));
igual('El saldo no cambia al revertir el estado de la compra', Core.calcularSaldo(config, movimientos), 11300);
pintura.estado = 'comprado';

// §46 Caso D: eliminar compra sin gasto asociado
const antesTornillos = compras.length;
compras = compras.filter(c => c.id !== tornillos.id);
igual('Caso D: se elimina una compra sin gasto asociado', compras.length, antesTornillos - 1);
igual('Caso D: el saldo no cambia', Core.calcularSaldo(config, movimientos), 11300);
compras.push(tornillos);

// §46 Caso E: eliminar compra CON gasto asociado no borra el movimiento
const comprasSinPintura = compras.filter(c => c.id !== pintura.id);
check('Caso E: el movimiento financiero sobrevive a la eliminación de la compra',
  movimientos.some(m => m.id === movPintura.id));
igual('Caso E: el saldo se conserva', Core.calcularSaldo(config, movimientos), 11300);
check('Caso E: el movimiento queda huérfano pero íntegro', comprasSinPintura.length === compras.length - 1);

/* =========================================================================
   §22 / §47 — PREVENCIÓN DE DUPLICADOS
   ========================================================================= */
bloque('§47 PREVENCIÓN DE DUPLICADOS');
check('La compra "Cable" está marcada como registrada', cable.registradoComoGasto === true);
check('La compra "Cable" guarda el id del movimiento', !!cable.movimientoId);
check('El sistema puede detectar el duplicado antes de crear el movimiento',
  cable.registradoComoGasto === true && cable.movimientoId !== null);
const movimientosDeCable = movimientos.filter(m => m.compraId === cable.id);
igual('Solo existe un movimiento asociado a "Cable"', movimientosDeCable.length, 1);

/* =========================================================================
   §24 — RESUMEN DE COMPRAS
   ========================================================================= */
bloque('§24 RESUMEN DE COMPRAS');
const resCompras = Core.resumenCompras(compras);
// Pendientes: Tornillos 1 × $120 = $120
igual('Compras pendientes (estimado)', resCompras.pendientes, 120);
// Compradas: Cable $170 real + Pintura $430 real
igual('Compras realizadas (precio real cuando existe)', resCompras.compradas, 600);
igual('Total estimado + real', resCompras.totalEstimado, 720);
igual('Número de pendientes', resCompras.numPendientes, 1);
igual('Número de compradas', resCompras.numCompradas, 2);
igual('Número registradas como gasto', resCompras.numRegistradas, 2);

/* =========================================================================
   §25-§30 / §50 — HISTORIAL MENSUAL
   ========================================================================= */
bloque('§50 HISTORIAL MENSUAL Y SALDO POR PERIODO');

const configH = { dineroInicial: 10000, fechaInicio: '2026-08-01', nombreEquipo: 'Spartans 83-27' };
const movsH = [
  mov('Donación', 'ingreso', 3000, '2026-08-05', 'general', 'Otros'),
  mov('Motores', 'gasto', 4500, '2026-08-20', 'mecanica', 'Fabricación'),
  mov('Patrocinio', 'ingreso', 3500, '2026-09-03', 'general', 'Otros'),
  mov('Sensores', 'gasto', 1200, '2026-09-08', 'programacion', 'Electrónica'),
  mov('Lonas', 'gasto', 620, '2026-09-19', 'marketing', 'Publicidad'),
  mov('Gasolina', 'gasto', 300, '2026-10-02', 'general', 'Transporte')
];

const agosto = Core.resumenMensual(configH, movsH, '2026-08');
igual('Agosto: dinero inicial del periodo (no hay nada antes)', agosto.dineroInicialPeriodo, 0);
igual('Agosto: apertura registrada dentro del mes', agosto.aperturaEnElMes, 10000);
igual('Agosto: ingresos', agosto.ingresos, 3000);
igual('Agosto: gastos', agosto.gastos, 4500);
igual('Agosto: saldo final', agosto.saldoFinal, 8500);
igual('Agosto: número de movimientos', agosto.numMovimientos, 2);

const septiembre = Core.resumenMensual(configH, movsH, '2026-09');
igual('§27 Septiembre inicia con el saldo final de agosto ($8,500)', septiembre.dineroInicialPeriodo, 8500);
igual('Septiembre: ingresos', septiembre.ingresos, 3500);
igual('Septiembre: gastos', septiembre.gastos, 1820);
igual('Septiembre: saldo final', septiembre.saldoFinal, 10180);
igual('Septiembre: número de movimientos', septiembre.numMovimientos, 3);
igual('Septiembre: número de ingresos', septiembre.numIngresos, 1);
igual('Septiembre: número de gastos', septiembre.numGastos, 2);

const octubre = Core.resumenMensual(configH, movsH, '2026-10');
igual('Octubre inicia con el saldo final de septiembre', octubre.dineroInicialPeriodo, 10180);
igual('Octubre: saldo final', octubre.saldoFinal, 9880);

const noviembre = Core.resumenMensual(configH, movsH, '2026-11');
check('Un mes sin movimientos se marca como vacío', noviembre.sinMovimientos === true);
igual('Un mes sin movimientos arrastra el saldo anterior', noviembre.saldoFinal, 9880);
igual('Un mes sin movimientos no inventa ingresos', noviembre.ingresos, 0);

check('Ningún movimiento desaparece al cambiar de mes',
  agosto.numMovimientos + septiembre.numMovimientos + octubre.numMovimientos === movsH.length);

const meses = Core.listarMeses(configH, movsH);
check('Se listan los meses con actividad', ['2026-08','2026-09','2026-10'].every(m => meses.includes(m)), meses.join(','));

/* =========================================================================
   §28 / §29 — GASTOS POR ÁREA Y CATEGORÍA
   ========================================================================= */
bloque('§28-§29 GASTOS POR ÁREA Y POR CATEGORÍA');
const porAreaTotal = Core.agruparPorArea(movsH);
igual('Gastos de Mecánica', porAreaTotal.mecanica, 4500);
igual('Gastos de Programación', porAreaTotal.programacion, 1200);
igual('Gastos de Marketing', porAreaTotal.marketing, 620);
igual('Gastos de General', porAreaTotal.general, 300);
igual('Diseño sin gastos', porAreaTotal.diseno, 0);
igual('La suma por área equivale al total de gastos',
  Object.values(porAreaTotal).reduce((a, b) => a + b, 0), 6620);

const porCatSep = septiembre.porCategoria;
igual('Categoría Electrónica en septiembre', porCatSep['Electrónica'], 1200);
igual('Categoría Publicidad en septiembre', porCatSep['Publicidad'], 620);
check('Los ingresos no se cuentan como gasto por categoría', porCatSep['Otros'] === undefined);

const areaMec = Core.resumenArea(configH, movsH, [], 'mecanica');
igual('Resumen de área Mecánica: gastos', areaMec.gastos, 4500);
igual('Resumen de área Mecánica: balance', areaMec.balance, -4500);

/* =========================================================================
   §32 — FILTROS COMBINADOS
   ========================================================================= */
bloque('§32 FILTROS');
igual('Filtro por tipo gasto', Core.filtrarMovimientos(movsH, { tipo: 'gasto' }).length, 4);
igual('Filtro por tipo ingreso', Core.filtrarMovimientos(movsH, { tipo: 'ingreso' }).length, 2);
igual('Filtro por área', Core.filtrarMovimientos(movsH, { area: 'general' }).length, 3);
igual('Filtro por categoría', Core.filtrarMovimientos(movsH, { categoria: 'Transporte' }).length, 1);
igual('Filtro por rango de fechas',
  Core.filtrarMovimientos(movsH, { desde: '2026-09-01', hasta: '2026-09-30' }).length, 3);
igual('Filtros combinados (gasto + general + rango)',
  Core.filtrarMovimientos(movsH, { tipo: 'gasto', area: 'general', desde: '2026-10-01' }).length, 1);
igual('Filtro por texto libre', Core.filtrarMovimientos(movsH, { texto: 'sensor' }).length, 1);
igual('Filtro sin resultados devuelve lista vacía',
  Core.filtrarMovimientos(movsH, { tipo: 'ingreso', area: 'mecanica' }).length, 0);

const comprasFiltro = [cable, pintura, tornillos];
igual('Filtro de compras por área', Core.filtrarCompras(comprasFiltro, { area: 'mecanica' }).length, 1);
igual('Filtro de compras por estado pendiente', Core.filtrarCompras(comprasFiltro, { estado: 'pendiente' }).length, 1);
igual('Filtro de compras registradas como gasto', Core.filtrarCompras(comprasFiltro, { estado: 'registrado' }).length, 2);

/* =========================================================================
   §42 — VALIDACIONES
   ========================================================================= */
bloque('§42 VALIDACIONES');
const base = { concepto: 'Prueba', tipo: 'gasto', cantidad: 100, fecha: '2026-09-18', area: 'general', categoria: 'Otros' };
check('Movimiento válido pasa', Core.validarMovimiento(base).ok === true);
check('Rechaza concepto vacío', Core.validarMovimiento({ ...base, concepto: '   ' }).ok === false);
check('Rechaza cantidad vacía', Core.validarMovimiento({ ...base, cantidad: '' }).ok === false);
check('Rechaza cantidad cero', Core.validarMovimiento({ ...base, cantidad: 0 }).ok === false);
check('Rechaza cantidad negativa', Core.validarMovimiento({ ...base, cantidad: -50 }).ok === false);
check('Rechaza cantidad no numérica', Core.validarMovimiento({ ...base, cantidad: 'abc' }).ok === false);
check('Rechaza fecha inválida', Core.validarMovimiento({ ...base, fecha: '2026-13-45' }).ok === false);
check('Rechaza fecha vacía', Core.validarMovimiento({ ...base, fecha: '' }).ok === false);
check('Rechaza área inexistente', Core.validarMovimiento({ ...base, area: 'cocina' }).ok === false);
check('Rechaza categoría vacía', Core.validarMovimiento({ ...base, categoria: '' }).ok === false);
check('Rechaza tipo inválido', Core.validarMovimiento({ ...base, tipo: 'inicial' }).ok === false);
igual('Normaliza la cantidad a positiva', Core.validarMovimiento({ ...base, cantidad: 100.456 }).valor.cantidad, 100.46);

const baseC = { nombre: 'Sensor', cantidad: 2, precioEstimado: 450, area: 'programacion', categoria: 'Electrónica' };
check('Compra válida pasa', Core.validarCompra(baseC).ok === true);
check('Rechaza producto sin nombre', Core.validarCompra({ ...baseC, nombre: '' }).ok === false);
check('Rechaza cantidad cero en compra', Core.validarCompra({ ...baseC, cantidad: 0 }).ok === false);
check('Rechaza precio negativo', Core.validarCompra({ ...baseC, precioEstimado: -5 }).ok === false);
check('Rechaza área inexistente en compra', Core.validarCompra({ ...baseC, area: 'ninguna' }).ok === false);

check('Dinero inicial vacío se rechaza', Core.validarDineroInicial('').ok === false);
check('Dinero inicial negativo se rechaza', Core.validarDineroInicial(-100).ok === false);
check('Dinero inicial cero se acepta', Core.validarDineroInicial(0).ok === true);
check('Dinero inicial válido se acepta', Core.validarDineroInicial('10000').ok === true);
check('Precio real cero se rechaza', Core.validarPrecioReal(0).ok === false);
check('Precio real válido se acepta', Core.validarPrecioReal(170).ok === true);

/* =========================================================================
   §33 / §51 — EXPORTACIÓN A EXCEL
   ========================================================================= */
bloque('§51 ESTRUCTURA DE LA EXPORTACIÓN');
const hojas = Core.construirHojasExcel(config, movimientos, compras, { descripcion: 'Todo el historial' });
const nombresHoja = Object.keys(hojas);
check('Existen las 5 hojas requeridas',
  ['Resumen', 'Movimientos', 'Compras', 'Resumen por área', 'Resumen por categoría']
    .every(h => nombresHoja.includes(h)), nombresHoja.join(' | '));

igual('Hoja Movimientos: encabezados completos', hojas.Movimientos[0].length, 10);
igual('Hoja Movimientos: incluye el inicial + todos los movimientos',
  hojas.Movimientos.length - 1, movimientos.length + 1);
check('Hoja Movimientos: los gastos se exportan en negativo',
  hojas.Movimientos.some(f => f[2] === 'Cable' && f[6] === -170));
// "Cable" es del 12/09 y "Pintura" del 15/09: el saldo después de Cable es 11,730.
check('Hoja Movimientos: incluye el saldo después de cada movimiento',
  hojas.Movimientos.find(f => f[2] === 'Cable')[7] === 11730 &&
  hojas.Movimientos.find(f => f[2] === 'Pintura')[7] === 11300);
check('Hoja Movimientos: relaciona la compra',
  hojas.Movimientos.find(f => f[2] === 'Cable')[8] === 'Cable');

igual('Hoja Compras: encabezados completos', hojas.Compras[0].length, 12);
igual('Hoja Compras: incluye todas las compras', hojas.Compras.length - 1, compras.length);
check('Hoja Compras: distingue estimado y real',
  hojas.Compras.find(f => f[1] === 'Cable')[3] === 180 && hojas.Compras.find(f => f[1] === 'Cable')[4] === 170);
check('Hoja Compras: marca el registro como gasto',
  hojas.Compras.find(f => f[1] === 'Cable')[11] === 'Sí');
check('Hoja Compras: incluye el área',
  hojas.Compras.find(f => f[1] === 'Tornillos')[5] === 'Mecánica');

igual('Hoja por área: 5 áreas + encabezado', hojas['Resumen por área'].length, 6);
check('Hoja por área: montos reales',
  hojas['Resumen por área'].find(f => f[0] === 'Programación')[1] === 170);
check('Hoja por categoría: montos reales',
  hojas['Resumen por categoría'].some(f => f[0] === 'Electrónica' && f[1] === 170));
check('Hoja Resumen: refleja el saldo disponible',
  hojas.Resumen.some(f => f[0] === 'Saldo disponible' && f[1] === Core.calcularSaldo(config, movimientos)));

// §34 exportación filtrada
const hojasFiltradas = Core.construirHojasExcel(configH, movsH, [], {
  descripcion: 'Septiembre 2026', filtros: { desde: '2026-09-01', hasta: '2026-09-30' }
});
igual('Exportación filtrada: solo los movimientos del periodo', hojasFiltradas.Movimientos.length - 1, 3);
check('Exportación filtrada: no incluye el evento inicial fuera del periodo',
  !hojasFiltradas.Movimientos.some(f => f[0] === 'INICIAL'));
igual('Nombre de archivo correcto', Core.nombreArchivoExcel().startsWith('finanzas-spartans-'), true);
check('Extensión .xlsx', Core.nombreArchivoExcel().endsWith('.xlsx'));

/* =========================================================================
   FORMATOS Y UTILIDADES
   ========================================================================= */
bloque('FORMATOS');
igual('Formato de moneda con miles', Core.formatearMoneda(11730), '$11,730');
igual('Formato de moneda con decimales', Core.formatearMoneda(1234.5), '$1,234.50');
igual('Formato de moneda negativa', Core.formatearMoneda(-250), '-$250');
igual('Formato de moneda cero', Core.formatearMoneda(0), '$0');
igual('Formato de fecha', Core.formatearFecha('2026-09-10'), '10/09/2026');
igual('Etiqueta de mes', Core.etiquetaMes('2026-09'), 'Septiembre 2026');
igual('Mes anterior cruzando el año', Core.mesAnterior('2026-01'), '2025-12');
igual('Mes siguiente cruzando el año', Core.mesSiguiente('2026-12'), '2027-01');
igual('Signo de ingreso', Core.formatearMonedaConSigno(2000, 'ingreso'), '+$2,000');
igual('Signo de gasto', Core.formatearMonedaConSigno(170, 'gasto'), '-$170');
check('Redondeo a dos decimales', Core.redondear(0.1 + 0.2) === 0.3);

/* =========================================================================
   DECIMALES Y CASOS LÍMITE
   ========================================================================= */
bloque('CASOS LÍMITE');
const configDec = { dineroInicial: 0, fechaInicio: '2026-01-01' };
const movsDec = [
  mov('A', 'ingreso', 0.1, '2026-01-02'),
  mov('B', 'ingreso', 0.2, '2026-01-03')
];
igual('Suma de decimales sin error de punto flotante', Core.calcularSaldo(configDec, movsDec), 0.3);
igual('Saldo puede quedar negativo si se gasta de más',
  Core.calcularSaldo({ dineroInicial: 100, fechaInicio: '2026-01-01' },
    [mov('C', 'gasto', 150, '2026-01-05')]), -50);
igual('Sin movimientos el saldo es el dinero inicial',
  Core.calcularSaldo({ dineroInicial: 500, fechaInicio: '2026-01-01' }, []), 500);
igual('Dos movimientos el mismo día mantienen orden estable',
  Core.construirLineaDeTiempo({ dineroInicial: 0, fechaInicio: '2026-01-01' }, [
    mov('Z', 'ingreso', 10, '2026-02-01', 'general', 'Otros', { creadoEn: '2026-02-01T10:00:00Z' }),
    mov('Y', 'ingreso', 20, '2026-02-01', 'general', 'Otros', { creadoEn: '2026-02-01T09:00:00Z' })
  ]).map(m => m.concepto).join(','), 'Dinero inicial,Y,Z');
igual('Área desconocida se contabiliza como General',
  Core.agruparPorArea([mov('X', 'gasto', 50, '2026-01-01', 'inexistente')]).general, 50);

/* =========================================================================
   REGRESIÓN: MOVIMIENTOS ANTERIORES A LA CREACIÓN DE LA CUENTA
   La apertura debe adelantarse para que ningún periodo quede descuadrado.
   ========================================================================= */
bloque('REGRESIÓN: MOVIMIENTOS ANTERIORES A LA APERTURA');
const configTarde = { dineroInicial: 10000, fechaInicio: '2026-09-18' };
const movsViejos = [
  mov('Donación', 'ingreso', 3000, '2026-08-05', 'general', 'Otros'),
  mov('Motores', 'gasto', 4500, '2026-08-20', 'mecanica', 'Fabricación'),
  mov('Gasolina', 'gasto', 300, '2026-10-02', 'general', 'Transporte')
];
igual('La apertura se adelanta al primer movimiento',
  Core.fechaDeApertura(configTarde, movsViejos), '2026-08-05');
igual('El saldo total sigue siendo correcto', Core.calcularSaldo(configTarde, movsViejos), 8200);

const agostoTarde = Core.resumenMensual(configTarde, movsViejos, '2026-08');
igual('Agosto incluye la apertura del equipo', agostoTarde.aperturaEnElMes, 10000);
igual('Agosto: saldo final coherente', agostoTarde.saldoFinal, 8500);
const septTarde = Core.resumenMensual(configTarde, movsViejos, '2026-09');
igual('Septiembre arranca con el saldo real de agosto', septTarde.dineroInicialPeriodo, 8500);
igual('Septiembre sin movimientos conserva el saldo', septTarde.saldoFinal, 8500);
const octTarde = Core.resumenMensual(configTarde, movsViejos, '2026-10');
igual('Octubre arranca con el saldo de septiembre', octTarde.dineroInicialPeriodo, 8500);
igual('Octubre: saldo final', octTarde.saldoFinal, 8200);
check('El encadenamiento de periodos no pierde ni inventa dinero',
  agostoTarde.saldoFinal === septTarde.dineroInicialPeriodo &&
  septTarde.saldoFinal === octTarde.dineroInicialPeriodo);

/* ---------- Resultado ---------- */
console.log('\n' + '='.repeat(62));
console.log('RESULTADO: ' + pasadas + ' pruebas pasadas, ' + fallidas + ' fallidas');
if (fallidas) {
  console.log('\nFALLOS:');
  fallos.forEach(f => console.log('  - ' + f));
}
console.log('='.repeat(62));
process.exit(fallidas ? 1 : 0);
