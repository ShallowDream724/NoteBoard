import { getBoardHistorySignature, serializeScene, type ExcalidrawScene } from './sceneIo';

/** Excalidraw mutates elements in place; reference equality cannot detect edits. */
export class BoardSceneRevisionTracker {
  private ids: string[] = [];
  private versions: number[] = [];
  private nonces: number[] = [];
  private deleted: boolean[] = [];
  private background = '';
  private snap = true;

  constructor(scene: ExcalidrawScene) { this.update(scene); }

  /** Scalar scan without building a whole-scene signature string every frame. */
  update(scene: ExcalidrawScene): boolean {
    const { elements, appState } = scene;
    let changed = this.ids.length !== elements.length || this.background !== appState.viewBackgroundColor || this.snap !== (appState.objectsSnapModeEnabled ?? true);
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      if (this.ids[i] !== element.id || this.versions[i] !== element.version || this.nonces[i] !== element.versionNonce || this.deleted[i] !== element.isDeleted) {
        changed = true;
        this.ids[i] = element.id;
        this.versions[i] = element.version;
        this.nonces[i] = element.versionNonce;
        this.deleted[i] = element.isDeleted;
      }
    }
    this.ids.length = this.versions.length = this.nonces.length = this.deleted.length = elements.length;
    this.background = appState.viewBackgroundColor;
    this.snap = appState.objectsSnapModeEnabled ?? true;
    return changed;
  }
}

/** Keeps only the latest live scene; full scene work belongs to a commit/capture boundary. */
export class BoardSceneMaterializer {
  private scene: ExcalidrawScene;
  private signature: string;
  private content: string;
  private serializedScene: ExcalidrawScene;
  private pending = false;
  private startsNewGroup = false;

  constructor(scene: ExcalidrawScene, private readonly commit: (scene: ExcalidrawScene, content: string, signature: string, startsNewGroup: boolean) => void) {
    this.scene = this.serializedScene = scene;
    this.signature = getBoardHistorySignature(scene);
    this.content = serializeScene(scene);
  }

  /** O(1) per Excalidraw frame, including mutable element objects and image resources. */
  stage(scene: ExcalidrawScene, startsNewGroup: boolean): void {
    this.scene = scene;
    this.pending = true;
    this.startsNewGroup ||= startsNewGroup;
  }

  materialize(): string {
    if (!this.pending) return this.content;
    const signature = getBoardHistorySignature(this.scene);
    const startsNewGroup = this.startsNewGroup;
    if (signature === this.signature) {
      this.pending = false;
      this.startsNewGroup = false;
      return this.content;
    }
    const content = serializeScene(this.scene);
    // Serialization failures retain pending work; successful commit may re-enter
    // the history materialization hook, so clear immediately before that callback.
    this.pending = false;
    this.startsNewGroup = false;
    this.signature = signature;
    this.content = content;
    this.serializedScene = this.scene;
    this.commit(this.scene, content, signature, startsNewGroup);
    return content;
  }

  /** Save/transfer/suspend preserves current tool and viewport state as before. */
  capture(): string {
    this.materialize();
    if (this.serializedScene !== this.scene) {
      this.content = serializeScene(this.scene);
      this.serializedScene = this.scene;
    }
    return this.content;
  }
}
