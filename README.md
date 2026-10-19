# Bookshelf

Bookshelf es una app móvil para llevar **tu biblioteca personal**: registrar los libros que
tienes, seguir lo que lees y recibir recomendaciones de un «librero» que conoce tu estante. Funciona
**sin conexión** (local-first) y se sincroniza con Supabase cuando hay red.

Proyecto final de Diseño de Interfaces. Android es la plataforma principal (Expo Go y APK con EAS).

## Alcance

**Incluye**

- Cuenta de usuario (registro, inicio de sesión, cierre de sesión seguro).
- Biblioteca: añadir, editar y borrar libros, con portada (foto, galería o portada tipográfica).
- Seguimiento de lectura: por leer / leyendo / terminado, página actual, valoración, notas y
  préstamos.
- Escáner con cámara que propone los datos del libro (IA) y «Mejorar portada» (enderezar y
  ajustar niveles).
- «Sugerir datos» en el formulario (autor, género y páginas a partir del título).
- Librero: una recomendación de tu propio estante, y «Nuevas aventuras» (un libro que aún no
  tienes), con historial.
- Preferencias de lectura, estadísticas básicas en Inicio, perfil y tema claro/oscuro.

**Fuera del alcance (a propósito)**: red social o funciones compartidas, tienda o enlaces de
compra, lector de libros electrónicos, escaneo de una estantería completa, gamificación (logros,
rachas, puntos) y estadísticas avanzadas.

## Funciones por área

| Área         | Qué hace                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cuenta       | Registro e inicio de sesión con correo y contraseña. Al cerrar sesión se borra de la memoria todo lo del usuario anterior.                                                               |
| Inicio       | Libro en curso con progreso, colección reciente, acceso al librero y estadísticas (Hoy, Esta semana, Este año, Total).                                                                   |
| Biblioteca   | Estante en cuadrícula, búsqueda sin acentos ni mayúsculas, filtros por estado, prestados y género.                                                                                       |
| Ficha        | Estado, página actual, valoración, notas, préstamo, libros relacionados, editar y borrar.                                                                                                |
| Añadir libro | Formulario con validación, portada con recorte y «Sugerir datos». Las páginas son obligatorias.                                                                                          |
| Escáner      | Foto de portada o lomo → propuesta de datos → «Revisa tu libro». Opción «Mejorar portada» (esquinas, perspectiva, niveles) con Original/Mejorada.                                        |
| Librero      | Recomendación con motivo, filtros de tiempo y ánimo, «Leer después», «Otra recomendación» e historial. «Nuevas aventuras» sugiere libros nuevos.                                         |
| Perfil       | Foto de perfil (cámara o galería, recorte cuadrado), nombre, preferencias de lectura (géneros, priorizar no leídos, ánimo, libros cortos entre semana), tema y estado de sincronización. |

## Tecnología

- React Native 0.86 + **Expo SDK 57** + TypeScript estricto + **Expo Router** (React Compiler
  activado).
- Estado: Zustand. Animaciones: Reanimated 4 (respetan «reducir movimiento»).
- Datos locales: **expo-sqlite**. Sesión en almacenamiento seguro (expo-secure-store).
- Backend: **Supabase** (Auth, Postgres con RLS, Storage, Edge Functions en Deno).
- IA: OpenAI **solo** desde Edge Functions; la app nunca ve la clave.
- Imagen: expo-camera, expo-image-picker, expo-image-manipulator y
  `@shopify/react-native-skia` (Mejorar portada).
- Calidad: Jest + Testing Library, ESLint, Prettier, `scripts/checkSecrets.mjs`.

## Arquitectura

- **Local-first.** Cada usuario tiene su propia base SQLite en el dispositivo. La interfaz lee y
  escribe siempre en local; cada cambio queda en una cola (`sync_queue`).
- **Motor de sincronización** (`src/features/sync`). Envía la cola cuando hay red, descarga los
  cambios del servidor y resuelve conflictos con «gana la última escritura». Las portadas se suben
  al bucket privado `book-covers`.
- **Repositorios.** La UI nunca llama a Supabase ni a SQLite directamente. Usa repositorios y
  servicios con interfaz (`bookRepository`, `recommendationService`, etc.) y sus
  implementaciones SQLite/Supabase. En desarrollo existen implementaciones de prueba que no
  entran en el bundle de producción.
- **Edge Functions** (`supabase/functions`):
  - Las cuatro funciones son `identify-book`, `suggest-book-details`, `recommend-book` y
    `discover-book`.
  - Comparten lógica pura en `_shared`.
  - Cada una verifica la sesión del usuario, valida tamaños, aplica un límite de uso (tabla
    `ai_usage`) y registra solo códigos de error.
- **Seguridad.**
  - Todas las tablas tienen RLS por `auth.uid()`. `ai_usage` no es accesible para los usuarios.
  - El bucket de portadas es privado, con carpetas por usuario.
  - La app solo conoce dos variables públicas. `npm run verify` falla si aparece una clave
    secreta en el repositorio.
- **Idiomas.** Código, nombres, comentarios y errores internos van en inglés. Todo el texto
  visible para el usuario va en español neutro y vive en `src/i18n/es.ts`.

## Estructura

```text
src/
  app/            Rutas de Expo Router (delgadas): (auth), (tabs), book/, scan, dev-gallery
  components/     Componentes de interfaz reutilizables
  design/         Tokens de color y tipografía, tema, iconos, movimiento, contraste
  features/       auth, library, scan, suggestions, recommendations, librarian,
                  preferences, profile, sync
  db/             Esquema SQLite, migraciones locales y cola de sincronización
  lib/            Supabase, entorno, red, fechas, almacenamiento seguro
  stores/         Stores de Zustand
  i18n/           es.ts (todo el texto visible)
  dev/            Galería y servicios de prueba (solo desarrollo)
  __tests__/      Pruebas de Jest
supabase/
  migrations/     SQL en orden (se ejecuta a mano)
  functions/      Edge Functions y lógica compartida
  tests/          rls_isolation.sql, constraints.sql
scripts/          checkSecrets.mjs, generateAssets.mjs
docs/             supabase-setup.md, ai-setup.md, qa-checklist.md
```

## Requisitos

- Node.js 20 o superior (probado con 22) y npm.
- Un proyecto de Supabase.
- Para la IA: una clave de OpenAI que solo se guarda como secreto de Supabase.
- Para probar: Expo Go en un teléfono Android, o una cuenta de Expo para compilar el APK.

## Instalación

```sh
npm install
```

En **Windows**, si la instalación falla en el script de `@shopify/react-native-skia`
(`install-libs.js` se cierra con un error), usa:

```sh
npm install --ignore-scripts
```

Ese atajo es **solo** para instalaciones locales en Windows. Expo Go no lo necesita, y EAS
compila en Linux, donde el script funciona.

## Variables de entorno

Copia `.env.example` como `.env` y rellena **solo** estas dos:

```sh
EXPO_PUBLIC_SUPABASE_URL=https://<tu-proyecto>.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<clave publicable (sb_publishable_...)>
```

Son públicas por diseño: viajan dentro de la app.

> **Nunca** pongas la clave de OpenAI, la clave secreta o la de servicio (`service_role`) de
> Supabase en `.env`, en `app.json`, en `src/` ni en ningún archivo del repositorio. Las variables
> `EXPO_PUBLIC_*` se incluyen en el bundle y cualquiera puede leerlas. La clave de OpenAI vive solo
> como secreto de Supabase.

## Configurar Supabase (en orden)

Detalles en `docs/supabase-setup.md` y `docs/ai-setup.md`.

1. **Migraciones**, en el orden siguiente (todas son idempotentes). En el panel: **SQL Editor →
   New query**, pega el archivo y pulsa **Run**.
   1. `supabase/migrations/20261010000000_initial_schema.sql`: tablas, triggers y RLS.
   2. `supabase/migrations/20261010000100_storage_covers.sql`: bucket privado `book-covers` y
      sus políticas.
   3. `supabase/migrations/20261011000000_ai_usage.sql`: límites de uso de la IA.
   4. `supabase/migrations/20261012000000_discovery_recommendations.sql` (fase 7.5):
      «Nuevas aventuras».
   5. `supabase/migrations/20261013000000_profile_avatars.sql` (fase 9.1): foto de perfil
      (columnas `avatar_path` y `avatar_updated_at`, bucket privado `avatars` y sus políticas).
   6. `supabase/migrations/20261014000000_reading_events.sql` (fase 9.2): registro de lectura
      diario (tabla `reading_events`, solo lectura e inserción de las filas propias).
   7. `supabase/migrations/20261015000000_input_constraints.sql` (fase 10.1): límites en el
      servidor para los textos y las páginas (restricciones CHECK). Antes recorta los valores
      existentes que se pasen del límite.
2. **Pruebas de SQL**: ejecuta `supabase/tests/rls_isolation.sql` (debe devolver
   `RLS isolation test passed`) y `supabase/tests/constraints.sql` (debe devolver
   `Input constraints test passed`). Ninguna guarda nada, porque terminan con `ROLLBACK`.
3. **Storage**: comprueba en **Storage** que `book-covers` y `avatars` existen y son **privados**.
4. **Auth**: en **Authentication → Sign In / Providers → Email**, **desactiva «Confirm email»**.
   La app no tiene paso de código de verificación: al registrarse entra directo. Si lo dejas
   activo, el registro funciona pero no devuelve sesión, y la app pide confirmar el correo y
   volver a iniciar sesión. Contraseña mínima: 8 (la app admite hasta 72).
5. **Secretos y funciones**. Los comandos se ejecutan en la carpeta del proyecto; la CLI de
   Supabase ya está en las dependencias de desarrollo.

   ```sh
   npx supabase login
   npx supabase link --project-ref <ref-del-proyecto>
   npx supabase secrets set OPENAI_API_KEY=<tu-clave> OPENAI_MODEL=<modelo>
   npx supabase functions deploy identify-book
   npx supabase functions deploy suggest-book-details
   npx supabase functions deploy recommend-book
   npx supabase functions deploy discover-book
   npx supabase functions deploy find-cover
   ```

   No uses `--no-verify-jwt`. Comprueba los secretos con `npx supabase secrets list`, que solo
   muestra los nombres.

## Scripts

| Comando                           | Qué hace                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `npm start`                       | Inicia Expo (servidor de desarrollo).                                        |
| `npm run typecheck`               | TypeScript sin emitir.                                                       |
| `npm run lint`                    | ESLint (0 avisos permitidos).                                                |
| `npm run format:check`            | Prettier en modo comprobación (`npm run format` corrige).                    |
| `npm test`                        | Pruebas de Jest.                                                             |
| `npm run check:secrets`           | Busca claves secretas en el repositorio (nunca lee `.env`).                  |
| `npm run verify`                  | Todo lo anterior en orden: debe pasar antes de entregar cualquier cambio.    |
| `node scripts/generateAssets.mjs` | Regenera el icono, el icono adaptable, la splash y el favicon provisionales. |

## Probar con Expo Go

1. Configura `.env` y Supabase (pasos anteriores).
2. Ejecuta `npm start` y escanea el código QR con Expo Go, con el teléfono en la misma red.
3. Si la red lo bloquea, usa `npx expo start --tunnel`.
4. En desarrollo, **Perfil → Galería de componentes** permite usar servicios de prueba (escáner,
   sugerencias, librero) sin gastar IA. La galería no existe en el APK.

## Compilar e instalar el APK (EAS)

`eas.json` define tres perfiles:

- `development`: cliente de desarrollo. Antes hay que instalar `expo-dev-client` con
  `npx expo install expo-dev-client`.
- `preview`: APK de distribución interna.
- `production`: App Bundle para Google Play.

```sh
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://<tu-proyecto>.supabase.co --visibility plaintext
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY --value <clave-publicable> --visibility plaintext
npx eas-cli@latest build --platform android --profile preview
```

- `init` crea el proyecto en EAS y añade su `projectId` y `owner` a `app.json`.
- **El `.env` local no se sube** a las compilaciones en la nube porque Git lo ignora. Por eso
  las dos variables públicas se crean como **variables de entorno de EAS** en el entorno
  `preview` (y en `production` si compilas ese perfil). Si faltan, la app no puede conectar con
  Supabase (falla al iniciar sesión o al cargar). No crees allí ninguna clave secreta.
- Al terminar, EAS muestra un enlace y un código QR. Ábrelo en el teléfono, descarga el APK e
  instálalo; Android pedirá permitir «instalar apps desconocidas» para el navegador.
- Las dependencias nativas (Skia, cámara, SQLite, Reanimated) son las versiones que fija Expo
  SDK 57 y compilan en EAS sin pasos extra.

## Prueba sin conexión en el APK

1. Instala el APK, inicia sesión **con red** y espera a que la biblioteca cargue y la
   insignia de sincronización diga «Sincronizado».
2. Activa el **modo avión**.
3. Añade un libro con foto, edita otro, cambia la página actual y borra uno. Todo debe funcionar
   y la insignia debe indicar «Sin conexión · N pendientes».
4. Cierra la app por completo y ábrela de nuevo: los cambios siguen ahí y la sesión se mantiene.
5. Comprueba que el escáner, «Sugerir datos» y el librero avisan de que no hay conexión, y que la
   última recomendación sigue visible.
6. Desactiva el modo avión: la cola se envía sola y la insignia vuelve a «Sincronizado».
7. Comprueba en Supabase (**Table Editor** y **Storage**) que llegaron los cambios y la portada.

La lista completa de pruebas manuales está en `docs/qa-checklist.md`.

## Limitaciones conocidas

- **Recuperar la contraseña** solo envía el correo de Supabase: la app todavía no puede completar
  el cambio (ver `docs/supabase-setup.md`).
- **Sincronización con «gana la última escritura»**: si el mismo libro se edita en dos
  dispositivos sin conexión, prevalece la última edición sincronizada.
- Si una **portada se cambia en otro dispositivo**, este dispositivo puede seguir mostrando la
  copia local anterior.
- **La IA puede equivocarse**: datos propuestos, recomendaciones y sugerencias siempre se revisan
  antes de guardarse, y los libros sugeridos pueden no existir (se marcan como «no comprobados»).
- `npm audit --omit=dev` reporta vulnerabilidades en **herramientas de compilación** de Expo y
  Jest. Su arreglo exige versiones mayores incompatibles con SDK 57, así que no se aplicó
  `--force`.
- Algunos comportamientos solo se pueden comprobar **en un dispositivo real** y no tienen pruebas
  automáticas: cámara, Skia, modo avión, permisos y lectores de pantalla. Para eso existe la
  lista de QA.
- El icono, el icono adaptable y la splash son **provisionales**: los genera
  `scripts/generateAssets.mjs`.

## Solución de problemas

- **Ruta de Windows con espacios o acentos** (por ejemplo `Diseño de interfaces`): usa comillas
  en la terminal (`cd "C:\...\Diseño de interfaces\..."`). Si Metro o Gradle fallan por la
  ruta, mueve el proyecto a una ruta corta sin espacios, como `C:\dev\bookshelf`.
- **`npm install` falla en Skia** (`install-libs.js`): usa `npm install --ignore-scripts`; los
  detalles están en Instalación.
- **La app no conecta con Supabase (no inicia sesión ni carga datos)**: falta `.env`, o, en el APK, las variables
  de entorno de EAS del perfil que compilaste.
- **El escáner, las sugerencias o el librero siempre fallan**:
  - Puede que la Edge Function no esté publicada (aparece como 404 en **Edge Functions →
    Logs**), o que falten los secretos. Repite el paso 5 de «Configurar Supabase».
  - Si es `discover-book`, puede faltar la migración de la fase 7.5.
- **«Demasiados intentos seguidos»**: es el límite por usuario. Por hora y por día:
  - escáner: 20 y 100;
  - sugerencias: 30 y 150;
  - librero: 20 y 60;
  - «Nuevas aventuras»: 15 y 50.

  Espera o prueba con otra cuenta.

- **«rate limit exceeded» al registrarse**: es el límite de correos de Supabase. Desactiva
  «Confirm email» o configura un SMTP propio.

## Límites de los campos

Un solo archivo (`src/lib/inputLimits.ts`) define cada límite; lo usan la interfaz, los
validadores, las funciones Edge (`supabase/functions/_shared/inputLimits.ts`) y las restricciones
de SQL, y una prueba comprueba que coinciden. Los campos de texto quitan los caracteres de control
al escribir o pegar y, al guardar, juntan los espacios repetidos; los números aceptan solo
dígitos; el correo se pasa a minúsculas; las contraseñas nunca se modifican.

| Campo                     | Límite                       |
| ------------------------- | ---------------------------- |
| Título                    | 200                          |
| Autor                     | 120                          |
| Género                    | 60                           |
| Notas                     | 2000 (contador desde 1800)   |
| Persona a quien se presta | 80                           |
| Nombre para mostrar       | 50                           |
| Correo                    | 254, sin espacios            |
| Contraseña                | de 8 a 72                    |
| Búsqueda                  | 100                          |
| Contexto del Librero      | 200                          |
| Páginas / página actual   | 5 dígitos; 1-10000 / 0-total |

Los libros guardados antes de estos límites se muestran recortados y se suben al servidor ya
recortados.
