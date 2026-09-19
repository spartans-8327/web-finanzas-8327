/* =========================================================================
   Pruebas del acceso con usuario y contraseña (data.js).

   Verifican la traducción usuario <-> correo técnico y el manejo de los
   errores reales de Supabase Auth, usando un cliente simulado que responde
   exactamente lo que responde Supabase. La contraseña nunca se almacena:
   se entrega a signInWithPassword y se descarta.

   Ejecutar:  node tests/auth.test.js
   ========================================================================= */
const fs = require('fs');
const path = require('path');

let pasadas = 0, fallidas = 0;
const fallos = [];
function check(nombre, ok, detalle) {
  if (ok) { pasadas++; console.log('  ✓ ' + nombre); }
  else { fallidas++; fallos.push(nombre + (detalle ? ' → ' + detalle : '')); console.log('  ✗ ' + nombre + (detalle ? ' → ' + detalle : '')); }
}
function igual(nombre, actual, esperado) {
  check(nombre, actual === esperado, 'obtenido "' + actual + '", esperado "' + esperado + '"');
}
function bloque(t) { console.log('\n' + t); }

// Cliente de Supabase simulado: acepta una sola credencial válida.
const CUENTA_OK = 'spartans8327@spartans8327.app';
const CLAVE_OK = 'claveDelEquipo';
let ultimaLlamada = null;

function clienteSimulado(respuestaForzada) {
  return {
    auth: {
      async signInWithPassword({ email, password }) {
        ultimaLlamada = { email, password };
        if (respuestaForzada) return { error: { message: respuestaForzada } };
        if (email !== CUENTA_OK || password !== CLAVE_OK) {
          return { error: { message: 'Invalid login credentials' } };
        }
        return { data: { user: { id: 'uid-1', email } }, error: null };
      },
      async getSession() { return { data: { session: null } }; },
      async signOut() { return { error: null }; },
      onAuthStateChange() { return { data: { subscription: {} } }; }
    },
    from() { throw new Error('no usado en estas pruebas'); }
  };
}

function cargarDatos(respuestaForzada) {
  const ventana = {
    SUPABASE_CONFIG: { url: 'https://demo.supabase.co', anonKey: 'clave-anon-publica' },
    CUENTAS_CONFIG: {
      cuentas: { 'Spartans8327': CUENTA_OK },
      dominioCuentas: 'spartans8327.app'
    },
    supabase: { createClient: () => clienteSimulado(respuestaForzada) }
  };
  new Function('window', fs.readFileSync(path.join(__dirname, '..', 'data.js'), 'utf8'))(ventana);
  return ventana.Datos;
}

(async () => {
  /* ------------------------------------------------------------------ */
  bloque('TRADUCCIÓN USUARIO -> CORREO TÉCNICO');
  const Datos = cargarDatos();
  await Datos.iniciar();
  igual('Se activa el modo Supabase con credenciales presentes', Datos.configurado(), true);

  igual('El usuario configurado se traduce a su correo',
    Datos.__correoDeUsuario('Spartans8327'), CUENTA_OK);
  igual('El nombre de usuario no distingue mayúsculas',
    Datos.__correoDeUsuario('spartans8327'), CUENTA_OK);
  igual('Se ignoran los espacios sobrantes',
    Datos.__correoDeUsuario('  Spartans8327  '), CUENTA_OK);
  igual('Un usuario no configurado usa el dominio de respaldo',
    Datos.__correoDeUsuario('Mecanica'), 'mecanica@spartans8327.app');
  igual('Un correo escrito completo se respeta (compatibilidad)',
    Datos.__correoDeUsuario('equipo@gmail.com'), 'equipo@gmail.com');
  igual('Un usuario vacío no produce correo', Datos.__correoDeUsuario('   '), '');

  bloque('TRADUCCIÓN INVERSA (AL RECARGAR LA PÁGINA)');
  igual('El correo configurado vuelve a su nombre de usuario',
    Datos.__usuarioDeCorreo(CUENTA_OK), 'Spartans8327');
  igual('Se respeta la escritura original del nombre',
    Datos.__usuarioDeCorreo(CUENTA_OK.toUpperCase()), 'Spartans8327');
  igual('Un correo desconocido muestra solo su parte local',
    Datos.__usuarioDeCorreo('otro@ejemplo.com'), 'otro');

  /* ------------------------------------------------------------------ */
  bloque('CASO 1 · USUARIO Y CONTRASEÑA CORRECTOS');
  const usuario = await Datos.iniciarSesion('Spartans8327', CLAVE_OK);
  check('Se crea la sesión', Datos.autenticado() === true);
  igual('Supabase recibe el correo técnico, no el nombre de usuario', ultimaLlamada.email, CUENTA_OK);
  igual('Supabase recibe la contraseña tal cual para validarla', ultimaLlamada.password, CLAVE_OK);
  igual('La interfaz muestra el nombre de usuario', Datos.usuarioVisible(), 'Spartans8327');
  check('El objeto de sesión no expone ninguna contraseña',
    JSON.stringify(usuario).toLowerCase().indexOf('password') === -1 &&
    JSON.stringify(usuario).indexOf(CLAVE_OK) === -1);
  check('Datos no guarda la contraseña en ninguna propiedad',
    JSON.stringify(Object.keys(Datos)).toLowerCase().indexOf('password') === -1 &&
    Object.keys(Datos).every(k => String(Datos[k]) !== CLAVE_OK));

  bloque('CASO 6 · CERRAR SESIÓN');
  await Datos.cerrarSesion();
  check('La sesión se elimina', Datos.autenticado() === false);
  igual('Sin sesión no hay nombre visible', Datos.usuarioVisible(), '');

  /* ------------------------------------------------------------------ */
  bloque('CASO 2 · USUARIO INCORRECTO + CONTRASEÑA CORRECTA');
  const D2 = cargarDatos();
  await D2.iniciar();
  let error2 = null;
  try { await D2.iniciarSesion('UsuarioQueNoExiste', CLAVE_OK); }
  catch (e) { error2 = e.message; }
  igual('Se rechaza con un mensaje amigable', error2, 'Usuario o contraseña incorrectos.');
  check('No se crea sesión', D2.autenticado() === false);
  check('El mensaje no revela detalles técnicos de Supabase',
    !/invalid|credentials|supabase|auth/i.test(error2 || ''));

  bloque('CASO 3 · USUARIO CORRECTO + CONTRASEÑA INCORRECTA');
  let error3 = null;
  try { await D2.iniciarSesion('Spartans8327', 'claveEquivocada'); }
  catch (e) { error3 = e.message; }
  igual('Se rechaza con un mensaje amigable', error3, 'Usuario o contraseña incorrectos.');
  check('No se crea sesión', D2.autenticado() === false);
  igual('El mensaje es idéntico al del usuario incorrecto (no filtra cuál falló)', error3, error2);

  bloque('VALIDACIONES PREVIAS Y OTROS ERRORES');
  let e4 = null;
  try { await D2.iniciarSesion('', CLAVE_OK); } catch (e) { e4 = e.message; }
  igual('Usuario vacío se rechaza antes de llamar al servidor', e4, 'Escribe el usuario del equipo.');
  let e5 = null;
  try { await D2.iniciarSesion('Spartans8327', ''); } catch (e) { e5 = e.message; }
  igual('Contraseña vacía se rechaza antes de llamar al servidor', e5, 'Escribe la contraseña.');

  const casos = [
    ['Email not confirmed', 'La cuenta del equipo todavía no está activada.'],
    ['For security purposes, you can only request this after 27 seconds', 'Demasiados intentos seguidos. Espera un momento y vuelve a intentarlo.'],
    ['TypeError: Failed to fetch', 'No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.'],
    ['Database error granting user', 'No se pudo iniciar sesión. Inténtalo de nuevo.']
  ];
  for (const [crudo, esperado] of casos) {
    const D = cargarDatos(crudo);
    await D.iniciar();
    let msg = null;
    try { await D.iniciarSesion('Spartans8327', CLAVE_OK); } catch (e) { msg = e.message; }
    igual('Error "' + crudo.slice(0, 34) + '…" se traduce a un mensaje claro', msg, esperado);
    check('  y no se muestra el texto original de Supabase', msg !== crudo);
  }

  /* ------------------------------------------------------------------ */
  bloque('SEGURIDAD DEL CÓDIGO FUENTE');
  const fuentes = ['config.js', 'data.js', 'script.js', 'index.html'];
  fuentes.forEach(f => {
    const texto = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    check(f + ': no contiene contraseñas escritas en el código',
      !/(password|contrase(n|ñ)a)\s*[:=]\s*['"][^'"]{3,}['"]/i.test(texto));
    // Se eliminan los comentarios antes de comprobar: la advertencia
    // "nunca pongas la service_role key" sí puede aparecer documentada.
    const sinComentarios = texto
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/<!--[\s\S]*?-->/g, '');
    check(f + ': no contiene una service_role key en el código activo',
      !/service_role/i.test(sinComentarios));
    check(f + ': no guarda contraseñas en el navegador',
      !/(localStorage|sessionStorage)\.setItem\([^)]*(password|contrase)/i.test(texto));
  });
  const htmlLogin = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  check('El formulario de acceso no pide correo',
    !/id="loginEmail"/.test(htmlLogin) && /id="loginUsuario"/.test(htmlLogin));
  check('El campo de contraseña sigue siendo de tipo password',
    /id="loginPassword"[^>]*>/.test(htmlLogin.replace(/(<input[^>]*type="password"[^>]*)/, '$1')) &&
    /<input type="password" id="loginPassword"/.test(htmlLogin));

  console.log('\n' + '='.repeat(62));
  console.log('RESULTADO ACCESO: ' + pasadas + ' pasadas, ' + fallidas + ' fallidas');
  if (fallos.length) { console.log('\nFALLOS:'); fallos.forEach(f => console.log('  - ' + f)); }
  console.log('='.repeat(62));
  process.exit(fallidas ? 1 : 0);
})();
