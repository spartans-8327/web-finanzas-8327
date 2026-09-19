/* =========================================================================
   MIS FINANZAS — SPARTANS 83-27
   script.js — Interfaz, navegación y orquestación.

   Reglas del módulo:
     · El saldo nunca se escribe a mano: siempre sale de core.js.
     · Los datos financieros siempre vienen de data.js (Supabase).
     · localStorage solo guarda preferencias de interfaz (vista, filtros).
   ========================================================================= */
(function () {
  'use strict';

  var CLAVE_PREFS = 'spartans_prefs_ui';

  /* ==================================================================
     ESTADO EN MEMORIA
     ================================================================== */
  var estado = {
    config: null,
    movimientos: [],
    compras: [],
    vista: 'inicio',
    areaActiva: 'mecanica',
    mesActivo: Core.mesActual(),
    vistaHistorial: 'mensual',
    filtros: { tipo: 'todos', area: 'todas', categoria: 'todas', desde: '', hasta: '', texto: '' },
    filtrosCompras: { estado: 'todos', area: 'todas', categoria: 'todas', texto: '' },
    agruparCompras: true,
    pendiente: null,      // acción esperando confirmación
    compraEnGasto: null,  // compra en el flujo "registrar como gasto"
    cargando: false
  };

  /* ==================================================================
     UTILIDADES DE DOM
     ================================================================== */
  function el(id) { return document.getElementById(id); }
  function todos(sel, raiz) { return Array.prototype.slice.call((raiz || document).querySelectorAll(sel)); }

  function escapar(texto) {
    return String(texto === null || texto === undefined ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function mostrar(nodo, visible) { if (nodo) nodo.hidden = !visible; }

  function texto(id, valor) { var n = el(id); if (n) n.textContent = valor; }

  function html(id, valor) { var n = el(id); if (n) n.innerHTML = valor; }

  /* ---- Preferencias de interfaz (no son datos financieros) ---- */
  function leerPrefs() {
    try { return JSON.parse(localStorage.getItem(CLAVE_PREFS) || '{}'); }
    catch (e) { return {}; }
  }
  function guardarPrefs(cambios) {
    try {
      var p = leerPrefs();
      Object.keys(cambios).forEach(function (k) { p[k] = cambios[k]; });
      localStorage.setItem(CLAVE_PREFS, JSON.stringify(p));
    } catch (e) { /* modo privado: la app funciona igual */ }
  }

  /* ---- Toasts ---- */
  function toast(mensaje, tipo) {
    var cont = el('toasts');
    var t = document.createElement('div');
    t.className = 'toast ' + (tipo || 'info');
    var ico = tipo === 'error' ? '✕' : (tipo === 'exito' ? '✓' : 'ℹ');
    t.innerHTML = '<span class="toast-ico">' + ico + '</span><span>' + escapar(mensaje) + '</span>';
    cont.appendChild(t);
    setTimeout(function () {
      t.classList.add('saliendo');
      setTimeout(function () { t.remove(); }, 220);
    }, tipo === 'error' ? 5200 : 3200);
  }

  /* ---- Modales ---- */
  var modalAbierto = null;
  function abrirModal(id) {
    mostrar(el(id), true);
    modalAbierto = id;
    document.body.style.overflow = 'hidden';
    var primero = el(id).querySelector('input:not([type=hidden]), select, textarea');
    if (primero) setTimeout(function () { primero.focus(); }, 60);
  }
  function cerrarModal(id) {
    mostrar(el(id), false);
    if (modalAbierto === id) modalAbierto = null;
    if (!todos('.overlay:not([hidden])').length) document.body.style.overflow = '';
  }
  function cerrarTodosLosModales() {
    todos('.overlay').forEach(function (o) { o.hidden = true; });
    modalAbierto = null;
    document.body.style.overflow = '';
  }

  function mostrarError(id, mensaje) {
    var n = el(id);
    if (!n) return;
    if (mensaje) { n.textContent = mensaje; n.hidden = false; }
    else { n.textContent = ''; n.hidden = true; }
  }

  function ocupado(boton, activo, textoOcupado) {
    if (!boton) return;
    if (activo) {
      boton.dataset.textoOriginal = boton.dataset.textoOriginal || boton.textContent;
      boton.classList.add('cargando');
      boton.textContent = textoOcupado || 'Guardando…';
      boton.disabled = true;
    } else {
      boton.classList.remove('cargando');
      if (boton.dataset.textoOriginal) boton.textContent = boton.dataset.textoOriginal;
      boton.disabled = false;
    }
  }

  /* ==================================================================
     CARGA DE SESIÓN Y DATOS
     ================================================================== */

  async function inicializarApp() {
    try {
      await Datos.iniciar();
    } catch (e) {
      console.error(e);
    }

    configurarEventos();
    rellenarSelectores();
    aplicarPreferencias();

    // Sin Supabase la contraseña no se comprueba: hay que decirlo donde se
    // escribe, no solo en el aviso general de la parte superior.
    mostrar(el('avisoLoginLocal'), !Datos.configurado());

    Datos.alCambiarSesion(function () {
      aplicarModoAcceso();
      cargarDatos();
    });

    await cargarDatos();
    mostrarAvisoDeModo();
    vigilarCambiosRemotos();

    setTimeout(function () {
      var carga = el('pantallaCarga');
      carga.classList.add('fuera');
      setTimeout(function () { carga.remove(); }, 320);
    }, 240);
  }

  /*
    Experiencia multidispositivo: al volver a la pestaña se vuelven a leer
    los datos de Supabase, de modo que lo registrado desde el celular
    aparece en la computadora sin recargar la página a mano. Se limita a
    una consulta por minuto para no castigar la conexión.
  */
  function vigilarCambiosRemotos() {
    if (!Datos.configurado()) return;
    var ultimaRecarga = Date.now();
    var refrescar = function () {
      if (document.hidden || estado.cargando || modalAbierto) return;
      if (Date.now() - ultimaRecarga < 60000) return;
      ultimaRecarga = Date.now();
      cargarDatos();
    };
    document.addEventListener('visibilitychange', refrescar);
    window.addEventListener('focus', refrescar);
  }

  function mostrarAvisoDeModo() {
    if (leerPrefs().avisoCerrado === true && Datos.configurado()) return;
    if (!Datos.configurado()) {
      texto('avisoModoTexto',
        'Modo local de prueba: Supabase todavía no está configurado, así que los datos se guardan solo en este navegador y no se comparten entre dispositivos. Edita config.js con la URL y la clave anon de tu proyecto.');
      mostrar(el('avisoModo'), true);
    }
  }

  async function cargarDatos() {
    estado.cargando = true;
    try {
      var datos = await Datos.cargarTodo();
      estado.config = datos.config;
      estado.movimientos = datos.movimientos || [];
      estado.compras = datos.compras || [];
      estado.cargando = false;
      decidirPantalla();
    } catch (e) {
      estado.cargando = false;
      console.error(e);
      toast('No se pudieron cargar los datos: ' + e.message, 'error');
      decidirPantalla();
    }
  }

  // Decide qué pantalla corresponde: configuración inicial, aviso de
  // "sin información" para visitantes, o la aplicación completa.
  function decidirPantalla() {
    var hayConfig = !!estado.config;
    aplicarModoAcceso();

    mostrar(el('encabezado'), hayConfig);
    mostrar(el('app'), hayConfig);
    mostrar(el('pantallaInicio'), !hayConfig && Datos.autenticado());
    mostrar(el('pantallaSinDatos'), !hayConfig && !Datos.autenticado());
    mostrar(el('fabAccion'), hayConfig && Datos.autenticado());

    if (hayConfig) {
      ajustarMesActivo();
      renderizarTodo();
    }
  }

  // El mes mostrado debe existir dentro del rango con datos.
  function ajustarMesActivo() {
    var meses = Core.listarMeses(estado.config, estado.movimientos);
    if (meses.indexOf(estado.mesActivo) === -1) {
      estado.mesActivo = meses[meses.length - 1] || Core.mesActual();
    }
  }

  function aplicarModoAcceso() {
    var editor = Datos.autenticado();
    document.body.classList.toggle('editor', editor);

    var chip = el('chipSesion');
    chip.dataset.modo = editor ? 'autenticado' : 'publico';
    texto('chipSesionTexto', editor ? 'Sesión iniciada' : 'Modo consulta');
    chip.title = editor
      ? 'Sesión iniciada como ' + Datos.usuarioVisible()
      : 'Estás viendo la información pública del equipo';

    var btn = el('btnSesion');
    btn.textContent = editor ? 'Cerrar sesión' : 'Iniciar sesión';
    btn.classList.toggle('btn-primario', !editor);
    btn.classList.toggle('btn-ghost', editor);

    texto('pieEstado', editor
      ? 'Sesión: ' + Datos.usuarioVisible() + (Datos.configurado() ? '' : ' · modo local')
      : 'Consulta pública · solo lectura');
  }

  /* ==================================================================
     SELECTORES Y PREFERENCIAS
     ================================================================== */

  function opcionesAreas(incluirTodas, etiquetaTodas) {
    var salida = incluirTodas ? '<option value="todas">' + (etiquetaTodas || 'Todas las áreas') + '</option>' : '';
    Core.AREAS.forEach(function (a) {
      salida += '<option value="' + a.id + '">' + a.icono + '  ' + escapar(a.nombre) + '</option>';
    });
    return salida;
  }

  function opcionesCategorias(incluirTodas) {
    var usadas = {};
    Core.CATEGORIAS.forEach(function (c) { usadas[c] = true; });
    estado.movimientos.forEach(function (m) { if (m.categoria) usadas[m.categoria] = true; });
    estado.compras.forEach(function (c) { if (c.categoria) usadas[c.categoria] = true; });

    var lista = Object.keys(usadas).sort(function (a, b) { return a.localeCompare(b, 'es'); });
    var salida = incluirTodas ? '<option value="todas">Todas las categorías</option>' : '';
    lista.forEach(function (c) { salida += '<option value="' + escapar(c) + '">' + escapar(c) + '</option>'; });
    return salida;
  }

  function rellenarSelectores() {
    ['movimientoArea', 'productoArea', 'gastoArea'].forEach(function (id) {
      if (el(id)) el(id).innerHTML = opcionesAreas(false);
    });
    ['filtroArea', 'filtroAreaCompras', 'expArea'].forEach(function (id) {
      if (el(id)) el(id).innerHTML = opcionesAreas(true);
    });
    ['movimientoCategoria', 'productoCategoria', 'gastoCategoria'].forEach(function (id) {
      if (el(id)) el(id).innerHTML = opcionesCategorias(false);
    });
    ['filtroCategoria', 'filtroCategoriaCompras'].forEach(function (id) {
      if (el(id)) {
        var previo = el(id).value;
        el(id).innerHTML = opcionesCategorias(true);
        if (previo) el(id).value = previo;
      }
    });
  }

  function aplicarPreferencias() {
    var p = leerPrefs();
    if (p.vista) estado.vista = p.vista;
    if (p.areaActiva) estado.areaActiva = p.areaActiva;
    if (typeof p.agruparCompras === 'boolean') {
      estado.agruparCompras = p.agruparCompras;
      el('agruparPorArea').checked = p.agruparCompras;
    }
  }

  /* ==================================================================
     NAVEGACIÓN
     ================================================================== */

  function irA(vista, area) {
    estado.vista = vista;
    if (area) estado.areaActiva = area;
    guardarPrefs({ vista: vista, areaActiva: estado.areaActiva });

    todos('.nav-item').forEach(function (b) {
      var activo = b.dataset.vista === vista &&
        (vista !== 'area' || b.dataset.area === estado.areaActiva);
      b.classList.toggle('activo', activo);
      // En móvil la barra se desplaza: la sección activa siempre queda visible.
      if (activo && b.scrollIntoView) {
        b.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
      }
    });

    mostrar(el('vistaInicio'), vista === 'inicio');
    mostrar(el('vistaArea'), vista === 'area');
    mostrar(el('vistaCompras'), vista === 'compras');
    mostrar(el('vistaHistorial'), vista === 'historial');
    mostrar(el('vistaReportes'), vista === 'reportes');

    renderizarVistaActual();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ==================================================================
     RENDER PRINCIPAL
     ================================================================== */

  function renderizarTodo() {
    rellenarSelectores();
    actualizarResumen();
    actualizarInsignias();
    irA(estado.vista, estado.areaActiva);
  }

  function renderizarVistaActual() {
    switch (estado.vista) {
      case 'inicio':    renderizarInicio(); break;
      case 'area':      renderizarArea(); break;
      case 'compras':   renderizarCompras(); break;
      case 'historial': renderizarHistorial(); break;
      case 'reportes':  renderizarReportes(); break;
    }
  }

  function actualizarInsignias() {
    Core.AREAS.forEach(function (a) {
      var badge = document.querySelector('[data-badge="' + a.id + '"]');
      if (!badge) return;
      var n = estado.compras.filter(function (c) {
        return (c.area || 'general') === a.id && c.estado === 'pendiente';
      }).length;
      badge.textContent = n;
      badge.classList.toggle('visible', n > 0);
    });
    var badgeCompras = document.querySelector('[data-badge="compras"]');
    var pendientes = estado.compras.filter(function (c) { return c.estado === 'pendiente'; }).length;
    badgeCompras.textContent = pendientes;
    badgeCompras.classList.toggle('visible', pendientes > 0);
    badgeCompras.classList.toggle('alerta', pendientes > 0);
  }

  /* ---- Resumen global (saldo + cifras principales) ---- */
  function actualizarResumen() {
    var r = Core.calcularResumen(estado.config, estado.movimientos);

    var nodoSaldo = el('saldoDisponible');
    nodoSaldo.textContent = Core.formatearMoneda(r.disponible);
    nodoSaldo.classList.toggle('negativo', r.disponible < 0);
    texto('saldoNota', estado.movimientos.length
      ? 'Calculado con ' + estado.movimientos.length + ' movimiento' + (estado.movimientos.length === 1 ? '' : 's') + ' registrados'
      : 'Aún no hay movimientos registrados');

    texto('resumenInicial', Core.formatearMoneda(r.inicial));
    texto('resumenIngresos', '+' + Core.formatearMoneda(r.ingresos));
    texto('resumenGastos', '-' + Core.formatearMoneda(r.gastos));
    texto('resumenDisponible', Core.formatearMoneda(r.disponible));

    // Barra de proporción ingresos vs gastos
    var totalFlujo = r.ingresos + r.gastos;
    var pctIngreso = totalFlujo > 0 ? (r.ingresos / totalFlujo) * 100 : 0;
    el('barraProporcion').innerHTML = totalFlujo > 0
      ? '<span class="parte-ingreso" style="width:' + pctIngreso + '%"></span>' +
        '<span class="parte-gasto" style="width:' + (100 - pctIngreso) + '%"></span>'
      : '<span style="width:100%;background:var(--borde)"></span>';
    texto('notaProporcion', totalFlujo > 0
      ? Math.round(pctIngreso) + '% del flujo son ingresos · ' + Math.round(100 - pctIngreso) + '% gastos'
      : 'Sin flujo de dinero todavía');
  }

  /* ==================================================================
     VISTA: INICIO
     ================================================================== */

  function renderizarInicio() {
    var resMes = Core.resumenMensual(estado.config, estado.movimientos, Core.mesActual());
    var etiqueta = 'de ' + Core.etiquetaMes(Core.mesActual()).split(' ')[0].toLowerCase();
    texto('kpiPeriodo1', etiqueta);
    texto('kpiPeriodo2', etiqueta);

    texto('kpiIngresos', '+' + Core.formatearMoneda(resMes.ingresos));
    texto('kpiIngresosPie', resMes.numIngresos + ' movimiento' + (resMes.numIngresos === 1 ? '' : 's'));
    texto('kpiGastos', '-' + Core.formatearMoneda(resMes.gastos));
    texto('kpiGastosPie', resMes.numGastos + ' movimiento' + (resMes.numGastos === 1 ? '' : 's'));

    var balance = Core.redondear(resMes.ingresos - resMes.gastos);
    var nodoBal = el('kpiBalance');
    nodoBal.textContent = (balance > 0 ? '+' : '') + Core.formatearMoneda(balance);
    nodoBal.className = 'kpi-valor ' + (balance > 0 ? 'positivo' : (balance < 0 ? 'negativo' : ''));
    texto('kpiBalancePie', balance >= 0 ? 'El equipo ganó más de lo que gastó' : 'El equipo gastó más de lo que ingresó');

    var resC = Core.resumenCompras(estado.compras);
    texto('kpiPendientes', Core.formatearMoneda(resC.pendientes));
    texto('kpiPendientesPie', resC.numPendientes + ' producto' + (resC.numPendientes === 1 ? '' : 's') + ' por comprar');

    // Distribución por área (histórico)
    dibujarBarrasArea('graficoAreasInicio', Core.agruparPorArea(estado.movimientos));

    // Actividad reciente: últimos 6 eventos
    var linea = Core.construirLineaDeTiempo(estado.config, estado.movimientos);
    var recientes = linea.slice(-6).reverse();
    el('actividadReciente').innerHTML = recientes.length
      ? recientes.map(filaEvento).join('')
      : vacio('Sin movimientos', 'Registra el primer ingreso o gasto del equipo.');

    // Pendientes destacados
    var pendientes = estado.compras
      .filter(function (c) { return c.estado === 'pendiente'; })
      .sort(function (a, b) { return Core.montoEstimado(b) - Core.montoEstimado(a); })
      .slice(0, 4);
    el('pendientesInicio').innerHTML = pendientes.length
      ? pendientes.map(tarjetaCompra).join('')
      : vacio('Nada pendiente', 'La lista de compras del equipo está al día.');
  }

  function vacio(titulo, detalle) {
    return '<div class="vacio"><span class="vacio-ico">◌</span><b>' + escapar(titulo) + '</b>' +
      (detalle ? '<br>' + escapar(detalle) : '') + '</div>';
  }

  function filaEvento(m) {
    var area = Core.areaPorId(m.area);
    var clase = m.tipo === 'inicial' ? 'inicial' : m.tipo;
    var simbolo = m.tipo === 'inicial' ? '◆' : (m.tipo === 'ingreso' ? '↑' : '↓');
    var monto = m.tipo === 'inicial'
      ? Core.formatearMoneda(m.cantidad)
      : Core.formatearMonedaConSigno(m.cantidad, m.tipo);
    var claseMonto = m.tipo === 'ingreso' ? 'positivo' : (m.tipo === 'gasto' ? 'negativo' : '');

    return '<div class="evento" data-detalle="' + escapar(m.id) + '">' +
      '<div class="evento-ico ' + clase + '">' + simbolo + '</div>' +
      '<div class="evento-cuerpo">' +
        '<p class="evento-titulo">' + escapar(m.concepto) + '</p>' +
        '<div class="evento-meta">' +
          '<span class="etiqueta-area"><i style="background:' + area.color + '"></i>' + escapar(area.nombre) + '</span>' +
          '<span class="etiqueta-simple">' + escapar(m.categoria || '') + '</span>' +
          '<span class="etiqueta-simple">' + Core.formatearFecha(m.fecha) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="evento-monto ' + claseMonto + '">' + monto +
        '<span class="evento-saldo">saldo ' + Core.formatearMoneda(m.saldoDespues) + '</span>' +
      '</div>' +
    '</div>';
  }

  /* ---- Gráfico de barras horizontales ---- */
  function dibujarBarrasArea(contenedorId, mapaAreas) {
    var items = Core.AREAS.map(function (a) {
      return { nombre: a.nombre, monto: mapaAreas[a.id] || 0, color: a.color, icono: a.icono };
    }).filter(function (x) { return x.monto > 0; })
      .sort(function (a, b) { return b.monto - a.monto; });
    dibujarBarras(contenedorId, items, 'Sin gastos registrados todavía');
  }

  function dibujarBarras(contenedorId, items, mensajeVacio) {
    var cont = el(contenedorId);
    if (!cont) return;
    if (!items.length) { cont.innerHTML = vacio(mensajeVacio || 'Sin datos', ''); return; }

    var total = items.reduce(function (s, x) { return s + x.monto; }, 0);
    var maximo = Math.max.apply(null, items.map(function (x) { return x.monto; }));

    cont.innerHTML = items.map(function (x) {
      var ancho = maximo > 0 ? (x.monto / maximo) * 100 : 0;
      var pct = total > 0 ? Math.round((x.monto / total) * 100) : 0;
      var color = x.color || 'var(--cian)';
      return '<div class="barra-item">' +
        '<div class="barra-cabecera">' +
          '<span class="barra-nombre">' +
            (x.icono ? '<i style="color:' + color + ';font-style:normal">' + x.icono + '</i>' : '') +
            '<span>' + escapar(x.nombre) + '</span></span>' +
          '<span class="barra-monto">' + Core.formatearMoneda(x.monto) +
            ' <span class="barra-pct">' + pct + '%</span></span>' +
        '</div>' +
        '<div class="barra-pista"><div class="barra-relleno" style="width:' + ancho + '%;background:' + color + '"></div></div>' +
      '</div>';
    }).join('');
  }

  /* ==================================================================
     VISTA: ÁREA
     ================================================================== */

  var DESCRIPCIONES_AREA = {
    mecanica: 'Chasis, motores, engranes, tornillería, ruedas, piezas impresas, mecanismos y herramienta.',
    programacion: 'Sensores, microcontroladores, cableado, módulos electrónicos, equipo de cómputo y servicios digitales.',
    diseno: 'Impresión, prototipos, materiales visuales, vinil, pintura, diseño 3D y fotografía.',
    marketing: 'Publicidad, lonas, playeras, stickers, merchandising, eventos y difusión del equipo.',
    general: 'Gastos que pertenecen al equipo completo y no a un área en particular.'
  };

  function renderizarArea() {
    var areaId = estado.areaActiva;
    var res = Core.resumenArea(estado.config, estado.movimientos, estado.compras, areaId);
    var area = res.area;

    var cab = el('areaCabecera');
    cab.style.setProperty('--area', area.color);
    texto('areaIcono', area.icono);
    el('areaIcono').style.color = area.color;
    texto('areaNombre', area.nombre);
    texto('areaKicker', 'Área del equipo');
    texto('areaDescripcion', DESCRIPCIONES_AREA[areaId] || '');

    texto('areaGastos', '-' + Core.formatearMoneda(res.gastos));
    texto('areaIngresos', '+' + Core.formatearMoneda(res.ingresos));
    var nodoBal = el('areaBalance');
    nodoBal.textContent = (res.balance > 0 ? '+' : '') + Core.formatearMoneda(res.balance);
    nodoBal.className = 'mini-valor ' + (res.balance > 0 ? 'positivo' : (res.balance < 0 ? 'negativo' : ''));

    var rc = res.resumenCompras;
    texto('areaPendientesMonto', Core.formatearMoneda(rc.pendientes));
    texto('areaPendientesNum', rc.numPendientes + ' producto' + (rc.numPendientes === 1 ? '' : 's'));
    texto('areaCompradoMonto', Core.formatearMoneda(rc.compradas));
    texto('areaCompradoNum', rc.numCompradas + ' producto' + (rc.numCompradas === 1 ? '' : 's'));

    var gastoTotal = Core.calcularResumen(estado.config, estado.movimientos).gastos;
    var pct = gastoTotal > 0 ? Math.round((res.gastos / gastoTotal) * 100) : 0;
    texto('areaPorcentaje', pct + '%');

    // Categorías del área
    var items = Core.mapaAListaOrdenada(res.porCategoria).map(function (x) {
      return { nombre: x.clave, monto: x.monto, color: area.color };
    });
    dibujarBarras('areaCategorias', items, 'Esta área todavía no registra gastos');

    // Movimientos del área
    var linea = Core.construirLineaDeTiempo(estado.config, estado.movimientos)
      .filter(function (m) { return !m.esInicial && (m.area || 'general') === areaId; })
      .reverse().slice(0, 8);
    texto('areaNumMovimientos', res.movimientos.length + ' en total');
    el('areaMovimientos').innerHTML = linea.length
      ? linea.map(filaEvento).join('')
      : vacio('Sin movimientos', 'Aún no hay ingresos ni gastos en esta área.');

    // Compras del área
    el('areaCompras').innerHTML = res.compras.length
      ? res.compras.slice().sort(ordenarCompras).map(tarjetaCompra).join('')
      : vacio('Sin productos', 'Agrega lo que necesita esta área del equipo.');
  }

  /* ==================================================================
     VISTA: COMPRAS
     ================================================================== */

  function ordenarCompras(a, b) {
    // Pendientes primero, luego por monto descendente.
    if (a.estado !== b.estado) return a.estado === 'pendiente' ? -1 : 1;
    return Core.montoProducto(b) - Core.montoProducto(a);
  }

  function renderizarCompras() {
    var res = Core.resumenCompras(estado.compras);
    texto('comprasPendientes', Core.formatearMoneda(res.pendientes));
    texto('comprasPendientesNum', res.numPendientes === 1 ? '1 producto por comprar'
      : res.numPendientes + ' productos por comprar');
    texto('comprasCompradas', Core.formatearMoneda(res.compradas));
    texto('comprasCompradasNum', res.numCompradas === 1 ? '1 producto comprado'
      : res.numCompradas + ' productos comprados');
    texto('comprasTotal', Core.formatearMoneda(res.totalEstimado));
    texto('comprasRegistradasNum', res.numRegistradas === 1 ? '1 registrada como gasto'
      : res.numRegistradas + ' registradas como gasto');

    var lista = Core.filtrarCompras(estado.compras, estado.filtrosCompras).sort(ordenarCompras);
    var cont = el('contenedorCompras');

    if (!lista.length) {
      cont.innerHTML = '<div class="panel">' +
        vacio(estado.compras.length ? 'Sin resultados' : 'La lista de compras está vacía',
              estado.compras.length ? 'Prueba con otros filtros.' : 'Agrega lo que necesita el equipo para empezar.') +
        '</div>';
      return;
    }

    if (!estado.agruparCompras) {
      cont.innerHTML = '<div class="panel"><div class="rejilla-compras">' +
        lista.map(tarjetaCompra).join('') + '</div></div>';
      return;
    }

    // Agrupado por área: cada bloque es identificable de un vistazo.
    var salida = '';
    Core.AREAS.forEach(function (a) {
      var delArea = lista.filter(function (c) { return (c.area || 'general') === a.id; });
      if (!delArea.length) return;
      var totalArea = delArea.reduce(function (s, c) { return s + Core.montoProducto(c); }, 0);
      salida += '<section class="panel grupo-area">' +
        '<header class="grupo-area-head">' +
          '<span class="grupo-area-titulo" style="color:' + a.color + '">' +
            '<span class="grupo-area-ico">' + a.icono + '</span>' + escapar(a.nombre) + '</span>' +
          '<span class="grupo-area-conteo">' + delArea.length + ' · ' + Core.formatearMoneda(totalArea) + '</span>' +
        '</header>' +
        '<div class="rejilla-compras">' + delArea.map(tarjetaCompra).join('') + '</div>' +
      '</section>';
    });
    cont.innerHTML = salida;
  }

  function tarjetaCompra(c) {
    var area = Core.areaPorId(c.area);
    var comprado = c.estado === 'comprado';
    var registrado = !!c.registradoComoGasto;
    var tieneReal = c.precioReal !== null && c.precioReal !== undefined && c.precioReal !== '';

    var estadoPastilla = registrado
      ? '<span class="estado-pastilla registrado">✓ Registrado</span>'
      : (comprado ? '<span class="estado-pastilla comprado">✓ Comprado</span>'
                  : '<span class="estado-pastilla pendiente">● Pendiente</span>');

    // Cifras: estimado siempre; si hay precio real se muestra y el estimado se tacha.
    var cifras = '';
    if (tieneReal) {
      cifras += '<span class="compra-cifra tachado">Estimado <b>' + Core.formatearMoneda(c.precioEstimado) + '</b></span>';
      cifras += '<span class="compra-cifra real">Real <b>' + Core.formatearMoneda(c.precioReal) + '</b></span>';
    } else {
      cifras += '<span class="compra-cifra">Estimado <b>' + Core.formatearMoneda(c.precioEstimado) + '</b></span>';
    }
    cifras = '<span class="compra-cifra">' + c.cantidad + ' unidad' + (c.cantidad === 1 ? '' : 'es') + '</span>' + cifras;

    // Cadena visual: necesidad → compra → gasto
    var cadena = '<div class="cadena">' +
      '<span class="cadena-paso hecho"><i class="cadena-punto"></i>Necesidad</span>' +
      '<span class="cadena-flecha">›</span>' +
      '<span class="cadena-paso ' + (comprado ? 'hecho' : '') + '"><i class="cadena-punto"></i>Comprado</span>' +
      '<span class="cadena-flecha">›</span>' +
      '<span class="cadena-paso ' + (registrado ? 'hecho' : '') + '"><i class="cadena-punto"></i>Gasto</span>' +
    '</div>';

    var acciones = '';
    if (Datos.autenticado()) {
      acciones += '<button class="btn btn-ghost" data-editar-compra="' + escapar(c.id) + '">Editar</button>';
      if (comprado && !registrado) {
        acciones += '<button class="btn btn-primario" data-gasto="' + escapar(c.id) + '">Registrar como gasto</button>';
      } else if (comprado && registrado) {
        acciones += '<button class="btn btn-ghost" data-gasto="' + escapar(c.id) + '">Registrar otro gasto</button>';
      }
      acciones += '<button class="btn btn-peligro" data-eliminar-compra="' + escapar(c.id) + '">Eliminar</button>';
    }

    return '<article class="tarjeta-compra ' + (registrado ? 'registrado' : (comprado ? 'comprado' : '')) + '"' +
        ' style="border-left-color:' + area.color + '">' +
      '<div class="compra-top">' +
        '<button class="compra-check ' + (comprado ? 'marcado' : '') + '" data-marcar="' + escapar(c.id) + '"' +
          (Datos.autenticado() ? '' : ' disabled') +
          ' title="' + (comprado ? 'Marcar como pendiente' : 'Marcar como comprado') + '"' +
          ' aria-label="Cambiar estado de ' + escapar(c.nombre) + '">✓</button>' +
        '<div style="flex:1;min-width:0">' +
          '<p class="compra-nombre">' + escapar(c.nombre) + '</p>' +
          '<div class="compra-cifras">' + cifras + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="compra-etiquetas">' +
        estadoPastilla +
        '<span class="etiqueta-area"><i style="background:' + area.color + '"></i>' + escapar(area.nombre) + '</span>' +
        '<span class="etiqueta-area">' + escapar(c.categoria || 'Otros') + '</span>' +
      '</div>' +
      (c.notas ? '<p class="compra-notas">' + escapar(c.notas) + '</p>' : '') +
      cadena +
      (acciones ? '<div class="compra-acciones">' + acciones + '</div>' : '') +
    '</article>';
  }

  /* ==================================================================
     VISTA: HISTORIAL
     ================================================================== */

  function renderizarHistorial() {
    mostrar(el('histMensual'), estado.vistaHistorial === 'mensual');
    mostrar(el('histCompleto'), estado.vistaHistorial === 'completo');
    todos('#tabsHistorial .seg').forEach(function (b) {
      b.classList.toggle('activo', b.dataset.vistaHist === estado.vistaHistorial);
    });
    if (estado.vistaHistorial === 'mensual') renderizarResumenMensual();
    else renderizarHistorialCompleto();
  }

  function renderizarResumenMensual() {
    var res = Core.resumenMensual(estado.config, estado.movimientos, estado.mesActivo);
    texto('etiquetaMes', res.etiqueta);
    texto('mesSubEtiqueta', res.sinMovimientos ? 'Sin movimientos registrados'
      : res.numMovimientos + ' movimiento' + (res.numMovimientos === 1 ? '' : 's') + ' en el periodo');

    // Límites de navegación
    var meses = Core.listarMeses(estado.config, estado.movimientos);
    el('btnMesAnterior').disabled = estado.mesActivo <= meses[0];
    el('btnMesSiguiente').disabled = estado.mesActivo >= meses[meses.length - 1];

    texto('mesInicial', Core.formatearMoneda(res.dineroInicialPeriodo));
    texto('mesInicialNota', res.aperturaEnElMes
      ? 'Más ' + Core.formatearMoneda(res.aperturaEnElMes) + ' de apertura del equipo'
      : 'Saldo al cerrar el mes anterior');
    texto('mesIngresos', '+' + Core.formatearMoneda(res.ingresos));
    texto('mesNumIngresos', res.numIngresos + ' ingreso' + (res.numIngresos === 1 ? '' : 's'));
    texto('mesGastos', '-' + Core.formatearMoneda(res.gastos));
    texto('mesNumGastos', res.numGastos + ' gasto' + (res.numGastos === 1 ? '' : 's'));
    texto('mesSaldoFinal', Core.formatearMoneda(res.saldoFinal));
    texto('mesNumMovimientos', res.numMovimientos + ' movimiento' + (res.numMovimientos === 1 ? '' : 's'));

    texto('selloMesArea', res.etiqueta);
    texto('selloMesCategoria', res.etiqueta);
    dibujarBarrasArea('mesPorArea', res.porArea);
    dibujarBarras('mesPorCategoria',
      Core.mapaAListaOrdenada(res.porCategoria).map(function (x) {
        return { nombre: x.clave, monto: x.monto, color: 'var(--cian)' };
      }), 'Sin gastos en ' + res.etiqueta);

    el('tablaMes').innerHTML = res.movimientos.length
      ? tablaMovimientos(res.movimientos)
      : vacio('Sin movimientos registrados', 'No hay actividad financiera en ' + res.etiqueta + '.');
  }

  function renderizarHistorialCompleto() {
    var linea = Core.construirLineaDeTiempo(estado.config, estado.movimientos);
    var hayFiltros = Core.tieneFiltrosActivos(estado.filtros);
    var lista = hayFiltros
      ? linea.filter(function (m) { return !m.esInicial && Core.filtrarMovimientos([m], estado.filtros).length; })
      : linea;

    texto('resultadoFiltros', hayFiltros
      ? lista.length + ' movimiento' + (lista.length === 1 ? '' : 's') + ' coinciden con los filtros · ' +
        'Total: ' + Core.formatearMoneda(lista.reduce(function (s, m) {
          return s + (m.tipo === 'gasto' ? -m.cantidad : m.cantidad); }, 0))
      : 'Mostrando todo el historial (' + estado.movimientos.length + ' movimientos)');

    el('tablaCompleta').innerHTML = lista.length
      ? tablaMovimientos(lista)
      : vacio('Sin resultados', 'Ningún movimiento coincide con los filtros aplicados.');
  }

  function tablaMovimientos(lista) {
    var editor = Datos.autenticado();
    var filas = lista.slice().reverse().map(function (m) {
      var area = Core.areaPorId(m.area);
      var esInicial = !!m.esInicial;
      var tipoTexto = esInicial ? 'Inicial' : (m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto');
      var claseTipo = esInicial ? 'inicial' : m.tipo;
      var monto = esInicial ? Core.formatearMoneda(m.cantidad) : Core.formatearMonedaConSigno(m.cantidad, m.tipo);
      var claseMonto = m.tipo === 'ingreso' ? 'positivo' : (m.tipo === 'gasto' ? 'negativo' : '');
      var compraLigada = m.compraId
        ? (estado.compras.filter(function (c) { return c.id === m.compraId; })[0] || {}).nombre
        : null;

      var acciones = '';
      if (editor && !esInicial) {
        acciones = '<div class="acciones-fila">' +
          '<button class="btn-mini" data-editar-mov="' + escapar(m.id) + '" title="Editar">✎</button>' +
          '<button class="btn-mini peligro" data-eliminar-mov="' + escapar(m.id) + '" title="Eliminar">🗑</button>' +
        '</div>';
      } else if (editor && esInicial) {
        acciones = '<div class="acciones-fila">' +
          '<button class="btn-mini" data-editar-inicial="1" title="Editar dinero inicial">✎</button></div>';
      }

      return '<tr class="' + (esInicial ? 'fila-inicial' : '') + '">' +
        '<td class="celda-concepto">' + escapar(m.concepto) +
          (compraLigada ? '<span class="celda-nota">↳ compra: ' + escapar(compraLigada) + '</span>' : '') +
          (m.notas ? '<span class="celda-nota">' + escapar(m.notas) + '</span>' : '') + '</td>' +
        '<td><span class="pastilla ' + claseTipo + '">' + tipoTexto + '</span></td>' +
        '<td><span class="etiqueta-area"><i style="background:' + area.color + '"></i>' + escapar(area.nombre) + '</span></td>' +
        '<td>' + (esInicial ? '—' : escapar(m.categoria || '—')) + '</td>' +
        '<td class="num ' + claseMonto + '">' + monto + '</td>' +
        '<td>' + Core.formatearFecha(m.fecha) + '</td>' +
        '<td class="num">' + Core.formatearMoneda(m.saldoDespues) + '</td>' +
        '<td>' + acciones + '</td>' +
      '</tr>';
    }).join('');

    return '<div class="tabla-envoltura"><table class="tabla"><thead><tr>' +
      '<th>Concepto</th><th>Tipo</th><th>Área</th><th>Categoría</th>' +
      '<th style="text-align:right">Cantidad</th><th>Fecha</th>' +
      '<th style="text-align:right">Saldo después</th><th></th>' +
      '</tr></thead><tbody>' + filas + '</tbody></table></div>';
  }

  /* ==================================================================
     VISTA: REPORTES
     ================================================================== */

  function renderizarReportes() {
    dibujarBarrasArea('reporteAreas', Core.agruparPorArea(estado.movimientos));
    dibujarBarras('reporteCategorias',
      Core.mapaAListaOrdenada(Core.agruparPorCategoria(estado.movimientos, 'gasto')).map(function (x) {
        return { nombre: x.clave, monto: x.monto, color: 'var(--cian)' };
      }), 'Sin gastos registrados todavía');

    dibujarGraficoMeses();
    dibujarGraficoSaldo();
  }

  function datosPorMes() {
    return Core.listarMeses(estado.config, estado.movimientos).map(function (clave) {
      return Core.resumenMensual(estado.config, estado.movimientos, clave);
    });
  }

  function dibujarGraficoMeses() {
    var cont = el('reporteMeses');
    var meses = datosPorMes();
    var maximo = Math.max.apply(null, meses.map(function (m) { return Math.max(m.ingresos, m.gastos); }).concat([1]));

    cont.innerHTML = '<div class="meses-pista">' + meses.map(function (m) {
      var hIng = Math.max(3, (m.ingresos / maximo) * 128);
      var hGas = Math.max(3, (m.gastos / maximo) * 128);
      var corto = m.etiqueta.split(' ')[0].slice(0, 3);
      return '<div class="mes-columna ' + (m.clave === estado.mesActivo ? 'activo' : '') + '" data-mes="' + m.clave + '"' +
        ' title="' + escapar(m.etiqueta) + ' · ingresos ' + Core.formatearMoneda(m.ingresos) +
        ' · gastos ' + Core.formatearMoneda(m.gastos) + '">' +
        '<div class="mes-barras">' +
          '<div class="mes-barra ingreso" style="height:' + hIng + 'px"></div>' +
          '<div class="mes-barra gasto" style="height:' + hGas + 'px"></div>' +
        '</div>' +
        '<span class="mes-etiq">' + corto + '<br>' + m.clave.slice(2, 4) + '</span>' +
      '</div>';
    }).join('') + '</div>' +
    '<div class="leyenda"><span><i style="background:var(--verde)"></i>Ingresos</span>' +
    '<span><i style="background:var(--rojo)"></i>Gastos</span>' +
    '<span class="pie-nota">Toca un mes para abrir su resumen</span></div>';
  }

  function dibujarGraficoSaldo() {
    var cont = el('reporteSaldo');
    var meses = datosPorMes();
    if (meses.length < 2) {
      cont.innerHTML = vacio('Aún no hay suficiente historial', 'La evolución del saldo aparecerá cuando existan al menos dos meses con datos.');
      return;
    }

    /*
      La escala se ajusta al rango real de los saldos (con un margen del 20%)
      en lugar de anclarse al cero: así se aprecia la variación entre meses
      aunque los importes sean grandes y parecidos entre sí.
    */
    var valores = meses.map(function (m) { return m.saldoFinal; });
    var vMax = Math.max.apply(null, valores);
    var vMin = Math.min.apply(null, valores);
    var holgura = (vMax - vMin) * 0.2 || Math.max(Math.abs(vMax) * 0.1, 1);
    var maximo = vMax + holgura;
    var minimo = vMin - holgura;
    var rango = (maximo - minimo) || 1;
    var ancho = 1000, alto = 190, margen = 26;

    var puntos = valores.map(function (v, i) {
      var x = margen + (i / (valores.length - 1)) * (ancho - margen * 2);
      var y = alto - margen - ((v - minimo) / rango) * (alto - margen * 2);
      return { x: x, y: y, v: v, etiqueta: meses[i].etiqueta };
    });

    var linea = puntos.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
    var area = 'M' + puntos[0].x.toFixed(1) + ',' + (alto - margen) +
      ' L' + linea.split(' ').join(' L') + ' L' + puntos[puntos.length - 1].x.toFixed(1) + ',' + (alto - margen) + ' Z';

    cont.innerHTML = '<svg viewBox="0 0 ' + ancho + ' ' + alto + '" preserveAspectRatio="none" role="img" aria-label="Evolución del saldo">' +
      '<defs><linearGradient id="gradSaldo" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#37D4E8" stop-opacity=".28"/>' +
        '<stop offset="100%" stop-color="#37D4E8" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      '<line x1="' + margen + '" y1="' + (alto - margen) + '" x2="' + (ancho - margen) + '" y2="' + (alto - margen) +
        '" stroke="#1E2937" stroke-width="1"/>' +
      '<line x1="' + margen + '" y1="' + margen + '" x2="' + (ancho - margen) + '" y2="' + margen +
        '" stroke="#1E2937" stroke-width="1" stroke-dasharray="4 6"/>' +
      '<path d="' + area + '" fill="url(#gradSaldo)"/>' +
      '<polyline points="' + linea + '" fill="none" stroke="#37D4E8" stroke-width="2.5" ' +
        'stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
      puntos.map(function (p) {
        return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4" fill="#0B0F16" stroke="#37D4E8" stroke-width="2">' +
          '<title>' + escapar(p.etiqueta) + ': ' + Core.formatearMoneda(p.v) + '</title></circle>';
      }).join('') +
    '</svg>' +
    '<div class="leyenda"><span><i style="background:var(--cian)"></i>Máximo ' + Core.formatearMoneda(vMax) +
      ' · mínimo ' + Core.formatearMoneda(vMin) + '</span>' +
    '<span>Saldo al cierre de cada mes · ' +
      escapar(meses[0].etiqueta) + ' → ' + escapar(meses[meses.length - 1].etiqueta) + '</span></div>';
  }

  /* ==================================================================
     MOVIMIENTOS: ALTA, EDICIÓN Y BAJA
     ================================================================== */

  function abrirModalMovimiento(mov) {
    if (!exigirSesion()) return;
    mostrarError('errorMovimiento', '');
    el('formMovimiento').reset();
    rellenarSelectores();

    var esEdicion = !!mov;
    texto('tituloModalMovimiento', esEdicion ? 'Editar movimiento' : 'Registrar movimiento');
    el('btnGuardarMovimiento').textContent = esEdicion ? 'Guardar cambios' : 'Guardar movimiento';
    el('btnGuardarMovimiento').dataset.textoOriginal = el('btnGuardarMovimiento').textContent;
    el('movimientoId').value = esEdicion ? mov.id : '';
    el('movimientoConcepto').value = esEdicion ? mov.concepto : '';
    el('movimientoCantidad').value = esEdicion ? mov.cantidad : '';
    el('movimientoFecha').value = esEdicion ? mov.fecha : Core.fechaHoy();
    el('movimientoArea').value = esEdicion ? mov.area : (estado.vista === 'area' ? estado.areaActiva : 'general');
    el('movimientoCategoria').value = esEdicion ? mov.categoria : 'Otros';
    el('movimientoNotas').value = esEdicion ? (mov.notas || '') : '';
    seleccionarTipo(esEdicion ? mov.tipo : 'ingreso');

    abrirModal('modalMovimiento');
  }

  function seleccionarTipo(tipo) {
    todos('#selectorTipo .seg').forEach(function (b) {
      b.classList.toggle('activo', b.dataset.tipo === tipo);
    });
    el('selectorTipo').dataset.tipo = tipo;
  }

  async function guardarMovimiento(evento) {
    evento.preventDefault();
    mostrarError('errorMovimiento', '');

    var datos = {
      concepto: el('movimientoConcepto').value,
      tipo: el('selectorTipo').dataset.tipo || 'ingreso',
      cantidad: el('movimientoCantidad').value,
      fecha: el('movimientoFecha').value,
      area: el('movimientoArea').value,
      categoria: el('movimientoCategoria').value,
      notas: el('movimientoNotas').value
    };

    var v = Core.validarMovimiento(datos);
    if (!v.ok) {
      mostrarError('errorMovimiento', v.mensaje);
      var campo = el('movimiento' + v.campo.charAt(0).toUpperCase() + v.campo.slice(1));
      if (campo) campo.focus();
      return;
    }

    var boton = el('btnGuardarMovimiento');
    var id = el('movimientoId').value;
    ocupado(boton, true);
    try {
      if (id) {
        await Datos.actualizarMovimiento(id, v.valor);
        toast('Movimiento actualizado. El saldo se recalculó.', 'exito');
      } else {
        await Datos.crearMovimiento(v.valor);
        toast('Movimiento registrado.', 'exito');
      }
      cerrarModal('modalMovimiento');
      await cargarDatos();
    } catch (e) {
      mostrarError('errorMovimiento', e.message);
    } finally {
      ocupado(boton, false);
    }
  }

  function pedirEliminarMovimiento(id) {
    var mov = estado.movimientos.filter(function (m) { return m.id === id; })[0];
    if (!mov) return;
    var compraLigada = estado.compras.filter(function (c) { return c.movimientoId === id; })[0];

    estado.pendiente = { tipo: 'movimiento', id: id };
    texto('tituloConfirmar', '¿Seguro que quieres eliminar este movimiento?');
    texto('mensajeConfirmar', '"' + mov.concepto + '" por ' +
      Core.formatearMonedaConSigno(mov.cantidad, mov.tipo) + ' del ' + Core.formatearFecha(mov.fecha) +
      '. Todos los saldos posteriores se recalcularán.');
    if (compraLigada) {
      html('detalleConfirmar', 'Este movimiento vino de la compra <b>' + escapar(compraLigada.nombre) +
        '</b>. El producto <b>no</b> se eliminará: volverá a quedar disponible para registrarse como gasto.');
      mostrar(el('detalleConfirmar'), true);
    } else {
      mostrar(el('detalleConfirmar'), false);
    }
    abrirModal('modalConfirmar');
  }

  /* ==================================================================
     COMPRAS: ALTA, EDICIÓN, ESTADO Y BAJA
     ================================================================== */

  function abrirModalProducto(producto) {
    if (!exigirSesion()) return;
    mostrarError('errorProducto', '');
    el('formProducto').reset();
    rellenarSelectores();

    var esEdicion = !!producto;
    texto('tituloModalProducto', esEdicion ? 'Editar producto' : 'Agregar producto');
    el('btnGuardarProducto').textContent = esEdicion ? 'Guardar cambios' : 'Agregar a la lista';
    el('btnGuardarProducto').dataset.textoOriginal = el('btnGuardarProducto').textContent;
    el('productoId').value = esEdicion ? producto.id : '';
    el('productoNombre').value = esEdicion ? producto.nombre : '';
    el('productoCantidad').value = esEdicion ? producto.cantidad : 1;
    el('productoPrecio').value = esEdicion ? producto.precioEstimado : '';
    el('productoArea').value = esEdicion ? producto.area : (estado.vista === 'area' ? estado.areaActiva : 'general');
    el('productoCategoria').value = esEdicion ? producto.categoria : 'Materiales';
    el('productoNotas').value = esEdicion ? (producto.notas || '') : '';
    actualizarTotalEstimado();

    abrirModal('modalProducto');
  }

  function actualizarTotalEstimado() {
    var cant = Number(el('productoCantidad').value) || 0;
    var precio = Number(el('productoPrecio').value) || 0;
    texto('productoTotalEstimado', precio > 0
      ? 'Se registrará como ' + Core.formatearMoneda(precio) + ' estimados' +
        (cant > 1 ? ' por las ' + cant + ' unidades' : '') + '.'
      : 'El precio estimado es el monto total que el equipo espera gastar.');
  }

  async function guardarProducto(evento) {
    evento.preventDefault();
    mostrarError('errorProducto', '');

    var datos = {
      nombre: el('productoNombre').value,
      cantidad: el('productoCantidad').value,
      precioEstimado: el('productoPrecio').value,
      area: el('productoArea').value,
      categoria: el('productoCategoria').value,
      notas: el('productoNotas').value
    };

    var v = Core.validarCompra(datos);
    if (!v.ok) {
      mostrarError('errorProducto', v.mensaje);
      return;
    }

    var boton = el('btnGuardarProducto');
    var id = el('productoId').value;
    ocupado(boton, true);
    try {
      if (id) {
        await Datos.actualizarCompra(id, v.valor);
        toast('Producto actualizado.', 'exito');
      } else {
        await Datos.crearCompra(v.valor);
        toast('Producto agregado a la lista.', 'exito');
      }
      cerrarModal('modalProducto');
      await cargarDatos();
    } catch (e) {
      mostrarError('errorProducto', e.message);
    } finally {
      ocupado(boton, false);
    }
  }

  // Marcar comprado / pendiente NUNCA toca el saldo (§19).
  async function cambiarEstadoCompra(id) {
    if (!exigirSesion()) return;
    var c = estado.compras.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var nuevo = c.estado === 'comprado' ? 'pendiente' : 'comprado';
    try {
      await Datos.actualizarCompra(id, { estado: nuevo });
      await cargarDatos();
      toast(nuevo === 'comprado'
        ? 'Marcado como comprado. El saldo no cambió: regístralo como gasto cuando tengas el precio real.'
        : 'Marcado como pendiente. El movimiento financiero, si existía, se conserva.', 'info');
    } catch (e) {
      toast('No se pudo cambiar el estado: ' + e.message, 'error');
    }
  }

  function pedirEliminarCompra(id) {
    var c = estado.compras.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    estado.pendiente = { tipo: 'compra', id: id };
    texto('tituloConfirmar', '¿Seguro que quieres eliminar este producto?');
    texto('mensajeConfirmar', '"' + c.nombre + '" se quitará de la lista de compras.');
    if (c.registradoComoGasto && c.movimientoId) {
      html('detalleConfirmar', 'Este producto ya fue registrado como gasto. El movimiento financiero ' +
        '<b>se conservará</b> en el historial y el saldo no cambiará; solo se elimina el producto de la lista.');
      mostrar(el('detalleConfirmar'), true);
    } else {
      mostrar(el('detalleConfirmar'), false);
    }
    abrirModal('modalConfirmar');
  }

  /* ---- Compra → gasto ---- */

  function registrarCompraComoGasto(id) {
    if (!exigirSesion()) return;
    var c = estado.compras.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    estado.compraEnGasto = id;

    if (c.registradoComoGasto) {
      // Nunca se crea un duplicado en silencio (§22).
      var mov = estado.movimientos.filter(function (m) { return m.id === c.movimientoId; })[0];
      texto('textoDuplicado', mov
        ? '"' + c.nombre + '" ya generó el gasto de ' + Core.formatearMoneda(mov.cantidad) +
          ' del ' + Core.formatearFecha(mov.fecha) + '. Si registras otro, se creará un movimiento adicional y el saldo bajará de nuevo.'
        : '"' + c.nombre + '" ya está marcado como registrado. Si continúas se creará un movimiento adicional.');
      abrirModal('modalDuplicado');
      return;
    }
    abrirModalGasto(c);
  }

  function abrirModalGasto(c) {
    mostrarError('errorGasto', '');
    rellenarSelectores();
    var area = Core.areaPorId(c.area);

    el('gastoProductoId').value = c.id;
    el('gastoConcepto').value = c.nombre;
    el('gastoPrecioReal').value = (c.precioReal !== null && c.precioReal !== undefined && c.precioReal !== '')
      ? c.precioReal : c.precioEstimado;
    el('gastoFecha').value = c.fechaCompra || Core.fechaHoy();
    el('gastoArea').value = c.area;
    el('gastoCategoria').value = c.categoria;

    html('gastoResumenProducto',
      '<p class="rp-nombre">' + escapar(c.nombre) + '</p>' +
      '<div class="rp-datos">' +
        '<span>' + c.cantidad + ' unidad' + (c.cantidad === 1 ? '' : 'es') + '</span>' +
        '<span>Estimado <b>' + Core.formatearMoneda(c.precioEstimado) + '</b></span>' +
        '<span>' + area.icono + ' ' + escapar(area.nombre) + '</span>' +
        '<span>' + escapar(c.categoria) + '</span>' +
      '</div>');

    actualizarAvisoGasto();
    abrirModal('modalGasto');
  }

  function actualizarAvisoGasto() {
    var c = estado.compras.filter(function (x) { return x.id === estado.compraEnGasto; })[0];
    var valor = Number(el('gastoPrecioReal').value);
    var nodo = el('gastoTotalAviso');
    if (!c || !isFinite(valor) || valor <= 0) {
      nodo.innerHTML = 'Confirma el monto que realmente se pagó. Solo este valor afecta al saldo.';
      return;
    }
    var saldoActual = Core.calcularSaldo(estado.config, estado.movimientos);
    var diferencia = Core.redondear(valor - c.precioEstimado);
    var textoDif = diferencia === 0
      ? 'Coincide con el precio estimado.'
      : (diferencia < 0
        ? 'Son ' + Core.formatearMoneda(Math.abs(diferencia)) + ' menos de lo estimado.'
        : 'Son ' + Core.formatearMoneda(diferencia) + ' más de lo estimado.');
    nodo.innerHTML = 'Se registrará un gasto de <b>' + Core.formatearMoneda(valor) + '</b>. ' +
      escapar(textoDif) + ' El saldo pasará de <b>' + Core.formatearMoneda(saldoActual) +
      '</b> a <b>' + Core.formatearMoneda(Core.redondear(saldoActual - valor)) + '</b>.';
  }

  async function confirmarGasto(evento) {
    evento.preventDefault();
    mostrarError('errorGasto', '');

    var c = estado.compras.filter(function (x) { return x.id === el('gastoProductoId').value; })[0];
    if (!c) { mostrarError('errorGasto', 'El producto ya no existe.'); return; }

    var precio = Core.validarPrecioReal(el('gastoPrecioReal').value);
    if (!precio.ok) { mostrarError('errorGasto', precio.mensaje); return; }

    var datos = {
      concepto: el('gastoConcepto').value,
      tipo: 'gasto',
      cantidad: precio.valor,
      fecha: el('gastoFecha').value,
      area: el('gastoArea').value,
      categoria: el('gastoCategoria').value,
      notas: ''
    };
    var v = Core.validarMovimiento(datos);
    if (!v.ok) { mostrarError('errorGasto', v.mensaje); return; }

    var boton = el('btnConfirmarGasto');
    ocupado(boton, true, 'Registrando…');
    try {
      await Datos.registrarCompraComoGasto(c, v.valor);
      cerrarModal('modalGasto');
      await cargarDatos();
      toast('Gasto de ' + Core.formatearMoneda(v.valor.cantidad) + ' registrado y ligado a "' + c.nombre + '".', 'exito');
      estado.compraEnGasto = null;
    } catch (e) {
      mostrarError('errorGasto', e.message);
    } finally {
      ocupado(boton, false);
    }
  }

  /* ==================================================================
     CONFIRMACIONES
     ================================================================== */

  async function ejecutarPendiente() {
    var p = estado.pendiente;
    if (!p) return;
    var boton = el('btnConfirmarAccion');
    ocupado(boton, true, 'Eliminando…');
    try {
      if (p.tipo === 'movimiento') {
        await Datos.eliminarMovimiento(p.id);
        toast('Movimiento eliminado. Los saldos posteriores se recalcularon.', 'exito');
      } else if (p.tipo === 'compra') {
        await Datos.eliminarCompra(p.id);
        toast('Producto eliminado de la lista.', 'exito');
      } else if (p.tipo === 'reiniciar') {
        await Datos.reiniciarDatos();
        toast('Datos reiniciados.', 'exito');
      }
      cerrarModal('modalConfirmar');
      estado.pendiente = null;
      await cargarDatos();
    } catch (e) {
      toast('No se pudo completar: ' + e.message, 'error');
    } finally {
      ocupado(boton, false);
    }
  }

  function pedirReiniciar() {
    if (!exigirSesion()) return;
    estado.pendiente = { tipo: 'reiniciar' };
    texto('tituloConfirmar', 'Reiniciar todos los datos');
    texto('mensajeConfirmar',
      'Esta acción eliminará todo tu historial, saldo y lista de compras. Esta acción no se puede deshacer. ¿Continuar?');
    html('detalleConfirmar', 'Se borrarán <b>' + estado.movimientos.length + ' movimientos</b> y <b>' +
      estado.compras.length + ' productos</b> del equipo. Solo afecta a este equipo.');
    mostrar(el('detalleConfirmar'), true);
    abrirModal('modalConfirmar');
  }

  /* ==================================================================
     DINERO INICIAL
     ================================================================== */

  async function crearConfiguracion(evento) {
    evento.preventDefault();
    mostrarError('errorDineroInicial', '');
    var v = Core.validarDineroInicial(el('inputDineroInicial').value);
    if (!v.ok) { mostrarError('errorDineroInicial', v.mensaje); return; }

    var boton = evento.target.querySelector('button[type=submit]');
    ocupado(boton, true, 'Creando…');
    try {
      await Datos.crearEquipo(v.valor);
      toast('Sistema financiero iniciado con ' + Core.formatearMoneda(v.valor) + '.', 'exito');
      await cargarDatos();
    } catch (e) {
      mostrarError('errorDineroInicial', e.message);
    } finally {
      ocupado(boton, false);
    }
  }

  function editarDineroInicial() {
    if (!exigirSesion()) return;
    var actual = estado.config.dineroInicial;
    var valor = window.prompt('Dinero inicial del equipo (afecta a todo el historial):', actual);
    if (valor === null) return;
    var v = Core.validarDineroInicial(valor);
    if (!v.ok) { toast(v.mensaje, 'error'); return; }
    Datos.actualizarDineroInicial(v.valor)
      .then(function () {
        toast('Dinero inicial actualizado. Todos los saldos se recalcularon.', 'exito');
        return cargarDatos();
      })
      .catch(function (e) { toast('No se pudo actualizar: ' + e.message, 'error'); });
  }

  /* ==================================================================
     SESIÓN
     ================================================================== */

  function exigirSesion() {
    if (Datos.autenticado()) return true;
    toast('Inicia sesión con la cuenta del equipo para modificar la información.', 'error');
    abrirModal('modalLogin');
    return false;
  }

  async function iniciarSesion(evento) {
    evento.preventDefault();
    mostrarError('errorLogin', '');
    var usuario = el('loginUsuario').value.trim();
    var pass = el('loginPassword').value;
    if (!usuario) {
      mostrarError('errorLogin', 'Escribe el usuario del equipo.');
      el('loginUsuario').focus();
      return;
    }
    if (!pass) {
      mostrarError('errorLogin', 'Escribe la contraseña.');
      el('loginPassword').focus();
      return;
    }

    var boton = el('btnEntrar');
    ocupado(boton, true, 'Entrando…');
    try {
      await Datos.iniciarSesion(usuario, pass);
      cerrarModal('modalLogin');
      el('formLogin').reset();
      toast('Sesión iniciada como ' + Datos.usuarioVisible() + '.', 'exito');
      aplicarModoAcceso();
      await cargarDatos();
    } catch (e) {
      mostrarError('errorLogin', e.message);
    } finally {
      ocupado(boton, false);
    }
  }

  async function cerrarSesion() {
    try {
      await Datos.cerrarSesion();
      toast('Sesión cerrada. Sigues viendo la información en modo consulta.', 'info');
      aplicarModoAcceso();
      await cargarDatos();
    } catch (e) {
      toast('No se pudo cerrar la sesión: ' + e.message, 'error');
    }
  }

  /* ==================================================================
     EXPORTACIÓN A EXCEL (SheetJS)
     ================================================================== */

  function anchoColumnas(filas) {
    var anchos = [];
    filas.forEach(function (fila) {
      fila.forEach(function (celda, i) {
        var largo = String(celda === null || celda === undefined ? '' : celda).length;
        anchos[i] = Math.min(42, Math.max(anchos[i] || 10, largo + 2));
      });
    });
    return anchos.map(function (w) { return { wch: w }; });
  }

  function exportarExcel(opciones) {
    if (typeof XLSX === 'undefined') {
      toast('No se pudo cargar la librería de Excel. Revisa tu conexión.', 'error');
      return;
    }
    if (!estado.config) { toast('Todavía no hay datos para exportar.', 'error'); return; }

    try {
      var hojas = Core.construirHojasExcel(estado.config, estado.movimientos, estado.compras, opciones || {});
      var libro = XLSX.utils.book_new();

      Object.keys(hojas).forEach(function (nombre) {
        var hoja = XLSX.utils.aoa_to_sheet(hojas[nombre]);
        hoja['!cols'] = anchoColumnas(hojas[nombre]);
        XLSX.utils.book_append_sheet(libro, hoja, nombre.slice(0, 31));
      });

      var archivo = Core.nombreArchivoExcel((opciones && opciones.sufijo) || '');
      XLSX.writeFile(libro, archivo);
      toast('Archivo generado: ' + archivo, 'exito');
    } catch (e) {
      console.error(e);
      toast('No se pudo generar el archivo: ' + e.message, 'error');
    }
  }

  function exportarPeriodoActual() {
    var clave = estado.mesActivo;
    var partes = clave.split('-');
    var ultimoDia = new Date(Date.UTC(Number(partes[0]), Number(partes[1]), 0)).getUTCDate();
    exportarExcel({
      descripcion: Core.etiquetaMes(clave),
      sufijo: clave,
      filtros: { desde: clave + '-01', hasta: clave + '-' + String(ultimoDia).padStart(2, '0') }
    });
  }

  function exportarFiltrado() {
    if (!Core.tieneFiltrosActivos(estado.filtros)) {
      toast('No hay filtros activos: se exportará todo el historial.', 'info');
      exportarExcel({ descripcion: 'Todo el historial' });
      return;
    }
    exportarExcel({ descripcion: 'Historial filtrado', sufijo: 'filtrado', filtros: estado.filtros });
  }

  function exportarRango() {
    var desde = el('expDesde').value;
    var hasta = el('expHasta').value;
    var area = el('expArea').value;
    if (desde && hasta && desde > hasta) {
      toast('La fecha "desde" no puede ser posterior a la fecha "hasta".', 'error');
      return;
    }
    var descripcion = 'Rango' + (desde ? ' desde ' + Core.formatearFecha(desde) : '') +
      (hasta ? ' hasta ' + Core.formatearFecha(hasta) : '') +
      (area !== 'todas' ? ' · ' + Core.areaPorId(area).nombre : '');
    exportarExcel({
      descripcion: descripcion,
      sufijo: 'rango',
      filtros: { desde: desde, hasta: hasta, area: area, tipo: 'todos', categoria: 'todas' }
    });
  }

  /* ==================================================================
     EVENTOS
     ================================================================== */

  function configurarEventos() {
    // Los controles de escritura solo existen para usuarios autenticados.
    todos('[data-accion]').forEach(function (b) { b.classList.add('solo-editor'); });

    // --- Navegación ---
    todos('.nav-item').forEach(function (b) {
      b.addEventListener('click', function () { irA(b.dataset.vista, b.dataset.area); });
    });
    todos('[data-ir]').forEach(function (b) {
      b.addEventListener('click', function () { irA(b.dataset.ir); });
    });

    // --- Sesión ---
    el('btnSesion').addEventListener('click', function () {
      if (Datos.autenticado()) cerrarSesion(); else abrirModal('modalLogin');
    });
    el('btnSesionVacio').addEventListener('click', function () { abrirModal('modalLogin'); });
    el('formLogin').addEventListener('submit', iniciarSesion);

    // --- Configuración inicial ---
    el('formDineroInicial').addEventListener('submit', crearConfiguracion);

    // --- Acciones principales ---
    todos('[data-accion="nuevo-movimiento"]').forEach(function (b) {
      b.addEventListener('click', function () { abrirModalMovimiento(null); });
    });
    todos('[data-accion="nuevo-producto"], [data-accion="nuevo-producto-area"]').forEach(function (b) {
      b.addEventListener('click', function () { abrirModalProducto(null); });
    });
    el('fabAccion').addEventListener('click', function () { abrirModalMovimiento(null); });

    // --- Formularios ---
    el('formMovimiento').addEventListener('submit', guardarMovimiento);
    el('formProducto').addEventListener('submit', guardarProducto);
    el('formGasto').addEventListener('submit', confirmarGasto);
    todos('#selectorTipo .seg').forEach(function (b) {
      b.addEventListener('click', function () { seleccionarTipo(b.dataset.tipo); });
    });
    el('productoCantidad').addEventListener('input', actualizarTotalEstimado);
    el('productoPrecio').addEventListener('input', actualizarTotalEstimado);
    el('gastoPrecioReal').addEventListener('input', actualizarAvisoGasto);

    el('btnRegistrarOtroGasto').addEventListener('click', function () {
      cerrarModal('modalDuplicado');
      var c = estado.compras.filter(function (x) { return x.id === estado.compraEnGasto; })[0];
      if (c) abrirModalGasto(c);
    });
    el('btnConfirmarAccion').addEventListener('click', ejecutarPendiente);

    // --- Historial ---
    el('btnMesAnterior').addEventListener('click', function () {
      estado.mesActivo = Core.mesAnterior(estado.mesActivo);
      renderizarResumenMensual();
    });
    el('btnMesSiguiente').addEventListener('click', function () {
      estado.mesActivo = Core.mesSiguiente(estado.mesActivo);
      renderizarResumenMensual();
    });
    todos('#tabsHistorial .seg').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.vistaHistorial = b.dataset.vistaHist;
        renderizarHistorial();
      });
    });

    // --- Filtros de historial ---
    todos('#filtroTipo .seg').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.filtros.tipo = b.dataset.tipo;
        todos('#filtroTipo .seg').forEach(function (x) { x.classList.toggle('activo', x === b); });
        renderizarHistorialCompleto();
      });
    });
    el('filtroArea').addEventListener('change', function () {
      estado.filtros.area = this.value; renderizarHistorialCompleto();
    });
    el('filtroCategoria').addEventListener('change', function () {
      estado.filtros.categoria = this.value; renderizarHistorialCompleto();
    });
    el('filtroDesde').addEventListener('change', function () {
      estado.filtros.desde = this.value; renderizarHistorialCompleto();
    });
    el('filtroHasta').addEventListener('change', function () {
      estado.filtros.hasta = this.value; renderizarHistorialCompleto();
    });
    el('buscarMovimientos').addEventListener('input', function () {
      estado.filtros.texto = this.value.trim(); renderizarHistorialCompleto();
    });
    el('btnLimpiarFiltros').addEventListener('click', function () {
      estado.filtros = { tipo: 'todos', area: 'todas', categoria: 'todas', desde: '', hasta: '', texto: '' };
      el('filtroArea').value = 'todas';
      el('filtroCategoria').value = 'todas';
      el('filtroDesde').value = '';
      el('filtroHasta').value = '';
      el('buscarMovimientos').value = '';
      todos('#filtroTipo .seg').forEach(function (x) { x.classList.toggle('activo', x.dataset.tipo === 'todos'); });
      renderizarHistorialCompleto();
    });

    // --- Filtros de compras ---
    todos('#filtroEstadoCompras .seg').forEach(function (b) {
      b.addEventListener('click', function () {
        estado.filtrosCompras.estado = b.dataset.estado;
        todos('#filtroEstadoCompras .seg').forEach(function (x) { x.classList.toggle('activo', x === b); });
        renderizarCompras();
      });
    });
    el('filtroAreaCompras').addEventListener('change', function () {
      estado.filtrosCompras.area = this.value; renderizarCompras();
    });
    el('filtroCategoriaCompras').addEventListener('change', function () {
      estado.filtrosCompras.categoria = this.value; renderizarCompras();
    });
    el('buscarCompras').addEventListener('input', function () {
      estado.filtrosCompras.texto = this.value.trim(); renderizarCompras();
    });
    el('agruparPorArea').addEventListener('change', function () {
      estado.agruparCompras = this.checked;
      guardarPrefs({ agruparCompras: this.checked });
      renderizarCompras();
    });

    // --- Exportación ---
    el('btnExportarRapido').addEventListener('click', function () { exportarExcel({ descripcion: 'Todo el historial' }); });
    el('btnExportarTodo').addEventListener('click', function () { exportarExcel({ descripcion: 'Todo el historial' }); });
    el('btnExportarMesActual').addEventListener('click', exportarPeriodoActual);
    el('btnExportarPeriodo').addEventListener('click', exportarPeriodoActual);
    el('btnExportarFiltrado').addEventListener('click', exportarFiltrado);
    el('btnExportarRango').addEventListener('click', function () {
      var caja = el('rangoExportar');
      caja.hidden = !caja.hidden;
    });
    el('btnExportarRangoConfirmar').addEventListener('click', exportarRango);

    // --- Reiniciar ---
    el('btnReiniciarDatos').addEventListener('click', pedirReiniciar);

    // --- Aviso ---
    el('btnCerrarAviso').addEventListener('click', function () {
      mostrar(el('avisoModo'), false);
      guardarPrefs({ avisoCerrado: true });
    });

    // --- Cierre de modales ---
    todos('[data-cerrar]').forEach(function (b) {
      b.addEventListener('click', function () { cerrarModal(b.dataset.cerrar); });
    });
    todos('.overlay').forEach(function (o) {
      o.addEventListener('click', function (e) { if (e.target === o) cerrarModal(o.id); });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && modalAbierto) cerrarModal(modalAbierto);
    });

    // --- Delegación de clicks en contenido generado ---
    document.addEventListener('click', manejarClicks);
  }

  function manejarClicks(e) {
    var destino = e.target.closest('[data-marcar],[data-gasto],[data-editar-compra],[data-eliminar-compra],' +
      '[data-editar-mov],[data-eliminar-mov],[data-editar-inicial],[data-detalle],[data-mes]');
    if (!destino) return;
    var d = destino.dataset;

    if (d.marcar) { cambiarEstadoCompra(d.marcar); return; }
    if (d.gasto) { registrarCompraComoGasto(d.gasto); return; }
    if (d.editarCompra) {
      abrirModalProducto(estado.compras.filter(function (x) { return x.id === d.editarCompra; })[0]);
      return;
    }
    if (d.eliminarCompra) { if (exigirSesion()) pedirEliminarCompra(d.eliminarCompra); return; }
    if (d.editarMov) {
      abrirModalMovimiento(estado.movimientos.filter(function (x) { return x.id === d.editarMov; })[0]);
      return;
    }
    if (d.eliminarMov) { if (exigirSesion()) pedirEliminarMovimiento(d.eliminarMov); return; }
    if (d.editarInicial) { editarDineroInicial(); return; }
    if (d.mes) {
      estado.mesActivo = d.mes;
      estado.vistaHistorial = 'mensual';
      irA('historial');
      return;
    }
    if (d.detalle) { mostrarDetalle(d.detalle); return; }
  }

  function mostrarDetalle(id) {
    var linea = Core.construirLineaDeTiempo(estado.config, estado.movimientos);
    var m = linea.filter(function (x) { return String(x.id) === String(id); })[0];
    if (!m) return;
    var area = Core.areaPorId(m.area);
    var compra = m.compraId
      ? estado.compras.filter(function (c) { return c.id === m.compraId; })[0] : null;

    var filas = [
      ['Concepto', escapar(m.concepto)],
      ['Tipo', m.tipo === 'inicial' ? 'Dinero inicial' : (m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto')],
      ['Cantidad', m.tipo === 'inicial' ? Core.formatearMoneda(m.cantidad) : Core.formatearMonedaConSigno(m.cantidad, m.tipo)],
      ['Fecha', Core.formatearFecha(m.fecha)],
      ['Área', area.icono + ' ' + escapar(area.nombre)],
      ['Categoría', escapar(m.categoria || '—')],
      ['Saldo después', Core.formatearMoneda(m.saldoDespues)]
    ];
    if (compra) filas.push(['Compra relacionada', escapar(compra.nombre)]);
    if (m.notas) filas.push(['Notas', escapar(m.notas)]);
    if (m.creadoEn) filas.push(['Registrado', Core.formatearFecha(String(m.creadoEn).slice(0, 10))]);

    html('contenidoDetalle',
      '<div class="detalle-lista">' +
      filas.map(function (f) {
        return '<div class="detalle-fila"><span>' + f[0] + '</span><span>' + f[1] + '</span></div>';
      }).join('') + '</div>' +
      (Datos.autenticado() && !m.esInicial
        ? '<div class="modal-acciones">' +
          '<button class="btn btn-ghost" data-editar-mov="' + escapar(m.id) + '">Editar</button>' +
          '<button class="btn btn-peligro" data-eliminar-mov="' + escapar(m.id) + '">Eliminar</button></div>'
        : ''));
    abrirModal('modalDetalle');
  }

  // Al elegir editar/eliminar desde el detalle se cierra primero ese modal.
  document.addEventListener('click', function (e) {
    var b = e.target.closest('#contenidoDetalle [data-editar-mov], #contenidoDetalle [data-eliminar-mov]');
    if (b) cerrarModal('modalDetalle');
  }, true);

  /* ==================================================================
     ARRANQUE
     ================================================================== */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inicializarApp);
  } else {
    inicializarApp();
  }

  // Expuesto para pruebas automatizadas en navegador sin interferir con la app.
  window.__app = { estado: estado, irA: irA, cargarDatos: cargarDatos, Core: Core };
})();
