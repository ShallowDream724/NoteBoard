/** Only application-produced absolute recovery references need publication.
 * A user's ordinary relative .noteboard-assets folder remains a normal image path. */
export const isTransientImageSource = (src: string): boolean => /^(?:[a-z]:[/\\]|[/\\]{2})/i.test(src)
  && /[/\\]\.noteboard-assets[/\\][a-f0-9]{64}\.[a-z0-9]+$/i.test(src);
export const isInlineImageSource = (src: string): boolean => /^data:image\//i.test(src);
