// Runs the whole simulated toolchain: preprocess -> compile -> link.
import { preprocess } from './preprocess.js';
import { compile } from './compile.js';
import { link } from './link.js';

export const isSource = (n) => /\.(c|cpp|cc|cxx)$/i.test(n);
export const isHeader = (n) => /\.(h|hpp|hh|hxx)$/i.test(n);
export const isScript = (n) => /\.(ld|lds|x)$/i.test(n);
export const isCpp = (n) => /\.(cpp|cc|cxx)$/i.test(n);

export function parseDefines(text) {
  const d = {};
  for (const part of (text || '').split(/[\s,]+/).filter(Boolean)) {
    const [k, ...v] = part.replace(/^-D/, '').split('=');
    if (k) d[k] = v.length ? v.join('=') : '1';
  }
  return d;
}

export function build(project) {
  const { files, options = {} } = project;
  const out = { units: [], objects: [], link: null, diagnostics: [], scriptName: null };
  const defines = parseDefines(options.defines);
  for (const name of Object.keys(files).filter(isSource)) {
    const cpp = isCpp(name);
    const pre = preprocess(files, name, { defines, cpp });
    const objName = name.replace(/\.[^.]+$/, '.o');
    let obj = null;
    let error = null;
    try {
      obj = compile(pre.text, { name: objName, cpp, opt: options.opt || 'O2', functionSections: options.functionSections !== false, dataSections: options.dataSections !== false });
    } catch (e) {
      error = `${name}: the simulator could not analyse this file (${e.message}).`;
    }
    out.units.push({ source: name, objName, pre, obj, error });
    if (obj) out.objects.push(obj);
    for (const d of pre.diagnostics) out.diagnostics.push({ ...d, file: d.file || name });
    if (error) out.diagnostics.push({ level: 'error', file: name, msg: error });
  }
  const scriptName = Object.keys(files).find(isScript);
  out.scriptName = scriptName || null;
  if (!scriptName) out.diagnostics.push({ level: 'error', file: '', msg: 'No linker script found. Add a file ending in .ld.' });
  else if (!out.objects.length) out.diagnostics.push({ level: 'error', file: '', msg: 'No .c or .cpp files to compile.' });
  else {
    try {
      out.link = link(out.objects, files[scriptName], { gc: !!options.gc });
    } catch (e) {
      out.diagnostics.push({ level: 'error', file: scriptName, msg: `The linker simulation failed: ${e.message}` });
    }
  }
  return out;
}
