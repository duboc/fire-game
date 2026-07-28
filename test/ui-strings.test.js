import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UI, UI_FALLBACK, UI_LANG_NAMES, UI_LOCALES, validateUi } from '../src/locales/ui.js';
import { SUPPORTED } from '../src/names.js';
import { buildI18nTag, injectI18n } from '../src/i18n-inject.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SURFACES = Object.keys(UI);
const PLACEHOLDER = /\{(\w+)\}/g;
const formsOf = (v) => (typeof v === 'string' ? [v] : Object.values(v));
const placeholdersIn = (v) =>
  new Set(formsOf(v).flatMap((s) => [...s.matchAll(PLACEHOLDER)].map((m) => m[1])));

test('the UI speaks exactly the languages the names do', () => {
  // The two lists are maintained separately, and a mismatch is the bug where a
  // player gets a French name inside an English page.
  assert.deepEqual([...UI_LOCALES].sort(), [...SUPPORTED].sort());
  assert.deepEqual(Object.keys(UI_LANG_NAMES).sort(), [...UI_LOCALES].sort());
  assert.ok(UI_LOCALES.includes(UI_FALLBACK));
});

test('every language has exactly the reference key set', () => {
  for (const surface of SURFACES) {
    const ref = Object.keys(UI[surface][UI_FALLBACK]).sort();
    assert.ok(ref.length > 0, `${surface} reference is empty`);
    for (const code of UI_LOCALES) {
      assert.deepEqual(Object.keys(UI[surface][code]).sort(), ref, `${surface}.${code}`);
    }
  }
});

test('a plural in the reference is a plural everywhere, with both forms', () => {
  for (const surface of SURFACES) {
    for (const [key, refVal] of Object.entries(UI[surface][UI_FALLBACK])) {
      if (typeof refVal !== 'object') continue;
      for (const code of UI_LOCALES) {
        const v = UI[surface][code][key];
        assert.equal(typeof v, 'object', `${surface}.${code}.${key} lost its plural forms`);
        assert.equal(typeof v.one, 'string', `${surface}.${code}.${key}.one`);
        assert.equal(typeof v.other, 'string', `${surface}.${code}.${key}.other`);
      }
    }
  }
});

test('placeholders survive translation', () => {
  // A translator who drops {rank} ships "Você ficou em" with a hole where the
  // player's position should be, and nothing else would catch it.
  for (const surface of SURFACES) {
    for (const [key, refVal] of Object.entries(UI[surface][UI_FALLBACK])) {
      const want = placeholdersIn(refVal);
      for (const code of UI_LOCALES) {
        assert.deepEqual(
          [...placeholdersIn(UI[surface][code][key])].sort(),
          [...want].sort(),
          `${surface}.${code}.${key}`,
        );
      }
    }
  }
});

test('every counted string interpolates its own count', () => {
  // {one, other} without {n} renders "player ready" with no number.
  for (const surface of SURFACES) {
    for (const code of UI_LOCALES) {
      for (const [key, v] of Object.entries(UI[surface][code])) {
        if (typeof v !== 'object') continue;
        assert.ok(placeholdersIn(v).has('n'), `${surface}.${code}.${key} has no {n}`);
      }
    }
  }
});

test('values are plain text — they are assigned with textContent', () => {
  for (const surface of SURFACES) {
    for (const code of UI_LOCALES) {
      for (const [key, v] of Object.entries(UI[surface][code])) {
        for (const s of formsOf(v)) {
          assert.ok(!/[<>]/.test(s), `${surface}.${code}.${key} contains markup: ${s}`);
        }
      }
    }
  }
});

test('the validator throws on a missing key, an extra key and a lost placeholder', () => {
  const clone = () => JSON.parse(JSON.stringify(UI));

  const missing = clone();
  delete missing.phone.fr.btnTap;
  assert.throws(() => validateUi(missing), /missing the key "btnTap"/);

  const extra = clone();
  extra.phone.fr.btnSprint = 'Cours !';
  assert.throws(() => validateUi(extra), /extra key "btnSprint"/);

  const dropped = clone();
  dropped.phone.fr.statusRanked = 'Bien joué !';
  assert.throws(() => validateUi(dropped), /same placeholders/);

  const flattened = clone();
  flattened.screen.de.playersReady = '{n} Spieler';
  assert.throws(() => validateUi(flattened), /\{one,other\} plural/);

  const noLang = clone();
  delete noLang.host.it;
  assert.throws(() => validateUi(noLang), /missing the language "it"/);
});

test('French counts zero as "one", which a naive n===1 check gets wrong', () => {
  // Not a test of our code so much as the reason it defers to Intl: if this
  // ever stops holding, the hand-rolled fallback in the runtime is fine too.
  assert.equal(new Intl.PluralRules('fr').select(0), 'one');
  assert.equal(new Intl.PluralRules('en').select(0), 'other');
  assert.equal(UI.screen.fr.playersReady.one, '{n} joueur prêt');
});

test('the injected tag is safe between <script> tags', () => {
  const withMarkup = { phone: { en: { x: 'a</script><script>alert(1)</script>' } } };
  const escaped = JSON.stringify(withMarkup).replace(/</g, '\\u003c');
  assert.ok(!escaped.includes('</script>'));
  for (const surface of SURFACES) {
    const tag = buildI18nTag(surface);
    // Exactly one opening and one closing tag: nothing in the catalogue or the
    // runtime has broken out of the block.
    assert.equal(tag.match(/<script/g).length, 1);
    assert.equal(tag.match(/<\/script>/g).length, 1);
  }
});

test('each surface is injected with its own keys and nobody else\'s', () => {
  const phone = buildI18nTag('phone');
  assert.ok(phone.includes('btnTap'));
  assert.ok(!phone.includes('msgBadPw'), 'the phone must not ship the host panel strings');
  assert.ok(!buildI18nTag('screen').includes('btnTap'));
  assert.throws(() => buildI18nTag('projector'), /unknown surface/);
});

test('every page has an <!--I18N--> marker and no external font request', () => {
  for (const [file, surface] of [['index.html', 'phone'], ['screen.html', 'screen'], ['host.html', 'host']]) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    assert.ok(html.includes('<!--I18N-->'), `${file} lost its marker`);
    // Event wifi is the one thing we cannot fix; a render-blocking request to
    // a third party is a blank phone.
    assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(html), `${file} still fetches external fonts`);
    assert.ok(injectI18n(surface)(html).includes('window.I18N'));
  }
  assert.throws(() => injectI18n('phone')('<html></html>'), /no <!--I18N--> marker/);
});

test('every data-i18n key in the markup exists in that page\'s catalogue', () => {
  // The binding that catches a typo'd or renamed key: without it the element
  // silently renders the key name to a room of 5.000 people.
  for (const [file, surface] of [['index.html', 'phone'], ['screen.html', 'screen'], ['host.html', 'host']]) {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    const keys = [...html.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(keys.length > 0, `${file} has no data-i18n bindings`);
    for (const k of keys) {
      assert.ok(k in UI[surface][UI_FALLBACK], `${file} binds "${k}", which ${surface} does not define`);
    }
  }
});
