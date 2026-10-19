# Lista de QA manual: Bookshelf

Hazla en el **APK de preview** (ver README) y en un teléfono Android real. Repite los bloques
marcados con 🌓 en tema **Claro** y **Oscuro**. Antes de empezar:

- Configura Supabase completo: migraciones, prueba de RLS, Edge Functions y secretos.
- Ten dos cuentas de prueba (A y B) y algunos libros reales a mano.

Marca cada casilla solo si el resultado coincide con lo esperado. Anota cualquier diferencia con
el modelo de teléfono y la versión de Android.

## 1. Cuenta

- [ ] Registro con correo nuevo y contraseña de 8 o más caracteres → entra a Inicio (con «Confirm email» desactivado).
- [ ] Registro con contraseña corta, correo inválido o contraseñas distintas → mensajes de validación en español junto al campo.
- [ ] Registro con un correo ya usado → mensaje claro, sin entrar.
- [ ] Inicio de sesión con contraseña incorrecta → mensaje de error, sin entrar.
- [ ] Inicio de sesión correcto → Inicio con la biblioteca de esa cuenta.
- [ ] «¿Olvidaste tu contraseña?» → avisa que envía un correo de recuperación y que el cambio no se completa en la app; el correo llega.
- [ ] Cerrar la app y abrirla de nuevo → la sesión se mantiene.

## 2. Biblioteca 🌓

- [ ] Biblioteca vacía → estado vacío con acción para añadir el primer libro.
- [ ] Añadir libro sin título o sin páginas → no guarda y señala los campos.
- [ ] Añadir libro con título, autor, género y páginas, sin portada → aparece con portada tipográfica.
- [ ] Añadir libro con portada de la **galería**, ajustando el recorte → la portada recortada aparece en el estante y en la ficha.
- [ ] Añadir libro con portada tomada con la **cámara** → igual que con la galería.
- [ ] Editar título, autor y portada → los cambios se ven en el estante, en la ficha y en Inicio.
- [ ] Borrar un libro (con confirmación) → desaparece del estante; cancelar no borra nada.
- [ ] Búsqueda «cien anos» encuentra «Cien años de soledad» (sin acentos ni mayúsculas).
- [ ] Filtros Todos / por leer / leyendo / terminados / Prestados y género → la cuadrícula muestra solo lo que corresponde.
- [ ] Con muchos libros (50 o más), el desplazamiento del estante es fluido.

## 3. Seguimiento de lectura 🌓

- [ ] Cambiar el estado a «leyendo» → el libro aparece como lectura en curso en Inicio.
- [ ] Actualizar la página actual → el progreso (y el porcentaje si hay páginas) se actualiza; no acepta una página mayor que el total.
- [ ] Marcar como terminado → cuenta en «Tu lectura» (Este año y Total).
- [ ] Valorar con estrellas y escribir notas → se guardan al volver a la ficha.
- [ ] Prestar un libro (nombre) → aparece la etiqueta «Prestado» y en el filtro Prestados; devolverlo la quita.
- [ ] La ficha muestra libros relacionados del mismo género.

## 4. Sincronización

- [ ] Con red: un cambio pasa de «1 cambio pendiente» a «Sincronizado» en segundos.
- [ ] Modo avión: añadir, editar, cambiar página y borrar funcionan; la insignia muestra «Sin conexión · N pendientes».
- [ ] Cerrar y abrir la app en modo avión → los cambios siguen ahí.
- [ ] Quitar el modo avión → la cola se envía sola y la insignia vuelve a «Sincronizado».
- [ ] En Supabase (Table Editor y Storage) aparecen las filas y la portada en `book-covers/<id-usuario>/`.
- [ ] Instalar el APK en otro teléfono (o borrar los datos de la app) e iniciar sesión → descarga toda la biblioteca, con portadas.
- [ ] Primer inicio sin red en un teléfono sin datos → aviso de que hace falta conexión la primera vez.

## 5. Escáner y «Mejorar portada» 🌓

- [ ] Primera vez: pide permiso de cámara con el texto en español; si lo niegas, explica cómo activarlo y ofrece añadir a mano.
- [ ] Foto de la **portada** de un libro real → «Revisa tu libro» con título y autor propuestos y editables.
- [ ] Foto del **lomo** → propone los datos igual.
- [ ] Foto de algo que no es un libro → «No vemos un libro en la foto», con «Reintentar» y «Añadir a mano».
- [ ] Modo avión antes de la foto → «Estás sin conexión».
- [ ] La portada propuesta viene recortada al libro; «Ajustar recorte» permite cambiarla.
- [ ] «Mejorar portada» → ajustar esquinas → vista Original / Mejorada; la mejorada se ve derecha y con mejor contraste; se puede volver a la original.
- [ ] Guardar → el libro aparece en el estante; si sales sin guardar no se crea nada.

## 6. Sugerir datos

- [ ] Título de menos de 3 letras → el botón no está disponible.
- [ ] «Sugerir datos» con un título real → propuestas solo para los campos vacíos, cada una con «Usar» y «Descartar».
- [ ] «Usar» rellena el campo; «Descartar» no cambia nada; nunca sobrescribe lo que escribiste.
- [ ] Sin conexión → botón desactivado con aviso.

## 7. Librero 🌓 (siempre en tema oscuro)

- [ ] **De mi estante**: con libros «por leer», «Pedir recomendación» → un libro con su motivo en español.
- [ ] Chips de tiempo («Menos de 30 min»…) y de ánimo («Algo tranquilo»…) → se envían con la petición; los de ánimo se ocultan si «Tener en cuenta mi ánimo» está desactivado.
- [ ] «Empezar a leer» → el libro pasa a «leyendo».
- [ ] «Leer después» → aparece en Historial → Leer después.
- [ ] «Otra recomendación» → llega otra y la anterior queda como saltada; si falla (p. ej. sin red), la actual no cambia.
- [ ] Sin libros «por leer» → explica el motivo y ofrece añadir un libro.
- [ ] **Nuevas aventuras**: «Parecido a…» un libro o «Basado en mis favoritos» → un libro que no está en el estante, con la etiqueta «Fuera de tu estante» y el aviso de comprobado o no comprobado.
- [ ] «Añadir a mi estante» desde una sugerencia → abre el formulario prellenado y editable; solo se crea al guardar.
- [ ] Historial: más reciente primero; un libro borrado aparece como no disponible y no se puede abrir.
- [ ] Sin conexión → la última recomendación sigue visible con aviso, y pedir otra está desactivado.
- [ ] Muchas peticiones seguidas → «Demasiados intentos» con mensaje claro.

## 8. Preferencias, estadísticas y perfil 🌓

- [ ] Elegir géneros favoritos y activar o desactivar cada preferencia → se guarda (también sin red) y se sincroniza.
- [ ] «Tu lectura» en Inicio: Este año / Total cambian las cifras; con biblioteca vacía no hay errores.
- [ ] Editar el nombre → se ve en Perfil y en el saludo de Inicio.
- [ ] Tema Claro / Oscuro / Sistema → cambia al instante y se mantiene al reabrir la app.

## 9. Cierre de sesión seguro

- [ ] Con cambios pendientes, «Cerrar sesión» → advierte «Tienes cambios sin sincronizar» antes de salir.
- [ ] Cerrar sesión con la cuenta A e iniciar con la B → no se ve **nada** de A: libros, portadas, perfil, preferencias, recomendaciones ni sincronización.
- [ ] Volver a la cuenta A → sus datos siguen intactos.

## 10. Accesibilidad 🌓

- [ ] Texto del sistema al **200 %** (Ajustes → Pantalla → Tamaño de fuente): ningún texto se corta ni se superpone en Inicio, Biblioteca, Ficha, Formulario, Escáner, Librero y Perfil.
- [ ] TalkBack: todos los botones, chips, pestañas y estrellas se anuncian con nombre, función y estado (seleccionado o desactivado); las portadas decorativas no se anuncian.
- [ ] Todos los elementos táctiles se pulsan con facilidad (al menos 44 × 44 pt).
- [ ] Con «Quitar animaciones» activado en Android, no hay animaciones de entrada ni de carga.
- [ ] Ningún estado se comunica solo con color: errores, prestado, comprobado y pendiente llevan texto o icono.
- [ ] Contraste legible en ambos temas, también los textos de ayuda (placeholders) en los campos.

## 11. Instalación y permisos

- [ ] El icono, el icono adaptable (con y sin tema de iconos) y la splash muestran el estante de Bookshelf sobre fondo crema.
- [ ] Ajustes → Apps → Bookshelf → Permisos: solo aparece la cámara y, en Android 12 o anterior, el almacenamiento (fotos); no aparecen micrófono ni otros.
- [ ] La app no muestra la galería de componentes de desarrollo en ningún lugar.
