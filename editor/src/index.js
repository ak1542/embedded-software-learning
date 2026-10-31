// The notes editor: Tiptap (ProseMirror) with the extensions the site needs.
// Built into vendor/editor.bundle.js with `npm run build:editor`.
import { Editor, Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Highlight from '@tiptap/extension-highlight';
import TextStyle from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Placeholder from '@tiptap/extension-placeholder';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import armasm from 'highlight.js/lib/languages/armasm';
import x86asm from 'highlight.js/lib/languages/x86asm';
import verilog from 'highlight.js/lib/languages/verilog';
import cmake from 'highlight.js/lib/languages/cmake';
import { Image, Video } from './media.js';
import { HtmlAnimation } from './anim.js';
import { Pdf } from './pdf.js';
import { numberHeadings } from './numbering.js';
import { Callout, CALLOUT_VARIANTS, Embed, Diagram, DEFAULT_DIAGRAM, embedUrl } from './nodes.js';

export { CALLOUT_VARIANTS, DEFAULT_DIAGRAM, embedUrl };

export const CODE_LANGUAGES = [
  ['c', 'C'],
  ['cpp', 'C++'],
  ['armasm', 'ARM assembly'],
  ['x86asm', 'x86 assembly'],
  ['python', 'Python'],
  ['rust', 'Rust'],
  ['bash', 'Shell'],
  ['makefile', 'Makefile'],
  ['cmake', 'CMake'],
  ['ini', 'INI / config'],
  ['json', 'JSON'],
  ['yaml', 'YAML'],
  ['verilog', 'Verilog'],
  ['plaintext', 'Plain text'],
];

const lowlight = createLowlight(common);
lowlight.register({ armasm, x86asm, verilog, cmake });

const CodeTab = Extension.create({
  name: 'codeTab',
  addKeyboardShortcuts() {
    return { Tab: () => (this.editor.isActive('codeBlock') ? this.editor.commands.insertContent('    ') : false) };
  },
});

// Like Word, always keep an empty paragraph after a table, picture, code block… so there is
// somewhere to click and keep typing.
// Right-shift (indent) for paragraphs and headings, 0-6 levels. Stored as an `indent` attribute so
// older notes (without it) are unaffected. Tab / Shift+Tab inside lists and tables keep their own meaning.
export const MAX_INDENT = 6;
const Indent = Extension.create({
  name: 'indent',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el) => Number(el.getAttribute('data-indent')) || 0,
            renderHTML: (attrs) => (attrs.indent ? { 'data-indent': attrs.indent, style: `margin-left:${attrs.indent * 2}rem` } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    const shift = (delta) => ({ state, tr, dispatch }) => {
      const { from, to } = state.selection;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return;
        const next = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent || 0) + delta));
        if (next !== (node.attrs.indent || 0)) {
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
          changed = true;
        }
      });
      if (changed && dispatch) dispatch(tr);
      return changed;
    };
    return { indentMore: () => shift(1), indentLess: () => shift(-1) };
  },
  addKeyboardShortcuts() {
    const own = (e) => !(e.isActive('listItem') || e.isActive('taskItem') || e.isActive('table') || e.isActive('codeBlock'));
    return {
      Tab: () => (own(this.editor) ? (this.editor.commands.indentMore(), true) : false),
      'Shift-Tab': () => (own(this.editor) ? (this.editor.commands.indentLess(), true) : false),
    };
  },
});

const TrailingParagraph = Extension.create({
  name: 'trailingParagraph',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('trailingParagraph'),
        appendTransaction: (transactions, oldState, newState) => {
          if (!this.editor.isEditable) return null;
          const { doc, tr, schema } = newState;
          if (!doc.lastChild || doc.lastChild.type.name === 'paragraph') return null;
          return tr.insert(doc.content.size, schema.nodes.paragraph.create());
        },
      }),
    ];
  },
});

// Adds a data-num attribute (1, 1.1, ...) to every heading; the stylesheet shows it.
const HeadingNumbers = Extension.create({
  name: 'headingNumbers',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('headingNumbers'),
        props: {
          decorations: (state) => {
            const headings = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'heading') headings.push({ pos, end: pos + node.nodeSize, level: node.attrs.level });
            });
            if (!headings.length) return null;
            const numbers = numberHeadings(headings.map((h) => h.level));
            return DecorationSet.create(state.doc, headings.map((h, i) => Decoration.node(h.pos, h.end, { 'data-num': numbers[i] })));
          },
        },
      }),
    ];
  },
});

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

const isHtmlFile = (f) => f.type === 'text/html' || /\.html?$/i.test(f.name);
const isPdfFile = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
const isMedia = (f) => f.type.startsWith('image/') || f.type.startsWith('video/') || isHtmlFile(f) || isPdfFile(f);
const looksLikeWebPage = (text) => /^\s*(<!doctype html|<html[\s>])/i.test(text);

// hooks: { resolveMedia(src), renderDiagram(el, code), insertFiles(files, pos),
//          addAnimation(html, pos), confirmAnimation() }
export function createEditor(element, { content, editable, hooks, onUpdate, numbering = false }) {
  return new Editor({
    element,
    editable,
    content: content || EMPTY_DOC,
    extensions: [
      StarterKit.configure({ codeBlock: false, heading: { levels: [1, 2, 3, 4] } }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'c' }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } }),
      Highlight,
      TextStyle,
      Color,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: 'Start typing…' }),
      Image.configure({ resolveMedia: hooks.resolveMedia }),
      Video.configure({ resolveMedia: hooks.resolveMedia }),
      Callout,
      Embed,
      HtmlAnimation.configure({ resolveMedia: hooks.resolveMedia }),
      Pdf.configure({ resolveMedia: hooks.resolveMedia }),
      Diagram.configure({ renderDiagram: hooks.renderDiagram }),
      CodeTab,
      TrailingParagraph,
      Indent,
      ...(numbering ? [HeadingNumbers] : []),
    ],
    editorProps: {
      attributes: { class: 'doc-content', spellcheck: 'true' },
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files || [])].filter(isMedia);
        if (files.length) {
          event.preventDefault();
          hooks.insertFiles(files, null);
          return true;
        }
        // A whole web page copied as text (for example an animation from a Claude chat).
        // Inside a code block it is always pasted as text.
        const text = event.clipboardData?.getData('text/plain') || '';
        if (hooks.addAnimation && looksLikeWebPage(text) && !view.state.selection.$from.parent.type.spec.code && hooks.confirmAnimation()) {
          event.preventDefault();
          hooks.addAnimation(text, null);
          return true;
        }
        return false;
      },
      handleDrop(view, event, slice, moved) {
        if (moved) return false;
        const files = [...(event.dataTransfer?.files || [])].filter(isMedia);
        if (!files.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        hooks.insertFiles(files, at ? at.pos : null);
        return true;
      },
    },
    onUpdate: ({ editor }) => onUpdate && onUpdate(editor),
  });
}
