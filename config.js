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

   NUNCA coloques aquí la "service_role key" ni ninguna contraseña.
   ========================================================================= */
window.SUPABASE_CONFIG = {
  url: 'TU_PROJECT_URL',
  anonKey: 'TU_ANON_KEY'
};
