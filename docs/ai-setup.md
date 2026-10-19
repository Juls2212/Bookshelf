# IA en Bookshelf (Edge Functions `identify-book`, `suggest-book-details`, `recommend-book` y `discover-book`)

La app nunca llama a OpenAI ni guarda ninguna clave de IA. Usa cuatro Edge Functions de Supabase,
que verifican tu sesión, aplican un límite de uso, llaman a OpenAI y devuelven solo propuestas:

- `identify-book`: la foto del escáner. Nada se guarda hasta que tocas «Guardar libro» en
  «Revisa tu libro».
- `suggest-book-details`: el botón «Sugerir datos» del formulario. Recibe solo el título (y el
  autor, si lo escribiste) y propone autor, género y páginas, y, solo si está seguro, el título
  oficial (`canonical_title`, p. ej. «El Quijote de la mancha» → «Don Quijote de la Mancha»). Nunca
  rellena nada sola ni cambia lo que ya escribiste: el título oficial se aplica únicamente con
  «Usar» en su fila (ni siquiera con «Usar todo») y se ignora con «Descartar».
- `recommend-book`: tu librero. Lee solo tus propios libros «por leer», tus libros terminados con
  valoración y tus preferencias (con tu sesión, así que aplica RLS), elige uno y guarda la
  recomendación en la tabla `recommendations`. Al modelo solo le envía título, autor, género,
  páginas, días en el estante y valoraciones: nunca notas ni a quién prestaste un libro.

- `discover-book`: «Nuevas aventuras» del librero. Sugiere un libro que **no** está en tu
  estante, parecido a uno que elijas o a tus libros mejor valorados. Lee tus libros con tu sesión
  (RLS), descarta los que ya tienes, comprueba el título en el catálogo abierto de Open Library
  (sin clave; si falla, la sugerencia se marca como «no comprobada») y guarda la sugerencia en
  `recommendations` con `kind = 'discovery'`. No hay enlaces de compra: el libro solo se crea si
  tú lo añades desde el formulario.

Todas usan los mismos secretos y la misma tabla `ai_usage`. `discover-book` necesita además el
SQL de la sección 1b.

## 1b. Preparar «Nuevas aventuras» (una vez)

En **SQL Editor → New query**, pega todo
`supabase/migrations/20261012000000_discovery_recommendations.sql` y pulsa **Run**. Es
idempotente. Hace que `recommendations.user_book_id` admita null y añade `kind`, los campos
`suggested_*` y `suggestion_verified`, con sus comprobaciones. Las filas existentes quedan como
`kind = 'shelf'` y la RLS sigue igual.

Todos los comandos se ejecutan en la carpeta del proyecto, en PowerShell o en la terminal de
VS Code. `npx supabase` usa la CLI que ya está instalada en el proyecto.

## 1. Crear la tabla de uso (una vez)

1. Abre el panel de Supabase: **SQL Editor → New query**.
2. Pega todo `supabase/migrations/20261011000000_ai_usage.sql` y pulsa **Run**. Es idempotente:
   se puede volver a ejecutar sin problema.
3. Comprueba en **Database → Tables** que `ai_usage` muestra «RLS enabled» y que **no** tiene
   políticas. Solo la función (con la clave de servicio) puede leerla o escribirla.

## 2. Conectar la CLI con tu proyecto (una vez)

```sh
npx supabase login
npx supabase link --project-ref <ref-del-proyecto>
```

El `ref` está en **Project Settings → General → Project ID**. Si ya enlazaste el proyecto,
salta este paso.

## 3. Guardar la clave y el modelo como secretos de Supabase

Elige un modelo de OpenAI que acepte imágenes y salidas estructuradas (JSON Schema), según la
lista de modelos de tu cuenta de OpenAI.

```sh
npx supabase secrets set OPENAI_API_KEY=<tu-clave> OPENAI_MODEL=<nombre-del-modelo>
```

Opción sin escribir la clave en la línea de comandos (no queda en el historial):

1. Copia `supabase/functions/.env.example` como `supabase/functions/.env` (Git ya lo ignora).
2. Escribe los valores en ese `.env`.
3. Ejecuta `npx supabase secrets set --env-file supabase/functions/.env`.

Comprueba con `npx supabase secrets list` (muestra nombres, nunca valores). La clave **nunca**
va en `.env` de la app, en `app.json`, en `src/` ni en ningún archivo del repositorio;
`npm run verify` falla si aparece una clave de OpenAI.

## 4. Publicar la función

```sh
npx supabase functions deploy identify-book
npx supabase functions deploy suggest-book-details
npx supabase functions deploy recommend-book
npx supabase functions deploy discover-book
npx supabase functions deploy find-cover
```

La verificación de JWT queda activa (es lo predeterminado): no uses `--no-verify-jwt`. Los
secretos nuevos se aplican sin volver a publicar.

Cada vez que cambie el código de `supabase/functions/` (por ejemplo, cuando la función empezó a
devolver `cover_box`, el recuadro de la portada que usa la app para recortar la foto), vuelve a
ejecutar el mismo comando. Mientras no la publiques de nuevo, la app recorta la foto con un
recorte centrado del 80 %.

## 5. Probar desde la app (sin curl)

1. Abre la app en Expo Go e inicia sesión.
2. En desarrollo, **Perfil → Galería de componentes → Identificador del escáner** debe estar
   en **Real (servidor)** (es lo predeterminado al abrir la app). Las demás opciones usan el
   identificador de prueba.
3. Toca **Escanear**, elige **Portada** y fotografía la portada de un libro real.
4. Deberías ver «Revisa tu libro» con el título y el autor propuestos. Corrige lo que haga
   falta y guarda.
5. Para ver las tarjetas de error:
   - Foto de algo que no es un libro → «No vemos un libro en la foto».
   - Modo avión antes de tomar la foto → «Estás sin conexión».
   - Más de 20 escaneos en una hora (o 100 en un día) → «Demasiados intentos seguidos».

Para probar las sugerencias: **Añadir libro**, escribe al menos 3 letras del título (por ejemplo
«cien años de soledad») y toca **Sugerir datos**. Deberías ver propuestas solo para los campos
vacíos, cada una con «Usar» y «Descartar». En desarrollo, **Galería de componentes →
Sugerencias de datos** debe estar en **Real (servidor)**. Sin conexión, el botón aparece
desactivado con un aviso.

Los registros están en **Edge Functions → identify-book (o suggest-book-details) → Logs**. Solo contienen códigos de
error, nunca imágenes, títulos, tokens ni claves.

## Códigos de error de `identify-book`

| Código            | HTTP | Causa                                                          |
| ----------------- | ---- | -------------------------------------------------------------- |
| `unauthorized`    | 401  | Sin sesión o sesión no válida.                                 |
| `invalid_request` | 400  | Cuerpo incorrecto, modo desconocido o imagen no JPEG/PNG/WebP. |
| `image_too_large` | 413  | La imagen pesa más de 1,5 MB.                                  |
| `rate_limited`    | 429  | Más de 20 llamadas por hora o 100 por día para ese usuario.    |
| `not_a_book`      | 422  | La foto no muestra un libro.                                   |
| `low_confidence`  | 422  | Es un libro, pero no se pudo leer el título.                   |
| `upstream_error`  | 502  | Faltan secretos, OpenAI falló o devolvió algo inválido.        |
| `timeout`         | 504  | OpenAI no respondió en 25 s.                                   |

## Códigos de error de `suggest-book-details`

| Código            | HTTP | Causa                                                                |
| ----------------- | ---- | -------------------------------------------------------------------- |
| `unauthorized`    | 401  | Sin sesión o sesión no válida.                                       |
| `invalid_request` | 400  | Título de menos de 3 o más de 200 caracteres, o autor de más de 120. |
| `rate_limited`    | 429  | Más de 30 llamadas por hora o 150 por día para ese usuario.          |
| `no_suggestions`  | 422  | No se encontró ningún libro real que coincida.                       |
| `upstream_error`  | 502  | Faltan secretos, OpenAI falló o devolvió algo inválido.              |
| `timeout`         | 504  | OpenAI no respondió en 15 s.                                         |

## Códigos de error de `recommend-book`

| Código            | HTTP | Causa                                                                            |
| ----------------- | ---- | -------------------------------------------------------------------------------- |
| `unauthorized`    | 401  | Sin sesión o sesión no válida.                                                   |
| `invalid_request` | 400  | Contexto de más de 200 caracteres, más de 30 ids excluidos o día/hora inválidos. |
| `rate_limited`    | 429  | Más de 20 llamadas por hora o 60 por día para ese usuario.                       |
| `no_candidates`   | 422  | No hay libros «por leer» disponibles (sin prestar ni excluidos).                 |
| `upstream_error`  | 502  | Faltan secretos, OpenAI falló o eligió un libro fuera de la lista dos veces.     |
| `timeout`         | 504  | OpenAI no respondió en 25 s.                                                     |

Para probarla antes de que exista la pantalla nueva del Librero (fase 7.3): en desarrollo,
**Galería de componentes → Recomendaciones del librero** permite usar el servicio de prueba. Tras
publicar la función, cada recomendación real aparece como fila nueva en **Table Editor →
recommendations**, con su explicación en `rationale`.

## Códigos de error de `discover-book`

| Código               | HTTP | Causa                                                                   |
| -------------------- | ---- | ----------------------------------------------------------------------- |
| `unauthorized`       | 401  | Sin sesión o sesión no válida.                                          |
| `invalid_request`    | 400  | Datos inválidos o el libro de referencia no es tuyo.                    |
| `rate_limited`       | 429  | Más de 15 llamadas por hora o 50 por día para ese usuario.              |
| `no_new_suggestions` | 422  | Dos intentos seguidos propusieron libros que ya tienes o ya te sugirió. |
| `upstream_error`     | 502  | Faltan secretos, falta el SQL de la sección 1b u OpenAI falló.          |
| `timeout`            | 504  | OpenAI no respondió en 25 s.                                            |

Si todo devuelve `upstream_error`, revisa con `npx supabase secrets list` que existan los dos
secretos y que el modelo elegido acepte imágenes.

## Portada sugerida (`find-cover`)

`find-cover` **no usa IA**: busca la portada en catálogos públicos, primero Open Library y, si
hace falta, Google Books. Devuelve hasta diez imágenes distintas, solo con `https` y de
`covers.openlibrary.org`, `books.google.com` o `books.googleusercontent.com`. La app vuelve a
comprobar esa lista, el tipo y el tamaño antes de descargar, y descarta imágenes de menos de
100 px (las de «sin portada»). Usa la misma tabla `ai_usage` para el límite: 30 llamadas por hora
y 150 por día por usuario.

Cómo busca: en Open Library prueba el título solo, luego título y autor, y luego una búsqueda
más amplia con las palabras del título; con la mejor obra encontrada pide además sus ediciones
(`editions.json`, hasta 40) para reunir más portadas. Después sigue con Google Books mientras haya
menos de diez: primero restringido a español (`langRestrict=es`) y luego sin filtro (título y
autor, luego título). Se eliminan duplicados por identificador de portada o de volumen y se ordenan
primero las ediciones en español y luego las imágenes más grandes.
Un resultado cuenta como el mismo libro si contiene al menos el 60 % de las palabras del título,
sin importar mayúsculas, tildes ni artículos («El Quijote de la mancha» encuentra «El ingenioso
hidalgo don Quijote de la Mancha»).

En la app, las candidatas aparecen como una tira de miniaturas desplazable bajo la vista previa:
tocar una la selecciona y «Usar esta portada» aplica la seleccionada.

Registros (**Edge Functions → find-cover → Logs**): por cada intento, una línea JSON con
`source`, `attempt`, `status` (0 = sin respuesta o tiempo agotado) y `candidates`, y al final el
total y los milisegundos. Nunca el título, el autor, la URL ni claves.

Publicarla:

```sh
npx supabase functions deploy find-cover
```

Secreto **opcional** (funciona sin él, con una cuota menor de Google Books):

```sh
npx supabase secrets set GOOGLE_BOOKS_API_KEY=<tu-clave-de-google-books>
```

Como las demás claves, nunca va en el `.env` de la app ni en el repositorio.

| Código            | HTTP | Causa                                                       |
| ----------------- | ---- | ----------------------------------------------------------- |
| `unauthorized`    | 401  | Sin sesión o sesión no válida.                              |
| `invalid_request` | 400  | Título vacío o de más de 200 caracteres, autor o ISBN malo. |
| `rate_limited`    | 429  | Más de 30 llamadas por hora o 150 por día para ese usuario. |
| `upstream_error`  | 502  | Ningún catálogo respondió.                                  |

Sin resultados no es un error: la función responde una lista vacía y la app no muestra nada.
