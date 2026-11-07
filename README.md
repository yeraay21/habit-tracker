# Tracker

PWA personal de hábitos y tareas integrada con Google Calendar. La pantalla principal es **Hoy**: arriba, lo siguiente que toca; debajo, los hábitos, la agenda (incluidos los bloques `[Plan]`) y las tareas, todo marcable con un toque. Las tareas y hábitos se guardan como eventos en un calendario propio, **Tracker**, así que los avisos llegan por Google Calendar aunque la app esté cerrada.

- Sin backend, sin dependencias y sin paso de compilación: HTML, CSS y JavaScript (módulos ES).
- Funciona sin conexión: muestra lo último sincronizado, deja marcar y crear cosas y lo sube al volver la red.
- Solo escribe en el calendario "Tracker". Los demás calendarios los lee sin poder modificarlos, y el propio permiso de Google lo impide.

---

## 1. Probar en local

Requisito: Node.js (cualquier versión reciente).

```bash
node tools/dev-server.mjs
```

- `http://localhost:8080/?demo=1`: **modo demo**, con un Google Calendar falso guardado en el navegador. Sirve para probarlo todo sin credenciales. En Ajustes → "Simular sin conexión" puedes probar el modo offline.
- `http://localhost:8080/`: modo real, conectado a tu cuenta (necesita el paso 2).

En `localhost` el service worker va primero a la red, así ves tus cambios al recargar.

---

## 2. Configurar Google Cloud (una sola vez, ~10 min)

> Google cambia a veces los nombres de los menús. Si alguno no coincide, busca la opción equivalente dentro de **Google Auth Platform** (antes "Pantalla de consentimiento OAuth").

### 2.1 Proyecto y API
1. Entra en <https://console.cloud.google.com/> con tu cuenta de Google.
2. Arriba, en el selector de proyectos → **Proyecto nuevo** → nombre `Tracker` → Crear. Comprueba que queda seleccionado.
3. Menú ☰ → **APIs y servicios → Biblioteca** → busca **Google Calendar API** → **Habilitar**.

### 2.2 Pantalla de consentimiento (Google Auth Platform)
1. Menú ☰ → **Google Auth Platform** → **Comenzar**.
2. *Información de la app*: nombre `Tracker` y tu correo como correo de asistencia.
3. *Audiencia*: **Externo**.
4. *Información de contacto*: tu correo. Acepta la política y pulsa **Crear**.
5. **Acceso a datos** → **Añadir o quitar permisos** → al final, en "Añadir permisos manualmente", pega estas tres líneas → **Añadir a la tabla** → **Actualizar** → **Guardar**:
   ```
   https://www.googleapis.com/auth/calendar.app.created
   https://www.googleapis.com/auth/calendar.events.readonly
   https://www.googleapis.com/auth/calendar.calendarlist.readonly
   ```
6. **Imagen de marca (Branding)**: completa nombre de la app, correo de asistencia y, al final, *Información de contacto del desarrollador*. **No subas logotipo**: obliga a pasar la verificación de Google. Si "Publicar app" sigue desactivado, rellena también (con la web ya publicada en GitHub Pages, paso 3):
   - Página principal: `https://TU_USUARIO.github.io/habit-tracker/`
   - Política de privacidad: `https://TU_USUARIO.github.io/habit-tracker/privacy.html`
   - Dominio autorizado: `TU_USUARIO.github.io`

   **Guardar** y recarga la página para comprobar que los datos se han guardado.
7. **Audiencia** → **Publicar app** (se activa cuando la marca está completa) → confirmar (estado: **En producción**).
   - Mientras no puedas publicar, puedes usar la app igualmente: en **Audiencia → Usuarios de prueba** añade tu Gmail. Solo tendrás que volver a iniciar sesión cada 7 días.
   - **Importante.** En estado "Prueba", Google caduca la sesión **cada 7 días**. En producción no.
   - No hace falta pasar la verificación de Google. Para uso personal basta con aceptar una vez el aviso "app no verificada" (ver paso 4).

### 2.3 Credenciales OAuth (cliente web)
1. **Google Auth Platform → Clientes → Crear cliente**.
2. Tipo de aplicación: **Aplicación web**. Nombre: `Tracker PWA`.
3. **Orígenes de JavaScript autorizados** (sin barra final):
   - `http://localhost:8080`
   - `https://TU_USUARIO.github.io`
4. **URIs de redirección autorizados** (con barra final):
   - `http://localhost:8080/`
   - `https://TU_USUARIO.github.io/habit-tracker/`
5. **Crear**. Copia el **ID de cliente** y el **secreto del cliente** (`GOCSPX-…`) y guarda el secreto en un sitio seguro: Google puede no volver a mostrarlo.
6. *(Opcional)* Pega el ID de cliente en `config.js` → `CLIENT_ID`. Es público, no pasa nada por subirlo. **El secreto no se pone nunca en el código**: se pega en *Ajustes* dentro de la app y se queda solo en ese dispositivo.

La pantalla de Ajustes muestra el origen y la URI de redirección exactos que espera la app.

---

## 3. Publicar en GitHub Pages (gratis)

1. Crea un repositorio en GitHub llamado `habit-tracker`. Si tu plan es Free, tiene que ser público. Con GitHub Pro (gratis con el Student Pack) puede ser privado.
2. Sube esta carpeta:
   ```bash
   git init
   ```
   ```bash
   git add .
   ```
   ```bash
   git commit -m "Tracker: fase 1"
   ```
   ```bash
   git branch -M main
   ```
   ```bash
   git remote add origin https://github.com/TU_USUARIO/habit-tracker.git
   ```
   ```bash
   git push -u origin main
   ```
3. En GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`** → Save.
4. Al minuto estará en `https://TU_USUARIO.github.io/habit-tracker/`. Esa URL tiene que coincidir con la URI de redirección del paso 2.3.

**Actualizaciones:** haz `git push` y listo. La app descarga la versión nueva en segundo plano y la muestra **en la siguiente apertura**. Si añades o renombras archivos, súbelos también a la lista `ASSETS` de `sw.js` y cambia `VERSION`.

---

## 4. Instalar en Android (Chrome)

1. Abre `https://TU_USUARIO.github.io/habit-tracker/` en Chrome.
2. Menú ⋮ → **Instalar aplicación** (o "Añadir a pantalla de inicio").
3. Abre Tracker desde el icono → **Ajustes** → pega el Client ID y el secret → **Guardar credenciales** → **Iniciar sesión con Google**.
4. Google mostrará *"Google no ha verificado esta aplicación"*. Es tu propia app: **Configuración avanzada → Ir a Tracker (no seguro)**. **Marca todas las casillas de permisos** y continúa.
5. En la primera sincronización se crea el calendario **Tracker** y el evento diario **🌙 Revisión del día**.
6. **Para que lleguen los avisos**, en la app **Google Calendar** de Android: Ajustes → tu cuenta → comprueba que **Tracker** está marcado (sincronizado) y que sus notificaciones están activadas. Los calendarios secundarios nuevos a veces aparecen sin sincronizar.

Truco: si mantienes pulsado el icono de Tracker aparece el atajo **Nueva tarea**.

Si el login en ventana emergente no se abre en la app instalada, en Ajustes cambia el método a **Redirección** y vuelve a intentarlo.

---

## 5. Cómo se mantiene la sesión (y sus límites)

- El login usa el flujo OAuth de *authorization code*. Google entrega un **refresh token** que la app guarda en el móvil y con el que renueva el acceso cada hora sin que hagas nada. **No tendrás que iniciar sesión al abrir la app.**
- Tendrás que volver a entrar (una vez) si:
  - la app de Google Cloud sigue en estado **Prueba** (la sesión caduca a los 7 días; publícala, paso 2.2.7);
  - revocas el acceso en <https://myaccount.google.com/permissions>, o Google lo revoca por seguridad (por ejemplo, tras ciertos cambios de contraseña);
  - pasas **6 meses** sin abrir la app;
  - borras los datos del navegador o desinstalas la app.
- Seguridad: el secret y el refresh token viven en el `localStorage` de tu móvil. La app no carga scripts de terceros salvo el de Google y tiene una CSP estricta. Los permisos solo dejan **leer** tus calendarios y **escribir en el calendario que la app creó**.

## 6. Sin conexión

- Al abrir, la app pinta al instante lo último guardado (de 7 días atrás a 5 semanas adelante).
- Lo que marques o crees sin conexión se guarda en una cola (el chip de arriba dice "N pendientes") y se envía al recuperar la red o al volver a abrir la app.
- Los eventos de tus otros calendarios también se pueden marcar como hechos, pero esa marca **solo se guarda en este móvil**, porque la app no puede escribir en esos calendarios.

## 7. Copia de seguridad

Ajustes → **Exportar JSON** descarga tus tareas, hábitos y su historial. **Importar JSON** los recrea en Tracker sin duplicar lo que ya existe.

---

Para la arquitectura, el modelo de datos y las decisiones de diseño, consulta [`CLAUDE.md`](CLAUDE.md).
