'use client';

/**
 * A script that runs once, while the browser parses the page's HTML, before anything is painted. In the browser
 * React only ever hydrates it, so it is typed text/plain there: React then has no script to warn about, and a
 * client render never runs it a second time. The nonce lets it past the page's Content Security Policy.
 */
export function InlineScript({ html, nonce }: { html: string; nonce?: string }) {
  return (
    <script
      type={typeof window === 'undefined' ? 'text/javascript' : 'text/plain'}
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
