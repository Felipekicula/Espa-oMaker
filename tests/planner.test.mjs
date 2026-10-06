import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// Assisted planning engine: pure module, same code the screen runs. No browser, network or database.
const source = readFileSync(new URL('../src/utils/planner.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const p = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))

const shift = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
/** Weekday periods of 4h from `start`; `overrides` is keyed "day|period" with { capacity, reserved, capacityNow }. */
export function agenda(start, workdays, overrides = {}) {
  const periods = []
  for (let day = start, n = 0; n < workdays; day = shift(day, 1)) {
    const w = new Date(day + 'T12:00:00Z').getUTCDay()
    if (w < 1 || w > 5) continue
    n++
    for (const period of ['manha', 'tarde']) {
      const o = overrides[day + '|' + period] ?? {}, capacity = o.capacity === undefined ? 240 : o.capacity
      periods.push({ day, period, capacity, capacityNow: o.capacityNow === undefined ? capacity : o.capacityNow, reserved: o.reserved ?? 0 })
    }
  }
  return periods
}
const sum = (blocks, purpose) => blocks.filter(b => !purpose || b.purpose === purpose).reduce((s, b) => s + b.minutes, 0)
const byPeriod = blocks => { const m = {}; for (const b of blocks) m[b.day + '|' + b.period] = (m[b.day + '|' + b.period] ?? 0) + b.minutes; return m }
/** Bruno's week in the documentation example: Friday afternoon closed, 2h already reserved on Wed morning, a class on Tue 13. */
export const exampleAgenda = () => agenda('2026-10-07', 40, {
  '2026-10-07|manha': { reserved: 120 }, '2026-10-13|manha': { capacity: 0 },
  ...Object.fromEntries(['2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13', '2026-11-20', '2026-11-27'].map(d => [d + '|tarde', { capacity: 0 }])),
})

test('protected slack is a fixed share of the period, counted against everything already reserved', () => {
  assert.equal(p.slackLimit(240, 20), 180) // 3h12 rounds down to 3h
  assert.equal(p.usableMinutes({ day: 'd', period: 'manha', capacity: 240, capacityNow: 240, reserved: 180 }, 20), 0) // not 20% off the last hour
  assert.equal(p.usableMinutes({ day: 'd', period: 'manha', capacity: 240, capacityNow: 240, reserved: 60 }, 20), 120)
  assert.equal(p.usableMinutes({ day: 'd', period: 'manha', capacity: 240, capacityNow: 240, reserved: 180 }, 20, true), 60) // only when explicitly allowed
  assert.equal(p.usableMinutes({ day: 'd', period: 'manha', capacity: null, capacityNow: null, reserved: 0 }, 20), 0) // unknown hours are never used
  assert.equal(p.usableMinutes({ day: 'd', period: 'tarde', capacity: 240, capacityNow: 50, reserved: 0 }, 20), 45) // today: only what is left of the period
  assert.equal(p.slackUse({ day: 'd', period: 'manha', capacity: 240, capacityNow: 240, reserved: 150 }, 20, 60), 30)
})

test('successive proposals never eat the protected slack', () => {
  let periods = agenda('2026-10-12', 10)
  for (const minutes of [600, 300, 450]) {
    const plan = p.allocate(periods, [{ minutes, purpose: 'trabalho' }], { slackPercent: 20 })
    assert.equal(plan.unplaced, 0); assert.equal(plan.slackUsed, 0)
    const added = byPeriod(plan.blocks)
    periods = periods.map(f => ({ ...f, reserved: f.reserved + (added[f.day + '|' + f.period] ?? 0) }))
    assert.ok(periods.every(f => f.reserved <= 180), 'no period goes past its 3h limit')
  }
  assert.equal(periods.reduce((s, f) => s + f.reserved, 0), 1350)
  // With explicit permission the same request reaches into the slack and says how much.
  const forced = p.allocate(periods, [{ minutes: 60, purpose: 'trabalho' }], { slackPercent: 20, useSlack: true })
  assert.deepEqual([forced.blocks[0].day, forced.blocks[0].minutes, forced.slackUsed, forced.slackPeriods], ['2026-10-12', 60, 60, 1])
})

test('margin and slack are shown as separate effects', () => {
  const r = p.propose({ mode: 'estimativa', workMinutes: 600, marginPercent: 20, periods: exampleAgenda(), slackPercent: 20, deadline: '2026-10-16' })
  assert.deepEqual([r.workMinutes, r.protectionMinutes], [600, 120])
  assert.deepEqual(r.scenarios.map(s => [s.key, s.minutes]), [['so_estimativa', 600], ['com_margem', 720], ['proposta', 720]])
  const ends = r.scenarios.map(s => s.allocation.end.day)
  assert.ok(ends[0] <= ends[1] && ends[1] <= ends[2], 'each protection can only push the date later')
  assert.equal(sum(r.plan.blocks, 'trabalho'), 600); assert.equal(sum(r.plan.blocks, 'protecao'), 120)
  assert.equal(r.plan.slackUsed, 0)
  assert.equal(r.beforeDeadline + r.afterDeadline, 720)
})

test('a range gives two forecasts and reserves the difference as protection', () => {
  const r = p.propose({ mode: 'faixa', lowMinutes: 360, highMinutes: 600, periods: exampleAgenda(), slackPercent: 20, deadline: '2026-10-16' })
  assert.deepEqual(r.scenarios.map(s => s.key), ['menor', 'maior'])
  assert.ok(r.scenarios[0].allocation.end.day <= r.scenarios[1].allocation.end.day)
  assert.deepEqual([r.workMinutes, r.protectionMinutes, sum(r.plan.blocks, 'trabalho'), sum(r.plan.blocks, 'protecao')], [360, 240, 360, 240])
})

test('"I do not know yet" reserves one investigation block and gives no completion forecast', () => {
  const r = p.propose({ mode: 'indefinida', investigationMinutes: 120, periods: exampleAgenda(), slackPercent: 20, deadline: '2026-10-16' })
  assert.deepEqual(r.scenarios, []); assert.equal(r.workMinutes, null); assert.equal(r.protectionMinutes, 0)
  // Wed morning already has 2h reserved (1h left under the 3h limit), so the whole block goes to the afternoon.
  assert.deepEqual(r.plan.blocks, [{ day: '2026-10-07', period: 'tarde', minutes: 120, purpose: 'investigacao', slackUsed: 0 }])
})

test('unknown hours are skipped and reported; what does not fit stays unplaced', () => {
  const periods = agenda('2026-10-12', 2, { '2026-10-12|tarde': { capacity: null, capacityNow: null } })
  const r = p.propose({ mode: 'estimativa', workMinutes: 900, marginPercent: 0, periods, slackPercent: 20, deadline: '2026-10-13' })
  assert.equal(r.plan.placed, 540); assert.equal(r.plan.unplaced, 360); assert.equal(r.plan.end, null)
  assert.equal(r.unknownPeriods, 1)
  assert.ok(!r.plan.blocks.some(b => b.day === '2026-10-12' && b.period === 'tarde'))
  assert.equal(r.scenarios[2].workdaysVsDeadline, null)
  // Skipping a period the person unticked.
  const skipped = p.propose({ mode: 'estimativa', workMinutes: 180, marginPercent: 0, periods, slackPercent: 20, deadline: null, skip: ['2026-10-12|manha'] })
  assert.deepEqual(skipped.plan.blocks.map(b => [b.day, b.period]), [['2026-10-13', 'manha']])
})

test('working days against the deadline', () => {
  assert.equal(p.workdaysVsDeadline('2026-10-09', '2026-10-12'), 1)  // Fri -> Mon
  assert.equal(p.workdaysVsDeadline('2026-10-12', '2026-10-12'), 0)
  assert.equal(p.workdaysVsDeadline('2026-10-14', '2026-10-12'), -2)
  assert.equal(p.workdaysVsDeadline(null, '2026-10-12'), null); assert.equal(p.workdaysVsDeadline('2026-10-12', null), null)
})

// The figures quoted in docs/PLANEJAMENTO_EQUIPE.md come from here, not from hand arithmetic.
test('documentation example is what the engine produces', () => {
  const day = s => s.allocation.end.day + ' ' + s.allocation.end.period
  const unknown = p.propose({ mode: 'indefinida', investigationMinutes: 120, periods: exampleAgenda(), slackPercent: 20, deadline: '2026-10-16' })
  assert.deepEqual(unknown.plan.blocks.map(b => [b.day, b.period, b.minutes]), [['2026-10-07', 'tarde', 120]])
  const afterInvestigation = exampleAgenda().filter(f => f.day >= '2026-10-08')
  const range = p.propose({ mode: 'faixa', lowMinutes: 360, highMinutes: 600, periods: afterInvestigation, slackPercent: 20, deadline: '2026-10-16' })
  assert.deepEqual(range.scenarios.map(s => [day(s), s.workdaysVsDeadline]), [['2026-10-08 tarde', 6], ['2026-10-12 manha', 4]])
  assert.deepEqual(Object.entries(byPeriod(range.plan.blocks)), [['2026-10-08|manha', 180], ['2026-10-08|tarde', 180], ['2026-10-09|manha', 180], ['2026-10-12|manha', 60]])
  const estimate = p.propose({ mode: 'estimativa', workMinutes: 600, marginPercent: 20, periods: exampleAgenda(), slackPercent: 20, deadline: '2026-10-16' })
  assert.deepEqual(estimate.scenarios.map(s => [s.key, day(s), s.workdaysVsDeadline]), [['so_estimativa', '2026-10-08 manha', 6], ['com_margem', '2026-10-08 tarde', 6], ['proposta', '2026-10-09 manha', 5]])
  // Capacity known up to the deadline, with slack: stated as capacity, not as a forecast.
  assert.equal(exampleAgenda().filter(f => f.day <= '2026-10-16').reduce((s, f) => s + p.usableMinutes(f, 20), 0), 37 * 60)
})
