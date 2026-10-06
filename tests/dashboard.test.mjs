import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
// Transpile only the pure module: no browser, authentication or production network.
const source = readFileSync(new URL('../src/utils/dashboard.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const d = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))

test('delivery day is the local day in Sao Paulo, not the UTC day', () => {
  assert.equal(d.localDay('2026-09-11T01:30:00Z'), '2026-09-10')
  assert.equal(d.localDay('2026-09-10T15:00:00Z'), '2026-09-10')
})
test('weeks start on Monday; long periods switch to months', () => {
  assert.equal(d.bucketKey('2026-10-06', 'week'), '2026-10-05')
  assert.equal(d.bucketKey('2026-10-04', 'week'), '2026-09-28')
  assert.equal(d.bucketKey('2026-10-06', 'month'), '2026-10')
  assert.equal(d.granularityFor(90), 'week'); assert.equal(d.granularityFor(180), 'month')
  assert.deepEqual(d.bucketKeys('2026-09-28', '2026-10-06', 'week'), ['2026-09-28', '2026-10-05'])
  assert.equal(d.periodStart('2026-10-06', 30), '2026-09-07')
})
test('punctuality compares the delivery day with the current deadline; no deadline is not a miss', () => {
  assert.equal(d.punctuality('2026-09-10', '2026-09-10'), 'no_prazo')
  assert.equal(d.punctuality('2026-09-10', '2026-09-11'), 'fora_do_prazo')
  assert.equal(d.punctuality(null, '2026-09-11'), 'sem_prazo')
})
test('only "entregue" with a recorded date counts; "pronta" and undated deliveries are kept apart', () => {
  const tickets = [
    { id: 'a', status: 'entregue', data_entrega: '2026-09-10' },
    { id: 'b', status: 'entregue', data_entrega: '2026-09-10' },
    { id: 'c', status: 'entregue', data_entrega: null },
    { id: 'd', status: 'entregue', data_entrega: '2026-09-01' }, // delivered before dates were recorded
    { id: 'e', status: 'pronta', data_entrega: '2026-09-10' },
    { id: 'f', status: 'entregue', data_entrega: '2026-01-10' }, // outside the period
  ]
  const at = new Map([['a', '2026-09-09T14:00:00Z'], ['b', '2026-09-15T14:00:00Z'], ['c', '2026-09-16T14:00:00Z'], ['e', '2026-09-09T14:00:00Z'], ['f', '2026-01-09T14:00:00Z']])
  const s = d.summarizeDeliveries(tickets, at, '2026-09-01', '2026-09-30', 'week')
  assert.deepEqual(s.delivered.sort(), ['a', 'b', 'c'])
  assert.deepEqual(s.noPrazo, ['a']); assert.deepEqual(s.foraDoPrazo, ['b']); assert.deepEqual(s.semPrazo, ['c'])
  assert.deepEqual(s.semDataEntrega, ['d'])
  assert.equal(s.percentNoPrazo, 50)
  assert.equal(s.buckets.reduce((sum, b) => sum + b.total, 0), 3)
  assert.equal(s.buckets.find(b => b.key === '2026-09-14').total, 2)
})
test('no countable delivery gives no percentage instead of 0% or 100%', () => {
  const s = d.summarizeDeliveries([{ id: 'c', status: 'entregue', data_entrega: null }], new Map([['c', '2026-09-16T14:00:00Z']]), '2026-09-01', '2026-09-30', 'week')
  assert.equal(s.percentNoPrazo, null)
})
test('overdue ignores delivered, cancelled and tickets without a deadline', () => {
  assert.equal(d.isOverdue({ id: '1', status: 'em_producao', data_entrega: '2026-10-05' }, '2026-10-06'), true)
  assert.equal(d.isOverdue({ id: '1', status: 'em_producao', data_entrega: '2026-10-06' }, '2026-10-06'), false)
  assert.equal(d.isOverdue({ id: '1', status: 'entregue', data_entrega: '2026-10-01' }, '2026-10-06'), false)
  assert.equal(d.isOverdue({ id: '1', status: 'pronta', data_entrega: null }, '2026-10-06'), false)
})
test('delivery-date migration: records on delivery, clears on reopen, never backfills', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create table public.tickets(id serial primary key, status text not null, data_entrega date);
      insert into public.tickets(status) values ('entregue'), ('em_producao');`)
    await db.exec(readFileSync(new URL('../supabase/migration-ticket-entregue-em.sql', import.meta.url), 'utf8'))
    const row = async id => (await db.query('select status, entregue_em from tickets where id=$1', [id])).rows[0]
    assert.equal((await row(1)).entregue_em, null) // delivered before the migration: no invented date
    await db.exec(`update tickets set data_entrega='2026-10-01' where id=1`)
    assert.equal((await row(1)).entregue_em, null)
    await db.exec(`update tickets set status='pronta' where id=2`)
    assert.equal((await row(2)).entregue_em, null) // ready is not delivered
    await db.exec(`update tickets set status='entregue' where id=2`)
    const first = (await row(2)).entregue_em
    assert.ok(first)
    await db.exec(`update tickets set status='entregue', data_entrega='2026-10-02' where id=2`)
    assert.deepEqual((await row(2)).entregue_em, first) // saving again keeps the original moment
    await db.exec(`update tickets set status='em_producao' where id=2`)
    assert.equal((await row(2)).entregue_em, null)
    await db.exec(`insert into tickets(status) values ('entregue')`)
    assert.ok((await row(3)).entregue_em)
    await db.exec(readFileSync(new URL('../supabase/migration-ticket-entregue-em.sql', import.meta.url), 'utf8')) // safe to re-run
  } finally { await db.close() }
})
