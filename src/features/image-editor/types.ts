export interface ImageEditorSaveMetadata {
  extension: 'png' | 'jpg' | 'webp';
  mimeType: string;
  width: number;
  height: number;
}
export interface ImageEditorOptions {
  key: string;
  src: string;
  name?: string;
  saveLabel?: string;
  onSave(blob: Blob, metadata: ImageEditorSaveMetadata, signal?: AbortSignal): Promise<boolean | void>;
}
export interface ImageEditorController { suspend(): void }
