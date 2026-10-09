// The ONLY place for user-facing text. English keys, neutral Spanish values.
// Never hardcode Spanish strings anywhere else in the app.
export const es = {
  tabs: {
    home: 'Inicio',
    library: 'Biblioteca',
    scan: 'Escanear',
    librarian: 'Librero',
    profile: 'Perfil',
  },
  health: {
    title: 'Conexión con Supabase (solo desarrollo)',
    checking: 'Comprobando conexión…',
    ok: 'Conexión correcta.',
    errors: {
      missing_env: 'Faltan las variables de entorno de Supabase. Revisa la configuración.',
      network_error: 'No se pudo conectar. Revisa tu conexión a internet.',
      timeout: 'La conexión tardó demasiado.',
      unauthorized: 'La clave pública de Supabase no es válida.',
      unexpected_status: 'Supabase respondió de forma inesperada.',
    },
  },
} as const;

export type Dictionary = typeof es;
