-- Registra QUANDO a demanda passou para "entregue" (necessário para o Dashboard:
-- entregas por período e pontualidade). Execute no SQL Editor do Supabase.
--
-- Migração aditiva: cria uma coluna e um gatilho. Não altera status, prazos nem
-- campos financeiros. Demandas entregues ANTES desta migração ficam com
-- entregue_em nulo de propósito: não existe registro confiável da data delas
-- (updated_at não é mantido e não deve ser usado), e o Dashboard as mostra à parte.
begin;

alter table public.tickets
add column if not exists entregue_em timestamptz;

comment on column public.tickets.entregue_em is 'Momento em que o status passou para entregue. Nulo = não entregue ou entregue antes do registro existir.';

create or replace function public.tickets_registrar_entrega()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'entregue' then
    if tg_op = 'INSERT' or old.status is distinct from 'entregue' then
      new.entregue_em := coalesce(new.entregue_em, now());
    end if;
  else
    -- Demanda reaberta: a entrega anterior deixa de valer.
    new.entregue_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_registrar_entrega_trigger on public.tickets;
create trigger tickets_registrar_entrega_trigger
  before insert or update of status on public.tickets
  for each row
  execute function public.tickets_registrar_entrega();

commit;
