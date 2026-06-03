import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeNameFactory, ANIMALS, ADJECTIVES } from '../src/names.js';

test('sequence numbers are unique and monotonic', () => {
  const next = makeNameFactory();
  const seqs = new Set();
  for (let i = 0; i < 1000; i++) {
    const id = next();
    assert.equal(id.seq, i + 1);
    assert.ok(!seqs.has(id.seq));
    seqs.add(id.seq);
  }
});

test('labels are unique even when the random pair collides', () => {
  // rng always returns 0 -> same animal+adjective every time
  const next = makeNameFactory(() => 0);
  const a = next();
  const b = next();
  assert.equal(a.name, b.name); // pair repeats by design
  assert.notEqual(a.label, b.label); // but label is unique via #seq
  assert.equal(a.label, `${ANIMALS[0].name} ${ADJECTIVES[0]} #1`);
  assert.equal(b.label, `${ANIMALS[0].name} ${ADJECTIVES[0]} #2`);
});

test('emoji always present', () => {
  const next = makeNameFactory();
  for (let i = 0; i < 50; i++) assert.ok(next().emoji.length > 0);
});
