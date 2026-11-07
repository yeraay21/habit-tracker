// Vista "Hoy": lo siguiente que toca arriba, hábitos, agenda y tareas.
import * as sync from '../sync.js';
import * as auth from '../auth.js';
import * as store from '../store.js';
import { itemsForDay, overdueTasks, pickNext } from '../model.js';
import { weekdayName, dayMonth, hm, relative, startOfDay } from '../dates.js';
import { h } from './dom.js';
import { itemRow, habitTile, syncChip } from './items.js';
import { toggle, more } from './actions.js';
import { pressable } from './dom.js';

export function renderToday(root) {
  const now = new Date();
  const today = startOfDay(now);
  const v = sync.getView();
  const items = itemsForDay(v.events, today, sync.localDone());
  const overdue = overdueTasks(v.events, today);

  const habits = items.filter((i) => i.kind === 'habit');
  const allDayExt = items.filter((i) => !i.tracker && i.allDay);
  const next = pickNext(items, now);
  const rest = items.filter((i) => i.kind !== 'habit' && !(i.allDay && !i.tracker) && i !== next?.item);
  const agenda = rest.filter((i) => !i.done && !i.allDay);
  const untimed = rest.filter((i) => !i.done && i.allDay);
  const done = rest.filter((i) => i.done);

  const trackable = items.filter((i) => i.tracker && !i.quotaMet);
  const doneCount = trackable.filter((i) => i.done).length;
  const pct = trackable.length ? Math.round((doneCount / trackable.length) * 100) : 0;

  root.append(
    h('div', { class: 'topline' }, h('span', { class: 'eyebrow' }, store.DEMO ? 'Modo demo' : 'Hoy'), syncChip()),
    h('header', { class: 'head' },
      h('div', null,
        h('p', { class: 'eyebrow' }, weekdayName(now)),
        h('h1', { class: 'title-xl' }, String(now.getDate()), ' ', h('span', null, dayMonth(now).split(' ')[1] || ''))),
      h('div', { class: 'score', 'aria-label': `${doneCount} de ${trackable.length} hechos` },
        h('b', null, String(doneCount)), h('span', null, `/${trackable.length}`))),
    h('div', { class: 'progress' }, h('i', { style: { width: `${pct}%` } })),
  );

  const banner = authBanner();
  if (banner) root.append(banner);

  root.append(hero(next, now));

  if (allDayExt.length) {
    root.append(h('div', { class: 'chips' }, allDayExt.map((i) => pressable(
      h('button', { class: 'chip', type: 'button' }, h('i', { style: { background: sync.calendarOf(i.ev._cal)?.color || 'var(--muted)' } }), i.title),
      () => more(i), () => more(i),
    ))));
  }

  if (habits.length) {
    const pend = habits.filter((x) => !x.done && !x.quotaMet).length;
    root.append(section('Hábitos', pend ? `${pend} por hacer` : 'todos ✓', h('div', { class: 'habits' }, habits.map(habitTile))));
  }

  if (overdue.length) {
    root.append(section('Atrasadas', `${overdue.length}`, h('div', { class: 'list' }, overdue.map((i) => itemRow(i, { now })))));
  }

  if (items.length || overdue.length) {
    root.append(section('Agenda', agenda.length ? `${agenda.length}` : '',
      agenda.length ? h('div', { class: 'list' }, agenda.map((i) => itemRow(i, { now })))
        : h('div', { class: 'empty' }, 'Nada más con hora para hoy.')));
  }

  if (untimed.length) {
    root.append(section('Sin hora', `${untimed.length}`, h('div', { class: 'list' }, untimed.map((i) => itemRow(i, { now })))));
  }

  if (done.length) {
    root.append(h('details', { class: 'section done-list' },
      h('summary', null, `Hecho (${done.length})`),
      h('div', { class: 'list' }, done.map((i) => itemRow(i, { now })))));
  }

  if (!items.length && !overdue.length) {
    root.append(h('div', { class: 'empty' }, 'Día vacío. Pulsa + para añadir una tarea o un hábito.'));
  }
}

function section(title, count, body) {
  return h('section', { class: 'section' }, h('h2', { class: 'section-h' }, title, count ? h('b', null, count) : null), body);
}

function hero(next, now) {
  if (!next) {
    return h('div', { class: 'hero-empty' }, h('b', null, 'Nada pendiente ahora'), 'Buen momento para adelantar algo o descansar de verdad.');
  }
  const { item: it, mode } = next;
  const label = {
    now: `Ahora · hasta ${hm(it.end)}`,
    next: `Siguiente · ${relative(it.start, now)}`,
    late: `Se te pasó · era a las ${hm(it.start)}`,
    todo: it.kind === 'habit' ? 'Pendiente hoy · hábito' : 'Pendiente hoy',
  }[mode];
  const meta = [];
  if (!it.allDay) meta.push(`${hm(it.start)}–${hm(it.end)}`);
  if (it.kind === 'plan') meta.push('[Plan]');
  else if (!it.tracker) meta.push(sync.calendarOf(it.ev._cal)?.summary || '');
  if (it.kind === 'habit' && it.target > 1) meta.push(`${it.count}/${it.target} ${it.unit}`);
  const btnLabel = it.kind === 'habit' && it.target > 1 ? `+1 ${it.unit || ''}`.trim() : it.tracker ? 'Hecho' : 'Marcar hecho';
  const card = h('section', { class: 'hero', 'data-mode': mode },
    h('div', { class: 'hero-label' }, label),
    h('h2', { class: 'hero-title' }, it.title),
    meta.length ? h('div', { class: 'hero-meta' }, meta.join(' · ')) : null,
    h('div', { class: 'hero-actions' },
      h('button', { class: 'hero-btn', type: 'button', onclick: () => toggle(it) }, '✓ ', btnLabel)),
  );
  pressable(card.querySelector('.hero-title'), null, () => more(it));
  return card;
}

function authBanner() {
  const st = auth.status();
  if (st === 'signedIn') {
    const s = sync.getStatus();
    if (s.state === 'auth' && s.msg) return h('div', { class: 'banner warn' }, h('p', null, s.msg), h('a', { class: 'btn btn-sm', href: '#ajustes' }, 'Ajustes'));
    return null;
  }
  const expired = store.get('authExpired');
  const msg = st === 'unconfigured'
    ? 'Conecta tu Google Calendar: pega el Client ID y el secret en Ajustes.'
    : expired ? 'La sesión de Google caducó. Inicia sesión de nuevo (una vez).' : 'Inicia sesión con Google para sincronizar.';
  return h('div', { class: 'banner warn' }, h('p', null, msg), h('a', { class: 'btn btn-sm btn-primary', href: '#ajustes' }, st === 'unconfigured' ? 'Configurar' : 'Entrar'));
}
