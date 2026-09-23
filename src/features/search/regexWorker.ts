import { collectRegexMatches } from './regexMatchingEngine';
import { regexSearchFailure, type RegexSearchRequest } from './regexProtocol';

self.onmessage = ({ data }: MessageEvent<RegexSearchRequest>) => {
  let result;
  try { result = collectRegexMatches(data); }
  catch { result = regexSearchFailure('worker'); }
  self.postMessage(result, { transfer: [result.ranges.buffer as ArrayBuffer] });
};
