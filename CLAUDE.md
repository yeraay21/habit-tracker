# CLAUDE.md — Tracker (PWA de hábitos y tareas)

## Contexto del usuario
- Estudiante de 4º de Ingeniería Informática (UPF), haciendo el TFG (visión por computador con YOLO-Pose). Horario de clases no fijo.
- Problema: olvida tareas, se distrae con el móvil o YouTube y las hace tarde. Quiere ver de un vistazo qué toca hoy y marcarlo.
- Usa Google Calendar a diario. Cada noche se crean automáticamente los bloques del día siguiente con prefijo **`[Plan]`**, y sus avisos sí le funcionan.
- Hábitos: gimnasio 5 días/semana (sáb y dom por la mañana + 3 tardes) con rotación pecho/tríceps/hombro → espalda/bíceps → pierna → espalda/pecho → brazos. Registra los pesos en otra PWA suya ("Diario de Hierro"). Inglés diario (~15 min de speaking + ~10 min de ejercicios, objetivo B2→C1). Al menos 2 CVs al día. Ganar masa muscular (se pesa de vez en cuando).
- Móvil: Android (Realme 7 Pro, Chrome). En el gimnasio no suele tener datos.
- Idioma: **español** (interfaz, comentarios y documentación).

## Restricciones (no negociables)
- Sin backend ni servicios de pago. Alojada en GitHub Pages.
- **Solo escribir en el calendario "Tracker"**: nunca modificar ni borrar eventos de otros calendarios.
- Rápida de abrir y cómoda con una mano. Código sencillo, sin framework ni build: el usuario lo irá ampliando.

## Decisiones tomadas
| Tema | Decisión | Por qué |
|---|---|---|
| Stack | HTML + CSS + JS (módulos ES), sin npm ni bundler | Cero mantenimiento, abre rápido, se sube tal cual a Pages |
| Login | **Opción B**: flujo *authorization code* con GIS `initCodeClient` (popup) y redirección clásica como alternativa. Canje del código en el navegador con `client_secret` → refresh token | El usuario no quiere iniciar sesión cada vez. Lo eligió él frente a la opción A (solo access token, un toque por hora) |
| Secret | Lo pega el usuario en Ajustes y se guarda en localStorage. **Nunca en el repo** | El repo es público |
| Estado de la app en Google Cloud | "En producción" sin verificar | En "Prueba" el refresh token caduca a los 7 días |
| Scopes | `calendar.app.created` (escribir solo en calendarios creados por la app), `calendar.events.readonly`, `calendar.calendarlist.readonly` | Google impone la restricción "solo Tracker" por permisos |
| Persistencia local | localStorage (JSON) vía `js/store.js` | Pocos datos; más simple que IndexedDB |
| Conflictos | Gana el último cambio | Un solo usuario, casi siempre un solo dispositivo |
| Notificaciones | Avisos `popup` de los propios eventos de Google Calendar | Llegan con la app cerrada sin necesidad de push propio |
| Revisión nocturna | Evento recurrente diario "🌙 Revisión del día" (22:00 por defecto) en Tracker. La app reescribe el título de la ocurrencia de hoy: "🌙 Quedan N: …" | Única forma de tener un aviso nocturno con contenido sin backend |
| Eventos externos marcados | La marca de "hecho" en eventos de otros calendarios (p. ej. `[Plan]`) se guarda **solo en local** (`localDone`) | No podemos escribir fuera de Tracker |
| Diseño | Tema oscuro "cuaderno nocturno": fondo tinta cálida, acento lima `#d4ff3a`, fuentes Bricolage Grotesque + IBM Plex Mono | Uso frecuente de noche; el lima marca solo lo importante |

## Arquitectura
```
index.html            shell: <main id="view">, barra inferior, botón +
sw.js                 service worker (stale-while-revalidate; en localhost, primero la red)
config.js             CLIENT_ID (público), zona horaria, ventana de sync, hora de revisión
js/app.js             arranque, rutas por hash (#hoy #cal #ajustes #nueva), repintado
js/auth.js            OAuth: signIn (popup GIS o redirección), canje, refresh, signOut
js/gcal.js            REST Calendar v3; las funciones de escritura SOLO usan trackerCalId
js/sync.js            caché server + cola outbox + vista combinada; flush, pull, revisión nocturna
js/model.js           evento ↔ tarea/hábito, recurrencia, itemsForDay, pickNext, parches
js/backup.js          exportar/importar JSON
js/mock.js            Google Calendar falso para ?demo=1 (también prohíbe escribir fuera de Tracker)
js/store.js, dates.js utilidades
js/ui/*.js            today, calendar, editor, settings, items (filas/fichas), actions (tocar/mantener), dom (h(), sheet, toast)
tools/dev-server.mjs  servidor estático local (node, sin dependencias)
```

### Flujo de datos
- `server` (copia de Google) + `outbox` (cambios pendientes) → `getView()` = server con la cola aplicada encima. **La interfaz solo lee `getView()` y solo escribe con `sync.create/patch/remove/patchOccurrence`.**
- `push()` fusiona varios toques seguidos sobre lo mismo en un solo PATCH, y mete los cambios de algo aún no creado dentro de su propio `create`.
- `sync()`: si hace falta crea el calendario Tracker → envía la cola en orden → descarga la ventana (de -7 a +35 días) de los calendarios visibles con `singleEvents=true`, y los maestros de los hábitos con `singleEvents=false` y `privateExtendedProperty=trk=1` → `ensureReview()` → vuelve a enviar la cola.
- Ids provisionales `tmp…`: al crear en Google se remapean en la cola (`remap`). Las ocurrencias de hábitos creados sin conexión se expanden en local (`expandHabit`, ids `…_L20261107`, `_local`). Los cambios sobre ellas llevan `resolve: true` y, al enviarse, buscan la ocurrencia real con `events.instances`.
- Claves de la caché: `"<alias>|<eventId>"`, donde el alias de Tracker es siempre `tracker` (no depende del id real).
- Disparadores de sync: al abrir, `online`, volver a la app (si pasó más de 1 min), cada 5 min con la app visible, y ~0,7 s después de cada cambio local.

### Modelo de datos (eventos de Tracker)
`extendedProperties.private`:
- `trk='1'`, `kind='task'|'habit'|'review'`, `uid` (estable, para copias de seguridad), `rem` (minutos de aviso o '').
- Hábito (en el maestro): `freq='daily'|'days'|'weekly'`, `days='MO,WE'`, `perWeek`, `target`, `unit`.
- Estado (en la tarea o en **cada ocurrencia** del hábito, que pasa a ser excepción): `done`, `doneAt`, `count`, `touched='1'` (sirve para exportar el historial).

Representación:
- Tarea con hora: evento con hora (duración elegible) y aviso. Tarea sin hora: evento de día completo sin aviso.
- Hábito diario o en días concretos: `RRULE:FREQ=DAILY` o `FREQ=WEEKLY;BYDAY=…`. Si tiene hora, lleva aviso.
- Hábito "N veces por semana": diario de día completo sin aviso. Se oculta de Hoy al cumplir N en la semana (de lunes a domingo).
- Al marcar como hecho: el título pasa a `✓ Título`, los hábitos numéricos llevan el sufijo ` (n/m)` y se vacían los avisos pendientes. Al desmarcar se restauran desde `rem`.
- Archivar un hábito: se añade `UNTIL=ayer` a la RRULE (conserva el historial). Si empezaba hoy o después, se borra.
- Todos los eventos de la app son `transparency: transparent` (no ocupan la agenda).

## Cómo probar
- `node tools/dev-server.mjs` → `http://localhost:8080/?demo=1`. El modo demo usa otro prefijo de localStorage (`trkdemo.`) y no toca la cuenta real.
- Ajustes (demo) → "Simular sin conexión" o "Reiniciar demo".
- Probado en demo (7-nov-2026): crear una tarea con aviso en Tracker, marcarla, la revisión nocturna se actualiza, hábitos con contador / días / N por semana, cola sin conexión con coalescencia, hábito creado sin conexión y marcado (camino `resolve`), calendario semana y mes, exportar e importar sin duplicados.
- **Sin probar contra Google real** (faltan credenciales): el canje del código en el navegador (CORS de `oauth2.googleapis.com/token`), el popup de GIS dentro de la PWA instalada, el comportamiento real de `calendar.app.created` y las excepciones de ocurrencias en Google.

## Convenciones
- Interfaz y comentarios en español. Sin dependencias. Funciones pequeñas y explícitas.
- Nunca `innerHTML` con datos del usuario. Usar `h()` de `ui/dom.js`. `svg()` solo con marcado estático propio.
- Archivo nuevo → añadirlo a `ASSETS` en `sw.js` y subir `VERSION`.
- Cualquier escritura en Google pasa por `gcal.insertEvent/patchEvent/deleteEvent`, que solo usan `trackerCalId`. No añadir funciones de escritura que reciban un calendario.

## Fase 2 (pendiente, en este orden sugerido)
1. Revisión nocturna interactiva: pantalla `#revision` que lista lo no hecho y lo pasa a mañana con un toque (ya existe `moveTaskPatch`). Enlazarla desde la descripción del evento 🌙.
2. Planificación semanal del domingo (vista de la semana siguiente + plantillas de bloques para el finde).
3. Hábito de gimnasio con rotación: calcular el entrenamiento que toca según los días hechos (pecho/tríceps/hombro → espalda/bíceps → pierna → espalda/pecho → brazos) y enlazar a "Diario de Hierro".
4. Rachas y mapa de calor tipo GitHub por hábito (descargar el historial con `privateExtendedProperty=touched=1`).
5. Cuenta atrás para exámenes y entregas del TFG (tareas con `p.deadline='1'`).
6. Modo foco: Pomodoro asociado a una tarea.
7. Registro rápido de peso con gráfica de evolución.
8. Ideas propuestas: registro de candidaturas dentro del hábito de CVs (empresa y enlace); más atajos del icono ("+1 CV"); "primer paso de 2 minutos" por tarea, que se muestra en la tarjeta destacada.
