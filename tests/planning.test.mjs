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

// Drag-and-drop preview rules (the database remains the authority).
const boardSource = readFileSync(new URL('../src/utils/planningBoard.ts', import.meta.url), 'utf8')
const board = await import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(boardSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64'))
const facts = (over = {}) => ({ samePerson: true, sameSlot: false, ended: false, closed: false, capacity: 240, reserved: 0, events: [], ...over })

test('unscheduled balance subtracts planned and pending-reschedule blocks only', () => {
  const blocks = [
    { work_item_id: 'a', minutes: 60, status: 'planned' }, { work_item_id: 'a', minutes: 30, status: 'needs_reschedule' },
    { work_item_id: 'a', minutes: 120, status: 'superseded' }, { work_item_id: 'a', minutes: 120, status: 'cancelled' }, { work_item_id: 'b', minutes: 60, status: 'planned' },
  ]
  assert.equal(board.unscheduledMinutes(180, 'a', blocks), 90)
  assert.equal(board.unscheduledMinutes(60, 'a', blocks), 0)
  assert.equal(board.unscheduledMinutes(null, 'a', blocks), null)
})
test('dragging never changes the assignee and explains each refusal', () => {
  assert.deepEqual(board.dropVerdict('block', 60, facts({ samePerson: false })), { ok: false, reason: 'Outro responsável', free: 240 })
  assert.equal(board.dropVerdict('block', 60, facts({ sameSlot: true })).reason, 'Já está aqui')
  assert.equal(board.dropVerdict('block', 60, facts({ ended: true, capacity: 0 })).reason, 'Período encerrado')
  assert.equal(board.dropVerdict('item', 15, facts({ closed: true, capacity: 0 })).reason, 'Indisponível')
  assert.equal(board.dropVerdict('block', 60, facts({ reserved: 240 })).reason, 'Sem horas livres')
  assert.equal(board.dropVerdict('block', 120, facts({ reserved: 180 })).reason, 'Só 1h livres')
  assert.equal(board.dropVerdict('item', 15, facts({ capacity: 0, events: ['Aula'] })).reason, 'Ocupado: Aula')
  assert.match(board.dropVerdict('block', 180, facts({ capacity: 120, events: ['Reunião'] })).reason, /Só 2h livres · ocupado: reunião/)
})
test('a block must fit whole; a new reservation only needs some free time; unknown hours are flagged, not refused', () => {
  assert.deepEqual(board.dropVerdict('block', 120, facts({ reserved: 120 })), { ok: true, free: 120 })
  assert.deepEqual(board.dropVerdict('item', 15, facts({ reserved: 180 })), { ok: true, free: 60 })
  assert.deepEqual(board.dropVerdict('block', 600, facts({ capacity: null })), { ok: true, free: null, warning: 'Horário não configurado' })
})
