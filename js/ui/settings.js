// Ajustes: cuenta de Google, calendarios visibles, revisión nocturna y copias de seguridad.
import * as auth from '../auth.js';
import * as sync from '../sync.js';
import * as store from '../store.js';
import { exportBackup, importBackup } from '../backup.js';
import { reviewTimeBody } from '../model.js';
import { CONFIG } from '../../config.js';
import { h, toast } from './dom.js';
import { syncChip } from './items.js';

export function renderSettings(root) {
  const s = store.getSettings();
  const st = auth.status();
  if (st === 'signedOut') auth.preloadGis().catch(() => {});

  root.append(...[
    h('div', { class: 'topline' }, h('span', { class: 'eyebrow' }, 'Ajustes'), syncChip()),
    h('h1', { class: 'title-l', style: { marginBottom: '16px' } }, 'Ajustes'),
    accountCard(st),
    store.DEMO ? null : credentialsCard(s),
    calendarsCard(s),
    reviewCard(s),
    backupCard(),
    store.DEMO ? demoCard() : null,
    h('p', { class: 'hint', style: { textAlign: 'center', marginTop: '18px' } },
      store.DEMO ? h('a', { href: auth.appUrl() }, 'Salir del modo demo') : h('a', { href: `${auth.appUrl()}?demo=1` }, 'Probar el modo demo (datos de mentira)')),
  ].filter(Boolean));
}

function rerender() {
  const root = document.getElementById('view');
  root.replaceChildren();
  renderSettings(root);
}

function accountCard(st) {
  const sync0 = sync.getStatus();
  const card = h('section', { class: 'card' }, h('h3', null, 'Cuenta de Google'));
  if (store.DEMO) {
    card.append(h('p', null, 'Estás en modo demo: un Google Calendar falso guardado en este navegador. No se toca tu cuenta real.'));
    return card;
  }
  if (st === 'unconfigured') {
    card.append(h('p', null, 'Primero pega el Client ID y el client secret de Google Cloud (tarjeta de abajo). Los pasos están en el README.'));
    return card;
  }
  if (st === 'signedOut') {
    card.append(
      h('p', null, store.get('authExpired') ? 'La sesión caducó o se revocó. Entra otra vez y seguirá funcionando sola.' : 'Inicia sesión una vez; después la app renueva el acceso sola.'),
      h('button', {
        class: 'btn btn-primary btn-block', type: 'button',
        onclick: async () => {
          try {
            await auth.signIn();
            toast('Sesión iniciada');
            sync.sync();
            rerender();
          } catch (e) {
            toast(e.message, 4000);
          }
        },
      }, 'Iniciar sesión con Google'),
    );
  } else {
    card.append(
      h('div', { class: 'status-line' }, `Conectado · ${sync0.pending} cambio${sync0.pending === 1 ? '' : 's'} pendiente${sync0.pending === 1 ? '' : 's'}`),
      sync0.msg ? h('p', { class: 'muted' }, sync0.msg) : null,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { sync.clearMessage(); sync.sync(); } }, 'Sincronizar ahora'),
        h('button', {
          class: 'btn btn-sm btn-danger', type: 'button',
          onclick: async () => {
            if (!confirm('¿Cerrar sesión? Los cambios pendientes se enviarán cuando vuelvas a entrar.')) return;
            await auth.signOut();
            rerender();
          },
        }, 'Cerrar sesión')),
    );
  }
  return card;
}

function credentialsCard(s) {
  let clientId = s.clientId || CONFIG.CLIENT_ID || '';
  let secret = s.clientSecret || '';
  let mode = s.authMode || 'popup';
  return h('section', { class: 'card' },
    h('h3', null, 'Credenciales de Google Cloud'),
    h('p', null, 'Se guardan solo en este dispositivo. El secret no se sube nunca al repositorio.'),
    h('label', { class: 'field' }, h('span', null, 'Client ID'),
      h('input', { value: clientId, autocomplete: 'off', spellcheck: 'false', placeholder: '…apps.googleusercontent.com', oninput: (e) => { clientId = e.target.value; } })),
    h('label', { class: 'field' }, h('span', null, 'Client secret'),
      h('input', { type: 'password', value: secret, autocomplete: 'off', placeholder: 'GOCSPX-…', oninput: (e) => { secret = e.target.value; } })),
    h('label', { class: 'field' }, h('span', null, 'Método de inicio de sesión'),
      h('select', { value: mode, onchange: (e) => { mode = e.target.value; } },
        h('option', { value: 'popup' }, 'Ventana emergente (Google Identity Services)'),
        h('option', { value: 'redirect' }, 'Redirección (si la ventana no se abre)'))),
    h('p', { class: 'muted', style: { marginBottom: '6px' } }, 'URI de redirección y origen a registrar en Google Cloud:'),
    h('div', { class: 'copy-box mono' }, auth.appUrl(), h('br'), location.origin),
    h('button', {
      class: 'btn btn-primary btn-sm', type: 'button',
      onclick: () => {
        const id = clientId.replace(/\s+/g, '');
        const sec = secret.replace(/\s+/g, '');
        if (/^GOCSPX-/.test(id)) { toast('Has pegado el secret en el campo Client ID: van al revés', 4500); return; }
        if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id)) {
          toast('El Client ID no parece válido: debe ser "números-letras.apps.googleusercontent.com"', 5000);
          return;
        }
        if (sec && !/^GOCSPX-/.test(sec)) toast('Ojo: el secret suele empezar por "GOCSPX-"', 4000);
        clientId = id;
        secret = sec;
        store.updateSettings({ clientId: id, clientSecret: sec, authMode: mode });
        toast('Credenciales guardadas');
        rerender();
      },
    }, 'Guardar credenciales'),
  );
}

function calendarsCard(s) {
  const cals = sync.getCalendars();
  const card = h('section', { class: 'card' }, h('h3', null, 'Calendarios en "Hoy"'));
  if (!cals.length) {
    card.append(h('p', { class: 'muted' }, 'Aparecerán aquí tras la primera sincronización.'));
    return card;
  }
  for (const c of cals) {
    const checked = c.tracker || (s.visibleCals?.[c.id] ?? c.selected);
    card.append(h('label', { class: 'check-line' },
      h('input', {
        type: 'checkbox', checked, disabled: c.tracker,
        onchange: (e) => {
          store.updateSettings({ visibleCals: { ...(store.getSettings().visibleCals || {}), [c.id]: e.target.checked } });
          sync.sync();
        },
      }),
      h('span', { class: 'cal-dot', style: { background: c.color } }),
      h('span', null, c.summary, c.tracker ? h('span', { class: 'muted' }, ' · de la app (escritura)') : c.primary ? h('span', { class: 'muted' }, ' · principal') : null)));
  }
  card.append(h('p', { class: 'hint', style: { marginTop: '8px' } }, 'Los demás calendarios solo se leen: la app no tiene permiso para modificarlos.'));
  return card;
}

function reviewCard(s) {
  let time = s.reviewTime || CONFIG.DEFAULT_REVIEW_TIME;
  return h('section', { class: 'card' },
    h('h3', null, 'Revisión nocturna'),
    h('p', null, 'Cada noche Google Calendar te avisa con un evento "🌙 Quedan N: …" que la app mantiene al día con lo que te queda.'),
    h('div', { class: 'btn-row', style: { alignItems: 'center' } },
      h('input', { class: 'input', type: 'time', value: time, style: { width: '140px', background: 'var(--bg-2)' }, onchange: (e) => { time = e.target.value || time; } }),
      h('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: () => {
          store.updateSettings({ reviewTime: time });
          const id = store.getSettings().reviewEventId;
          const master = id && sync.getView().masters[id];
          if (master) sync.patch(master, reviewTimeBody(master, time));
          toast(`Revisión a las ${time}`);
        },
      }, 'Guardar hora')),
  );
}

function backupCard() {
  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', style: { display: 'none' },
    onchange: async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const r = await importBackup(f);
        toast(`Importado: ${r.created} nuevos, ${r.skipped} ya existían, ${r.occ} marcas`, 4000);
      } catch (err) {
        toast(`No se pudo importar: ${err.message}`, 4000);
      }
      e.target.value = '';
    },
  });
  return h('section', { class: 'card' },
    h('h3', null, 'Copia de seguridad'),
    h('p', null, 'Exporta tus tareas, hábitos y su historial a un archivo JSON. Al importar no se duplica lo que ya existe.'),
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn btn-sm', type: 'button',
        onclick: async () => {
          try {
            const r = await exportBackup();
            toast(`Exportado: ${r.events} elementos${r.source === 'cache' ? ' (desde la copia local)' : ''}`);
          } catch (err) {
            toast(`Error al exportar: ${err.message}`, 4000);
          }
        },
      }, 'Exportar JSON'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => fileInput.click() }, 'Importar JSON'),
      fileInput),
  );
}

function demoCard() {
  let offline = false;
  return h('section', { class: 'card' },
    h('h3', null, 'Pruebas (demo)'),
    h('label', { class: 'check-line' },
      h('input', {
        type: 'checkbox',
        checked: !!store.get('mockOffline'),
        onchange: (e) => {
          offline = e.target.checked;
          store.set('mockOffline', offline);
          if (!offline) sync.sync();
          toast(offline ? 'Simulando sin conexión' : 'Conexión simulada restaurada');
        },
      }),
      'Simular sin conexión'),
    h('button', {
      class: 'btn btn-sm btn-danger', type: 'button',
      onclick: () => { if (confirm('¿Borrar todos los datos de la demo?')) { store.clearAll(); location.reload(); } },
    }, 'Reiniciar demo'),
  );
}
