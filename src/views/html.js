'use strict';
// Мини-шаблонизатор: всё, что подставляется в html``, экранируется, кроме уже собранных фрагментов.
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v) { return String(v).replace(/[&<>"']/g, (c) => ESC[c]); }
function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}
function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Safe(out);
}
const raw = (s) => new Safe(s);
module.exports = { html, raw, esc, Safe };
