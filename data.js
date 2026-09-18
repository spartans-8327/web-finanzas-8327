/* =========================================================================
   MIS FINANZAS — SPARTANS 83-27
   data.js — Capa de datos.

   Toda la persistencia pasa por aquí. Supabase es la fuente de verdad:
   los datos financieros NO viven en el navegador. El único almacenamiento
   local que se usa es para preferencias de interfaz (ver script.js).

   Si config.js todavía no tiene credenciales, la aplicación arranca en
   "modo local de prueba" para que se pueda evaluar la interfaz antes de
   conectar Supabase. Ese modo se anuncia claramente en pantalla y no
   sincroniza entre dispositivos.
   ========================================================================= */
(function (global) {
  'use strict';

  var CLAVE_LOCAL = 'spartans_finanzas_local_v1';

  var Datos = {
    modo: 'local',        // 'supabase' | 'local'
    cliente: null,
    usuario: null,
    equipoId: null,
    equipoPublico: true,
    error: null
  };

  /* ------------------------------------------------------------------
     TRADUCCIÓN ENTRE LA BASE DE DATOS Y LA APLICACIÓN
     La base usa snake_case; la aplicación usa camelCase.
     ------------------------------------------------------------------ */

  function aMovimiento(fila) {
    return {
      id: fila.id,
      concepto: fila.concepto,
      tipo: fila.tipo,
      cantidad: Number(fila.cantidad),
      fecha: String(fila.fecha).slice(0, 10),
      area: fila.area || 'general',
      categoria: fila.categoria || 'Otros',
      notas: fila.notas || '',
      compraId: fila.compra_id || null,
      creadoEn: fila.created_at || '',
      creadoPor: fila.created_by || null,
      modificadoPor: fila.updated_by || null
    };
  }

  function aCompra(fila) {
    return {
      id: fila.id,
      nombre: fila.nombre,
      cantidad: Number(fila.cantidad),
      precioEstimado: Number(fila.precio_estimado),
      precioReal: (fila.precio_real === null || fila.precio_real === undefined) ? null : Number(fila.precio_real),
      area: fila.area || 'general',
      categoria: fila.categoria || 'Otros',
      estado: fila.estado || 'pendiente',
      notas: fila.notas || '',
      fechaCompra: fila.fecha_compra ? String(fila.fecha_compra).slice(0, 10) : null,
      registradoComoGasto: !!fila.registrado_como_gasto,
      movimientoId: fila.movimiento_id || null,
      creadoEn: fila.created_at || '',
      creadoPor: fila.created_by || null
    };
  }

  function aConfig(fila) {
    return {
      id: fila.id,
      nombreEquipo: fila.nombre || 'Spartans 83-27',
      dineroInicial: Number(fila.dinero_inicial),
      fechaInicio: String(fila.fecha_inicio).slice(0, 10),
      publico: fila.publico !== false,
      ownerId: fila.owner_id || null,
      creadoEn: fila.created_at || ''
    };
  }

  function filaMovimiento(d, equipoId, uid) {
    return {
      equipo_id: equipoId,
      concepto: d.concepto,
      tipo: d.tipo,
      cantidad: d.cantidad,
      fecha: d.fecha,
      area: d.area,
      categoria: d.categoria,
      notas: d.notas || null,
      compra_id: d.compraId || null,
      created_by: uid || null,
      updated_by: uid || null
    };
  }

  function filaCompra(d, equipoId, uid) {
    return {
      equipo_id: equipoId,
      nombre: d.nombre,
      cantidad: d.cantidad,
      precio_estimado: d.precioEstimado,
      area: d.area,
      categoria: d.categoria,
      notas: d.notas || null,
      created_by: uid || null
    };
  }

  /* ==================================================================
     RESPALDO LOCAL (solo mientras no hay credenciales de Supabase)
     ================================================================== */

  function leerLocal() {
    try {
      var crudo = localStorage.getItem(CLAVE_LOCAL);
      if (crudo) return JSON.parse(crudo);
    } catch (e) { /* almacenamiento no disponible */ }
    return { config: null, movimientos: [], compras: [], sesion: null };
  }

  function escribirLocal(datos) {
    try { localStorage.setItem(CLAVE_LOCAL, JSON.stringify(datos)); }
    catch (e) { console.warn('No se pudo guardar localmente:', e); }
  }

  function idLocal(prefijo) {
    return prefijo + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  var backendLocal = {
    async sesionActual() {
      var d = leerLocal();
      return d.sesion ? { email: d.sesion } : null;
    },
    async iniciarSesion(email, password) {
      if (!email || !password) throw new Error('Escribe el correo y la contraseña.');
      if (String(password).length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
      var d = leerLocal();
      d.sesion = email;
      escribirLocal(d);
      return { email: email };
    },
    async cerrarSesion() {
      var d = leerLocal();
      d.sesion = null;
      escribirLocal(d);
    },
    async cargarTodo() {
      var d = leerLocal();
      return {
        config: d.config,
        movimientos: (d.movimientos || []).slice(),
        compras: (d.compras || []).slice()
      };
    },
    async crearEquipo(dineroInicial) {
      var d = leerLocal();
      d.config = {
        id: idLocal('eq'),
        nombreEquipo: 'Spartans 83-27',
        dineroInicial: dineroInicial,
        fechaInicio: new Date().toISOString().slice(0, 10),
        publico: true,
        ownerId: d.sesion || null,
        creadoEn: new Date().toISOString()
      };
      d.movimientos = d.movimientos || [];
      d.compras = d.compras || [];
      escribirLocal(d);
      return d.config;
    },
    async actualizarDineroInicial(valor) {
      var d = leerLocal();
      if (d.config) { d.config.dineroInicial = valor; escribirLocal(d); }
    },
    async crearMovimiento(datos) {
      var d = leerLocal();
      var m = {
        id: idLocal('mov'), concepto: datos.concepto, tipo: datos.tipo,
        cantidad: datos.cantidad, fecha: datos.fecha, area: datos.area,
        categoria: datos.categoria, notas: datos.notas || '',
        compraId: datos.compraId || null, creadoEn: new Date().toISOString(),
        creadoPor: d.sesion || null, modificadoPor: d.sesion || null
      };
      d.movimientos.push(m);
      escribirLocal(d);
      return m;
    },
    async actualizarMovimiento(id, datos) {
      var d = leerLocal();
      var m = d.movimientos.find(function (x) { return x.id === id; });
      if (!m) throw new Error('El movimiento ya no existe.');
      ['concepto', 'tipo', 'cantidad', 'fecha', 'area', 'categoria', 'notas'].forEach(function (k) {
        if (datos[k] !== undefined) m[k] = datos[k];
      });
      m.modificadoPor = d.sesion || null;
      escribirLocal(d);
      return m;
    },
    async eliminarMovimiento(id) {
      var d = leerLocal();
      d.movimientos = d.movimientos.filter(function (m) { return m.id !== id; });
      // Liberar la compra ligada: el producto sigue existiendo, solo deja
      // de estar marcado como registrado para poder volver a registrarlo.
      d.compras.forEach(function (c) {
        if (c.movimientoId === id) { c.movimientoId = null; c.registradoComoGasto = false; }
      });
      escribirLocal(d);
    },
    async crearCompra(datos) {
      var d = leerLocal();
      var c = {
        id: idLocal('cmp'), nombre: datos.nombre, cantidad: datos.cantidad,
        precioEstimado: datos.precioEstimado, precioReal: null, area: datos.area,
        categoria: datos.categoria, estado: 'pendiente', notas: datos.notas || '',
        fechaCompra: null, registradoComoGasto: false, movimientoId: null,
        creadoEn: new Date().toISOString(), creadoPor: d.sesion || null
      };
      d.compras.push(c);
      escribirLocal(d);
      return c;
    },
    async actualizarCompra(id, datos) {
      var d = leerLocal();
      var c = d.compras.find(function (x) { return x.id === id; });
      if (!c) throw new Error('El producto ya no existe.');
      ['nombre', 'cantidad', 'precioEstimado', 'precioReal', 'area', 'categoria', 'estado', 'notas', 'fechaCompra', 'registradoComoGasto', 'movimientoId'].forEach(function (k) {
        if (datos[k] !== undefined) c[k] = datos[k];
      });
      escribirLocal(d);
      return c;
    },
    async eliminarCompra(id) {
      var d = leerLocal();
      d.compras = d.compras.filter(function (c) { return c.id !== id; });
      // El movimiento financiero asociado NO se elimina (§23).
      d.movimientos.forEach(function (m) { if (m.compraId === id) m.compraId = null; });
      escribirLocal(d);
    },
    async reiniciarDatos() {
      var d = leerLocal();
      escribirLocal({ config: null, movimientos: [], compras: [], sesion: d.sesion });
    }
  };

  /* ==================================================================
     BACKEND SUPABASE
     ================================================================== */

  function sb() { return Datos.cliente; }

  function revisar(respuesta) {
    if (respuesta.error) {
      var msg = respuesta.error.message || 'Error de conexión con Supabase.';
      if (/row-level security|violates row-level/i.test(msg)) {
        msg = 'No tienes permiso para realizar esta acción. Inicia sesión con la cuenta del equipo.';
      }
      throw new Error(msg);
    }
    return respuesta.data;
  }

  var backendSupabase = {
    async sesionActual() {
      var r = await sb().auth.getSession();
      var sesion = r.data && r.data.session;
      return sesion ? sesion.user : null;
    },
    async iniciarSesion(email, password) {
      var r = await sb().auth.signInWithPassword({ email: email, password: password });
      if (r.error) {
        var m = r.error.message || '';
        if (/invalid login credentials/i.test(m)) throw new Error('Correo o contraseña incorrectos.');
        if (/email not confirmed/i.test(m)) throw new Error('La cuenta aún no ha confirmado su correo.');
        throw new Error(m || 'No se pudo iniciar sesión.');
      }
      return r.data.user;
    },
    async cerrarSesion() {
      await sb().auth.signOut();
    },

    // Selecciona el equipo de trabajo: el del usuario autenticado si hay
    // sesión, o el primer equipo público para la vista de consulta.
    async resolverEquipo() {
      var r = await sb().from('equipos').select('*').order('created_at', { ascending: true }).limit(1);
      var filas = revisar(r);
      if (!filas || !filas.length) return null;
      return aConfig(filas[0]);
    },

    async cargarTodo() {
      var config = await this.resolverEquipo();
      if (!config) return { config: null, movimientos: [], compras: [] };
      Datos.equipoId = config.id;
      Datos.equipoPublico = config.publico;

      var resultados = await Promise.all([
        sb().from('movimientos').select('*').eq('equipo_id', config.id).order('fecha', { ascending: true }),
        sb().from('compras').select('*').eq('equipo_id', config.id).order('created_at', { ascending: true })
      ]);
      return {
        config: config,
        movimientos: revisar(resultados[0]).map(aMovimiento),
        compras: revisar(resultados[1]).map(aCompra)
      };
    },

    async crearEquipo(dineroInicial) {
      var uid = Datos.usuario && Datos.usuario.id;
      var r = await sb().from('equipos').insert({
        nombre: 'Spartans 83-27',
        dinero_inicial: dineroInicial,
        fecha_inicio: new Date().toISOString().slice(0, 10),
        publico: true,
        owner_id: uid
      }).select().single();
      var fila = revisar(r);
      Datos.equipoId = fila.id;
      return aConfig(fila);
    },

    async actualizarDineroInicial(valor) {
      revisar(await sb().from('equipos').update({ dinero_inicial: valor }).eq('id', Datos.equipoId));
    },

    async crearMovimiento(datos) {
      var uid = Datos.usuario && Datos.usuario.id;
      var r = await sb().from('movimientos')
        .insert(filaMovimiento(datos, Datos.equipoId, uid)).select().single();
      return aMovimiento(revisar(r));
    },

    async actualizarMovimiento(id, datos) {
      var uid = Datos.usuario && Datos.usuario.id;
      var cambios = { updated_by: uid || null };
      if (datos.concepto !== undefined) cambios.concepto = datos.concepto;
      if (datos.tipo !== undefined) cambios.tipo = datos.tipo;
      if (datos.cantidad !== undefined) cambios.cantidad = datos.cantidad;
      if (datos.fecha !== undefined) cambios.fecha = datos.fecha;
      if (datos.area !== undefined) cambios.area = datos.area;
      if (datos.categoria !== undefined) cambios.categoria = datos.categoria;
      if (datos.notas !== undefined) cambios.notas = datos.notas || null;
      var r = await sb().from('movimientos').update(cambios).eq('id', id).select().single();
      return aMovimiento(revisar(r));
    },

    async eliminarMovimiento(id) {
      // Primero se libera la compra ligada para no dejar productos marcados
      // como "registrados" apuntando a un movimiento inexistente.
      revisar(await sb().from('compras')
        .update({ registrado_como_gasto: false, movimiento_id: null })
        .eq('movimiento_id', id));
      revisar(await sb().from('movimientos').delete().eq('id', id));
    },

    async crearCompra(datos) {
      var uid = Datos.usuario && Datos.usuario.id;
      var r = await sb().from('compras')
        .insert(filaCompra(datos, Datos.equipoId, uid)).select().single();
      return aCompra(revisar(r));
    },

    async actualizarCompra(id, datos) {
      var cambios = {};
      if (datos.nombre !== undefined) cambios.nombre = datos.nombre;
      if (datos.cantidad !== undefined) cambios.cantidad = datos.cantidad;
      if (datos.precioEstimado !== undefined) cambios.precio_estimado = datos.precioEstimado;
      if (datos.precioReal !== undefined) cambios.precio_real = datos.precioReal;
      if (datos.area !== undefined) cambios.area = datos.area;
      if (datos.categoria !== undefined) cambios.categoria = datos.categoria;
      if (datos.estado !== undefined) cambios.estado = datos.estado;
      if (datos.notas !== undefined) cambios.notas = datos.notas || null;
      if (datos.fechaCompra !== undefined) cambios.fecha_compra = datos.fechaCompra;
      if (datos.registradoComoGasto !== undefined) cambios.registrado_como_gasto = datos.registradoComoGasto;
      if (datos.movimientoId !== undefined) cambios.movimiento_id = datos.movimientoId;
      var r = await sb().from('compras').update(cambios).eq('id', id).select().single();
      return aCompra(revisar(r));
    },

    async eliminarCompra(id) {
      // El movimiento financiero asociado sobrevive (§23): solo se desliga.
      revisar(await sb().from('movimientos').update({ compra_id: null }).eq('compra_id', id));
      revisar(await sb().from('compras').delete().eq('id', id));
    },

    async reiniciarDatos() {
      revisar(await sb().from('compras').delete().eq('equipo_id', Datos.equipoId));
      revisar(await sb().from('movimientos').delete().eq('equipo_id', Datos.equipoId));
      revisar(await sb().from('equipos').delete().eq('id', Datos.equipoId));
      Datos.equipoId = null;
    }
  };

  /* ==================================================================
     API PÚBLICA
     ================================================================== */

  function backend() {
    return Datos.modo === 'supabase' ? backendSupabase : backendLocal;
  }

  Datos.configurado = function () { return Datos.modo === 'supabase'; };
  Datos.autenticado = function () { return !!Datos.usuario; };
  Datos.correoUsuario = function () {
    return Datos.usuario ? (Datos.usuario.email || 'cuenta del equipo') : '';
  };

  // Arranca el cliente y recupera la sesión existente (si la hay).
  Datos.iniciar = async function () {
    var cfg = global.SUPABASE_CONFIG || {};
    var credencialesListas = cfg.url && cfg.anonKey &&
      cfg.url.indexOf('TU_PROJECT_URL') === -1 && cfg.anonKey.indexOf('TU_ANON_KEY') === -1;

    if (credencialesListas && global.supabase && global.supabase.createClient) {
      try {
        Datos.cliente = global.supabase.createClient(cfg.url, cfg.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
        });
        Datos.modo = 'supabase';
      } catch (e) {
        Datos.modo = 'local';
        Datos.error = 'No se pudo conectar con Supabase: ' + e.message;
      }
    } else {
      Datos.modo = 'local';
    }

    Datos.usuario = await backend().sesionActual();
    return Datos.modo;
  };

  /*
    Notifica los cambios de sesión. Supabase emite además eventos de
    arranque y de renovación de token que no cambian quién es el usuario;
    esos se ignoran para no recargar los datos sin motivo.
  */
  Datos.alCambiarSesion = function (callback) {
    if (Datos.modo !== 'supabase' || !Datos.cliente) return;
    Datos.cliente.auth.onAuthStateChange(function (evento, sesion) {
      var nuevoId = sesion && sesion.user ? sesion.user.id : null;
      var anteriorId = Datos.usuario ? Datos.usuario.id : null;
      Datos.usuario = sesion ? sesion.user : null;
      if (nuevoId === anteriorId) return;
      callback(evento, Datos.usuario);
    });
  };

  Datos.iniciarSesion = async function (email, password) {
    Datos.usuario = await backend().iniciarSesion(String(email || '').trim(), password);
    return Datos.usuario;
  };

  Datos.cerrarSesion = async function () {
    await backend().cerrarSesion();
    Datos.usuario = null;
  };

  Datos.cargarTodo = function () { return backend().cargarTodo(); };
  Datos.crearEquipo = function (v) { return backend().crearEquipo(v); };
  Datos.actualizarDineroInicial = function (v) { return backend().actualizarDineroInicial(v); };
  Datos.crearMovimiento = function (d) { return backend().crearMovimiento(d); };
  Datos.actualizarMovimiento = function (id, d) { return backend().actualizarMovimiento(id, d); };
  Datos.eliminarMovimiento = function (id) { return backend().eliminarMovimiento(id); };
  Datos.crearCompra = function (d) { return backend().crearCompra(d); };
  Datos.actualizarCompra = function (id, d) { return backend().actualizarCompra(id, d); };
  Datos.eliminarCompra = function (id) { return backend().eliminarCompra(id); };
  Datos.reiniciarDatos = function () { return backend().reiniciarDatos(); };

  /*
    Registrar una compra como gasto es la única operación que toca dos
    tablas. Se crea primero el movimiento y después se liga la compra;
    si el segundo paso falla, se deshace el movimiento para no dejar un
    gasto huérfano inflando el saldo.
  */
  Datos.registrarCompraComoGasto = async function (compra, datosGasto) {
    var movimiento = await backend().crearMovimiento({
      concepto: datosGasto.concepto,
      tipo: 'gasto',
      cantidad: datosGasto.cantidad,
      fecha: datosGasto.fecha,
      area: datosGasto.area,
      categoria: datosGasto.categoria,
      notas: datosGasto.notas || '',
      compraId: compra.id
    });
    try {
      await backend().actualizarCompra(compra.id, {
        estado: 'comprado',
        precioReal: datosGasto.cantidad,
        fechaCompra: datosGasto.fecha,
        registradoComoGasto: true,
        movimientoId: movimiento.id
      });
    } catch (e) {
      try { await backend().eliminarMovimiento(movimiento.id); } catch (e2) { /* ya se informa abajo */ }
      throw new Error('No se pudo ligar la compra con el gasto. No se registró nada: ' + e.message);
    }
    return movimiento;
  };

  global.Datos = Datos;
})(window);
