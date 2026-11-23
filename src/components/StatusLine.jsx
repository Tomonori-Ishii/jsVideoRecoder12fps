// メッセージ行（F-009、F-010）。長い保存先は横に流す（ティッカー）。
// 表示しきれないエラー文は末尾を … で省略し、全文は title で見られる。

import { useLayoutEffect, useRef, useState } from 'react';

export default function StatusLine({ text, kind }) {
  const outer = useRef(null);
  const inner = useRef(null);
  const [overflow, setOverflow] = useState(false);

  useLayoutEffect(() => {
    if (!outer.current || !inner.current) return;
    setOverflow(inner.current.scrollWidth > outer.current.clientWidth);
  }, [text]);

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ticker = kind === 'info' && overflow && !reduceMotion;

  return (
    <div className="status" ref={outer} title={text || ''}>
      <span
        ref={inner}
        className={`status-text ${kind === 'error' ? 'is-error' : ''} ${ticker ? 'ticker' : ''}`}
      >
        {text || ''}
      </span>
    </div>
  );
}
