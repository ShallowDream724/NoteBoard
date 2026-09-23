/** Formula DOM belongs to its editor, not to an intersection callback. Small
 * documents are prepared once; larger documents retain a bounded working set.
 * No DOM measurement or document traversal is performed by this module. */
const MAX_BACKGROUND_FORMULAS = 512;
const MAX_BACKGROUND_SOURCE = 64 * 1024;
const MAX_RESIDENT_NODES = 64 * 1024;
const MAX_RESIDENT_FORMULAS = 1024;

interface PreviewOwner {
  sourceLength: number;
  prepare: () => void;
  cancelPreparation: () => void;
  evict: () => boolean;
}
interface Entry extends PreviewOwner { near: boolean; nodes: number; retiring: boolean }
export interface MathPreviewLease {
  nearby(near: boolean): void;
  preparesBackground(): boolean;
  isActive(): boolean;
  canMount(nodes: number): boolean;
  mounted(nodes: number): void;
  measured(): void;
  released(): void;
  cancelRetirement(): void;
  dispose(): void;
}
const sessions = new WeakMap<HTMLElement, PreviewSession>();

class PreviewSession {
  private entries = new Set<Entry>();
  private inactive = new Map<Entry, true>();
  private characters = 0;
  private nodes = 0;
  private residents = 0;
  private retiringNodes = 0;
  private retiringCount = 0;
  private scheduled = false;
  private background = false;
  private saturated = false;
  private active = true;

  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    for (const entry of this.entries) {
      if (!active) entry.cancelPreparation();
      else if (entry.near) entry.prepare();
    }
    this.schedule();
  }

  register(owner: PreviewOwner): MathPreviewLease {
    const entry: Entry = { ...owner, near: false, nodes: 0, retiring: false };
    this.entries.add(entry); this.characters += entry.sourceLength; this.schedule();
    const cancelRetirement = () => {
      if (!entry.retiring) return;
      entry.retiring = false; this.retiringNodes -= entry.nodes; this.retiringCount--;
    };
    const release = () => {
      cancelRetirement(); this.inactive.delete(entry);
      if (entry.nodes) { this.nodes -= entry.nodes; this.residents--; entry.nodes = 0; }
    };
    return {
      preparesBackground: () => this.background,
      isActive: () => this.active,
      nearby: near => {
        entry.near = near; this.inactive.delete(entry);
        if (!near && entry.nodes) this.inactive.set(entry, true);
        this.trim();
      },
      canMount: nodes => {
        if (!this.active) return false;
        if (entry.near) return true;
        if (this.nodes + nodes <= MAX_RESIDENT_NODES && this.residents < MAX_RESIDENT_FORMULAS) return true;
        // A few expensive expressions must not turn a small source document
        // into an unbounded DOM. Stop speculative work, keep visible work.
        this.saturated = true; this.schedule(); return false;
      },
      mounted: nodes => {
        release(); entry.nodes = Math.max(1, nodes); this.nodes += entry.nodes; this.residents++;
        if (!entry.near) this.inactive.set(entry, true);
        this.trim();
      },
      measured: () => this.trim(),
      released: release,
      cancelRetirement,
      dispose: () => {
        if (!this.entries.delete(entry)) return;
        release(); this.characters -= entry.sourceLength;
        if (this.nodes < MAX_RESIDENT_NODES / 2) this.saturated = false;
        this.schedule();
      },
    };
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      // React installs node views in one commit. Decide after registration has
      // settled, not 512 times while the document is still being mounted.
      const background = this.active && !this.saturated && this.entries.size <= MAX_BACKGROUND_FORMULAS
        && this.characters <= MAX_BACKGROUND_SOURCE;
      if (background) {
        this.background = true;
        for (const entry of this.entries) entry.prepare();
      } else if (this.background) {
        this.background = false;
        for (const entry of this.entries) if (!entry.near) entry.cancelPreparation();
      }
      this.trim();
    });
  }

  private trim() {
    if (this.nodes - this.retiringNodes <= MAX_RESIDENT_NODES
      && this.residents - this.retiringCount <= MAX_RESIDENT_FORMULAS) return;
    for (const [entry] of this.inactive) {
      if (entry.retiring) continue;
      if (entry.evict()) {
        entry.retiring = true; this.retiringNodes += entry.nodes; this.retiringCount++;
      }
      if (this.nodes - this.retiringNodes <= MAX_RESIDENT_NODES
        && this.residents - this.retiringCount <= MAX_RESIDENT_FORMULAS) break;
    }
  }
}

export function registerMathPreview(owner: HTMLElement, preview: PreviewOwner): MathPreviewLease {
  let session = sessions.get(owner);
  if (!session) { session = new PreviewSession(); sessions.set(owner, session); }
  return session.register(preview);
}

/** Mode/tab visibility is supplied by the editor owner; IntersectionObserver
 * deliberately cannot infer visibility:hidden or background tab ownership. */
export function setMathPreviewSessionActive(owner: HTMLElement, active: boolean): void {
  let session = sessions.get(owner);
  if (!session) { session = new PreviewSession(); sessions.set(owner, session); }
  session.setActive(active);
}
