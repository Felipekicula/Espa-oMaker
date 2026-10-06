-- Planejamento assistido: demanda inteira, histórico de estimativas, folga protegida,
-- feriados e ausências. Aplicar DEPOIS de migration-maker-planning.sql, uma única vez.
--
-- Só acrescenta colunas, tabelas e funções do módulo de planejamento (maker_*). Não altera
-- demandas, tarefas, prazos nem campos financeiros. A única mudança em algo já existente é
-- a função maker_check_block, recriada para também descontar feriados e ausências; a regra
-- de capacidade continua a mesma. É uma transação: se falhar, nada é aplicado.
begin;

alter table public.maker_work_items
  add column scope text not null default 'etapa' check (scope in ('etapa','demanda')),
  add column estimate_mode text check (estimate_mode in ('estimativa','faixa','indefinida')),
  -- Trabalho previsto e proteção contra erro ficam separados. remaining_minutes continua sendo
  -- o total a reservar (os dois somados); nada aqui representa hora efetivamente trabalhada.
  add column work_minutes integer check (work_minutes > 0),
  add column protection_minutes integer not null default 0 check (protection_minutes >= 0),
  add column review_on date,
  add column converted_at timestamptz,
  add constraint maker_whole_ticket_shape check (scope = 'etapa' or (ticket_id is not null and ticket_task_id is null));
alter table public.maker_blocks
  add column purpose text not null default 'trabalho' check (purpose in ('trabalho','protecao','investigacao'));
-- No máximo um cartão de "demanda inteira" ativo por demanda.
create unique index maker_one_whole_card_per_ticket on public.maker_work_items(ticket_id) where scope = 'demanda' and status = 'pending';

-- Histórico de estimativas: uma linha por alteração; a primeira é a estimativa original.
create table public.maker_estimate_log (
  id uuid primary key default gen_random_uuid(),
  work_item_id uuid not null references public.maker_work_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references public.app_users(id),
  reason text not null check (reason in ('inicial','revisao','transformacao','folga')),
  mode text check (mode in ('estimativa','faixa','indefinida')),
  work_minutes integer, protection_minutes integer, low_minutes integer, high_minutes integer,
  review_on date, note text
);
create index maker_estimate_log_item_idx on public.maker_estimate_log(work_item_id, created_at);
-- Folga protegida por pessoa, em % da capacidade de cada período.
create table public.maker_person_settings (
  user_id uuid primary key references public.app_users(id),
  slack_percent integer not null default 20 check (slack_percent between 0 and 50)
);
-- Feriados (user_id nulo = toda a equipe) e ausências. period nulo = dia inteiro.
create table public.maker_time_off (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.app_users(id),
  day date not null, period text check (period in ('manha','tarde')),
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid not null default auth.uid() references public.app_users(id),
  created_at timestamptz not null default now()
);
create index maker_time_off_day_idx on public.maker_time_off(day);

do $$ declare t text; begin
  foreach t in array array['maker_estimate_log','maker_person_settings','maker_time_off'] loop
    execute format('alter table public.%I enable row level security',t);
    -- O Supabase concede tudo a anon e authenticated em tabelas novas; aqui fica só o necessário.
    execute format('revoke all on public.%I from anon, authenticated',t);
  end loop;
  foreach t in array array['maker_person_settings','maker_time_off'] loop
    execute format('create policy team_access on public.%I for all to authenticated using (exists (select 1 from public.app_users where id = auth.uid())) with check (exists (select 1 from public.app_users where id = auth.uid()))',t);
  end loop;
end $$;
-- O histórico só recebe linhas novas: não há política nem permissão para editar ou apagar.
create policy team_read on public.maker_estimate_log for select to authenticated using (exists (select 1 from public.app_users where id = auth.uid()));
create policy team_append on public.maker_estimate_log for insert to authenticated with check (exists (select 1 from public.app_users where id = auth.uid()));
grant select, insert on public.maker_estimate_log to authenticated;
grant select, insert, update on public.maker_person_settings to authenticated;
grant select, insert, delete on public.maker_time_off to authenticated;

-- Capacidade real de um período: horário configurado, menos feriados/ausências e eventos.
-- Nulo = horário não configurado (desconhecido). from_time recorta o que já passou hoje.
create function public.maker_period_capacity(person uuid, d date, p text, from_time time default null)
returns integer language plpgsql stable security invoker set search_path = '' as $$
declare slot public.maker_availability; busy numeric; begin
  select * into slot from public.maker_availability where user_id = person and weekday = extract(isodow from d) and period = p;
  if not found then return null; end if;
  if exists(select 1 from public.maker_time_off o where o.day = d and (o.user_id is null or o.user_id = person) and (o.period is null or o.period = p)) then return 0; end if;
  if from_time is not null then slot.starts_at := least(slot.ends_at, greatest(slot.starts_at, from_time)); end if;
  select coalesce(sum(extract(epoch from(upper(r)-lower(r)))/60),0) into busy from (
    select unnest(range_agg(tsrange(d+greatest(e.starts_at,slot.starts_at),d+least(e.ends_at,slot.ends_at),'[)'))) r
    from public.maker_events e where e.status='confirmed' and e.day=d and person=any(e.participant_ids)
    and e.starts_at<slot.ends_at and e.ends_at>slot.starts_at
  ) ranges;
  return greatest(0, extract(epoch from(slot.ends_at-slot.starts_at))/60 - busy)::integer;
end $$;
-- Quanto do período pode ser ocupado sem tocar na folga protegida (múltiplo de 15 min).
create function public.maker_slack_limit(person uuid, d date, p text)
returns integer language plpgsql stable security invoker set search_path = '' as $$
declare capacity integer; percent integer; begin
  capacity := public.maker_period_capacity(person, d, p);
  if capacity is null then return null; end if;
  select slack_percent into percent from public.maker_person_settings where user_id = person;
  return (floor(capacity * (100 - coalesce(percent, 20)) / 100.0 / 15) * 15)::integer;
end $$;

-- Mesma regra de capacidade de antes, agora descontando também feriados e ausências.
create or replace function public.maker_check_block() returns trigger language plpgsql security invoker set search_path = '' as $$
declare capacity integer; reserved numeric; item public.maker_work_items; today date := (now() at time zone 'America/Sao_Paulo')::date; begin
  if new.status <> 'planned' then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text,0));
  select * into item from public.maker_work_items where id=new.work_item_id for update;
  if item.status='completed' then raise exception 'Etapa já concluída.'; end if;
  if item.assignee_id is distinct from new.user_id then raise exception 'O bloco deve pertencer ao responsável da etapa.'; end if;
  if new.day < today then raise exception 'Não reserve trabalho no passado.'; end if;
  capacity := public.maker_period_capacity(new.user_id, new.day, new.period, case when new.day = today then (now() at time zone 'America/Sao_Paulo')::time end);
  if capacity is null then return new; end if; -- Unknown availability remains explicitly unknown in UI.
  select coalesce(sum(minutes),0) into reserved from public.maker_blocks where user_id=new.user_id and day=new.day and period=new.period and status='planned' and id<>new.id;
  if new.minutes+reserved > capacity then raise exception 'O trabalho excede o tempo disponível neste período.'; end if;
  return new;
end $$;

-- Demanda inteira e etapas da mesma demanda não podem ficar pendentes ao mesmo tempo.
create function public.maker_guard_scope() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status <> 'pending' or new.ticket_id is null then return new; end if;
  if new.scope = 'demanda' and exists(select 1 from public.maker_work_items where ticket_id = new.ticket_id and status = 'pending' and scope = 'etapa' and id <> new.id) then
    raise exception 'Esta demanda já tem etapas planejadas. Planeje as etapas existentes.';
  end if;
  if new.scope = 'etapa' and exists(select 1 from public.maker_work_items where ticket_id = new.ticket_id and status = 'pending' and scope = 'demanda' and id <> new.id) then
    raise exception 'Esta demanda está planejada como demanda inteira. Use "Transformar em etapas".';
  end if;
  return new;
end $$;
create trigger maker_item_scope before insert or update of status, scope, ticket_id on public.maker_work_items for each row execute function public.maker_guard_scope();

-- Aceite de uma proposta: etapa (nova ou existente), todos os blocos e o histórico, tudo ou nada.
-- Cada bloco passa pelo gatilho de capacidade. Sem use_slack, a proposta não pode entrar na folga.
create function public.maker_accept_plan(plan jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare item public.maker_work_items; item_id uuid; person uuid; b jsonb; first boolean := true;
  previous uuid := nullif(plan->>'replace_from_block','')::uuid; use_slack boolean := coalesce((plan->>'use_slack')::boolean, false);
  mode text := plan->>'mode'; work integer := nullif(plan->>'work_minutes','')::integer; protection integer := coalesce(nullif(plan->>'protection_minutes','')::integer, 0);
  review date := nullif(plan->>'review_on','')::date; total integer; remaining integer; d date; p text; m integer;
  lim integer; reserved integer; over integer; used integer := 0; begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if mode is null or mode not in ('estimativa','faixa','indefinida') then raise exception 'Informe como a estimativa foi feita.'; end if;
  if mode <> 'indefinida' and work is null then raise exception 'Informe o trabalho previsto.'; end if;
  if mode = 'indefinida' then work := null; protection := 0; end if;
  select coalesce(sum((x->>'minutes')::integer),0), count(*) into total, m from jsonb_array_elements(coalesce(plan->'blocks','[]'::jsonb)) x;
  if m = 0 then raise exception 'A proposta não tem blocos.'; end if;
  remaining := case when mode = 'indefinida' then total else work + protection end;
  if total > remaining then raise exception 'Os blocos somam mais do que o trabalho a reservar.'; end if;
  if nullif(plan->>'item_id','') is not null then
    select * into item from public.maker_work_items where id = (plan->>'item_id')::uuid for update;
    if not found or item.status <> 'pending' then raise exception 'Etapa não encontrada ou já concluída.'; end if;
    item_id := item.id; person := coalesce(item.assignee_id, nullif(plan->>'assignee_id','')::uuid);
    -- As reservas anteriores ficam no histórico; as novas substituem.
    update public.maker_blocks set status='superseded' where work_item_id = item_id and status in ('planned','needs_reschedule');
    update public.maker_work_items set assignee_id = person, estimate_mode = mode, work_minutes = work, protection_minutes = protection, remaining_minutes = remaining, review_on = review where id = item_id;
  else
    person := nullif(plan->>'assignee_id','')::uuid;
    insert into public.maker_work_items(title, ticket_id, assignee_id, remaining_minutes, scope, estimate_mode, work_minutes, protection_minutes, review_on)
    values (plan->>'title', (plan->>'ticket_id')::uuid, person, remaining, coalesce(plan->>'scope','demanda'), mode, work, protection, review) returning id into item_id;
  end if;
  if person is null then raise exception 'Defina o responsável.'; end if;
  for b in select value from jsonb_array_elements(plan->'blocks') with ordinality order by ordinality loop
    d := (b->>'day')::date; p := b->>'period'; m := (b->>'minutes')::integer;
    lim := public.maker_slack_limit(person, d, p);
    if lim is not null then
      select coalesce(sum(minutes),0) into reserved from public.maker_blocks where user_id = person and day = d and period = p and status = 'planned';
      over := greatest(0, reserved + m - lim) - greatest(0, reserved - lim);
      if over > 0 and not use_slack then
        raise exception 'A proposta usaria % min da folga protegida em % (%). Recalcule ou confirme o uso da folga.', over, to_char(d,'DD/MM'), p;
      end if;
      used := used + over;
    end if;
    insert into public.maker_blocks(work_item_id, user_id, day, period, minutes, purpose, predecessor_id)
    values (item_id, person, d, p, m, coalesce(b->>'purpose','trabalho'), case when first then previous end);
    first := false;
  end loop;
  insert into public.maker_estimate_log(work_item_id, reason, mode, work_minutes, protection_minutes, low_minutes, high_minutes, review_on, note)
  values (item_id, case when item.id is null then 'inicial' else 'revisao' end, mode, work, protection,
    nullif(plan->>'low_minutes','')::integer, nullif(plan->>'high_minutes','')::integer, review, nullif(plan->>'note',''));
  if used > 0 then
    insert into public.maker_estimate_log(work_item_id, reason, note) values (item_id, 'folga', format('%s min da folga protegida usados, com confirmação.', used));
  end if;
  return item_id;
end $$;

-- Transforma a demanda inteira em etapas: o cartão é encerrado como transformado e as reservas
-- futuras passam para as etapas do mesmo responsável, sem duplicar horas. Blocos antigos ficam
-- no histórico. Reservas de hoje ou vencidas voltam para "A agendar".
create function public.maker_convert_to_steps(card_id uuid, steps jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare card public.maker_work_items; today date := (now() at time zone 'America/Sao_Paulo')::date; step jsonb; step_id uuid; person uuid;
  need integer; work integer; protection integer; take integer; i integer; total integer := 0; moved integer := 0;
  ids uuid[]; days date[]; periods text[]; owners uuid[]; purposes text[]; left_minutes integer[]; linked boolean[]; begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  select * into card from public.maker_work_items where id = card_id for update;
  if not found or card.scope <> 'demanda' or card.status <> 'pending' then raise exception 'Cartão de demanda inteira não encontrado ou já encerrado.'; end if;
  if jsonb_array_length(coalesce(steps,'[]'::jsonb)) < 1 then raise exception 'Informe pelo menos uma etapa.'; end if;
  select array_agg(id order by day, period, created_at), array_agg(day order by day, period, created_at), array_agg(period order by day, period, created_at),
    array_agg(user_id order by day, period, created_at), array_agg(purpose order by day, period, created_at), array_agg(minutes order by day, period, created_at),
    array_agg(false order by day, period, created_at)
  into ids, days, periods, owners, purposes, left_minutes, linked
  from public.maker_blocks where work_item_id = card_id and status = 'planned' and day > today;
  update public.maker_blocks set status='superseded' where work_item_id = card_id and status in ('planned','needs_reschedule');
  update public.maker_work_items set status='completed', converted_at = now(), remaining_minutes = null where id = card_id;
  for step in select value from jsonb_array_elements(steps) with ordinality order by ordinality loop
    work := (step->>'work_minutes')::integer; protection := coalesce(nullif(step->>'protection_minutes','')::integer, 0);
    if work is null or work <= 0 or length(trim(coalesce(step->>'title',''))) = 0 then raise exception 'Cada etapa precisa de nome e de horas de trabalho.'; end if;
    person := coalesce(nullif(step->>'assignee_id','')::uuid, card.assignee_id); need := work + protection; total := total + need;
    insert into public.maker_work_items(title, ticket_id, assignee_id, remaining_minutes, scope, estimate_mode, work_minutes, protection_minutes)
    values (trim(step->>'title'), card.ticket_id, person, need, 'etapa', 'estimativa', work, protection) returning id into step_id;
    for i in 1..coalesce(array_length(ids,1),0) loop
      exit when need = 0;
      if left_minutes[i] > 0 and owners[i] = person then
        take := least(need, left_minutes[i]);
        insert into public.maker_blocks(work_item_id, user_id, day, period, minutes, purpose, predecessor_id)
        values (step_id, person, days[i], periods[i], take, purposes[i], case when not linked[i] then ids[i] end);
        linked[i] := true; left_minutes[i] := left_minutes[i] - take; need := need - take; moved := moved + take;
      end if;
    end loop;
    insert into public.maker_estimate_log(work_item_id, reason, mode, work_minutes, protection_minutes, note)
    values (step_id, 'inicial', 'estimativa', work, protection, 'Criada ao transformar a demanda inteira em etapas.');
  end loop;
  insert into public.maker_estimate_log(work_item_id, reason, mode, work_minutes, protection_minutes, note)
  values (card_id, 'transformacao', card.estimate_mode, card.work_minutes, card.protection_minutes,
    format('Transformada em %s etapas somando %s min (antes: %s min a reservar). %s min de reservas futuras repassados.',
      jsonb_array_length(steps), total, coalesce(card.remaining_minutes, 0), moved));
end $$;

revoke all on function public.maker_accept_plan(jsonb), public.maker_convert_to_steps(uuid, jsonb) from public, anon;
grant execute on function public.maker_accept_plan(jsonb), public.maker_convert_to_steps(uuid, jsonb) to authenticated;
revoke all on function public.maker_period_capacity(uuid, date, text, time), public.maker_slack_limit(uuid, date, text) from public, anon;
grant execute on function public.maker_period_capacity(uuid, date, text, time), public.maker_slack_limit(uuid, date, text) to authenticated;
commit;
