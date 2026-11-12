import assert from 'node:assert/strict';
import test from 'node:test';
import { datesForTerm } from '../database/seeds/academic-data.mjs';
import { ACADEMIC_SLOTS } from '../database/seeds/academic-plan.mjs';

test('The seed timetable continues until 19:25 with a break after every third pair', () => {
  assert.equal(ACADEMIC_SLOTS.length, 12);
  assert.deepEqual(ACADEMIC_SLOTS.slice(-3), [
    { id: 'p10', startsAt: '16:45', endsAt: '17:35' },
    { id: 'p11', startsAt: '17:40', endsAt: '18:30' },
    { id: 'p12', startsAt: '18:35', endsAt: '19:25' },
  ]);
  const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  ACADEMIC_SLOTS.forEach((slot, index) => {
    assert.equal(minutes(slot.endsAt) - minutes(slot.startsAt), 50);
    if (index > 0)
      assert.equal(
        minutes(slot.startsAt) - minutes(ACADEMIC_SLOTS[index - 1].endsAt),
        index % 3 === 0 ? 15 : 5,
      );
  });
});

test('The timetable can start on Thursday and covers twenty weekdays', () => {
  const blocks = datesForTerm(2026, '2026-11-12');
  assert.equal(blocks.length, 4);
  assert.ok(blocks.every((block) => block.length === 5));
  assert.deepEqual(blocks[0], [
    '2026-11-12',
    '2026-11-13',
    '2026-11-16',
    '2026-11-17',
    '2026-11-18',
  ]);
  const days = blocks.flat();
  assert.equal(new Set(days).size, 20);
  assert.equal(days.at(-1), '2026-12-09');
  assert.deepEqual(days, [...days].sort());
  assert.ok(days.every((day) => ![0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay())));
});

test('A Monday start retains four ordinary Monday-to-Friday weeks', () => {
  const blocks = datesForTerm(2026, '2026-11-23');
  assert.deepEqual(blocks[0], [
    '2026-11-23',
    '2026-11-24',
    '2026-11-25',
    '2026-11-26',
    '2026-11-27',
  ]);
  assert.equal(blocks[3][4], '2026-12-18');
});

test('The timetable rejects weekends, impossible dates and crossing the semester boundary', () => {
  for (const date of ['2026-11-14', '2026-11-15', '2026-02-30', 'invalid'])
    assert.throws(() => datesForTerm(2026, date));
  assert.throws(() => datesForTerm(2026, '2026-08-31'), /первом семестре/);
  assert.throws(() => datesForTerm(2026, '2026-12-10'), /первом семестре/);
});
