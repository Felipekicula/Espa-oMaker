import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// Transpile only the pure module: no browser, authentication or production network.
const source = readFileSync(new URL('../src/utils/planning.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const p = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const now = new Date('2026-10-05T10:00:00-03:00')
const availability = [{ user_id:'f',weekday:1,period:'manha',starts_at:'08:00',ends_at:'12:00' }]
const event = (start,end) => ({ day:'2026-10-05',status:'confirmed',participant_ids:['f'],starts_at:start,ends_at:end })
const block = overrides => ({ id:'b',work_item_id:'i',user_id:'f',day:'2026-10-05',period:'manha',minutes:60,status:'planned',...overrides })
const item = overrides => ({ id:'i',status:'pending',assignee_id:'f',remaining_minutes:180,...overrides })
test('local day remains Monday at UTC Tuesday',()=>assert.equal(p.today(new Date('2026-10-06T01:00Z')),'2026-10-05'))
test('union of overlapping events subtracts time only once',()=>assert.equal(p.availableMinutes('f','2026-10-05','manha',availability,[event('09:00','11:00'),event('10:00','12:00')]),60))
test('remaining capacity excludes elapsed time today',()=>assert.equal(p.availableMinutes('f','2026-10-05','manha',availability,[],now),120))
test('missing availability is unknown; confirmed closure is zero',()=>{assert.equal(p.availableMinutes('f','2026-10-06','manha',availability,[]),null);assert.equal(p.availableMinutes('f','2026-10-05','manha',[{...availability[0],ends_at:'08:00'}],[]),0)})
test('multiple same-day reservations sum; done blocks do not occupy future capacity',()=>assert.equal(p.reservedMinutes([block({}),block({id:'c',minutes:120}),block({id:'d',status:'done'})],'f','2026-10-05','manha'),180))
test('ended periods and overdue days stay visible as missed',()=>{assert(p.isMissed(block({}),availability,new Date('2026-10-05T12:01-03:00')));assert(!p.isMissed(block({}),[],now));assert(p.isMissed(block({day:'2026-10-02'}),[],now))})
test('suggestions distinguish after-deadline slots and unknown availability',()=>{const slots=p.slotsFor('f',60,'2026-10-05',availability,[],[],now);assert(slots.some(s=>s.afterDeadline));assert(slots.some(s=>s.free===null));assert(!slots.some(s=>[0,6].includes(p.weekday(s.day))))})
test('known insufficient capacity produces an explicit does-not-fit alert',()=>{const slots=[...availability,{user_id:'f',weekday:1,period:'tarde',starts_at:'12:00',ends_at:'12:00'}];assert.match(p.itemAssessment(item({}),'2026-10-05',[],slots,[],now),/Não cabe/)})
test('unknown availability cannot turn into a green promise',()=>assert.match(p.itemAssessment(item({remaining_minutes:60}),'2026-10-09',[block({day:'2026-10-06'})],[],[],now),/confirmar/))
test('completed stage is separate from a missed block',()=>assert.equal(p.itemAssessment(item({status:'completed'}),'2026-10-05',[block({day:'2026-10-02'})],[],[],now),'Etapa concluída'))
