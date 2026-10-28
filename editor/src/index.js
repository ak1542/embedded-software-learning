// The notes editor: Tiptap (ProseMirror) with the extensions the site needs.
// Built into vendor/editor.bundle.js with `npm run build:editor`.
import { Editor, Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
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

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

const isMedia = (f) => f.type.startsWith('image/') || f.type.startsWith('video/');

// hooks: { resolveMedia(src), renderDiagram(el, code), insertFiles(files, pos) }
export function createEditor(element, { content, editable, hooks, onUpdate }) {
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
      Diagram.configure({ renderDiagram: hooks.renderDiagram }),
      CodeTab,
      TrailingParagraph,
    ],
    editorProps: {
      attributes: { class: 'doc-content', spellcheck: 'true' },
      handlePaste(view, event) {
        const files = [...(event.clipboardData?.files || [])].filter(isMedia);
        if (!files.length) return false;
        event.preventDefault();
        hooks.insertFiles(files, null);
        return true;
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
