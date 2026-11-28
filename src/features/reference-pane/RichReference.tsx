import { useEffect, useState, type MouseEvent } from 'react';
import 'katex/dist/katex.min.css';
import '../export/richDocument.css';
import '../editor-md/callout.css';
import { handleLinkClick } from '../editor-md/linkHandler';
import { prepareDocument } from '../export/documentConversion';

interface RichReferenceProps {
  docKey: string;
  content: string;
  directory: string;
  format: 'markdown' | 'noteboard';
}

export function RichReference({ docKey, content, directory, format }: RichReferenceProps) {
  const [result, setResult] = useState<{ html: string } | { error: string }>();
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void prepareDocument(content, '', directory, controller.signal, format)
        .then(({ html }) => {
          if (!controller.signal.aborted) setResult({ html });
        }).catch(error => {
          if (!controller.signal.aborted) setResult({ error: error instanceof Error ? error.message : String(error) });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [content, directory, format]);

  if (!result) return <p className="nb-reference-message" role="status">正在排版文档…</p>;
  if ('error' in result) return (
    <div className="nb-reference-message" role="alert">
      <p>无法排版文档</p>
      <p>{result.error}</p>
    </div>
  );

  const followLink = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as Element).closest('a[href]');
    const href = anchor?.getAttribute('href');
    if (!href) return;
    event.preventDefault();
    if (href.startsWith('#')) {
      event.currentTarget.querySelector(`#${CSS.escape(href.slice(1))}`)?.scrollIntoView({ block: 'start' });
    } else {
      void handleLinkClick(href, docKey);
    }
  };

  // The document worker returns schema-derived markup with document controls removed.
  return (
    <div className="nb-reference-scroll" tabIndex={0} aria-label="文档正文">
      <div className="nb-reference-rich" onClick={followLink} dangerouslySetInnerHTML={{ __html: result.html }} />
    </div>
  );
}
