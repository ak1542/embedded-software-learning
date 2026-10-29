import { h } from '../dom.js';

const hx = (n, w = 8) => (n >>> 0).toString(16).padStart(w, '0').toUpperCase();

// rows: 16 bytes per line. bytes/known: Uint8Array; base: address of byte 0; owners: optional [{start,end,label}] (offsets into bytes)
export function hexDump({ bytes, known, base = 0, from = 0, rows = 256, owners = null }) {
  const out = [];
  let oi = 0;
  const end = Math.min(bytes.length, from + rows * 16);
  for (let off = from; off < end; off += 16) {
    let hexPart = '', ascii = '';
    for (let k = 0; k < 16; k++) {
      const i = off + k;
      if (i >= bytes.length) {
        hexPart += '   ';
        continue;
      }
      const real = !known || known[i];
      hexPart += real ? hx(bytes[i], 2) + ' ' : '·· ';
      ascii += real ? (bytes[i] >= 32 && bytes[i] < 127 ? String.fromCharCode(bytes[i]) : '.') : '·';
      if (k === 7) hexPart += ' ';
    }
    let own = '';
    if (owners) {
      while (oi < owners.length && owners[oi].end <= off) oi++;
      const names = [];
      for (let j = oi; j < owners.length && owners[j].start < off + 16; j++) if (owners[j].end > off && owners[j].start < off + 16) names.push(owners[j].label + (owners[j].estimated ? '*' : ''));
      own = [...new Set(names)].slice(0, 3).join(', ');
    }
    out.push(`<span class="ad">${hx(base + off)}</span>  ${hexPart.replace(/··/g, '<span class="ph">··</span>')} <span class="z">|${ascii.replace(/</g, '&lt;')}|</span>  <span class="own">${own.replace(/</g, '&lt;')}</span>`);
  }
  return h('div', { class: 'hex', html: out.join('\n') });
}
export { hx };
