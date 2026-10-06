-- DADOS FICTICIOS PARA HOMOLOGACAO. Ver docs/HOMOLOGACAO.md.
-- Rodar UMA vez, somente em um projeto Supabase de homologacao, depois de schema.sql, das
-- migracoes, de migration-maker-planning.sql e de migration-ticket-entregue-em.sql.
--
-- Trava de seguranca: o script se recusa a rodar se o banco nao parecer a homologacao vazia
-- (precisa ter exatamente os usuarios ana.teste e bruno.teste, e nenhuma demanda).
-- Tudo roda em uma unica operacao: qualquer erro desfaz tudo. Nenhuma regra do banco e desligada.

do $$
declare
  ana uuid; bruno uuid;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  rover uuid;
  pessoa uuid; dia date; prazo date; g int; p text; wd int;
  categorias text[] := array['servicos_3d','reparos','engenharia','workshop','sublimacao','saude','servicos_gerais','outros'];
  prioridades text[] := array['baixa','media','alta','urgente'];
  abertos text[] := array['recebida','recebida','em_analise','orcamento_em_criacao','aguardando_aprovacao','aguardando_aprovacao',
                          'enviado_cliente','aprovado','em_producao','em_producao','pos_processo','pronta','pronta'];
begin
  -- ---------- verificacao do destino ----------
  select id into ana from auth.users where email = 'ana.teste@example.com';
  select id into bruno from auth.users where email = 'bruno.teste@example.com';
  if ana is null or bruno is null then
    raise exception 'DESTINO ERRADO: usuarios ana.teste/bruno.teste nao existem. Este script e so para a homologacao.';
  end if;
  if exists (select 1 from public.app_users where id not in (ana, bruno)) then
    raise exception 'DESTINO ERRADO: existem outros usuarios em app_users. Este script e so para a homologacao.';
  end if;
  if exists (select 1 from public.tickets) then
    raise exception 'Este banco ja tem demandas. O script so roda na homologacao vazia (e apenas uma vez).';
  end if;

  -- ---------- horarios: seg a sex, 08-12 e 13-17; Bruno indisponivel na sexta a tarde ----------
  foreach pessoa in array array[ana, bruno] loop
    for wd in 1..5 loop
      insert into public.maker_availability(user_id, weekday, period, starts_at, ends_at) values (pessoa, wd, 'manha', '08:00', '12:00');
      if pessoa = bruno and wd = 5 then
        insert into public.maker_availability(user_id, weekday, period, starts_at, ends_at) values (pessoa, wd, 'tarde', '12:00', '12:00');
      else
        insert into public.maker_availability(user_id, weekday, period, starts_at, ends_at) values (pessoa, wd, 'tarde', '13:00', '17:00');
      end if;
    end loop;
  end loop;

  -- ---------- demanda do roteiro: prazo em 6 dias, duas tarefas da Ana ----------
  insert into public.tickets(titulo, descricao, tipo, origem, solicitante_nome, categoria, prioridade, status, responsavel_id, data_criacao, data_entrega, created_by)
  values ('Rover de teste', 'Demanda ficticia para o roteiro de homologacao.', 'interna', 'interno', 'Cliente Ficticio', 'engenharia', 'alta', 'em_producao', ana, hoje - 3, hoje + 6, ana)
  returning id into rover;

  insert into public.ticket_tasks(ticket_id, titulo, responsavel_id, created_by, status)
  values (rover, 'Modelar suporte', ana, ana, 'pendente');
  insert into public.ticket_tasks(ticket_id, titulo, responsavel_id, created_by, status)
  values (rover, 'Imprimir e montar', ana, ana, 'pendente');

  -- Bloco vencido: o banco recusa reservas no passado, entao ele nao e criado aqui.
  -- Use `npm run test:homolog -- --preparar-vencido`, que monta um sem desligar nenhuma regra.

  -- ---------- demandas em aberto para os graficos ----------
  for g in 1..array_length(abertos, 1) loop
    pessoa := case when g % 2 = 0 then bruno else ana end;
    insert into public.tickets(titulo, tipo, origem, solicitante_nome, categoria, prioridade, status, responsavel_id, data_criacao, data_entrega, created_by)
    values ('Demanda ficticia ' || lpad(g::text, 2, '0'), case when g % 3 = 0 then 'externa' else 'interna' end, 'interno',
            'Cliente Ficticio ' || g, categorias[1 + g % 8], prioridades[1 + g % 4], abertos[g], pessoa, hoje - 20 - g, hoje + 3 + g, ana);
  end loop;
  -- atrasadas (prazo vencido), uma delas "pronta": pronta nao e entregue
  insert into public.tickets(titulo, tipo, origem, solicitante_nome, categoria, prioridade, status, responsavel_id, data_criacao, data_entrega, created_by) values
    ('Demanda ficticia atrasada A', 'externa', 'interno', 'Cliente Ficticio A', 'servicos_3d', 'alta',    'em_producao', ana,   hoje - 40, hoje - 2,  ana),
    ('Demanda ficticia atrasada B', 'interna', 'interno', 'Cliente Ficticio B', 'reparos',     'media',   'aprovado',    bruno, hoje - 45, hoje - 6,  ana),
    ('Demanda ficticia atrasada C', 'externa', 'interno', 'Cliente Ficticio C', 'sublimacao',  'urgente', 'pronta',      bruno, hoje - 50, hoje - 12, ana),
    ('Demanda ficticia sem prazo',  'interna', 'interno', 'Cliente Ficticio D', 'outros',      'baixa',   'recebida',    null,  hoje - 5,  null,      ana),
    ('Demanda ficticia cancelada 1','interna', 'interno', 'Cliente Ficticio E', 'workshop',    'baixa',   'cancelada',   ana,   hoje - 60, hoje - 30, ana),
    ('Demanda ficticia cancelada 2','externa', 'interno', 'Cliente Ficticio F', 'saude',       'media',   'cancelada',   bruno, hoje - 70, hoje - 35, ana);

  -- ---------- 40 entregas com data registrada, espalhadas por ~5 meses ----------
  -- 1 em cada 5 sem prazo; das demais, cerca de 1 em cada 4 fora do prazo.
  for g in 1..40 loop
    dia := hoje - (g * 4 + g % 3);
    prazo := case when g % 5 = 0 then null when g % 4 = 0 then dia - 2 - g % 3 else dia + g % 4 end;
    pessoa := case when g % 9 = 0 then null when g % 2 = 0 then bruno else ana end;
    insert into public.tickets(titulo, tipo, origem, solicitante_nome, categoria, prioridade, status, responsavel_id, data_criacao, data_entrega, created_by, entregue_em)
    values ('Entrega ficticia ' || lpad(g::text, 2, '0'), case when g % 2 = 0 then 'externa' else 'interna' end, 'interno',
            'Cliente Ficticio ' || (100 + g), categorias[1 + g % 8], prioridades[1 + g % 4], 'entregue', pessoa, dia - 10 - g % 6, prazo, ana,
            (dia + time '15:00') at time zone 'America/Sao_Paulo');
  end loop;

  -- ---------- 5 entregas "antigas", de antes de o sistema registrar a data ----------
  for g in 1..5 loop
    insert into public.tickets(titulo, tipo, origem, solicitante_nome, categoria, prioridade, status, responsavel_id, data_criacao, data_entrega, created_by)
    values ('Entrega antiga sem data ' || g, 'interna', 'interno', 'Cliente Ficticio ' || (200 + g), categorias[g], 'media', 'entregue',
            case when g % 2 = 0 then bruno else ana end, hoje - 300 - g, hoje - 280 - g, ana);
  end loop;
  update public.tickets set entregue_em = null where titulo like 'Entrega antiga sem data %';
end $$;

-- Conferencia (so leitura)
select
  (select count(*) from public.tickets) as demandas,
  (select count(*) from public.tickets where status not in ('entregue','cancelada')) as em_aberto,
  (select count(*) from public.tickets where status = 'entregue' and entregue_em is not null) as entregues_com_data,
  (select count(*) from public.tickets where status = 'entregue' and entregue_em is null) as entregues_sem_data,
  (select count(*) from public.maker_availability) as horarios;
-- Esperado: 65, 18, 40, 5, 20
