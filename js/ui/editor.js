// Hoja para crear/editar tareas y hábitos.
import * as sync from '../sync.js';
import { taskBody, habitBody, priv, cleanTitle, startOf, endOf, isAllDay, kindOf, parseRule } from '../model.js';
import { ymd, hm, WEEK } from '../dates.js';
import { h, sheet, toast } from './dom.js';

const REMINDERS = [
  { v: '0', label: 'Al empezar' },
  { v: '5', label: '5 min antes' },
  { v: '10', label: '10 min antes' },
  { v: '30', label: '30 min antes' },
  { v: '60', label: '1 h antes' },
  { v: '', label: 'Sin aviso' },
];
const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

/**
 * openEditor({ date })           -> nuevo (tarea por defecto)
 * openEditor({ ev })             -> editar tarea o hábito (ev = evento suelto o maestro del hábito)
 */
export function openEditor({ date, ev, kind } = {}) {
  const editing = !!ev;
  const p = ev ? priv(ev) : {};
  const rule = ev ? parseRule(ev.recurrence) : null;
  const st = {
    kind: ev ? kindOf(ev) : kind || 'task',
    title: ev ? cleanTitle(ev) : '',
    date: ev ? ymd(startOf(ev)) : date || ymd(new Date()),
    time: ev && !isAllDay(ev) ? hm(startOf(ev)) : '',
    duration: ev && !isAllDay(ev) ? Math.round((endOf(ev) - startOf(ev)) / 60000) : 30,
    remind: ev ? (p.rem ?? '') : '0',
    freq: p.freq || 'daily',
    days: p.days ? p.days.split(',') : rule?.BYDAY ? rule.BYDAY.split(',') : ['MO', 'WE', 'FR'],
    perWeek: Number(p.perWeek) || 3,
    target: Number(p.target) || 1,
    unit: p.unit || '',
  };

  const body = h('div');
  const s = sheet(body);

  function save() {
    if (!st.title.trim()) { toast('Ponle un título'); return; }
    const remind = st.remind === '' ? null : Number(st.remind);
    if (st.kind === 'task') {
      const b = taskBody({ title: st.title, date: st.date, time: st.time, duration: st.duration, remind }, p);
      if (editing) sync.patch(ev, b); else sync.create(b);
      toast(editing ? 'Tarea guardada' : 'Tarea creada');
    } else {
      if (st.freq === 'days' && !st.days.length) { toast('Elige al menos un día'); return; }
      const b = habitBody({
        title: st.title, freq: st.freq, days: WEEK.map((w) => w.code).filter((c) => st.days.includes(c)),
        perWeek: st.perWeek, time: st.time, duration: st.duration, target: st.target, unit: st.unit, remind,
        startDate: editing ? ymd(startOf(ev)) : st.date,
      }, p);
      if (editing) {
        // conservar un posible fin (hábito archivado)
        const until = (ev.recurrence || []).join(';').match(/;UNTIL=[^;]+/);
        if (until) b.recurrence = [b.recurrence[0] + until[0]];
        sync.patch(ev, b);
      } else sync.create(b);
      toast(editing ? 'Hábito guardado' : 'Hábito creado');
    }
    s.close();
  }

  function render() {
    const focused = document.activeElement?.dataset?.f;
    const parts = [
      h('h2', { class: 'sheet-h' }, editing ? (st.kind === 'task' ? 'Editar tarea' : 'Editar hábito') : 'Añadir'),
      editing ? null : seg([['task', 'Tarea'], ['habit', 'Hábito']], st.kind, (k) => { st.kind = k; render(); }),
      field('Título', h('input', {
        class: 'big', 'data-f': 'title', value: st.title, maxlength: 120, enterkeyhint: 'done', autocomplete: 'off',
        placeholder: st.kind === 'task' ? 'p. ej. Enviar memoria del TFG' : 'p. ej. CVs enviados',
        oninput: (e) => { st.title = e.target.value; },
        onkeydown: (e) => { if (e.key === 'Enter') save(); },
      })),
      st.kind === 'task' ? taskFields() : habitFields(),
      h('div', { class: 'sheet-actions' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => s.close() }, 'Cancelar'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: save }, 'Guardar')),
    ];
    body.replaceChildren(...parts.flat(Infinity).filter((x) => x != null && x !== false));
    const f = body.querySelector(`[data-f="${focused || (!editing ? 'title' : '')}"]`);
    if (f) setTimeout(() => f.focus(), focused ? 0 : 60);
  }

  function taskFields() {
    return [
      h('div', { class: 'row2' },
        field('Fecha', h('input', { type: 'date', value: st.date, onchange: (e) => { st.date = e.target.value || st.date; } })),
        field('Hora (opcional)', h('input', { type: 'time', value: st.time, onchange: (e) => { st.time = e.target.value; render(); } }))),
      st.time ? h('div', { class: 'row2' },
        field('Duración', select(DURATIONS.map((d) => [String(d), d < 60 ? `${d} min` : `${d / 60} h`.replace('.5', ',5')]), String(st.duration), (v) => { st.duration = Number(v); })),
        field('Aviso', select(REMINDERS.map((r) => [r.v, r.label]), String(st.remind), (v) => { st.remind = v; })))
        : h('p', { class: 'hint' }, 'Sin hora: aparece en "Hoy" y en la revisión nocturna, sin aviso propio.'),
    ];
  }

  function habitFields() {
    return [
      h('span', { class: 'eyebrow', style: { display: 'block', margin: '0 2px 6px' } }, 'Frecuencia'),
      seg([['daily', 'Diario'], ['days', 'Días'], ['weekly', 'N/semana']], st.freq, (f) => { st.freq = f; render(); }),
      st.freq === 'days' ? h('div', { class: 'daypick' }, WEEK.map((w) => h('button', {
        type: 'button', class: st.days.includes(w.code) ? 'on' : '', 'aria-pressed': String(st.days.includes(w.code)),
        onclick: () => { st.days = st.days.includes(w.code) ? st.days.filter((d) => d !== w.code) : [...st.days, w.code]; render(); },
      }, w.short))) : null,
      st.freq === 'weekly' ? field('Veces por semana', stepper(st.perWeek, 1, 7, (n) => { st.perWeek = n; })) : null,
      h('div', { class: 'row2' },
        field('Objetivo diario', stepper(st.target, 1, 50, (n) => { st.target = n; render(); })),
        field('Unidad', h('input', { 'data-f': 'unit', value: st.unit, placeholder: st.target > 1 ? 'CVs, páginas…' : 'opcional', maxlength: 20, oninput: (e) => { st.unit = e.target.value; } }))),
      st.freq !== 'weekly' ? h('div', { class: 'row2' },
        field('Hora (opcional)', h('input', { type: 'time', value: st.time, onchange: (e) => { st.time = e.target.value; render(); } })),
        st.time ? field('Aviso', select(REMINDERS.map((r) => [r.v, r.label]), String(st.remind), (v) => { st.remind = v; })) : h('span'))
        : h('p', { class: 'hint' }, 'Los hábitos "N veces por semana" no llevan aviso: desaparecen de Hoy cuando cumples las N.'),
      st.freq !== 'weekly' && !st.time ? h('p', { class: 'hint' }, 'Ponle hora si quieres que Google Calendar te avise.') : null,
    ];
  }

  render();
}

function field(label, input) {
  const tag = ['INPUT', 'SELECT'].includes(input.tagName) ? 'label' : 'div';
  return h(tag, { class: 'field' }, h('span', null, label), input);
}

function seg(options, current, onPick) {
  return h('div', { class: 'seg', role: 'tablist' }, options.map(([v, label]) => h('button', {
    type: 'button', class: v === current ? 'on' : '', role: 'tab', 'aria-selected': String(v === current), onclick: () => onPick(v),
  }, label)));
}

function select(options, value, onChange) {
  return h('select', { value, onchange: (e) => onChange(e.target.value) }, options.map(([v, l]) => h('option', { value: v }, l)));
}

function stepper(value, min, max, onChange) {
  let n = value;
  const out = h('output', null, String(n));
  const set = (x) => { n = Math.min(max, Math.max(min, x)); out.textContent = String(n); onChange(n); };
  return h('div', { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': 'Menos', onclick: (e) => { e.preventDefault(); set(n - 1); } }, '−'),
    out,
    h('button', { type: 'button', 'aria-label': 'Más', onclick: (e) => { e.preventDefault(); set(n + 1); } }, '+'));
}
