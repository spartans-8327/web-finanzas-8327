/* =========================================================
   MIS FINANZAS - lógica de la aplicación
   Todo se guarda en localStorage. Sin frameworks, sin backend.
   ========================================================= */

const CLAVE_CONFIG = 'mf_config';
const CLAVE_MOVIMIENTOS = 'mf_movimientos';
const CLAVE_COMPRAS = 'mf_compras';

const NOMBRES_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

let config = { inicializado: false, dineroInicial: 0, fechaInicio: '' };
let movimientos = [];
let compras = [];

// Estado de la interfaz (no se guarda en localStorage)
let vistaHistorialActual = 'mensual'; // 'mensual' | 'completo'
let mesActual = { year: 0, month: 0 };
let filtroTipoActual = 'todos';
let filtroCategoriaActual = 'todas';
let productoParaGasto = null; // id del producto en flujo de "registrar como gasto"
let pendienteEliminar = null; // { tipo: 'movimiento'|'producto', id }

/* ================= UTILIDADES ================= */

function generarId(prefijo) {
  return prefijo + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function obtenerFechaHoy() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatearMoneda(valor) {
  const n = Number(valor) || 0;
  const esEntero = Math.abs(n - Math.round(n)) < 0.005;
  return '$' + n.toLocaleString('es-MX', {
    minimumFractionDigits: esEntero ? 0 : 2,
    maximumFractionDigits: 2
  });
}

function formatearFecha(fechaISO) {
  if (!fechaISO) return '';
  const [y, m, d] = fechaISO.split('-');
  return `${d}/${m}/${y}`;
}

function mostrarToast(mensaje, tipo = 'exito') {
  const contenedor = document.getElementById('toastContenedor');
  contenedor.innerHTML = ''; // solo un toast visible a la vez
  const toast = document.createElement('div');
  toast.className = `toast ${tipo}`;
  toast.textContent = mensaje;
  contenedor.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

function abrirModal(id) {
  document.getElementById(id).classList.remove('oculto');
}

function cerrarModal(id) {
  document.getElementById(id).classList.add('oculto');
}

/* ================= PERSISTENCIA ================= */

function cargarDatos() {
  try {
    const configGuardada = localStorage.getItem(CLAVE_CONFIG);
    const movimientosGuardados = localStorage.getItem(CLAVE_MOVIMIENTOS);
    const comprasGuardadas = localStorage.getItem(CLAVE_COMPRAS);

    config = configGuardada ? JSON.parse(configGuardada) : { inicializado: false, dineroInicial: 0, fechaInicio: '' };
    movimientos = movimientosGuardados ? JSON.parse(movimientosGuardados) : [];
    compras = comprasGuardadas ? JSON.parse(comprasGuardadas) : [];
  } catch (error) {
    console.error('Error al cargar datos de localStorage:', error);
    config = { inicializado: false, dineroInicial: 0, fechaInicio: '' };
    movimientos = [];
    compras = [];
  }
}

function guardarDatos() {
  localStorage.setItem(CLAVE_CONFIG, JSON.stringify(config));
  localStorage.setItem(CLAVE_MOVIMIENTOS, JSON.stringify(movimientos));
  localStorage.setItem(CLAVE_COMPRAS, JSON.stringify(compras));
}

/* ================= CÁLCULOS DE DINERO ================= */

function calcularSaldo() {
  let saldo = config.dineroInicial;
  movimientos.forEach(m => {
    saldo += (m.tipo === 'ingreso' ? m.cantidad : -m.cantidad);
  });
  return saldo;
}

// Devuelve los movimientos ordenados cronológicamente, cada uno con su saldo después.
function obtenerMovimientosConSaldo() {
  const ordenados = movimientos.slice().sort((a, b) => {
    if (a.fecha < b.fecha) return -1;
    if (a.fecha > b.fecha) return 1;
    return 0;
  });
  let saldo = config.dineroInicial;
  return ordenados.map(m => {
    saldo += (m.tipo === 'ingreso' ? m.cantidad : -m.cantidad);
    return Object.assign({}, m, { saldoDespues: saldo });
  });
}

/* ================= MOVIMIENTOS ================= */

function registrarMovimiento(datos) {
  const mov = {
    id: generarId('mov'),
    concepto: datos.concepto.trim(),
    tipo: datos.tipo,
    cantidad: Math.abs(Number(datos.cantidad)),
    fecha: datos.fecha,
    categoria: (datos.categoria || '').trim()
  };
  movimientos.push(mov);
  guardarDatos();
  return mov.id;
}

function editarMovimiento(id, datos) {
  const mov = movimientos.find(m => m.id === id);
  if (!mov) return;
  mov.concepto = datos.concepto.trim();
  mov.tipo = datos.tipo;
  mov.cantidad = Math.abs(Number(datos.cantidad));
  mov.fecha = datos.fecha;
  mov.categoria = (datos.categoria || '').trim();
  guardarDatos();
}

function eliminarMovimiento(id) {
  movimientos = movimientos.filter(m => m.id !== id);
  // Si algún producto de la lista de compras estaba ligado a este movimiento,
  // se libera la relación para que pueda volver a registrarse como gasto.
  compras.forEach(p => {
    if (p.movimientoIdRelacionado === id) {
      p.registradoComoGasto = false;
      p.movimientoIdRelacionado = null;
    }
  });
  guardarDatos();
}

/* ================= LISTA DE COMPRAS ================= */

function agregarProducto(datos) {
  const producto = {
    id: generarId('prod'),
    nombre: datos.nombre.trim(),
    cantidad: Math.round(Number(datos.cantidad)),
    precioEstimado: Number(datos.precioEstimado),
    precioReal: null,
    categoria: datos.categoria || '',
    estado: 'pendiente',
    registradoComoGasto: false,
    movimientoIdRelacionado: null
  };
  compras.push(producto);
  guardarDatos();
  return producto.id;
}

function editarProducto(id, datos) {
  const producto = compras.find(p => p.id === id);
  if (!producto) return;
  producto.nombre = datos.nombre.trim();
  producto.cantidad = Math.round(Number(datos.cantidad));
  producto.precioEstimado = Number(datos.precioEstimado);
  producto.categoria = datos.categoria || '';
  guardarDatos();
}

function eliminarProducto(id) {
  // Eliminar el producto NO elimina el movimiento financiero ya registrado.
  compras = compras.filter(p => p.id !== id);
  guardarDatos();
}

function cambiarEstadoProducto(id) {
  const producto = compras.find(p => p.id === id);
  if (!producto) return;
  producto.estado = producto.estado === 'comprado' ? 'pendiente' : 'comprado';
  guardarDatos();
}

function registrarProductoComoGasto(id) {
  const producto = compras.find(p => p.id === id);
  if (!producto) return;
  productoParaGasto = id;
  if (producto.registradoComoGasto) {
    abrirModal('modalDuplicado');
  } else {
    abrirModalGasto(producto);
  }
}

function confirmarGastoDeProducto(id, precioReal, fecha) {
  const producto = compras.find(p => p.id === id);
  if (!producto) return;
  producto.precioReal = precioReal;
  const movId = registrarMovimiento({
    concepto: producto.nombre,
    tipo: 'gasto',
    cantidad: precioReal,
    fecha: fecha,
    categoria: producto.categoria || ''
  });
  producto.registradoComoGasto = true;
  producto.movimientoIdRelacionado = movId;
  guardarDatos();
}

/* ================= RENDER: RESUMEN FINANCIERO ================= */

function actualizarResumen() {
  const ingresos = movimientos.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.cantidad, 0);
  const gastos = movimientos.filter(m => m.tipo === 'gasto').reduce((s, m) => s + m.cantidad, 0);
  const saldo = calcularSaldo();

  document.getElementById('saldoDisponible').textContent = formatearMoneda(saldo);
  document.getElementById('resumenInicial').textContent = formatearMoneda(config.dineroInicial);
  document.getElementById('resumenIngresos').textContent = '+' + formatearMoneda(ingresos);
  document.getElementById('resumenGastos').textContent = '-' + formatearMoneda(gastos);
  document.getElementById('resumenDisponible').textContent = formatearMoneda(saldo);
}

/* ================= RENDER: HISTORIAL ================= */

function crearFilaMovimiento(mov, esInicial) {
  const tr = document.createElement('tr');

  if (esInicial) {
    tr.innerHTML = `
      <td>Dinero inicial</td>
      <td><span class="etiqueta-tipo inicial">Inicial</span></td>
      <td>${formatearMoneda(mov.saldoDespues)}</td>
      <td>${formatearFecha(mov.fecha)}</td>
      <td>${formatearMoneda(mov.saldoDespues)}</td>
      <td></td>`;
    return tr;
  }

  const esIngreso = mov.tipo === 'ingreso';
  const signo = esIngreso ? '+' : '-';
  const claseMonto = esIngreso ? 'monto-ingreso' : 'monto-gasto';

  tr.innerHTML = `
    <td>${escaparHtml(mov.concepto)}</td>
    <td><span class="etiqueta-tipo ${mov.tipo}">${esIngreso ? 'Ingreso' : 'Gasto'}</span></td>
    <td class="${claseMonto}">${signo}${formatearMoneda(mov.cantidad)}</td>
    <td>${formatearFecha(mov.fecha)}</td>
    <td>${formatearMoneda(mov.saldoDespues)}</td>
    <td>
      <div class="acciones-fila">
        <button class="btn-enlace" data-accion="editar-mov" data-id="${mov.id}">Editar</button>
        <button class="btn-enlace peligro" data-accion="eliminar-mov" data-id="${mov.id}">Eliminar</button>
      </div>
    </td>`;
  return tr;
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto;
  return div.innerHTML;
}

function renderizarHistorial() {
  if (vistaHistorialActual === 'mensual') {
    renderizarHistorialMensual();
  } else {
    renderizarHistorialCompleto();
  }
}

function renderizarHistorialMensual() {
  document.getElementById('etiquetaMes').textContent =
    `${NOMBRES_MES[mesActual.month]} ${mesActual.year}`;

  const todasConSaldo = obtenerMovimientosConSaldo();

  const delMes = todasConSaldo.filter(m => {
    const [y, mo] = m.fecha.split('-').map(Number);
    return y === mesActual.year && (mo - 1) === mesActual.month;
  });

  const anteriores = todasConSaldo.filter(m => {
    const [y, mo] = m.fecha.split('-').map(Number);
    return (y < mesActual.year) || (y === mesActual.year && (mo - 1) < mesActual.month);
  });

  const fechaInicioObj = config.fechaInicio ? config.fechaInicio.split('-').map(Number) : null;
  const inicialEnEsteMes = fechaInicioObj &&
    fechaInicioObj[0] === mesActual.year && (fechaInicioObj[1] - 1) === mesActual.month;

  const sinMovimientos = delMes.length === 0 && !inicialEnEsteMes;

  document.getElementById('mesSinMovimientos').classList.toggle('oculto', !sinMovimientos);
  document.getElementById('mesConMovimientos').classList.toggle('oculto', sinMovimientos);

  if (sinMovimientos) return;

  const saldoInicialPeriodo = anteriores.length
    ? anteriores[anteriores.length - 1].saldoDespues
    : config.dineroInicial;

  const ingresosMes = delMes.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.cantidad, 0);
  const gastosMes = delMes.filter(m => m.tipo === 'gasto').reduce((s, m) => s + m.cantidad, 0);
  const saldoFinal = saldoInicialPeriodo + ingresosMes - gastosMes;
  const numIngresos = delMes.filter(m => m.tipo === 'ingreso').length;
  const numGastos = delMes.filter(m => m.tipo === 'gasto').length;

  document.getElementById('mesInicial').textContent = formatearMoneda(saldoInicialPeriodo);
  document.getElementById('mesIngresos').textContent = '+' + formatearMoneda(ingresosMes);
  document.getElementById('mesGastos').textContent = '-' + formatearMoneda(gastosMes);
  document.getElementById('mesSaldoFinal').textContent = formatearMoneda(saldoFinal);
  document.getElementById('mesNumMovimientos').textContent = delMes.length;
  document.getElementById('mesNumIngresos').textContent = numIngresos;
  document.getElementById('mesNumGastos').textContent = numGastos;

  // Gastos por categoría del mes
  const categoriasDiv = document.getElementById('categoriasMes');
  const gastosPorCategoria = {};
  delMes.filter(m => m.tipo === 'gasto').forEach(m => {
    const cat = m.categoria || 'Sin categoría';
    gastosPorCategoria[cat] = (gastosPorCategoria[cat] || 0) + m.cantidad;
  });
  const categoriasOrdenadas = Object.entries(gastosPorCategoria).sort((a, b) => b[1] - a[1]);
  if (categoriasOrdenadas.length === 0) {
    categoriasDiv.innerHTML = '';
  } else {
    const maxMonto = categoriasOrdenadas[0][1];
    categoriasDiv.innerHTML = '<h3 style="font-size:0.85rem;color:var(--color-texto-suave);margin:0 0 8px;">Gastos por categoría</h3>' +
      categoriasOrdenadas.map(([cat, monto]) => `
        <div class="categoria-fila">
          <span class="categoria-nombre">${escaparHtml(cat)}</span>
          <span class="categoria-barra-fondo"><span class="categoria-barra" style="width:${(monto / maxMonto) * 100}%"></span></span>
          <span class="categoria-monto">${formatearMoneda(monto)}</span>
        </div>`).join('');
  }

  // Tabla de movimientos del mes
  const tbody = document.querySelector('#tablaMovimientosMes tbody');
  tbody.innerHTML = '';
  if (inicialEnEsteMes) {
    tbody.appendChild(crearFilaMovimiento({ fecha: config.fechaInicio, saldoDespues: config.dineroInicial }, true));
  }
  delMes.forEach(m => tbody.appendChild(crearFilaMovimiento(m, false)));
}

function cambiarMes(delta) {
  let m = mesActual.month + delta;
  let y = mesActual.year;
  if (m < 0) { m = 11; y -= 1; }
  if (m > 11) { m = 0; y += 1; }
  mesActual = { year: y, month: m };
  renderizarHistorialMensual();
}

function actualizarSelectCategorias() {
  const select = document.getElementById('filtroCategoria');
  const valorActual = select.value;
  const categorias = new Set();
  movimientos.forEach(m => { if (m.categoria) categorias.add(m.categoria); });

  select.innerHTML = '<option value="todas">Todas las categorías</option>' +
    Array.from(categorias).sort().map(c => `<option value="${escaparHtml(c)}">${escaparHtml(c)}</option>`).join('');

  if (Array.from(select.options).some(o => o.value === valorActual)) {
    select.value = valorActual;
  } else {
    filtroCategoriaActual = 'todas';
  }
}

function renderizarHistorialCompleto() {
  actualizarSelectCategorias();

  const desde = document.getElementById('filtroDesde').value;
  const hasta = document.getElementById('filtroHasta').value;

  const todasConSaldo = obtenerMovimientosConSaldo();

  let filtradas = todasConSaldo.filter(m => {
    if (filtroTipoActual !== 'todos' && m.tipo !== filtroTipoActual) return false;
    if (filtroCategoriaActual !== 'todas' && (m.categoria || '') !== filtroCategoriaActual) return false;
    if (desde && m.fecha < desde) return false;
    if (hasta && m.fecha > hasta) return false;
    return true;
  });

  const tbody = document.querySelector('#tablaMovimientosCompleta tbody');
  tbody.innerHTML = '';

  const mostrarInicial = filtroTipoActual === 'todos' && filtroCategoriaActual === 'todas' &&
    (!desde || desde <= config.fechaInicio) && (!hasta || hasta >= config.fechaInicio);

  if (mostrarInicial) {
    tbody.appendChild(crearFilaMovimiento({ fecha: config.fechaInicio, saldoDespues: config.dineroInicial }, true));
  }

  filtradas.forEach(m => tbody.appendChild(crearFilaMovimiento(m, false)));

  if (!mostrarInicial && filtradas.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6" style="text-align:center;color:var(--color-texto-suave);padding:24px;">Sin movimientos que coincidan con el filtro.</td>';
    tbody.appendChild(tr);
  }
}

/* ================= RENDER: LISTA DE COMPRAS ================= */

function montoDelProducto(p) {
  return p.precioReal != null ? p.precioReal : p.precioEstimado;
}

function renderizarListaCompras() {
  const lista = document.getElementById('listaCompras');
  const vacio = document.getElementById('listaComprasVacia');
  lista.innerHTML = '';

  vacio.classList.toggle('oculto', compras.length > 0);

  compras.forEach(p => {
    const li = document.createElement('li');
    li.className = 'producto-item' + (p.estado === 'comprado' ? ' comprado' : '');

    const precioMostrar = montoDelProducto(p);
    let detalleTexto = `${p.cantidad} ${p.cantidad === 1 ? 'unidad' : 'unidades'} · ${formatearMoneda(precioMostrar)}`;
    if (p.categoria) detalleTexto += ` · ${p.categoria}`;

    let estadoHtml = '';
    if (p.estado === 'pendiente') {
      estadoHtml = '<span class="producto-estado pendiente">Pendiente</span>';
    } else if (p.registradoComoGasto) {
      estadoHtml = '<span class="producto-estado registrado">Registrado como gasto</span>';
    } else {
      estadoHtml = '<span class="producto-estado comprado">Comprado</span>';
    }

    let precioRealHtml = '';
    if (p.precioReal != null && p.precioReal !== p.precioEstimado) {
      precioRealHtml = `<div class="producto-precio-real">Real: ${formatearMoneda(p.precioReal)} (estimado ${formatearMoneda(p.precioEstimado)})</div>`;
    }

    const botonGasto = p.estado === 'comprado'
      ? `<button class="btn-enlace" data-accion="registrar-gasto" data-id="${p.id}">Registrar como gasto</button>`
      : '';

    li.innerHTML = `
      <input type="checkbox" class="producto-checkbox" data-accion="toggle-estado" data-id="${p.id}" ${p.estado === 'comprado' ? 'checked' : ''}>
      <div class="producto-info">
        <p class="producto-nombre">${escaparHtml(p.nombre)}</p>
        ${estadoHtml}
        <p class="producto-detalle">${detalleTexto}</p>
        ${precioRealHtml}
        <div class="producto-acciones">
          ${botonGasto}
          <button class="btn-enlace" data-accion="editar-prod" data-id="${p.id}">Editar</button>
          <button class="btn-enlace peligro" data-accion="eliminar-prod" data-id="${p.id}">Eliminar</button>
        </div>
      </div>`;
    lista.appendChild(li);
  });

  const pendientesTotal = compras.filter(p => p.estado === 'pendiente').reduce((s, p) => s + montoDelProducto(p), 0);
  const realizadasTotal = compras.filter(p => p.estado === 'comprado').reduce((s, p) => s + montoDelProducto(p), 0);

  document.getElementById('comprasPendientesTotal').textContent = formatearMoneda(pendientesTotal);
  document.getElementById('comprasRealizadasTotal').textContent = formatearMoneda(realizadasTotal);
  document.getElementById('comprasEstimadoTotal').textContent = formatearMoneda(pendientesTotal + realizadasTotal);
}

/* ================= RENDER GENERAL ================= */

function renderizarTodo() {
  actualizarResumen();
  renderizarHistorial();
  renderizarListaCompras();
}

/* ================= MODAL: MOVIMIENTO ================= */

function abrirModalMovimiento(mov) {
  const form = document.getElementById('formMovimiento');
  form.reset();
  document.getElementById('errorMovimiento').classList.add('oculto');

  if (mov) {
    document.getElementById('tituloModalMovimiento').textContent = 'Editar movimiento';
    document.getElementById('movimientoId').value = mov.id;
    document.getElementById('movimientoConcepto').value = mov.concepto;
    document.getElementById('movimientoTipo').value = mov.tipo;
    document.getElementById('movimientoCantidad').value = mov.cantidad;
    document.getElementById('movimientoFecha').value = mov.fecha;
    document.getElementById('movimientoCategoria').value = mov.categoria || '';
  } else {
    document.getElementById('tituloModalMovimiento').textContent = 'Registrar movimiento';
    document.getElementById('movimientoId').value = '';
    document.getElementById('movimientoFecha').value = obtenerFechaHoy();
  }
  abrirModal('modalMovimiento');
}

function manejarSubmitMovimiento(e) {
  e.preventDefault();
  const errorEl = document.getElementById('errorMovimiento');

  const id = document.getElementById('movimientoId').value;
  const concepto = document.getElementById('movimientoConcepto').value.trim();
  const tipo = document.getElementById('movimientoTipo').value;
  const cantidad = parseFloat(document.getElementById('movimientoCantidad').value);
  const fecha = document.getElementById('movimientoFecha').value;
  const categoria = document.getElementById('movimientoCategoria').value.trim();

  if (!concepto) {
    return mostrarError(errorEl, 'El concepto no puede estar vacío.');
  }
  if (isNaN(cantidad) || cantidad <= 0) {
    return mostrarError(errorEl, 'La cantidad debe ser un número mayor a cero.');
  }
  if (!fecha) {
    return mostrarError(errorEl, 'Selecciona una fecha válida.');
  }

  errorEl.classList.add('oculto');
  const datos = { concepto, tipo, cantidad, fecha, categoria };

  if (id) {
    editarMovimiento(id, datos);
    mostrarToast('Movimiento actualizado.');
  } else {
    registrarMovimiento(datos);
    mostrarToast('Movimiento guardado.');
  }

  cerrarModal('modalMovimiento');
  renderizarTodo();
}

function mostrarError(elemento, mensaje) {
  elemento.textContent = mensaje;
  elemento.classList.remove('oculto');
}

/* ================= MODAL: PRODUCTO ================= */

function abrirModalProducto(producto) {
  const form = document.getElementById('formProducto');
  form.reset();
  document.getElementById('errorProducto').classList.add('oculto');

  if (producto) {
    document.getElementById('tituloModalProducto').textContent = 'Editar producto';
    document.getElementById('productoId').value = producto.id;
    document.getElementById('productoNombre').value = producto.nombre;
    document.getElementById('productoCantidad').value = producto.cantidad;
    document.getElementById('productoPrecio').value = producto.precioEstimado;
    document.getElementById('productoCategoria').value = producto.categoria || '';
  } else {
    document.getElementById('tituloModalProducto').textContent = 'Agregar producto';
    document.getElementById('productoId').value = '';
  }
  abrirModal('modalProducto');
}

function manejarSubmitProducto(e) {
  e.preventDefault();
  const errorEl = document.getElementById('errorProducto');

  const id = document.getElementById('productoId').value;
  const nombre = document.getElementById('productoNombre').value.trim();
  const cantidad = parseInt(document.getElementById('productoCantidad').value, 10);
  const precio = parseFloat(document.getElementById('productoPrecio').value);
  const categoria = document.getElementById('productoCategoria').value;

  if (!nombre) {
    return mostrarError(errorEl, 'Escribe qué necesitas comprar.');
  }
  if (isNaN(cantidad) || cantidad <= 0) {
    return mostrarError(errorEl, 'La cantidad debe ser un número entero mayor a cero.');
  }
  if (isNaN(precio) || precio <= 0) {
    return mostrarError(errorEl, 'El precio estimado debe ser mayor a cero.');
  }

  errorEl.classList.add('oculto');
  const datos = { nombre, cantidad, precioEstimado: precio, categoria };

  if (id) {
    editarProducto(id, datos);
    mostrarToast('Producto actualizado.');
  } else {
    agregarProducto(datos);
    mostrarToast('Producto agregado a la lista.');
  }

  cerrarModal('modalProducto');
  renderizarTodo();
}

/* ================= MODAL: REGISTRAR GASTO ================= */

function abrirModalGasto(producto) {
  document.getElementById('errorGasto').classList.add('oculto');
  document.getElementById('gastoProductoId').value = producto.id;
  document.getElementById('gastoConcepto').textContent = producto.nombre;
  document.getElementById('gastoCantidadInfo').textContent =
    `${producto.cantidad} ${producto.cantidad === 1 ? 'unidad' : 'unidades'} · Estimado ${formatearMoneda(producto.precioEstimado)}`;
  document.getElementById('gastoPrecioReal').value = producto.precioEstimado;
  document.getElementById('gastoFecha').value = obtenerFechaHoy();
  abrirModal('modalGasto');
}

function manejarSubmitGasto(e) {
  e.preventDefault();
  const errorEl = document.getElementById('errorGasto');

  const id = document.getElementById('gastoProductoId').value;
  const precioReal = parseFloat(document.getElementById('gastoPrecioReal').value);
  const fecha = document.getElementById('gastoFecha').value;

  if (isNaN(precioReal) || precioReal <= 0) {
    return mostrarError(errorEl, 'El precio real debe ser mayor a cero.');
  }
  if (!fecha) {
    return mostrarError(errorEl, 'Selecciona una fecha válida.');
  }

  errorEl.classList.add('oculto');
  confirmarGastoDeProducto(id, precioReal, fecha);
  mostrarToast('Gasto registrado en el historial.');
  cerrarModal('modalGasto');
  renderizarTodo();
}

/* ================= MODAL: CONFIRMAR ELIMINAR ================= */

function pedirConfirmacionEliminar(tipo, id, nombre) {
  pendienteEliminar = { tipo, id };
  document.getElementById('mensajeConfirmarEliminar').textContent =
    `¿Deseas eliminar "${nombre}"? Esta acción no se puede deshacer.`;
  abrirModal('modalConfirmarEliminar');
}

function ejecutarEliminacionPendiente() {
  if (!pendienteEliminar) return;
  if (pendienteEliminar.tipo === 'movimiento') {
    eliminarMovimiento(pendienteEliminar.id);
    mostrarToast('Movimiento eliminado.');
  } else if (pendienteEliminar.tipo === 'producto') {
    eliminarProducto(pendienteEliminar.id);
    mostrarToast('Producto eliminado.');
  }
  pendienteEliminar = null;
  cerrarModal('modalConfirmarEliminar');
  renderizarTodo();
}

/* ================= INICIALIZACIÓN ================= */

function manejarClicksGlobal(e) {
  const btn = e.target.closest('[data-accion]');
  if (!btn) return;
  const accion = btn.dataset.accion;
  const id = btn.dataset.id;

  if (accion === 'editar-mov') {
    const mov = movimientos.find(m => m.id === id);
    if (mov) abrirModalMovimiento(mov);
  } else if (accion === 'eliminar-mov') {
    const mov = movimientos.find(m => m.id === id);
    if (mov) pedirConfirmacionEliminar('movimiento', id, mov.concepto);
  } else if (accion === 'editar-prod') {
    const prod = compras.find(p => p.id === id);
    if (prod) abrirModalProducto(prod);
  } else if (accion === 'eliminar-prod') {
    const prod = compras.find(p => p.id === id);
    if (prod) pedirConfirmacionEliminar('producto', id, prod.nombre);
  } else if (accion === 'registrar-gasto') {
    registrarProductoComoGasto(id);
  } else if (accion === 'toggle-estado') {
    cambiarEstadoProducto(id);
    renderizarTodo();
  }
}

function configurarEventos() {
  // Pantalla inicial
  document.getElementById('btnComenzar').addEventListener('click', () => {
    const input = document.getElementById('inputDineroInicial');
    const errorEl = document.getElementById('errorDineroInicial');
    const valor = parseFloat(input.value);

    if (input.value.trim() === '' || isNaN(valor) || valor < 0) {
      return mostrarError(errorEl, 'Ingresa una cantidad válida (cero o mayor).');
    }
    errorEl.classList.add('oculto');

    config = { inicializado: true, dineroInicial: valor, fechaInicio: obtenerFechaHoy() };
    guardarDatos();
    mostrarAppPrincipal();
  });

  document.getElementById('inputDineroInicial').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnComenzar').click();
  });

  // Botones principales
  document.getElementById('btnAbrirMovimiento').addEventListener('click', () => abrirModalMovimiento(null));
  document.getElementById('btnAbrirProducto').addEventListener('click', () => abrirModalProducto(null));

  // Formularios
  document.getElementById('formMovimiento').addEventListener('submit', manejarSubmitMovimiento);
  document.getElementById('formProducto').addEventListener('submit', manejarSubmitProducto);
  document.getElementById('formGasto').addEventListener('submit', manejarSubmitGasto);

  // Cerrar modales
  document.querySelectorAll('[data-cerrar]').forEach(btn => {
    btn.addEventListener('click', () => cerrarModal(btn.dataset.cerrar));
  });
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('oculto');
    });
  });

  // Duplicado de gasto
  document.getElementById('btnRegistrarOtroGasto').addEventListener('click', () => {
    cerrarModal('modalDuplicado');
    const producto = compras.find(p => p.id === productoParaGasto);
    if (producto) abrirModalGasto(producto);
  });

  // Confirmar eliminación
  document.getElementById('btnConfirmarEliminar').addEventListener('click', ejecutarEliminacionPendiente);

  // Reiniciar datos
  document.getElementById('btnReiniciarDatos').addEventListener('click', () => abrirModal('modalReiniciar'));
  document.getElementById('btnConfirmarReiniciar').addEventListener('click', () => {
    localStorage.removeItem(CLAVE_CONFIG);
    localStorage.removeItem(CLAVE_MOVIMIENTOS);
    localStorage.removeItem(CLAVE_COMPRAS);
    location.reload();
  });

  // Tabs de historial
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      vistaHistorialActual = btn.dataset.vista;
      document.getElementById('vistaMensual').classList.toggle('oculto', vistaHistorialActual !== 'mensual');
      document.getElementById('vistaCompleta').classList.toggle('oculto', vistaHistorialActual !== 'completo');
      renderizarHistorial();
    });
  });

  // Navegación de mes
  document.getElementById('btnMesAnterior').addEventListener('click', () => cambiarMes(-1));
  document.getElementById('btnMesSiguiente').addEventListener('click', () => cambiarMes(1));

  // Filtros de historial completo
  document.querySelectorAll('.filtro-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filtro-btn').forEach(b => b.classList.remove('activo'));
      btn.classList.add('activo');
      filtroTipoActual = btn.dataset.filtro;
      renderizarHistorialCompleto();
    });
  });
  document.getElementById('filtroCategoria').addEventListener('change', (e) => {
    filtroCategoriaActual = e.target.value;
    renderizarHistorialCompleto();
  });
  document.getElementById('filtroDesde').addEventListener('change', renderizarHistorialCompleto);
  document.getElementById('filtroHasta').addEventListener('change', renderizarHistorialCompleto);

  // Delegación de eventos para filas dinámicas (historial y lista de compras)
  document.addEventListener('click', manejarClicksGlobal);
  document.addEventListener('change', manejarClicksGlobal);
}

function mostrarAppPrincipal() {
  document.getElementById('pantallaInicio').classList.add('oculto');
  document.getElementById('app').classList.remove('oculto');

  const hoy = new Date();
  mesActual = { year: hoy.getFullYear(), month: hoy.getMonth() };

  renderizarTodo();
}

function inicializarApp() {
  cargarDatos();
  configurarEventos();

  if (config.inicializado) {
    mostrarAppPrincipal();
  } else {
    document.getElementById('pantallaInicio').classList.remove('oculto');
  }
}

document.addEventListener('DOMContentLoaded', inicializarApp);
