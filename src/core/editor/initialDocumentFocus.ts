// Only the latest explicit new-document action may claim initial input focus.
// Session restoration and background editor mounts never create a request.
let requestedKey: string | null = null;
export function requestInitialDocumentFocus(key: string): void { requestedKey = key; }
export function consumeInitialDocumentFocus(key: string): boolean {
  if (requestedKey !== key) return false;
  requestedKey = null; return true;
}
