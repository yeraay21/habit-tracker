// Qué pasa al tocar o mantener pulsado un elemento (compartido por Hoy y Calendario).
import * as sync from '../sync.js';
import { donePatch, countPatch, moveTaskPatch, archivePatch, startOf } from '../model.js';
import { addDays, startOfDay, ymd, sameDay, hm } from '../dates.js';
import { actionSheet, toast, vibrate } from './dom.js';
import { openEditor } from './editor.js';

/** Toque: marcar / desmarcar, o +1 en hábitos con objetivo numérico. */
export function toggle(it) {
  vibrate();
  if (it.kind === 'habit' && it.target > 1) {
    sync.patch(it.ev, countPatch(it.ev, +1));
    const n = Math.min(99, it.count + 1);
    if (n === it.target) toast(`¡${it.title}: objetivo cumplido! ${n}/${it.target}`);
  } else if (it.tracker) {
    sync.patch(it.ev, donePatch(it.ev, !it.done));
  } else {
    sync.toggleLocalDone(it.key);
  }
}

/** Mantener pulsado: menú de acciones. */
export function more(it) {
  const today = startOfDay(new Date());
  const when = it.allDay ? 'Sin hora' : `${hm(it.start)}–${hm(it.end)}`;

  if (!it.tracker) {
    const cal = sync.calendarOf(it.ev._cal);
    actionSheet(it.title, `${cal?.summary || 'Otro calendario'} · ${when} · solo lectura`, [
      { label: it.done ? 'Desmarcar' : 'Marcar como hecho', hint: 'solo en este móvil', run: () => sync.toggleLocalDone(it.key) },
      it.ev.htmlLink && { label: 'Abrir en Google Calendar', run: () => window.open(it.ev.htmlLink, '_blank', 'noopener') },
    ]);
    return;
  }

  if (it.kind === 'habit') {
    const master = sync.getView().masters[it.ev.recurringEventId];
    actionSheet(it.title, it.target > 1 ? `Hoy: ${it.count}/${it.target} ${it.unit}` : when, [
      it.target > 1 && it.count > 0 && { label: 'Restar 1', hint: `${it.count - 1}/${it.target}`, run: () => sync.patch(it.ev, countPatch(it.ev, -1)) },
      it.done && { label: 'Marcar como no hecho', run: () => sync.patch(it.ev, donePatch(it.ev, false)) },
      !it.done && it.target > 1 && { label: 'Marcar como completado', run: () => sync.patch(it.ev, donePatch(it.ev, true)) },
      { label: 'Editar hábito', run: () => (master ? openEditor({ ev: master }) : toast('Conéctate para editar este hábito')) },
      master && {
        label: 'Dejar de seguir este hábito',
        hint: 'conserva el historial',
        danger: true,
        run: () => {
          if (startOf(master) >= today) sync.remove(master.id);
          else sync.patch(master, archivePatch(master));
          toast('Hábito archivado');
        },
      },
    ]);
    return;
  }

  // tarea
  const isToday = sameDay(it.start, today);
  const tomorrow = ymd(addDays(today, 1));
  actionSheet(it.title, `${isToday ? 'Hoy' : ymd(it.start)} · ${when}`, [
    { label: it.done ? 'Marcar como no hecha' : 'Marcar como hecha', run: () => sync.patch(it.ev, donePatch(it.ev, !it.done)) },
    !isToday && { label: 'Mover a hoy', run: () => { sync.patch(it.ev, moveTaskPatch(it.ev, ymd(today))); toast('Movida a hoy'); } },
    { label: 'Mover a mañana', run: () => { sync.patch(it.ev, moveTaskPatch(it.ev, tomorrow)); toast('Movida a mañana'); } },
    { label: 'Editar', run: () => openEditor({ ev: it.ev }) },
    { label: 'Eliminar', danger: true, run: () => { sync.remove(it.ev.id); toast('Tarea eliminada'); } },
  ]);
}
