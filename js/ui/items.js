// Piezas visuales reutilizables: filas de agenda, fichas de hábito, chip de sincronización.
import * as sync from '../sync.js';
import { hm, relative } from '../dates.js';
import { h, svg, ICON, pressable } from './dom.js';
import { toggle, more } from './actions.js';

export function calColor(it) {
  if (it.tracker) return 'var(--accent)';
  return sync.calendarOf(it.ev._cal)?.color || 'var(--muted)';
}

/** Fila de agenda (tarea o evento). */
export function itemRow(it, { now = new Date(), showDate = false } = {}) {
  const cls = ['row'];
  if (it.done) cls.push('done');
  if (!it.tracker) cls.push('ext');
  if (it.kind === 'plan') cls.push('plan');
  if (!it.tracker && !it.allDay && it.end <= now) cls.push('past');

  const time = it.allDay
    ? h('div', { class: 'row-time' }, showDate || it.late ? it.start.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '—')
    : h('div', { class: 'row-time' }, hm(it.start), h('small', null, hm(it.end)));

  const meta = [];
  if (it.kind === 'plan') meta.push(h('span', { class: 'tag plan' }, 'Plan'));
  if (it.late) meta.push(h('span', { class: 'tag late' }, 'Atrasada'));
  if (!it.tracker) {
    const cal = sync.calendarOf(it.ev._cal);
    meta.push(h('span', { class: 'cal-dot', style: { background: calColor(it) } }), h('span', null, cal?.summary || ''));
  }
  if (it.kind === 'habit') meta.push(h('span', { class: 'tag' }, it.target > 1 ? `${it.count}/${it.target} ${it.unit}` : 'Hábito'));
  if (!it.done && !it.allDay && it.start > now && it.start - now < 3 * 3600e3) meta.push(h('span', null, `· ${relative(it.start, now)}`));
  if (it.pending) meta.push(h('span', { class: 'tag sync', title: 'Pendiente de sincronizar' }, '⟳'));

  const row = h('button', { class: cls.join(' '), type: 'button' },
    time,
    h('span', { class: 'check' }, svg(ICON.check)),
    h('div', { class: 'row-body' },
      h('div', { class: 'row-title' }, it.title),
      meta.length ? h('div', { class: 'row-meta' }, meta) : null),
  );
  return pressable(row, () => toggle(it), () => more(it));
}

/** Anillo de progreso para hábitos. */
function ring(it) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const frac = it.done ? 1 : it.quotaMet ? 1 : Math.min(1, it.count / it.target);
  const inner = it.done || it.quotaMet
    ? `<path d="M13.5 20.5l4.5 4.5 8.5-9"${it.done ? '' : ' style="stroke:var(--accent)"'}/>`
    : it.target > 1 ? `<text x="20" y="24.5" text-anchor="middle">${Number(it.count)}</text>` : '';
  const fill = it.done ? '<circle cx="20" cy="20" r="14" style="fill:var(--accent);stroke:none"/>' : '';
  return svg(`<svg class="ring" viewBox="0 0 40 40" aria-hidden="true">
    <circle class="bg" cx="20" cy="20" r="${r}"/>
    <circle class="fg" cx="20" cy="20" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}" transform="rotate(-90 20 20)"/>
    ${fill}${inner}</svg>`);
}

export function habitTile(it) {
  let meta;
  if (it.quotaMet) meta = `${it.weekDone}/${it.perWeek} esta semana ✓`;
  else if (it.target > 1) meta = `${it.count}/${it.target}${it.unit ? ` ${it.unit}` : ''}`;
  else if (it.perWeek) meta = `${it.weekDone}/${it.perWeek} esta semana`;
  else meta = it.allDay ? (it.done ? 'Hecho' : 'Hoy') : hm(it.start);
  const tile = h('button', { class: `habit${it.done ? ' done' : ''}${it.quotaMet ? ' quota' : ''}`, type: 'button' },
    ring(it),
    h('div', { class: 'habit-body' },
      h('div', { class: 'habit-name' }, it.title),
      h('div', { class: 'habit-meta' }, meta, it.pending ? ' ⟳' : '')),
  );
  return pressable(tile, () => toggle(it), () => more(it));
}

/** Chip con el estado de sincronización; al tocarlo, sincroniza. */
export function syncChip() {
  const st = sync.getStatus();
  const labels = {
    ok: st.lastSync ? `Sincronizado · ${relative(new Date(st.lastSync)).replace('ahora', 'ahora mismo')}` : 'Sincronizado',
    syncing: 'Sincronizando…',
    offline: 'Sin conexión',
    error: 'Error al sincronizar',
    auth: 'Sin sesión',
    idle: st.lastSync ? `Última sync ${relative(new Date(st.lastSync))}` : 'Sin sincronizar',
  };
  let text = labels[st.state] || labels.idle;
  if (st.pending && st.state !== 'syncing') text += ` · ${st.pending} pendiente${st.pending > 1 ? 's' : ''}`;
  return h('button', {
    class: 'sync',
    'data-state': st.state,
    title: st.msg || '',
    onclick: () => (st.state === 'auth' ? (location.hash = '#ajustes') : sync.sync()),
  }, h('span', { class: 'dot' }), text);
}
