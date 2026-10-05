import { StateEffect } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { textAnalysisService } from './textAnalysisService';

export class AnalysisOwner {
  readonly lintOwner = {};
  alive = true;
  revision = 0;
  cancel(): void {
    this.revision++;
    textAnalysisService.cancelOwner(this);
    textAnalysisService.cancelOwner(this.lintOwner);
  }
}

export const textAnalysisLifecycle = ViewPlugin.fromClass(class {
  readonly owner = new AnalysisOwner();
  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet) this.owner.cancel();
  }
  destroy(): void { this.owner.alive = false; this.owner.cancel(); }
});

/** Also protects standalone EditorViews created by integrations or tests. */
export function getAnalysisOwner(view: EditorView): AnalysisOwner {
  if (!view.plugin(textAnalysisLifecycle)) {
    view.dispatch({ effects: StateEffect.appendConfig.of(textAnalysisLifecycle) });
  }
  return view.plugin(textAnalysisLifecycle)!.owner;
}
