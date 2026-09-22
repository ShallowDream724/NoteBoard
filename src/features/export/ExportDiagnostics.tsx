import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Full diagnostics remain copyable; only the visible excerpt is bounded. */
export function ExportDiagnostics({ message, details }: { message: string; details: string }) {
  const [copied, setCopied] = useState(false), [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => { setCopied(false); setCopyFailed(false); }, [details]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(details); setCopied(true); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  };
  return <div className="export-diagnostics">
    <span role="status" tabIndex={0}>{message.slice(0, 12000)}{message.length > 12000 ? '\n后续内容请复制查看。' : ''}{copyFailed ? '\n复制失败，可选中文字后按 Ctrl+C。' : ''}</span>
    {!!details && <button className="export-copy" title="复制完整信息" onClick={() => void copy()}>{copied ? <Check size={15}/> : <Copy size={15}/>} {copied ? '已复制' : '复制信息'}</button>}
  </div>;
}
