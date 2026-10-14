import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The Live Vote design tokens (public/vote/theme.css). A light
// "Google Cloud console" palette: these tests keep it light and keep every
// text colour readable on the surfaces it is used on (WCAG 2.x contrast).
const css = fs.readFileSync(new URL('../public/vote/theme.css', import.meta.url), 'utf8');
const root = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
const token = (name) => {
  const m = root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\b`));
  assert.ok(m, `--${name} must be a #rrggbb colour in :root`);
  return m[1];
};

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('the palette is light: page background and surfaces are near-white', () => {
  assert.ok(luminance(token('bg')) > 0.85, `--bg ${token('bg')} is not light`);
  assert.ok(luminance(token('surface')) > 0.9, `--surface ${token('surface')} is not light`);
  assert.ok(luminance(token('surface-2')) > 0.8, `--surface-2 ${token('surface-2')} is not light`);
});

test('body and secondary text meet WCAG AA (4.5:1) on every surface', () => {
  for (const fg of ['ink', 'ink-2']) {
    for (const bg of ['bg', 'surface', 'surface-2', 'primary-dim']) {
      const c = contrast(token(fg), token(bg));
      assert.ok(c >= 4.5, `--${fg} on --${bg}: ${c.toFixed(2)}:1`);
    }
  }
});

// --primary is a fill/border colour (buttons, outlines, checks) — blue *text*
// uses --g-blue-700. So it is held to the non-text rule (WCAG 1.4.11, 3:1)
// plus the white-label check below.
test('primary fills and outlines stand out from the page (3:1, non-text UI)', () => {
  for (const bg of ['surface', 'bg']) {
    const c = contrast(token('primary'), token(bg));
    assert.ok(c >= 3, `--primary on --${bg}: ${c.toFixed(2)}:1`);
  }
});

test('accent text colours (timers, links, statuses) meet AA on white surfaces', () => {
  for (const fg of ['g-blue-700', 'g-green-700', 'g-red-700', 'g-yellow-700']) {
    for (const bg of ['surface', 'bg']) {
      const c = contrast(token(fg), token(bg));
      assert.ok(c >= 4.5, `--${fg} on --${bg}: ${c.toFixed(2)}:1`);
    }
  }
});

test('white labels on primary buttons meet AA', () => {
  const c = contrast('#ffffff', token('primary'));
  assert.ok(c >= 4.5, `white on --primary: ${c.toFixed(2)}:1`);
});

// --ink-3 carries real small text too (ranks, units, meta lines), so it is
// held to AA like the others — not just the 3:1 a placeholder would need.
test('tertiary grey (ranks, units, meta) meets AA on every surface', () => {
  for (const bg of ['bg', 'surface', 'surface-2']) {
    const c = contrast(token('ink-3'), token(bg));
    assert.ok(c >= 4.5, `--ink-3 on --${bg}: ${c.toFixed(2)}:1`);
  }
});
