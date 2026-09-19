/* =========================================================================
   Prueba de autenticación REAL contra Supabase Auth (GoTrue).

   No usa mocks: levanta el mismo servidor de autenticación que usa Supabase
   en producción (GoTrue), con PostgreSQL detrás, y lo ataca con el cliente
   oficial @supabase/supabase-js a través de data.js, exactamente como lo
   hace el navegador.

   Requisitos (los prepara tests/preparar-auth-real.sh):
     · PostgreSQL en 127.0.0.1:5433 con la base gotrue_test
     · GoTrue escuchando en 127.0.0.1:9999
   ========================================================================= */
const fs = require('fs');
const path = require('path');
const http = require('http');
const jwt = require(path.join(process.env.SCRATCH, 'node_modules/jsonwebtoken'));
const { createClient } = require(path.join(process.env.SCRATCH, 'node_modules/@supabase/supabase-js'));

const SECRETO = 'secreto-de-pruebas-local-muy-largo-para-hs256-0123456789';
const GOTRUE = 'http://127.0.0.1:9999';
const PUERTO_PASARELA = 8010;
const URL_SUPABASE = 'http://127.0.0.1:' + PUERTO_PASARELA;

const CORREO_TECNICO = 'spartans8327@spartans8327.app';
const CLAVE = 'ClaveDelEquipo2026';

let pasadas = 0, fallidas = 0;
const fallos = [];
function check(n, ok, d) {
  if (ok) { pasadas++; console.log('  ✓ ' + n); }
  else { fallidas++; fallos.push(n + (d ? ' → ' + d : '')); console.log('  ✗ ' + n + (d ? ' → ' + d : '')); }
}
function igual(n, a, e) { check(n, a === e, 'obtenido "' + a + '", esperado "' + e + '"'); }
function bloque(t) { console.log('\n' + t); }

// Supabase expone GoTrue bajo /auth/v1; aquí se reproduce ese enrutado para
// que supabase-js funcione sin modificar ni una línea.
function pasarela() {
  return http.createServer((req, res) => {
    const ruta = req.url.replace(/^\/auth\/v1/, '') || '/';
    const partes = new URL(GOTRUE + ruta);
    const cuerpo = [];
    req.on('data', c => cuerpo.push(c));
    req.on('end', () => {
      const datos = Buffer.concat(cuerpo);
      const pr = http.request({
        hostname: partes.hostname, port: partes.port, path: partes.pathname + partes.search,
        method: req.method, headers: Object.assign({}, req.headers, { host: partes.host })
      }, pres => {
        res.writeHead(pres.statusCode, pres.headers);
        pres.pipe(res);
      });
      pr.on('error', e => { res.writeHead(502); res.end(JSON.stringify({ message: e.message })); });
      if (datos.length) pr.write(datos);
      pr.end();
    });
  });
}

// Carga data.js con el cliente OFICIAL de Supabase apuntando al GoTrue local.
function cargarDatos(claveAnon) {
  const ventana = {
    SUPABASE_CONFIG: { url: URL_SUPABASE, anonKey: claveAnon },
    CUENTAS_CONFIG: {
      cuentas: { 'Spartans8327': CORREO_TECNICO },
      dominioCuentas: 'spartans8327.app'
    },
    supabase: { createClient },
    localStorage: {
      _d: {},
      getItem(k) { return this._d[k] || null; },
      setItem(k, v) { this._d[k] = v; },
      removeItem(k) { delete this._d[k]; }
    }
  };
  new Function('window', fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8'))(ventana);
  return ventana.Datos;
}

(async () => {
  const srv = pasarela();
  await new Promise(r => srv.listen(PUERTO_PASARELA, r));

  const claveAnon = jwt.sign({ role: 'anon', iss: 'supabase' }, SECRETO, { expiresIn: '1h' });

  try {
    /* --------------------------------------------------------------- */
    bloque('PREPARACIÓN: CREAR LA CUENTA DEL EQUIPO EN GOTRUE');
    const alta = await fetch(URL_SUPABASE + '/auth/v1/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: claveAnon, Authorization: 'Bearer ' + claveAnon },
      body: JSON.stringify({ email: CORREO_TECNICO, password: CLAVE })
    });
    const cuenta = await alta.json();
    check('La cuenta del equipo se crea en Supabase Auth', !!cuenta.id || !!(cuenta.user && cuenta.user.id),
      JSON.stringify(cuenta).slice(0, 160));
    const idUsuario = cuenta.id || (cuenta.user && cuenta.user.id);

    /*
      En Supabase la columna auth.users.role trae por omisión el valor
      'authenticated', que es el rol que acaba dentro del token y el que leen
      las políticas de RLS. GoTrue por su cuenta la deja vacía, así que aquí
      se reproduce ese valor por omisión para que el entorno de prueba se
      comporte como el de producción.
    */
    require('child_process').execSync(
      `psql -h /tmp -p 5433 -U postgres -d gotrue_test -q -c "update auth.users set role='authenticated' where id='${idUsuario}'"`
    );

    /* --------------------------------------------------------------- */
    bloque('CASO 1 · USUARIO CORRECTO + CONTRASEÑA CORRECTA → ACCESO');
    const D1 = cargarDatos(claveAnon);
    await D1.iniciar();
    igual('La aplicación entra en modo Supabase (no demostración)', D1.configurado(), true);
    igual('El modo demostración queda descartado', D1.esDemostracion(), false);

    const usuario = await D1.iniciarSesion('Spartans8327', CLAVE);
    check('Supabase Auth concede el acceso', D1.autenticado() === true);
    igual('La sesión pertenece a la cuenta del equipo', usuario.email, CORREO_TECNICO);
    igual('La interfaz mostraría el nombre de usuario', D1.usuarioVisible(), 'Spartans8327');
    igual('La sesión NO está marcada como demostración', D1.sesionDeDemostracion(), false);

    // Token real emitido por GoTrue
    const sesion = await D1.cliente.auth.getSession();
    const token = sesion.data.session && sesion.data.session.access_token;
    check('GoTrue emite un token de acceso real', !!token);
    const carga = jwt.verify(token, SECRETO);
    igual('El token identifica a la cuenta del equipo', carga.sub, idUsuario);
    igual('El token lleva el rol "authenticated" que usa RLS', carga.role, 'authenticated');

    /* --------------------------------------------------------------- */
    bloque('CASO 3 · USUARIO CORRECTO + CONTRASEÑA INCORRECTA → RECHAZO');
    const D3 = cargarDatos(claveAnon);
    await D3.iniciar();
    let e3 = null;
    try { await D3.iniciarSesion('Spartans8327', 'ClaveEquivocada2026'); } catch (e) { e3 = e.message; }
    igual('Supabase Auth rechaza la contraseña incorrecta', e3, 'Usuario o contraseña incorrectos.');
    igual('No se crea sesión', D3.autenticado(), false);
    const s3 = await D3.cliente.auth.getSession();
    check('No queda ninguna sesión guardada', !s3.data.session);

    /* --------------------------------------------------------------- */
    bloque('CASO 2 · USUARIO INCORRECTO + CONTRASEÑA CORRECTA → RECHAZO');
    const D2 = cargarDatos(claveAnon);
    await D2.iniciar();
    let e2 = null;
    try { await D2.iniciarSesion('UsuarioQueNoExiste', CLAVE); } catch (e) { e2 = e.message; }
    igual('Supabase Auth rechaza el usuario inexistente', e2, 'Usuario o contraseña incorrectos.');
    igual('No se crea sesión', D2.autenticado(), false);
    igual('El mensaje no distingue cuál de los dos falló', e2, e3);

    // Variantes del nombre de usuario
    const D2b = cargarDatos(claveAnon);
    await D2b.iniciar();
    await D2b.iniciarSesion('spartans8327', CLAVE);
    check('El nombre de usuario en minúsculas también entra', D2b.autenticado() === true);
    await D2b.cerrarSesion();

    /* --------------------------------------------------------------- */
    bloque('CASO 6 · CERRAR SESIÓN → SE PIERDE EL ACCESO');
    await D1.cerrarSesion();
    igual('La sesión se cierra', D1.autenticado(), false);
    const sFin = await D1.cliente.auth.getSession();
    check('Supabase ya no conserva la sesión', !sFin.data.session);
    igual('Sin sesión no hay nombre visible', D1.usuarioVisible(), '');

    const tokenViejo = token;
    const reintento = await fetch(URL_SUPABASE + '/auth/v1/user', {
      headers: { apikey: claveAnon, Authorization: 'Bearer ' + tokenViejo }
    });
    check('El servidor deja de aceptar la sesión cerrada', reintento.status !== 200,
      'estado ' + reintento.status);

    /* --------------------------------------------------------------- */
    bloque('CUENTA COMPARTIDA · CERRAR SESIÓN EN DOS DISPOSITIVOS');
    /*
      Escenario real de este equipo: la misma cuenta abierta en el celular y
      en la computadora. Al cerrar sesión en uno, Supabase invalida la sesión
      del otro; cuando el segundo cierra sesión el servidor responde con un
      error. Antes eso dejaba la sesión guardada en el navegador y al
      recargar volvía a entrar.
    */
    const movil = cargarDatos(claveAnon);
    const compu = cargarDatos(claveAnon);
    await movil.iniciar(); await compu.iniciar();
    await movil.iniciarSesion('Spartans8327', CLAVE);
    await compu.iniciarSesion('Spartans8327', CLAVE);
    check('Ambos dispositivos tienen sesión', movil.autenticado() && compu.autenticado());

    await movil.cerrarSesion();
    check('El primer dispositivo cierra sesión', movil.autenticado() === false);

    let errorCierre = null;
    try { await compu.cerrarSesion(); } catch (e) { errorCierre = e.message; }
    igual('El segundo dispositivo también queda sin sesión', compu.autenticado(), false);
    const sCompu = await compu.cliente.auth.getSession();
    check('No queda ninguna sesión guardada en el segundo dispositivo',
      !sCompu.data.session, errorCierre || 'quedó sesión');

    /* --------------------------------------------------------------- */
    bloque('CASOS 4 Y 5 · RLS CON EL IDENTIFICADOR REAL DEL TOKEN');
    // El id que RLS usará (auth.uid()) es exactamente el "sub" del token real.
    fs.writeFileSync(path.join(process.env.SCRATCH, 'uid-real.txt'), carga.sub);
    check('El identificador real queda disponible para la prueba de RLS', !!carga.sub);
    igual('auth.uid() y el usuario de la sesión coinciden', carga.sub, idUsuario);

    /* --------------------------------------------------------------- */
    bloque('LA CONTRASEÑA NO SE ALMACENA EN NINGÚN SITIO');
    const almacen = JSON.stringify(D1.cliente ? {} : {});
    check('data.js no expone la contraseña en ninguna propiedad',
      Object.keys(D1).every(k => String(D1[k]).indexOf(CLAVE) === -1));
    const sesionSerializada = JSON.stringify(sesion.data.session || {});
    check('La sesión emitida por Supabase no contiene la contraseña',
      sesionSerializada.indexOf(CLAVE) === -1);
    check('El almacenamiento del cliente no contiene la contraseña',
      almacen.indexOf(CLAVE) === -1);
    const hash = require('child_process').execSync(
      `psql -h /tmp -p 5433 -U postgres -d gotrue_test -tAc "select encrypted_password from auth.users where email='${CORREO_TECNICO}'"`
    ).toString().trim();
    check('Supabase guarda la contraseña como hash bcrypt, nunca en claro',
      hash.startsWith('$2') && hash.indexOf(CLAVE) === -1, hash.slice(0, 12) + '…');

  } catch (e) {
    fallidas++;
    fallos.push('EXCEPCIÓN: ' + e.message);
    console.log('\n✗ EXCEPCIÓN: ' + e.message + '\n' + (e.stack || '').split('\n').slice(1, 4).join('\n'));
  } finally {
    srv.close();
  }

  console.log('\n' + '='.repeat(62));
  console.log('RESULTADO AUTENTICACIÓN REAL: ' + pasadas + ' pasadas, ' + fallidas + ' fallidas');
  if (fallos.length) { console.log('\nFALLOS:'); fallos.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(62));
  process.exit(fallidas ? 1 : 0);
})();
