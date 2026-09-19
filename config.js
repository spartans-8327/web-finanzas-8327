/* =========================================================================
   CONFIGURACIÓN DE SUPABASE
   -------------------------------------------------------------------------
   Sustituye estos dos valores por los de tu proyecto:
     Supabase → Project Settings → API
       · Project URL          → SUPABASE_URL
       · anon / public key    → SUPABASE_ANON_KEY

   La clave "anon" es pública por diseño y está pensada para vivir en el
   navegador: por sí sola no da acceso a nada, porque quien decide qué se
   puede leer o escribir son las políticas de Row Level Security (schema.sql).

   NUNCA coloques aquí la "service_role key", contraseñas ni ningún secreto.
   ========================================================================= */
window.SUPABASE_CONFIG = {
  url: 'TU_PROJECT_URL',
  anonKey: 'TU_ANON_KEY'
};

/* =========================================================================
   CUENTAS DEL EQUIPO
   -------------------------------------------------------------------------
   Supabase Auth identifica las cuentas por correo electrónico, pero en la
   aplicación solo se escribe un nombre de usuario. Aquí se relaciona uno con
   otro.

   El correo es solo un identificador técnico: no se muestra en la interfaz,
   no se pide al iniciar sesión y nunca se usa para enviar mensajes. La
   contraseña NO va aquí: la sigue guardando y verificando Supabase Auth.

   · "cuentas": nombres de usuario con su correo correspondiente. Si la cuenta
     del equipo ya existe en Supabase con otro correo, basta con escribirlo
     aquí y el nombre de usuario seguirá funcionando igual.
   · "dominioCuentas": respaldo para cualquier usuario que no esté en la lista;
     "Spartans8327" se convierte en "spartans8327@<dominioCuentas>".

   El nombre de usuario no distingue mayúsculas de minúsculas.
   ========================================================================= */
window.CUENTAS_CONFIG = {
  cuentas: {
    'Spartans8327': 'spartans8327@spartans8327.app'
  },
  dominioCuentas: 'spartans8327.app'
};
