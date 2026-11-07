// Mini helpers de interfaz: crear elementos, toasts, hojas inferiores y "mantener pulsado".

/** h('div', { class: 'x', onclick: fn }, 'texto', otroNodo) */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  if (value !== undefined) el.value = value;
  return el;
}

/** SVG desde una cadena estática (solo para iconos propios, nunca con datos del usuario). */
export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}

export const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  prev: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
};

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export const vibrate = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* nada */ } };

// ---------- hoja inferior (modal) ----------
let openSheet = null;
window.addEventListener('popstate', () => { if (openSheet) openSheet.close(true); });

/** Abre una hoja inferior con el contenido dado. El botón "atrás" de Android la cierra. */
export function sheet(content, { onClose } = {}) {
  if (openSheet) openSheet.close();
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'sheet-grip' }), content);
  const backdrop = h('div', { class: 'sheet-backdrop' }, panel);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) api.close(); });
  const api = {
    close(fromPop = false) {
      if (openSheet !== api) return;
      openSheet = null;
      backdrop.remove();
      if (!fromPop && history.state?.sheet) history.back();
      onClose?.();
    },
  };
  document.body.append(backdrop);
  history.pushState({ sheet: 1 }, '');
  openSheet = api;
  return api;
}

/** Lista de acciones (menú al mantener pulsado). */
export function actionSheet(title, subtitle, actions) {
  const s = sheet(h('div', null,
    h('h2', { class: 'sheet-h' }, title),
    subtitle ? h('p', { class: 'sheet-sub' }, subtitle) : null,
    h('div', { class: 'action-list' },
      actions.filter(Boolean).map((a) => h('button', {
        class: `action-item${a.danger ? ' danger' : ''}`,
        onclick: () => { s.close(); setTimeout(a.run, 0); },
      }, a.label, a.hint ? h('small', null, a.hint) : null))),
  ));
  return s;
}

/** Toque corto -> onTap, mantener pulsado (~0,45 s) -> onLong. */
export function pressable(el, onTap, onLong) {
  let timer = null;
  let long = false;
  let sx = 0;
  let sy = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', (e) => {
    long = false;
    sx = e.clientX;
    sy = e.clientY;
    if (!onLong) return;
    timer = setTimeout(() => { timer = null; long = true; vibrate(15); onLong(); }, 450);
  });
  el.addEventListener('pointermove', (e) => { if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) cancel(); });
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('click', (e) => {
    if (long) { e.preventDefault(); long = false; return; }
    onTap?.(e);
  });
  return el;
}
