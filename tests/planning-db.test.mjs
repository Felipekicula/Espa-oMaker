import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
const user='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002', ticket='00000000-0000-0000-0000-000000000003'
async function setup(){
  const db=new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
    create table public.app_users(id uuid primary key,name text); insert into public.app_users values ('${user}','Felipe'),('${other}','Manu');
    create table public.tickets(id uuid primary key,status text); insert into public.tickets values('${ticket}','em_producao');
    create table public.ticket_tasks(id bigserial primary key,ticket_id uuid references public.tickets, titulo text, responsavel_id uuid, status text);
    insert into public.ticket_tasks(ticket_id,titulo,responsavel_id,status) values('${ticket}','Etapa','${user}','pendente');
    grant select on public.app_users, public.tickets to authenticated; grant select,update on public.ticket_tasks to authenticated;
    set request.jwt.claim.sub='${user}';`)
  await db.exec(readFileSync(new URL('../supabase/migration-maker-planning.sql',import.meta.url),'utf8'))
  await db.exec('set role authenticated')
  return db
}
const future='2099-01-05' // Monday. Tests never depend on wall-clock work periods.
async function createItem(db, task=true){const r=await db.query(`insert into maker_work_items(title,ticket_id,ticket_task_id,assignee_id,remaining_minutes) values ('Teste',$1,$2,$3,120) returning id`,[ticket,task?1:null,user]);return r.rows[0].id}
async function createBlock(db,id,minutes=60){const r=await db.query(`insert into maker_blocks(work_item_id,user_id,day,period,minutes) values($1,$2,$3,'manha',$4) returning id`,[id,user,future,minutes]);return r.rows[0].id}
test('migration + shared blocks, capacity, rescheduling, completion and RLS',async()=>{
 const db=await setup()
 try {
  await db.query(`insert into maker_availability values($1,1,'manha','08:00','12:00')`,[user])
  const id=await createItem(db),first=await createBlock(db,id,120),second=await createBlock(db,id,120)
  await assert.rejects(()=>createBlock(db,id,15),/excede/)
  await db.query(`select maker_continue_block($1,90)`,[first]);assert.equal((await db.query('select status from maker_blocks where id=$1',[first])).rows[0].status,'needs_reschedule')
  await db.query(`select maker_continue_block($1,90,$2,'tarde',60)`,[first,'2099-01-06'])
  assert.equal((await db.query('select status from maker_blocks where id=$1',[first])).rows[0].status,'superseded')
  await assert.rejects(()=>db.query(`select maker_continue_block($1,90)`,[first]),/já alterado/)
  await db.query(`select maker_complete_item($1,$2)`,[id,second])
  assert.equal((await db.query('select status from ticket_tasks where id=1')).rows[0].status,'concluido')
  assert.equal((await db.query('select status from tickets where id=$1',[ticket])).rows[0].status,'em_producao')
  assert.equal((await db.query('select count(*)::int count from maker_blocks where status=\'planned\'')).rows[0].count,0)
  await db.exec('reset role; set role anon');await assert.rejects(()=>db.query('select * from maker_blocks'),/permission denied/)
  await assert.rejects(()=>db.query(`select maker_continue_block($1,30)`,[first]),/permission denied/)
 } finally {await db.close()}
})
test('event series and preparation are atomic; conflict rolls back every occurrence',async()=>{
 const db=await setup();try {
 const payload={title:'Workshop',kind:'workshop',day:future,starts_at:'09:00',ends_at:'10:00',participant_ids:[user],preparation_deadline:'2099-01-02'}
 await db.query('select maker_create_event($1,$2,2)',[JSON.stringify(payload),JSON.stringify([{title:'Separar materiais',assignee_id:other}])])
 assert.equal((await db.query('select count(*)::int count from maker_events')).rows[0].count,2)
 assert.equal((await db.query('select count(*)::int count from maker_work_items')).rows[0].count,2)
 await assert.rejects(()=>db.query('select maker_create_event($1,$2,2)',[JSON.stringify({...payload,day:'2098-12-29',preparation_deadline:'2098-12-26'}),'[]']),/outro evento/)
 assert.equal((await db.query('select count(*)::int count from maker_events')).rows[0].count,2)
 const event=(await db.query('select id from maker_events order by day limit 1')).rows[0].id
 const item=(await db.query('select id from maker_work_items where event_id=$1',[event])).rows[0].id
 await db.query('update maker_work_items set assignee_id=$1 where id=$2',[user,item]);await createBlock(db,item,30)
 await db.query(`update maker_events set status='cancelled' where id=$1`,[event])
 assert.equal((await db.query('select count(*)::int count from maker_blocks where status=\'planned\'')).rows[0].count,0)
 }finally{await db.close()}
})
test('closed availability rejects blocks; task must belong to ticket; invalid remaining rejected',async()=>{
 const db=await setup();try{
 await db.query(`insert into maker_availability values($1,1,'manha','08:00','08:00')`,[user])
 const id=await createItem(db);await assert.rejects(()=>createBlock(db,id,30),/excede/)
 await db.query('delete from maker_availability');const block=await createBlock(db,id,30)
 await assert.rejects(()=>db.query('select maker_continue_block($1,null)',[block]),/restante/)
 await db.query('update ticket_tasks set status=\'concluido\' where id=1')
 assert.equal((await db.query('select status from maker_work_items where id=$1',[id])).rows[0].status,'completed')
 }finally{await db.close()}
})
test('overlapping events subtract a union of intervals; a changed task owner must replan',async()=>{
 const db=await setup();try{
 await db.query(`insert into maker_availability values($1,1,'manha','08:00','12:00')`,[user]);
 // Confirmed overlapping events are rejected, so simulate historical overlap as the database owner.
 await db.exec('reset role; alter table maker_events disable trigger maker_event_calendar');
 await db.query(`insert into maker_events(title,kind,day,starts_at,ends_at,participant_ids) values('A','aula',$1,'09:00','11:00',$2),('B','aula',$1,'10:00','12:00',$2)`,[future,[user]]);
 await db.exec('alter table maker_events enable trigger maker_event_calendar; set role authenticated');
 const id=await createItem(db),block=await createBlock(db,id,60);await assert.rejects(()=>createBlock(db,id,15),/excede/);
 await db.query(`update ticket_tasks set responsavel_id=$1 where id=1`,[other]);
 const row=(await db.query('select user_id,status from maker_blocks where id=$1',[block])).rows[0];assert.equal(row.user_id,other);assert.equal(row.status,'needs_reschedule');
 }finally{await db.close()}
})
test('authenticated non-members cannot read or write team planning',async()=>{
 const db=await setup();try{
 await createItem(db);await db.exec("set request.jwt.claim.sub='00000000-0000-0000-0000-000000000099'");
 assert.equal((await db.query('select * from maker_work_items')).rows.length,0);
 await assert.rejects(()=>db.query(`insert into maker_work_items(title,ticket_id,assignee_id) values('X',$1,$2)`,[ticket,user]),/row-level security/);
 }finally{await db.close()}
})
