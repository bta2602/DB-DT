import test from 'node:test';
import assert from 'node:assert/strict';
import { average, dateKey, emptyData, lessonConflicts, lessonStatus, markUnmarked } from '../../public/studyhub/logic.js';

test('empty school data never invents records or averages',()=>{
  assert.ok(Object.values(emptyData()).every(items=>items.length===0));
  assert.equal(average([null,undefined,'']),null);
  assert.equal(average([4,null,5]),4.5);
});
test('attendance bulk marking preserves absence and only touches selected students',()=>{
  assert.deepEqual(markUnmarked({a:'absent',b:'late'},['a','b','c']),{a:'absent',b:'late',c:'present'});
});
test('class time uses a half-open interval and cancelled classes never occupy resources',()=>{
  const l={startsAt:'2030-01-02T05:00:00Z',endsAt:'2030-01-02T06:00:00Z',status:'scheduled'};
  assert.equal(lessonStatus(l,Date.parse(l.startsAt)),'current');
  assert.equal(lessonStatus(l,Date.parse(l.endsAt)),'finished');
  assert.equal(lessonStatus({...l,status:'cancelled'},Date.parse(l.startsAt)),'cancelled');
});
test('schedule overlap respects room, teacher and group; adjacent lessons are allowed',()=>{
  const l={id:'a',roomId:'r',teacherId:'t',groupId:'g',startsAt:'2030-01-02T05:00:00Z',endsAt:'2030-01-02T06:00:00Z',status:'scheduled'};
  assert.equal(lessonConflicts({...l,id:'b',groupId:'other',teacherId:'other'},[l]).length,1);
  assert.equal(lessonConflicts({...l,id:'b',startsAt:l.endsAt,endsAt:'2030-01-02T07:00:00Z'},[l]).length,0);
  assert.equal(lessonConflicts({...l,id:'b'},[{...l,status:'cancelled'}]).length,0);
  assert.equal(lessonConflicts(l,[l]).length,0);
});
test('calendar day is the school time zone, not the viewer time zone',()=>{
  assert.equal(dateKey('2030-01-01T20:00:00Z'),'2030-01-02');
});
