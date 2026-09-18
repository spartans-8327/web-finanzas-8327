/* =========================================================================
   MIS FINANZAS — SPARTANS 83-27
   core.js — Lógica pura del sistema financiero.

   Este archivo NO toca el DOM ni la red. Solo recibe datos y devuelve datos.
   Eso permite probarlo automáticamente con Node (ver tests/core.test.js) y
   reutilizarlo tanto en la vista pública como en la vista autenticada.
   ========================================================================= */
(function (raiz) {
  'use strict';

  /* ------------------------------------------------------------------
     CATÁLOGOS
     ------------------------------------------------------------------ */

  var AREAS = [
    { id: 'mecanica',     nombre: 'Mecánica',     icono: '⚙',  color: '#EF3E4A' },
    { id: 'programacion', nombre: 'Programación', icono: '⌁',  color: '#37D4E8' },
    { id: 'diseno',       nombre: 'Diseño',       icono: '◈',  color: '#A78BFA' },
    { id: 'marketing',    nombre: 'Marketing',    icono: '◉',  color: '#F5B740' },
    { id: 'general',      nombre: 'General',      icono: '▣',  color: '#8A98AB' }
  ];

  // Las categorías son ampliables: el sistema acepta cualquier texto no vacío,
  // esta lista solo alimenta los selectores de la interfaz.
  var CATEGORIAS = [
    'Electrónica', 'Materiales', 'Fabricación', 'Herramientas',
    'Software / Servicios', 'Consumibles', 'Transporte', 'Alimentación',
    'Competencia / Eventos', 'Publicidad', 'Merchandising', 'Comunicación',
    'Mantenimiento', 'Otros'
  ];

  var TIPOS = ['ingreso', 'gasto'];

  var NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  function areaPorId(id) {
    for (var i = 0; i < AREAS.length; i++) {
      if (AREAS[i].id === id) return AREAS[i];
    }
    return AREAS[AREAS.length - 1]; // General como respaldo
  }

  function esAreaValida(id) {
    return AREAS.some(function (a) { return a.id === id; });
  }

  /* ------------------------------------------------------------------
     UTILIDADES DE FORMATO
     ------------------------------------------------------------------ */

  function redondear(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function formatearMoneda(valor) {
    var n = Number(valor) || 0;
    var signo = n < 0 ? '-' : '';
    var abs = Math.abs(redondear(n));
    var entero = Math.floor(abs);
    var decimales = Math.round((abs - entero) * 100);
    var texto = entero.toLocaleString('es-MX');
    if (decimales > 0) texto += '.' + (decimales < 10 ? '0' + decimales : decimales);
    return signo + '$' + texto;
  }

  function formatearMonedaConSigno(valor, tipo) {
    var base = formatearMoneda(Math.abs(Number(valor) || 0));
    if (tipo === 'gasto') return '-' + base;
    if (tipo === 'ingreso') return '+' + base;
    return base;
  }

  // 'YYYY-MM-DD' -> 'DD/MM/YYYY' sin depender de zonas horarias.
  function formatearFecha(fechaISO) {
    if (!fechaISO) return '';
    var p = String(fechaISO).slice(0, 10).split('-');
    if (p.length !== 3) return String(fechaISO);
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function fechaHoy() {
    var d = new Date();
    var mes = String(d.getMonth() + 1).padStart(2, '0');
    var dia = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + mes + '-' + dia;
  }

  function esFechaValida(fechaISO) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fechaISO || ''))) return false;
    var p = String(fechaISO).split('-');
    var y = Number(p[0]), m = Number(p[1]), d = Number(p[2]);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var prueba = new Date(Date.UTC(y, m - 1, d));
    return prueba.getUTCFullYear() === y && prueba.getUTCMonth() === m - 1 && prueba.getUTCDate() === d;
  }

  function claveMes(fechaISO) {
    return String(fechaISO || '').slice(0, 7); // 'YYYY-MM'
  }

  function etiquetaMes(clave) {
    var p = String(clave || '').split('-');
    if (p.length < 2) return '';
    return NOMBRES_MES[Number(p[1]) - 1] + ' ' + p[0];
  }

  function mesAnterior(clave) {
    var p = clave.split('-');
    var y = Number(p[0]), m = Number(p[1]) - 1;
    if (m < 1) { m = 12; y -= 1; }
    return y + '-' + String(m).padStart(2, '0');
  }

  function mesSiguiente(clave) {
    var p = clave.split('-');
    var y = Number(p[0]), m = Number(p[1]) + 1;
    if (m > 12) { m = 1; y += 1; }
    return y + '-' + String(m).padStart(2, '0');
  }

  function mesActual() {
    return fechaHoy().slice(0, 7);
  }

  /* ------------------------------------------------------------------
     LÍNEA DE TIEMPO Y SALDO

     El saldo NUNCA se almacena: siempre se reconstruye a partir del
     dinero inicial más el historial completo de movimientos. Editar o
     eliminar un movimiento recalcula automáticamente todos los saldos
     posteriores porque la línea de tiempo se vuelve a construir entera.
     ------------------------------------------------------------------ */

  /*
    Fecha del depósito inicial. Si el equipo registra movimientos con fecha
    anterior a la creación de la cuenta (por ejemplo al capturar gastos
    viejos), la apertura se adelanta hasta el primer movimiento: el saldo
    siempre parte del dinero inicial y ningún periodo queda descuadrado.
  */
  function fechaDeApertura(config, movimientos) {
    var fecha = (config && config.fechaInicio) || fechaHoy();
    (movimientos || []).forEach(function (m) {
      if (m.fecha && m.fecha < fecha) fecha = m.fecha;
    });
    return fecha;
  }

  // Ordena por fecha y, a igualdad de fecha, por fecha de creación e id
  // para que el orden sea estable y reproducible en cualquier dispositivo.
  function ordenarMovimientos(movimientos) {
    return movimientos.slice().sort(function (a, b) {
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
      var ca = a.creadoEn || '', cb = b.creadoEn || '';
      if (ca !== cb) return ca < cb ? -1 : 1;
      return String(a.id) < String(b.id) ? -1 : 1;
    });
  }

  // Devuelve todos los eventos financieros (incluido el depósito inicial,
  // que es un evento sintético derivado de la configuración) con el saldo
  // resultante después de cada uno.
  function construirLineaDeTiempo(config, movimientos) {
    var eventos = [];
    var inicial = Number((config && config.dineroInicial) || 0);
    eventos.push({
      id: '__inicial__',
      esInicial: true,
      concepto: 'Dinero inicial',
      tipo: 'inicial',
      cantidad: inicial,
      fecha: fechaDeApertura(config, movimientos),
      area: 'general',
      categoria: 'Otros',
      notas: '',
      compraId: null
    });
    ordenarMovimientos(movimientos || []).forEach(function (m) { eventos.push(m); });

    var saldo = 0;
    return eventos.map(function (ev) {
      if (ev.tipo === 'inicial') saldo += Number(ev.cantidad) || 0;
      else if (ev.tipo === 'ingreso') saldo += Number(ev.cantidad) || 0;
      else saldo -= Number(ev.cantidad) || 0;
      saldo = redondear(saldo);
      var copia = {};
      for (var k in ev) if (Object.prototype.hasOwnProperty.call(ev, k)) copia[k] = ev[k];
      copia.saldoDespues = saldo;
      return copia;
    });
  }

  function calcularSaldo(config, movimientos) {
    var linea = construirLineaDeTiempo(config, movimientos);
    return linea.length ? linea[linea.length - 1].saldoDespues : 0;
  }

  function calcularResumen(config, movimientos) {
    var lista = movimientos || [];
    var ingresos = 0, gastos = 0;
    lista.forEach(function (m) {
      if (m.tipo === 'ingreso') ingresos += Number(m.cantidad) || 0;
      else if (m.tipo === 'gasto') gastos += Number(m.cantidad) || 0;
    });
    var inicial = Number((config && config.dineroInicial) || 0);
    return {
      inicial: redondear(inicial),
      ingresos: redondear(ingresos),
      gastos: redondear(gastos),
      disponible: redondear(inicial + ingresos - gastos)
    };
  }

  /* ------------------------------------------------------------------
     RESÚMENES POR PERIODO
     ------------------------------------------------------------------ */

  // Lista de meses con actividad (incluye el mes del dinero inicial y el
  // mes en curso) ordenada cronológicamente.
  function listarMeses(config, movimientos) {
    var set = {};
    if (config) set[claveMes(fechaDeApertura(config, movimientos))] = true;
    (movimientos || []).forEach(function (m) { set[claveMes(m.fecha)] = true; });
    set[mesActual()] = true;
    return Object.keys(set).sort();
  }

  function agruparPorArea(movimientos) {
    var mapa = {};
    AREAS.forEach(function (a) { mapa[a.id] = 0; });
    (movimientos || []).forEach(function (m) {
      if (m.tipo !== 'gasto') return;
      var area = esAreaValida(m.area) ? m.area : 'general';
      mapa[area] = redondear((mapa[area] || 0) + (Number(m.cantidad) || 0));
    });
    return mapa;
  }

  function agruparPorCategoria(movimientos, tipo) {
    var mapa = {};
    (movimientos || []).forEach(function (m) {
      if (m.tipo !== (tipo || 'gasto')) return;
      var cat = (m.categoria || 'Otros').trim() || 'Otros';
      mapa[cat] = redondear((mapa[cat] || 0) + (Number(m.cantidad) || 0));
    });
    return mapa;
  }

  // Convierte un mapa {clave: monto} en una lista ordenada de mayor a menor.
  function mapaAListaOrdenada(mapa) {
    return Object.keys(mapa)
      .map(function (k) { return { clave: k, monto: mapa[k] }; })
      .filter(function (x) { return x.monto > 0; })
      .sort(function (a, b) { return b.monto - a.monto; });
  }

  /*
    Resumen de un mes concreto.

    "Dinero inicial del periodo" = saldo existente justo antes del primer
    evento del mes. Para un mes posterior equivale al saldo final del mes
    anterior; nunca se inventa un valor.
  */
  function resumenMensual(config, movimientos, clave) {
    var linea = construirLineaDeTiempo(config, movimientos);
    var antes = linea.filter(function (e) { return claveMes(e.fecha) < clave; });
    var dentro = linea.filter(function (e) { return claveMes(e.fecha) === clave; });

    var saldoInicialPeriodo = antes.length ? antes[antes.length - 1].saldoDespues : 0;
    var saldoFinal = dentro.length ? dentro[dentro.length - 1].saldoDespues : saldoInicialPeriodo;

    var reales = dentro.filter(function (e) { return !e.esInicial; });
    var ingresos = 0, gastos = 0, numIngresos = 0, numGastos = 0;
    reales.forEach(function (m) {
      if (m.tipo === 'ingreso') { ingresos += Number(m.cantidad) || 0; numIngresos++; }
      else if (m.tipo === 'gasto') { gastos += Number(m.cantidad) || 0; numGastos++; }
    });

    var aperturaEnElMes = dentro.some(function (e) { return e.esInicial; })
      ? Number((config && config.dineroInicial) || 0) : 0;

    return {
      clave: clave,
      etiqueta: etiquetaMes(clave),
      dineroInicialPeriodo: redondear(saldoInicialPeriodo),
      aperturaEnElMes: redondear(aperturaEnElMes),
      ingresos: redondear(ingresos),
      gastos: redondear(gastos),
      saldoFinal: redondear(saldoFinal),
      numMovimientos: reales.length,
      numIngresos: numIngresos,
      numGastos: numGastos,
      movimientos: dentro,           // incluye el evento inicial si cae en el mes
      porArea: agruparPorArea(reales),
      porCategoria: agruparPorCategoria(reales, 'gasto'),
      sinMovimientos: reales.length === 0
    };
  }

  // Resumen financiero de un área concreta (presupuesto informativo del área).
  function resumenArea(config, movimientos, compras, areaId) {
    var movsArea = (movimientos || []).filter(function (m) { return (m.area || 'general') === areaId; });
    var comprasArea = (compras || []).filter(function (c) { return (c.area || 'general') === areaId; });
    var ingresos = 0, gastos = 0;
    movsArea.forEach(function (m) {
      if (m.tipo === 'ingreso') ingresos += Number(m.cantidad) || 0;
      else if (m.tipo === 'gasto') gastos += Number(m.cantidad) || 0;
    });
    return {
      area: areaPorId(areaId),
      ingresos: redondear(ingresos),
      gastos: redondear(gastos),
      balance: redondear(ingresos - gastos),
      movimientos: movsArea,
      compras: comprasArea,
      resumenCompras: resumenCompras(comprasArea),
      porCategoria: agruparPorCategoria(movsArea, 'gasto')
    };
  }

  /* ------------------------------------------------------------------
     COMPRAS
     ------------------------------------------------------------------ */

  /*
    Los precios estimado y real son montos TOTALES de la línea, no precios
    por unidad: lo que el usuario confirma al registrar el gasto es
    exactamente lo que se resta del saldo (§45). La cantidad es informativa
    ("3 unidades de cable por $180").
  */
  function montoProducto(p) {
    var valor = (p.precioReal !== null && p.precioReal !== undefined && p.precioReal !== '')
      ? Number(p.precioReal) : Number(p.precioEstimado) || 0;
    return redondear(valor);
  }

  function montoEstimado(p) {
    return redondear(Number(p.precioEstimado) || 0);
  }

  function resumenCompras(compras) {
    var lista = compras || [];
    var pendientes = 0, compradas = 0, realGastado = 0, numPendientes = 0, numCompradas = 0, numRegistradas = 0;
    lista.forEach(function (p) {
      if (p.estado === 'comprado') {
        compradas += montoProducto(p);
        numCompradas++;
        if (p.precioReal !== null && p.precioReal !== undefined && p.precioReal !== '') {
          realGastado += redondear(Number(p.precioReal));
        }
      } else {
        pendientes += montoEstimado(p);
        numPendientes++;
      }
      if (p.registradoComoGasto) numRegistradas++;
    });
    return {
      pendientes: redondear(pendientes),
      compradas: redondear(compradas),
      totalEstimado: redondear(pendientes + compradas),
      totalReal: redondear(realGastado),
      numPendientes: numPendientes,
      numCompradas: numCompradas,
      numRegistradas: numRegistradas,
      total: lista.length
    };
  }

  /* ------------------------------------------------------------------
     FILTROS
     ------------------------------------------------------------------ */

  function filtrarMovimientos(lista, filtros) {
    var f = filtros || {};
    return (lista || []).filter(function (m) {
      if (f.tipo && f.tipo !== 'todos' && m.tipo !== f.tipo) return false;
      if (f.area && f.area !== 'todas' && (m.area || 'general') !== f.area) return false;
      if (f.categoria && f.categoria !== 'todas' && (m.categoria || '') !== f.categoria) return false;
      if (f.desde && m.fecha < f.desde) return false;
      if (f.hasta && m.fecha > f.hasta) return false;
      if (f.texto) {
        var t = f.texto.toLowerCase();
        var campos = [m.concepto, m.categoria, m.notas].join(' ').toLowerCase();
        if (campos.indexOf(t) === -1) return false;
      }
      return true;
    });
  }

  function filtrarCompras(lista, filtros) {
    var f = filtros || {};
    return (lista || []).filter(function (p) {
      if (f.area && f.area !== 'todas' && (p.area || 'general') !== f.area) return false;
      if (f.estado && f.estado !== 'todos') {
        if (f.estado === 'registrado') { if (!p.registradoComoGasto) return false; }
        else if (p.estado !== f.estado) return false;
      }
      if (f.categoria && f.categoria !== 'todas' && (p.categoria || '') !== f.categoria) return false;
      if (f.texto) {
        var t = f.texto.toLowerCase();
        if ((p.nombre || '').toLowerCase().indexOf(t) === -1) return false;
      }
      return true;
    });
  }

  /* ------------------------------------------------------------------
     VALIDACIONES
     Nunca fallar en silencio: cada validación devuelve un mensaje claro.
     ------------------------------------------------------------------ */

  function validarDineroInicial(valor) {
    if (valor === '' || valor === null || valor === undefined) {
      return { ok: false, mensaje: 'Escribe con cuánto dinero comienza el equipo.' };
    }
    var n = Number(valor);
    if (!isFinite(n)) return { ok: false, mensaje: 'La cantidad debe ser un número válido.' };
    if (n < 0) return { ok: false, mensaje: 'El dinero inicial no puede ser negativo.' };
    return { ok: true, valor: redondear(n) };
  }

  function validarMovimiento(datos) {
    var d = datos || {};
    var concepto = String(d.concepto || '').trim();
    if (!concepto) return { ok: false, campo: 'concepto', mensaje: 'Escribe un concepto para el movimiento.' };
    if (TIPOS.indexOf(d.tipo) === -1) return { ok: false, campo: 'tipo', mensaje: 'Selecciona si es un ingreso o un gasto.' };

    if (d.cantidad === '' || d.cantidad === null || d.cantidad === undefined) {
      return { ok: false, campo: 'cantidad', mensaje: 'Escribe la cantidad del movimiento.' };
    }
    var cantidad = Number(d.cantidad);
    if (!isFinite(cantidad)) return { ok: false, campo: 'cantidad', mensaje: 'La cantidad debe ser un número válido.' };
    if (cantidad <= 0) return { ok: false, campo: 'cantidad', mensaje: 'La cantidad debe ser mayor que cero.' };

    if (!esFechaValida(d.fecha)) return { ok: false, campo: 'fecha', mensaje: 'Selecciona una fecha válida.' };
    if (!esAreaValida(d.area)) return { ok: false, campo: 'area', mensaje: 'Selecciona un área del equipo.' };

    var categoria = String(d.categoria || '').trim();
    if (!categoria) return { ok: false, campo: 'categoria', mensaje: 'Selecciona una categoría.' };

    return {
      ok: true,
      valor: {
        concepto: concepto,
        tipo: d.tipo,
        cantidad: redondear(Math.abs(cantidad)),
        fecha: d.fecha,
        area: d.area,
        categoria: categoria,
        notas: String(d.notas || '').trim()
      }
    };
  }

  function validarCompra(datos) {
    var d = datos || {};
    var nombre = String(d.nombre || '').trim();
    if (!nombre) return { ok: false, campo: 'nombre', mensaje: 'Escribe qué necesita el equipo.' };

    var cantidad = Number(d.cantidad);
    if (!isFinite(cantidad) || cantidad <= 0) {
      return { ok: false, campo: 'cantidad', mensaje: 'La cantidad debe ser un número mayor que cero.' };
    }

    if (d.precioEstimado === '' || d.precioEstimado === null || d.precioEstimado === undefined) {
      return { ok: false, campo: 'precioEstimado', mensaje: 'Escribe el precio estimado por unidad.' };
    }
    var precio = Number(d.precioEstimado);
    if (!isFinite(precio)) return { ok: false, campo: 'precioEstimado', mensaje: 'El precio debe ser un número válido.' };
    if (precio < 0) return { ok: false, campo: 'precioEstimado', mensaje: 'El precio no puede ser negativo.' };

    if (!esAreaValida(d.area)) return { ok: false, campo: 'area', mensaje: 'Selecciona el área a la que pertenece.' };
    var categoria = String(d.categoria || '').trim();
    if (!categoria) return { ok: false, campo: 'categoria', mensaje: 'Selecciona una categoría.' };

    return {
      ok: true,
      valor: {
        nombre: nombre,
        cantidad: Math.round(cantidad),
        precioEstimado: redondear(precio),
        area: d.area,
        categoria: categoria,
        notas: String(d.notas || '').trim()
      }
    };
  }

  function validarPrecioReal(valor) {
    if (valor === '' || valor === null || valor === undefined) {
      return { ok: false, mensaje: 'Escribe el precio real de la compra.' };
    }
    var n = Number(valor);
    if (!isFinite(n)) return { ok: false, mensaje: 'El precio debe ser un número válido.' };
    if (n <= 0) return { ok: false, mensaje: 'El precio debe ser mayor que cero.' };
    return { ok: true, valor: redondear(n) };
  }

  /* ------------------------------------------------------------------
     EXPORTACIÓN

     Genera las filas de las 5 hojas del Excel a partir de los datos
     reales. La escritura del archivo la hace SheetJS en script.js.
     ------------------------------------------------------------------ */

  function construirHojasExcel(config, movimientos, compras, opciones) {
    var o = opciones || {};
    var linea = construirLineaDeTiempo(config, movimientos);

    // El filtro se aplica sobre la línea de tiempo completa para conservar
    // el saldo real acumulado de cada movimiento.
    var movsFiltrados = linea.filter(function (e) {
      if (e.esInicial) return !o.filtros || !tieneFiltrosActivos(o.filtros);
      if (!o.filtros) return true;
      return filtrarMovimientos([e], o.filtros).length === 1;
    });

    var comprasFiltradas = (compras || []).filter(function (p) {
      if (!o.filtros || !o.filtros.area || o.filtros.area === 'todas') return true;
      return (p.area || 'general') === o.filtros.area;
    });

    var resumen = calcularResumen(config, movimientos);
    var movsReales = movsFiltrados.filter(function (m) { return !m.esInicial; });

    var hojaResumen = [
      ['MIS FINANZAS — SPARTANS 83-27'],
      ['Equipo', (config && config.nombreEquipo) || 'Spartans 83-27'],
      ['Fecha de exportación', fechaHoy()],
      ['Alcance de la exportación', o.descripcion || 'Todo el historial'],
      [],
      ['Dinero inicial', resumen.inicial],
      ['Ingresos totales', resumen.ingresos],
      ['Gastos totales', resumen.gastos],
      ['Saldo disponible', resumen.disponible],
      [],
      ['Movimientos exportados', movsReales.length],
      ['Compras exportadas', comprasFiltradas.length]
    ];

    var hojaMovimientos = [[
      'ID', 'Fecha', 'Concepto', 'Tipo', 'Área', 'Categoría',
      'Cantidad', 'Saldo después', 'Compra relacionada', 'Notas'
    ]];
    movsFiltrados.forEach(function (m) {
      var compraRel = '';
      if (m.compraId) {
        var c = (compras || []).filter(function (x) { return x.id === m.compraId; })[0];
        compraRel = c ? c.nombre : m.compraId;
      }
      hojaMovimientos.push([
        m.esInicial ? 'INICIAL' : m.id,
        m.fecha,
        m.concepto,
        m.tipo === 'inicial' ? 'Inicial' : (m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'),
        areaPorId(m.area).nombre,
        m.categoria || '',
        m.tipo === 'gasto' ? -Math.abs(m.cantidad) : Math.abs(m.cantidad),
        m.saldoDespues,
        compraRel,
        m.notas || ''
      ]);
    });

    var hojaCompras = [[
      'ID', 'Producto', 'Cantidad', 'Precio estimado', 'Precio real', 'Área',
      'Categoría', 'Estado', 'Fecha de creación', 'Fecha de compra',
      'Movimiento relacionado', 'Registrado como gasto'
    ]];
    comprasFiltradas.forEach(function (p) {
      hojaCompras.push([
        p.id,
        p.nombre,
        p.cantidad,
        Number(p.precioEstimado) || 0,
        (p.precioReal === null || p.precioReal === undefined || p.precioReal === '') ? '' : Number(p.precioReal),
        areaPorId(p.area).nombre,
        p.categoria || '',
        p.estado === 'comprado' ? 'Comprado' : 'Pendiente',
        (p.creadoEn || '').slice(0, 10),
        p.fechaCompra || '',
        p.movimientoId || '',
        p.registradoComoGasto ? 'Sí' : 'No'
      ]);
    });

    var porArea = agruparPorArea(movsReales);
    var hojaAreas = [['Área', 'Gastos', 'Ingresos', 'Balance', 'Compras registradas']];
    AREAS.forEach(function (a) {
      var ingresosArea = movsReales
        .filter(function (m) { return m.tipo === 'ingreso' && (m.area || 'general') === a.id; })
        .reduce(function (s, m) { return s + Number(m.cantidad); }, 0);
      var comprasArea = comprasFiltradas.filter(function (p) { return (p.area || 'general') === a.id; }).length;
      hojaAreas.push([
        a.nombre,
        redondear(porArea[a.id] || 0),
        redondear(ingresosArea),
        redondear(ingresosArea - (porArea[a.id] || 0)),
        comprasArea
      ]);
    });

    var porCategoria = agruparPorCategoria(movsReales, 'gasto');
    var hojaCategorias = [['Categoría', 'Total gastado']];
    mapaAListaOrdenada(porCategoria).forEach(function (x) {
      hojaCategorias.push([x.clave, x.monto]);
    });
    if (hojaCategorias.length === 1) hojaCategorias.push(['Sin gastos registrados', 0]);

    return {
      Resumen: hojaResumen,
      Movimientos: hojaMovimientos,
      Compras: hojaCompras,
      'Resumen por área': hojaAreas,
      'Resumen por categoría': hojaCategorias
    };
  }

  function tieneFiltrosActivos(f) {
    if (!f) return false;
    return (f.tipo && f.tipo !== 'todos') || (f.area && f.area !== 'todas') ||
      (f.categoria && f.categoria !== 'todas') || !!f.desde || !!f.hasta || !!f.texto;
  }

  function nombreArchivoExcel(sufijo) {
    return 'finanzas-spartans-' + (sufijo ? sufijo + '-' : '') + fechaHoy() + '.xlsx';
  }

  /* ------------------------------------------------------------------
     EXPORTACIÓN DEL MÓDULO
     ------------------------------------------------------------------ */

  var Core = {
    AREAS: AREAS,
    CATEGORIAS: CATEGORIAS,
    TIPOS: TIPOS,
    NOMBRES_MES: NOMBRES_MES,
    areaPorId: areaPorId,
    esAreaValida: esAreaValida,
    redondear: redondear,
    formatearMoneda: formatearMoneda,
    formatearMonedaConSigno: formatearMonedaConSigno,
    formatearFecha: formatearFecha,
    fechaHoy: fechaHoy,
    esFechaValida: esFechaValida,
    claveMes: claveMes,
    etiquetaMes: etiquetaMes,
    mesAnterior: mesAnterior,
    mesSiguiente: mesSiguiente,
    mesActual: mesActual,
    ordenarMovimientos: ordenarMovimientos,
    fechaDeApertura: fechaDeApertura,
    construirLineaDeTiempo: construirLineaDeTiempo,
    calcularSaldo: calcularSaldo,
    calcularResumen: calcularResumen,
    listarMeses: listarMeses,
    resumenMensual: resumenMensual,
    resumenArea: resumenArea,
    agruparPorArea: agruparPorArea,
    agruparPorCategoria: agruparPorCategoria,
    mapaAListaOrdenada: mapaAListaOrdenada,
    montoProducto: montoProducto,
    montoEstimado: montoEstimado,
    resumenCompras: resumenCompras,
    filtrarMovimientos: filtrarMovimientos,
    filtrarCompras: filtrarCompras,
    tieneFiltrosActivos: tieneFiltrosActivos,
    validarDineroInicial: validarDineroInicial,
    validarMovimiento: validarMovimiento,
    validarCompra: validarCompra,
    validarPrecioReal: validarPrecioReal,
    construirHojasExcel: construirHojasExcel,
    nombreArchivoExcel: nombreArchivoExcel
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else raiz.Core = Core;
})(typeof window !== 'undefined' ? window : this);
