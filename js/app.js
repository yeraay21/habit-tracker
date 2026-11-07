// Arranque de la app: rutas por hash (#hoy, #cal, #ajustes), service worker y sincronización.
import * as store from './store.js';
import * as auth from './auth.js';
import * as sync from './sync.js';
import { renderToday } from './ui/today.js';
import { renderCalendar, selectedDate } from './ui/calendar.js';
import { renderSettings } from './ui/settings.js';
import { openEditor } from './ui/editor.js';
import { toast } from './ui/dom.js';
import { ymd } from './dates.js';

const views = { hoy: renderToday, cal: renderCalendar, ajustes: renderSettings };
const main = document.getElementById('view');
let current = 'hoy';

function route() {
  const name = location.hash.slice(1) || 'hoy';
  if (name === 'nueva') { // atajo del icono en Android
    history.replaceState(null, '', '#hoy');
    current = 'hoy';
    render(true);
    openEditor({});
    return;
  }
  current = views[name] ? name : 'hoy';
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === current));
  render(true);
  window.scrollTo(0, 0);
}

function render(enter = false) {
  // En Ajustes no repintamos mientras escribes en un campo.
  if (!enter && current === 'ajustes' && main.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
  const y = window.scrollY;
  const openDetails = [...main.querySelectorAll('details[open]')].length > 0;
  main.classList.toggle('enter', enter);
  main.replaceChildren();
  views[current](main);
  if (!enter) {
    if (openDetails) main.querySelectorAll('details').forEach((d) => { d.open = true; });
    window.scrollTo(0, y);
  }
}

let raf = 0;
const scheduleRender = () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => render(false));
};

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW', e));
  if (store.DEMO) (await import('./mock.js')).install();

  try {
    if (await auth.handleRedirect()) toast('Sesión iniciada');
  } catch (e) {
    toast(e.message, 4500);
  }

  document.getElementById('fab').addEventListener('click', () => {
    openEditor({ date: current === 'cal' ? selectedDate() : ymd(new Date()) });
  });
  window.addEventListener('hashchange', route);
  sync.subscribe(scheduleRender);
  auth.onChange(scheduleRender);
  route();

  // Mantener "Hoy" al día (lo siguiente que toca cambia con la hora).
  setInterval(() => { if (current === 'hoy' && document.visibilityState === 'visible') scheduleRender(); }, 30_000);
  sync.start();
}

boot();
