import { NativeError } from './nativeError';
import { emit } from '../../core/emitter';
import { editorDocumentKey } from './editorDocumentCodec';
import './nativeError.css';

export const NativeErrorView = NativeError.extend({
  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('section'); dom.className = 'nb-native-error'; dom.contentEditable = 'false';
      const title = document.createElement('strong'); title.textContent = `此内容需要修复${node.attrs.line ? ` · 第 ${node.attrs.line} 行` : ''}`;
      const message = document.createElement('p'); message.textContent = node.attrs.message;
      const raw = document.createElement('pre'); raw.textContent = node.attrs.raw;
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '在源码中修复';
      button.onclick = () => emit('toggle-md-view-mode', { key: editorDocumentKey(editor), mode: 'source', line: node.attrs.line ?? undefined });
      dom.append(title, message, raw, button);
      return { dom };
    };
  },
});
