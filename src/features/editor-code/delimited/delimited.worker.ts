import { indexDelimited, readDelimitedCell, readDelimitedWindow } from './parser';
import type { DelimitedIndex, Delimiter } from './parser';
import type { DelimitedRequest, DelimitedResponse } from './protocol';

let text = '', delimiter: Delimiter = ',', index: DelimitedIndex | undefined;
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<DelimitedRequest>) => {
  const request = event.data;
  let response: DelimitedResponse;
  try {
    if (request.type === 'load') {
      index = undefined; text = request.text; delimiter = request.delimiter;
      index = indexDelimited(text, delimiter);
      const { records: _records, ...summary } = index;
      response = { id: request.id, type: 'ready', summary };
    } else {
      if (!index) throw new Error('表格尚未打开');
      response = request.type === 'window'
        ? { id: request.id, type: 'window', rows: readDelimitedWindow(text, delimiter, index, request.range) }
        : { id: request.id, type: 'cell', cell: readDelimitedCell(text, delimiter, index, request.row, request.column) };
    }
  } catch (error) {
    if (request.type === 'load') { text = ''; index = undefined; }
    response = { id: request.id, type: 'error', message: error instanceof Error ? error.message : '无法打开表格视图，请查看源码。' };
  }
  scope.postMessage(response);
};
