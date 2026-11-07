// Calendario: vista semana y mes, para ver y añadir cosas en otros días.
import * as sync from '../sync.js';
import { itemsForDay } from '../model.js';
import { addDays, startOfDay, startOfWeek, startOfMonth, monthTitle, longDate, dayMonth, sameDay, WEEK, ymd } from '../dates.js';
import { h, svg, ICON } from './dom.js';
import { itemRow, syncChip } from './items.js';
import { openEditor } from './editor.js';

const ui = { mode: 'week', cursor: startOfDay(new Date()), selected: startOfDay(new Date()) };

/** Día seleccionado (el botón + lo usa para crear en ese día). */
export const selectedDate = () => ymd(ui.selected);

export function renderCalendar(root) {
  const v = sync.getView();
  const ld = sync.localDone();
  const today = startOfDay(new Date());

  root.append(
    h('div', { class: 'topline' }, h('span', { class: 'eyebrow' }, 'Calendario'), syncChip()),
    h('div', { class: 'seg' },
      h('button', { type: 'button', class: ui.mode === 'week' ? 'on' : '', onclick: () => setMode('week') }, 'Semana'),
      h('button', { type: 'button', class: ui.mode === 'month' ? 'on' : '', onclick: () => setMode('month') }, 'Mes')),
  );

  if (ui.mode === 'month') renderMonth(root, v, ld, today);
  else renderWeek(root, v, ld, today);

  function setMode(m) {
    ui.mode = m;
    ui.cursor = ui.selected;
    rerender(root);
  }
}

function rerender(root) {
  root.replaceChildren();
  renderCalendar(root);
}

function nav(root, title, onPrev, onNext) {
  return h('div', { class: 'cal-nav' },
    h('h1', { class: 'title-l' }, title),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Anterior', onclick: () => { onPrev(); rerender(root); } }, svg(ICON.prev)),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Siguiente', onclick: () => { onNext(); rerender(root); } }, svg(ICON.next)));
}

function renderMonth(root, v, ld, today) {
  const first = startOfMonth(ui.cursor);
  const gridStart = startOfWeek(first);
  const gridEnd = addDays(gridStart, 42);
  sync.ensureRange(gridStart, gridEnd);
  const missing = !sync.covered(gridStart, gridEnd);

  root.append(nav(root, monthTitle(first),
    () => { ui.cursor = new Date(first.getFullYear(), first.getMonth() - 1, 1); },
    () => { ui.cursor = new Date(first.getFullYear(), first.getMonth() + 1, 1); }));

  const cells = WEEK.map((w) => h('div', { class: 'wd' }, w.short));
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const items = itemsForDay(v.events, d, ld);
    const cls = ['day-cell'];
    if (d.getMonth() !== first.getMonth()) cls.push('other');
    if (sameDay(d, today)) cls.push('today');
    if (sameDay(d, ui.selected)) cls.push('sel');
    const dots = items.slice(0, 5).map((it) => h('i', {
      class: it.tracker && !it.done ? 'ring-dot' : '',
      style: { background: it.tracker ? 'var(--accent)' : (sync.calendarOf(it.ev._cal)?.color || 'var(--muted)') },
    }));
    cells.push(h('button', {
      class: cls.join(' '), type: 'button', 'aria-label': longDate(d),
      onclick: () => { ui.selected = d; rerender(root); },
    }, String(d.getDate()), h('span', { class: 'dots' }, dots)));
  }
  root.append(h('div', { class: 'month' }, cells));
  if (missing) root.append(h('p', { class: 'hint' }, navigator.onLine ? 'Cargando este mes…' : 'Sin conexión: este mes no está descargado.'));

  root.append(dayPanel(ui.selected, v, ld));
}

function dayPanel(day, v, ld) {
  const items = itemsForDay(v.events, day, ld);
  return h('section', { class: 'section' },
    h('div', { class: 'day-panel-h' },
      h('h3', null, longDate(day)),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openEditor({ date: ymd(day) }) }, '+ Añadir')),
    items.length ? h('div', { class: 'list' }, items.map((i) => itemRow(i))) : h('div', { class: 'empty' }, 'Nada este día.'));
}

function renderWeek(root, v, ld, today) {
  const ws = startOfWeek(ui.cursor);
  const we = addDays(ws, 7);
  sync.ensureRange(ws, we);
  root.append(nav(root, `${dayMonth(ws)} – ${dayMonth(addDays(ws, 6))}`,
    () => { ui.cursor = addDays(ws, -7); },
    () => { ui.cursor = addDays(ws, 7); }));
  if (!sync.covered(ws, we)) root.append(h('p', { class: 'hint' }, navigator.onLine ? 'Cargando esta semana…' : 'Sin conexión: esta semana no está descargada.'));

  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const items = itemsForDay(v.events, d, ld);
    root.append(h('section', { class: `week-day${sameDay(d, today) ? ' is-today' : ''}` },
      h('div', { class: 'week-day-h' },
        h('h3', null, sameDay(d, today) ? `Hoy · ${longDate(d)}` : longDate(d)),
        h('button', { class: 'btn btn-sm btn-ghost', type: 'button', 'aria-label': `Añadir el ${longDate(d)}`, onclick: () => { ui.selected = d; openEditor({ date: ymd(d) }); } }, '+')),
      items.length ? h('div', { class: 'list' }, items.map((it) => itemRow(it))) : h('div', { class: 'empty' }, 'Libre')));
  }
}
