-- Additive migration. Apply after schema.sql and migration-ticket-tasks.sql.
-- No tickets, financial fields or existing tasks are deleted or migrated.
begin;
create table public.maker_events (
  id uuid primary key default gen_random_uuid(), title text not null check (length(trim(title)) > 0),
  kind text not null check (kind in ('aula','workshop','reuniao')),
  day date not null, starts_at time not null, ends_at time not null,
  location text, participant_ids uuid[] not null check (cardinality(participant_ids) > 0),
  preparation_deadline date, series_id uuid,
  status text not null default 'confirmed' check (status in ('confirmed','cancelled','completed')),
  created_by uuid not null default auth.uid() references public.app_users(id),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at), check (preparation_deadline is null or preparation_deadline <= day)
);
create table public.maker_work_items (
  id uuid primary key default gen_random_uuid(), title text not null check (length(trim(title)) > 0),
  ticket_id uuid references public.tickets(id), event_id uuid references public.maker_events(id),
  ticket_task_id bigint unique references public.ticket_tasks(id) on delete set null,
  assignee_id uuid references public.app_users(id), remaining_minutes integer check (remaining_minutes > 0),
  due_date date, status text not null default 'pending' check (status in ('pending','completed')),
  created_by uuid not null default auth.uid() references public.app_users(id), created_at timestamptz not null default now(),
  check ((ticket_id is not null)::integer + (event_id is not null)::integer = 1),
  check (ticket_task_id is null or ticket_id is not null)
);
create table public.maker_availability (
  user_id uuid not null references public.app_users(id), weekday integer not null check (weekday between 1 and 5),
  period text not null check (period in ('manha','tarde')), starts_at time not null, ends_at time not null,
  primary key (user_id, weekday, period), check (ends_at >= starts_at),
  check ((period = 'manha' and ends_at <= '12:00') or (period = 'tarde' and starts_at >= '12:00'))
);
create table public.maker_blocks (
  id uuid primary key default gen_random_uuid(), work_item_id uuid not null references public.maker_work_items(id),
  user_id uuid not null references public.app_users(id), day date not null,
  period text not null check (period in ('manha','tarde')), minutes integer not null check (minutes > 0 and minutes <= 720),
  status text not null default 'planned' check (status in ('planned','done','needs_reschedule','superseded','cancelled')),
  predecessor_id uuid unique references public.maker_blocks(id),
  created_by uuid not null default auth.uid() references public.app_users(id), created_at timestamptz not null default now(),
  check (extract(isodow from day) between 1 and 5)
);
create index maker_events_day_idx on public.maker_events(day);
create index maker_blocks_user_day_idx on public.maker_blocks(user_id,day);
create index maker_work_items_ticket_idx on public.maker_work_items(ticket_id);
create index maker_work_items_event_idx on public.maker_work_items(event_id);

-- Same shared-team model as ticket tasks, but anonymous access is not granted.
do $$ declare t text; begin
  foreach t in array array['maker_events','maker_work_items','maker_availability','maker_blocks'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy team_access on public.%I for all to authenticated using (exists (select 1 from public.app_users where id = auth.uid())) with check (exists (select 1 from public.app_users where id = auth.uid()))',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('revoke all on public.%I from anon',t);
  end loop;
end $$;

create function public.maker_validate_item() returns trigger language plpgsql security invoker set search_path = '' as $$
declare source public.ticket_tasks; begin
  if new.ticket_task_id is not null then
    select * into source from public.ticket_tasks where id = new.ticket_task_id;
    if source.ticket_id is distinct from new.ticket_id then raise exception 'A tarefa não pertence à demanda selecionada.'; end if;
    new.assignee_id := source.responsavel_id;
    new.title := source.titulo;
  end if;
  return new;
end $$;
create trigger maker_item_source before insert or update on public.maker_work_items for each row execute function public.maker_validate_item();

-- Serialize changes to each participant calendar before checking overlapping events.
create function public.maker_validate_event() returns trigger language plpgsql security invoker set search_path = '' as $$
declare person uuid; begin
  for person in select distinct unnest(new.participant_ids) order by 1 loop
    if not exists(select 1 from public.app_users where id = person) then raise exception 'Participante inválido.'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(person::text, 0));
  end loop;
  if new.status = 'confirmed' and exists(
    select 1 from public.maker_events e where e.id <> new.id and e.status = 'confirmed' and e.day = new.day
    and e.participant_ids && new.participant_ids and e.starts_at < new.ends_at and e.ends_at > new.starts_at
  ) then raise exception 'Existe outro evento nesse horário para um dos participantes.'; end if;
  return new;
end $$;
create trigger maker_event_calendar before insert or update on public.maker_events for each row execute function public.maker_validate_event();

-- Atomic event + occurrences + preparation. Every occurrence is independent.
create function public.maker_create_event(payload jsonb, preparations jsonb, occurrences integer default 1)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare result uuid; event_id uuid; series uuid; i integer; step jsonb; participants uuid[]; first_day date; prep_day date; begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  if occurrences < 1 or occurrences > 52 then raise exception 'Escolha entre 1 e 52 ocorrências.'; end if;
  select array_agg(value::uuid) into participants from jsonb_array_elements_text(payload->'participant_ids');
  first_day := (payload->>'day')::date; prep_day := nullif(payload->>'preparation_deadline','')::date;
  if occurrences > 1 then series := gen_random_uuid(); end if;
  for i in 0..occurrences-1 loop
    insert into public.maker_events(title,kind,day,starts_at,ends_at,location,participant_ids,preparation_deadline,series_id)
    values(payload->>'title',payload->>'kind',first_day+7*i,(payload->>'starts_at')::time,(payload->>'ends_at')::time,
      nullif(payload->>'location',''),participants,prep_day+7*i,series) returning id into event_id;
    if i=0 then result:=event_id; end if;
    for step in select value from jsonb_array_elements(preparations) loop
      insert into public.maker_work_items(title,event_id,assignee_id,remaining_minutes)
      values(step->>'title',event_id,nullif(step->>'assignee_id','')::uuid,nullif(step->>'remaining_minutes','')::integer);
    end loop;
  end loop;
  return result;
end $$;

-- Block check uses configured working hours, union of events, and existing reservations.
create function public.maker_check_block() returns trigger language plpgsql security invoker set search_path = '' as $$
declare slot public.maker_availability; capacity numeric; busy numeric; reserved numeric; item public.maker_work_items; begin
  if new.status <> 'planned' then return new; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text,0));
  select * into item from public.maker_work_items where id=new.work_item_id for update;
  if item.status='completed' then raise exception 'Etapa já concluída.'; end if;
  if item.assignee_id is distinct from new.user_id then raise exception 'O bloco deve pertencer ao responsável da etapa.'; end if;
  if new.day < (now() at time zone 'America/Sao_Paulo')::date then raise exception 'Não reserve trabalho no passado.'; end if;
  select * into slot from public.maker_availability where user_id=new.user_id and weekday=extract(isodow from new.day) and period=new.period;
  if not found then return new; end if; -- Unknown availability remains explicitly unknown in UI.
  if new.day = (now() at time zone 'America/Sao_Paulo')::date then
    slot.starts_at := least(slot.ends_at,greatest(slot.starts_at,(now() at time zone 'America/Sao_Paulo')::time));
  end if;
  capacity := extract(epoch from(slot.ends_at-slot.starts_at))/60;
  select coalesce(sum(extract(epoch from(upper(r)-lower(r)))/60),0) into busy from (
    select unnest(range_agg(tsrange(new.day+greatest(e.starts_at,slot.starts_at),new.day+least(e.ends_at,slot.ends_at),'[)'))) r
    from public.maker_events e where e.status='confirmed' and e.day=new.day and new.user_id=any(e.participant_ids)
    and e.starts_at<slot.ends_at and e.ends_at>slot.starts_at
  ) ranges;
  select coalesce(sum(minutes),0) into reserved from public.maker_blocks where user_id=new.user_id and day=new.day and period=new.period and status='planned' and id<>new.id;
  if new.minutes+reserved > capacity-busy then raise exception 'O trabalho excede o tempo disponível neste período.'; end if;
  return new;
end $$;
create trigger maker_block_capacity before insert or update on public.maker_blocks for each row execute function public.maker_check_block();

create function public.maker_complete_item(item_id uuid, block_id uuid default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare item public.maker_work_items; begin
  select * into item from public.maker_work_items where id=item_id for update;
  if not found then raise exception 'Etapa não encontrada.'; end if;
  if block_id is not null and not exists(select 1 from public.maker_blocks where id=block_id and work_item_id=item_id and status in ('planned','needs_reschedule')) then raise exception 'Bloco já alterado. Atualize a tela.'; end if;
  update public.maker_work_items set status='completed',remaining_minutes=null where id=item_id;
  update public.maker_blocks set status=case when id=block_id then 'done' else 'cancelled' end where work_item_id=item_id and status in ('planned','needs_reschedule');
  if item.ticket_task_id is not null then update public.ticket_tasks set status='concluido' where id=item.ticket_task_id; end if;
end $$;

-- "Continue later" always retains a visible pending block until rescheduled.
create function public.maker_continue_block(block_id uuid, remaining integer, new_day date default null, new_period text default null, new_minutes integer default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare old public.maker_blocks; item public.maker_work_items; begin
  if remaining is null or remaining <= 0 then raise exception 'Informe o trabalho restante.'; end if;
  select * into old from public.maker_blocks where id=block_id for update;
  if not found or old.status not in ('planned','needs_reschedule') then raise exception 'Bloco já alterado. Atualize a tela.'; end if;
  select * into item from public.maker_work_items where id=old.work_item_id for update;
  if item.status='completed' then raise exception 'Etapa já concluída.'; end if;
  update public.maker_work_items set remaining_minutes=remaining where id=old.work_item_id;
  update public.maker_blocks set status=case when new_day is null then 'needs_reschedule' else 'superseded' end where id=block_id;
  if new_day is not null then
    if new_period is null or new_minutes is null or new_minutes>remaining then raise exception 'Confira o período e a duração.'; end if;
    insert into public.maker_blocks(work_item_id,user_id,day,period,minutes,predecessor_id)
    values(old.work_item_id,old.user_id,new_day,new_period,new_minutes,old.id);
  end if;
end $$;

revoke all on function public.maker_create_event(jsonb,jsonb,integer), public.maker_complete_item(uuid,uuid), public.maker_continue_block(uuid,integer,date,text,integer) from public,anon;
grant execute on function public.maker_create_event(jsonb,jsonb,integer), public.maker_complete_item(uuid,uuid), public.maker_continue_block(uuid,integer,date,text,integer) to authenticated;
create function public.maker_save_availability(person_id uuid, slots jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare slot jsonb; begin
  if auth.uid() is null then raise exception 'Faça login.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(person_id::text,0));
  delete from public.maker_availability where user_id=person_id;
  for slot in select value from jsonb_array_elements(slots) loop
    insert into public.maker_availability(user_id,weekday,period,starts_at,ends_at)
    values(person_id,(slot->>'weekday')::integer,slot->>'period',(slot->>'starts_at')::time,(slot->>'ends_at')::time);
  end loop;
end $$;
revoke all on function public.maker_save_availability(uuid,jsonb) from public,anon;
grant execute on function public.maker_save_availability(uuid,jsonb) to authenticated;
-- Existing task updates and event cancellation also release obsolete reservations.
create function public.maker_sync_task() returns trigger language plpgsql security invoker set search_path = '' as $$
declare item_id uuid; begin
  select id into item_id from public.maker_work_items where ticket_task_id=new.id;
  if item_id is null then return new; end if;
  if new.status='concluido' then
    update public.maker_work_items set status='completed',remaining_minutes=null where id=item_id;
    update public.maker_blocks set status='cancelled' where work_item_id=item_id and status in ('planned','needs_reschedule');
  elsif old.status='concluido' then
    update public.maker_work_items set status='pending',remaining_minutes=null where id=item_id;
  end if;
  if new.titulo is distinct from old.titulo then
    update public.maker_work_items set title=new.titulo where id=item_id;
  end if;
  if new.responsavel_id is distinct from old.responsavel_id then
    update public.maker_work_items set assignee_id=new.responsavel_id where id=item_id;
    update public.maker_blocks set user_id=new.responsavel_id,status='needs_reschedule' where work_item_id=item_id and status in ('planned','needs_reschedule');
  end if;
  return new;
end $$;
create trigger maker_existing_task_sync after update of status,responsavel_id,titulo on public.ticket_tasks for each row execute function public.maker_sync_task();
create function public.maker_cancel_event_blocks() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.status='cancelled' and old.status<>'cancelled' then
    update public.maker_blocks set status='cancelled' where work_item_id in (select id from public.maker_work_items where event_id=new.id) and status in ('planned','needs_reschedule');
  end if;
  return new;
end $$;
create trigger maker_event_cancel after update of status on public.maker_events for each row execute function public.maker_cancel_event_blocks();
commit;
