import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
// Assisted planning rules executed in embedded PostgreSQL: both planning migrations, no production access.
const ana = '00000000-0000-0000-0000-000000000001', bruno = '00000000-0000-0000-0000-000000000002', outsider = '00000000-0000-0000-0000-000000000009'
const t1 = '00000000-0000-0000-0000-0000000000a1', t2 = '00000000-0000-0000-0000-0000000000a2', t3 = '00000000-0000-0000-0000-0000000000a3'
const mon = '2099-01-05', tue = '2099-01-06', wed = '2099-01-07' // far future: never depends on the clock
const sql = name => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8')
async function setup() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create table public.app_users(id uuid primary key,name text); insert into public.app_users values ('${ana}','Ana'),('${bruno}','Bruno');
    create table public.tickets(id uuid primary key,status text); insert into public.tickets values('${t1}','em_producao'),('${t2}','em_producao'),('${t3}','em_producao');
    create table public.ticket_tasks(id bigserial primary key,ticket_id uuid references public.tickets, titulo text, responsavel_id uuid, status text);
    grant select on public.app_users, public.tickets to authenticated; grant select,update on public.ticket_tasks to authenticated;
    -- Supabase grants everything on new public tables to these roles; migrations must not rely on a clean slate.
    alter default privileges in schema public grant all on tables to anon, authenticated;
    set request.jwt.claim.sub='${ana}';`)
  await db.exec(sql('migration-maker-planning.sql'))
  await db.exec(sql('migration-maker-assisted-planning.sql'))
  await db.exec('set role authenticated')
  for (const person of [ana, bruno]) for (let weekday = 1; weekday <= 5; weekday++) {
    await db.query(`insert into maker_availability values($1,$2,'manha','08:00','12:00'),($1,$2,'tarde','13:00','17:00')`, [person, weekday])
  }
  return db
}
const accept = (db, plan) => db.query('select maker_accept_plan($1::jsonb) as id', [JSON.stringify(plan)]).then(r => r.rows[0].id)
const plan = (ticket, blocks, extra = {}) => ({ ticket_id: ticket, title: 'Demanda', assignee_id: ana, scope: 'demanda', mode: 'estimativa', work_minutes: 240, protection_minutes: 60, blocks, ...extra })
const count = async (db, q, args = []) => (await db.query(`select count(*)::int n from ${q}`, args)).rows[0].n
const reserved = async (db, day, period, person = ana) => (await db.query(`select coalesce(sum(minutes),0)::int n from maker_blocks where user_id=$1 and day=$2 and period=$3 and status='planned'`, [person, day, period])).rows[0].n

test('accepting a proposal is all or nothing: a refused block leaves no card, block or history', async () => {
  const db = await setup()
  try {
    await assert.rejects(() => accept(db, plan(t1, [{ day: mon, period: 'manha', minutes: 180 }, { day: mon, period: 'tarde', minutes: 300 }], { use_slack: true, work_minutes: 600 })), /excede o tempo disponível/)
    assert.equal(await count(db, 'maker_work_items'), 0); assert.equal(await count(db, 'maker_blocks'), 0); assert.equal(await count(db, 'maker_estimate_log'), 0)
    const id = await accept(db, plan(t1, [{ day: mon, period: 'manha', minutes: 180, purpose: 'trabalho' }, { day: mon, period: 'tarde', minutes: 60, purpose: 'trabalho' }, { day: mon, period: 'tarde', minutes: 60, purpose: 'protecao' }]))
    const item = (await db.query('select * from maker_work_items where id=$1', [id])).rows[0]
    assert.deepEqual([item.scope, item.estimate_mode, item.work_minutes, item.protection_minutes, item.remaining_minutes, item.status], ['demanda', 'estimativa', 240, 60, 300, 'pending'])
    assert.equal(await count(db, `maker_blocks where work_item_id=$1 and status='planned'`, [id]), 3)
    assert.equal(await count(db, `maker_blocks where work_item_id=$1 and purpose='protecao'`, [id]), 1)
    const log = (await db.query('select reason, mode, work_minutes, protection_minutes from maker_estimate_log where work_item_id=$1', [id])).rows
    assert.deepEqual(log, [{ reason: 'inicial', mode: 'estimativa', work_minutes: 240, protection_minutes: 60 }])
  } finally { await db.close() }
})

test('protected slack counts the whole period: successive proposals cannot consume it silently', async () => {
  const db = await setup()
  try {
    // 4h period, 20% slack -> 3h usable for proposals.
    assert.equal((await db.query(`select maker_slack_limit($1,$2,'manha') n`, [ana, mon])).rows[0].n, 180)
    await assert.rejects(() => accept(db, plan(t1, [{ day: mon, period: 'manha', minutes: 195 }])), /folga protegida/)
    await accept(db, plan(t1, [{ day: mon, period: 'manha', minutes: 180 }]))
    // A second proposal sees the period as full even though 1h of raw capacity is left.
    await assert.rejects(() => accept(db, plan(t2, [{ day: mon, period: 'manha', minutes: 15 }])), /usaria 15 min da folga protegida/)
    assert.equal(await count(db, 'maker_work_items where ticket_id=$1', [t2]), 0)
    // Explicit confirmation uses it and leaves a record; total capacity is still the hard limit.
    const second = await accept(db, plan(t2, [{ day: mon, period: 'manha', minutes: 60 }], { use_slack: true }))
    assert.equal(await reserved(db, mon, 'manha'), 240)
    assert.match((await db.query(`select note from maker_estimate_log where work_item_id=$1 and reason='folga'`, [second])).rows[0].note, /60 min da folga protegida/)
    await assert.rejects(() => accept(db, plan(t3, [{ day: mon, period: 'manha', minutes: 15 }], { use_slack: true })), /excede o tempo disponível/)
    await db.query(`insert into maker_person_settings values($1, 0)`, [ana])
    assert.equal((await db.query(`select maker_slack_limit($1,$2,'tarde') n`, [ana, mon])).rows[0].n, 240)
  } finally { await db.close() }
})

test('one whole-demand card per demand, and never together with its steps', async () => {
  const db = await setup()
  try {
    await accept(db, plan(t1, [{ day: mon, period: 'manha', minutes: 60 }]))
    await assert.rejects(() => accept(db, plan(t1, [{ day: tue, period: 'manha', minutes: 60 }])), /maker_one_whole_card_per_ticket|duplicate/)
    await assert.rejects(() => db.query(`insert into maker_work_items(title,ticket_id,assignee_id,remaining_minutes) values('Etapa',$1,$2,60)`, [t1, ana]), /demanda inteira/)
    await db.query(`insert into maker_work_items(title,ticket_id,assignee_id,remaining_minutes) values('Etapa',$1,$2,60)`, [t2, ana])
    await assert.rejects(() => accept(db, plan(t2, [{ day: tue, period: 'manha', minutes: 60 }])), /já tem etapas planejadas/)
    assert.equal(await count(db, 'maker_blocks where day=$1', [tue]), 0)
  } finally { await db.close() }
})

test('revising what is left replaces future reservations and keeps the original estimate in the history', async () => {
  const db = await setup()
  try {
    const id = await accept(db, plan(t1, [{ day: mon, period: 'manha', minutes: 180 }, { day: mon, period: 'tarde', minutes: 120 }]))
    const first = (await db.query(`select id from maker_blocks where work_item_id=$1 and period='manha'`, [id])).rows[0].id
    await accept(db, { item_id: id, mode: 'faixa', work_minutes: 360, protection_minutes: 120, low_minutes: 360, high_minutes: 480, replace_from_block: first, note: 'Depois do primeiro bloco',
      blocks: [{ day: tue, period: 'manha', minutes: 180 }, { day: tue, period: 'tarde', minutes: 180 }, { day: wed, period: 'manha', minutes: 120, purpose: 'protecao' }] })
    const blocks = (await db.query(`select day::text, period, minutes, status, purpose, predecessor_id from maker_blocks where work_item_id=$1 order by day, period`, [id])).rows
    assert.deepEqual(blocks.filter(b => b.status === 'superseded').map(b => [b.day, b.minutes]), [[mon, 180], [mon, 120]])
    assert.deepEqual(blocks.filter(b => b.status === 'planned').map(b => [b.day, b.period, b.minutes, b.purpose]), [[tue, 'manha', 180, 'trabalho'], [tue, 'tarde', 180, 'trabalho'], [wed, 'manha', 120, 'protecao']])
    assert.equal(blocks.find(b => b.day === tue && b.period === 'manha').predecessor_id, first)
    const item = (await db.query('select remaining_minutes, work_minutes, protection_minutes, estimate_mode from maker_work_items where id=$1', [id])).rows[0]
    assert.deepEqual(item, { remaining_minutes: 480, work_minutes: 360, protection_minutes: 120, estimate_mode: 'faixa' })
    const log = (await db.query('select reason, work_minutes, protection_minutes, low_minutes, high_minutes from maker_estimate_log where work_item_id=$1 order by created_at', [id])).rows
    assert.deepEqual(log, [{ reason: 'inicial', work_minutes: 240, protection_minutes: 60, low_minutes: null, high_minutes: null }, { reason: 'revisao', work_minutes: 360, protection_minutes: 120, low_minutes: 360, high_minutes: 480 }])
    // "I do not know yet": only the investigation block, no work figure.
    const unknown = await accept(db, { ticket_id: t2, title: 'Outra', assignee_id: ana, scope: 'demanda', mode: 'indefinida', work_minutes: 999, review_on: wed, blocks: [{ day: wed, period: 'tarde', minutes: 120, purpose: 'investigacao' }] })
    const u = (await db.query('select work_minutes, protection_minutes, remaining_minutes, review_on::text from maker_work_items where id=$1', [unknown])).rows[0]
    assert.deepEqual(u, { work_minutes: null, protection_minutes: 0, remaining_minutes: 120, review_on: wed })
  } finally { await db.close() }
})

test('turning the whole demand into steps moves reservations without duplicating hours', async () => {
  const db = await setup()
  try {
    const card = await accept(db, plan(t1, [{ day: mon, period: 'manha', minutes: 180 }, { day: mon, period: 'tarde', minutes: 120, purpose: 'protecao' }]))
    await db.query('select maker_convert_to_steps($1,$2::jsonb)', [card, JSON.stringify([
      { title: 'Modelar', work_minutes: 120 }, { title: 'Imprimir', work_minutes: 100, protection_minutes: 20 }, { title: 'Pintar', work_minutes: 60, assignee_id: bruno },
    ])])
    const old = (await db.query('select status, converted_at is not null converted, remaining_minutes from maker_work_items where id=$1', [card])).rows[0]
    assert.deepEqual(old, { status: 'completed', converted: true, remaining_minutes: null })
    assert.equal(await count(db, `maker_blocks where work_item_id=$1 and status='planned'`, [card]), 0)
    assert.equal(await count(db, `maker_blocks where work_item_id=$1 and status='superseded'`, [card]), 2)
    const steps = (await db.query(`select i.title, i.scope, i.remaining_minutes, coalesce((select sum(minutes) from maker_blocks b where b.work_item_id=i.id and b.status='planned'),0)::int reserved
      from maker_work_items i where i.ticket_id=$1 and i.status='pending' order by i.created_at, i.title`, [t1])).rows
    assert.deepEqual(steps.map(s => [s.title, s.scope, s.remaining_minutes, s.reserved]).sort(), [['Imprimir', 'etapa', 120, 120], ['Modelar', 'etapa', 120, 120], ['Pintar', 'etapa', 60, 0]])
    // Same periods, never more hours than before: 180 + 120 became 180 + 60 (60 min released).
    assert.equal(await reserved(db, mon, 'manha'), 180); assert.equal(await reserved(db, mon, 'tarde'), 60); assert.equal(await reserved(db, mon, 'manha', bruno), 0)
    assert.equal(await count(db, `maker_blocks where predecessor_id is not null and status='planned'`), 2)
    assert.match((await db.query(`select note from maker_estimate_log where work_item_id=$1 and reason='transformacao'`, [card])).rows[0].note, /3 etapas somando 300 min \(antes: 300 min a reservar\)\. 240 min/)
    await assert.rejects(() => db.query('select maker_convert_to_steps($1,$2::jsonb)', [card, '[{"title":"X","work_minutes":60}]']), /já encerrado/)
    await assert.rejects(() => accept(db, plan(t1, [{ day: tue, period: 'manha', minutes: 60 }])), /já tem etapas planejadas/)
  } finally { await db.close() }
})

test('holidays and absences remove capacity in the database; unknown hours stay unknown', async () => {
  const db = await setup()
  try {
    await db.query(`insert into maker_time_off(user_id, day, period, reason) values ($1,$2,'manha','Consulta')`, [ana, mon])
    await db.query(`insert into maker_time_off(user_id, day, period, reason) values (null,$1,null,'Feriado')`, [tue])
    assert.equal((await db.query(`select maker_period_capacity($1,$2,'manha') n`, [ana, mon])).rows[0].n, 0)
    assert.equal((await db.query(`select maker_period_capacity($1,$2,'tarde') n`, [ana, mon])).rows[0].n, 240)
    assert.equal((await db.query(`select maker_period_capacity($1,$2,'tarde') n`, [bruno, tue])).rows[0].n, 0)
    assert.equal((await db.query(`select maker_period_capacity($1,'2099-01-10','manha') n`, [ana])).rows[0].n, null) // Saturday: nothing configured
    const item = (await db.query(`insert into maker_work_items(title,ticket_id,assignee_id,remaining_minutes) values('Etapa',$1,$2,600) returning id`, [t1, ana])).rows[0].id
    await assert.rejects(() => db.query(`insert into maker_blocks(work_item_id,user_id,day,period,minutes) values($1,$2,$3,'manha',15)`, [item, ana, mon]), /excede/)
    await assert.rejects(() => db.query(`insert into maker_blocks(work_item_id,user_id,day,period,minutes) values($1,$2,$3,'tarde',15)`, [item, ana, tue]), /excede/)
    await db.query(`insert into maker_blocks(work_item_id,user_id,day,period,minutes) values($1,$2,$3,'tarde',240)`, [item, ana, mon])
    await assert.rejects(() => db.query(`insert into maker_blocks(work_item_id,user_id,day,period,minutes) values($1,$2,$3,'tarde',15)`, [item, ana, mon]), /excede/)
    // An event still subtracts only its own interval.
    await db.query(`select maker_create_event($1::jsonb,'[]'::jsonb,1)`, [JSON.stringify({ title: 'Aula', kind: 'aula', day: wed, starts_at: '08:00', ends_at: '10:00', participant_ids: [ana] })])
    assert.equal((await db.query(`select maker_period_capacity($1,$2,'manha') n`, [ana, wed])).rows[0].n, 120)
  } finally { await db.close() }
})

test('history is append-only and the new objects are closed to non-members and anonymous users', async () => {
  const db = await setup()
  try {
    const id = await accept(db, plan(t1, [{ day: mon, period: 'manha', minutes: 60 }]))
    await assert.rejects(() => db.query(`update maker_estimate_log set work_minutes=1 where work_item_id=$1`, [id]), /permission denied/)
    await assert.rejects(() => db.query(`delete from maker_estimate_log where work_item_id=$1`, [id]), /permission denied/)
    await assert.rejects(() => db.query(`delete from maker_person_settings`), /permission denied/)
    await assert.rejects(() => db.query(`update maker_time_off set reason='x'`), /permission denied/)
    await db.exec(`set request.jwt.claim.sub='${outsider}'`)
    assert.equal(await count(db, 'maker_estimate_log'), 0); assert.equal(await count(db, 'maker_time_off'), 0)
    await assert.rejects(() => accept(db, plan(t2, [{ day: tue, period: 'manha', minutes: 60 }])), /row-level security|violates/)
    await db.exec('reset role; set role anon')
    await assert.rejects(() => accept(db, plan(t2, [{ day: tue, period: 'manha', minutes: 60 }])), /permission denied/)
    await assert.rejects(() => db.query('select * from maker_time_off'), /permission denied/)
  } finally { await db.close() }
})
