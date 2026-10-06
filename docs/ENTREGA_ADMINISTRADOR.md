# Entrega para o administrador do sistema

Branch `feat/planejamento-equipe-eventos`, baseada em `dd9e4c2` (o `main` atual de `emanuelstefaness/Espa-oMaker`). Sem conflito com o `main`.

Nada foi executado em produção: nenhuma migração, nenhum deploy, nenhum merge. Tudo abaixo foi verificado em testes simulados e em um Supabase de homologação separado, só com dados fictícios.

## 1. Resumo das mudanças

| Área | O que muda |
|---|---|
| Menu | Reorganizado em Principal, Operações, Gestão e Financeiro. Agenda antiga redireciona para Planejamento; WhatsApp para Todas as demandas. Estoque e Prefeitura deixam de ter rotas; tabelas e registros continuam no banco. |
| Planejamento de equipe (novo) | Agenda semanal por pessoa, manhã/tarde, com arrastar e soltar. Etapas com estimativa, reservas em blocos, horas livres por período, remanejamento com histórico, bloco não concluído em vermelho, conclusão de etapa sem concluir a demanda. |
| Planejamento assistido (novo) | "Planejar demanda inteira" em um único cartão, por estimativa, faixa ou "não sei ainda"; proposta de blocos com conclusão prevista e comparação com o prazo; trabalho e proteção separados; histórico de estimativas; folga protegida por pessoa; feriados e ausências; transformação em etapas. Nada é gravado antes do aceite. |
| Aulas e eventos (novo) | Cadastro direto, sem triagem, com participantes, 1 a 52 ocorrências semanais e etapas de preparação. Ocupam a agenda dos participantes. |
| Dashboard | Refeito: cards, entregas por semana/mês, pontualidade, em aberto por etapa, demandas por responsável, capacidade da equipe e alertas do planejamento. Fila ativa e alertas rápidos mantidos. |
| Relatórios | Agrupados em um menu. Cálculos, filtros e exportações inalterados. |
| Calculadora, orçamentos, regras financeiras | Sem alteração. |

Mudança em código existente de dados: `listTickets` passa a ordenar também por `id`, para a paginação ser estável. O Dashboard deixa de limitar a 200 demandas.

O bundle principal cresce de ~704 kB para ~1.089 kB porque o Dashboard usa `recharts`, que já era dependência do projeto e não era usada.

Detalhes de comportamento: `docs/PLANEJAMENTO_EQUIPE.md`.

### Ponto que exige decisão: data de entrega

O sistema hoje **não registra quando uma demanda é entregue**: não existe coluna para isso, o app não grava `ticket_logs` e `updated_at` não é mantido. A segunda migração cria `tickets.entregue_em`, preenchida por gatilho quando o status passa para `entregue`.

Consequências:

- Demandas já entregues ficam sem data. O Dashboard as mostra separadas e não as inclui em entregas por período nem em pontualidade.
- A pontualidade passa a existir a partir do dia em que a migração for aplicada.
- A comparação usa o prazo atualmente cadastrado, porque não há histórico de alterações de prazo.

## 2. Evidências dos testes

| Teste | Onde roda | Resultado |
|---|---|---|
| `npm test` | Regras em memória e as três migrações em PostgreSQL embarcado (PGlite) | 40 de 40 |
| `npm run build` | Local | ok, só o aviso de tamanho de bundle |
| ESLint dos arquivos alterados | Local | ok. O lint geral do repositório mantém falhas anteriores, fora do escopo |
| `node tests/ui-smoke.cjs` | Chromium com Supabase simulado | ok, desktop e largura de celular |
| `npm run test:homolog` | Chromium contra Supabase de homologação real | 17 de 17 |
| Roteiro manual | Homologação, pelo solicitante | Login, horários, bloco vencido, duas atividades no período, capacidade excedida, continuar depois, arraste, remanejamento |

O que o teste em banco real confirmou: reserva parcial, vários blocos no período, recusas do próprio banco (capacidade, evento, outro responsável, passado), conflito entre duas sessões sem mover o bloco, remanejamento com histórico, conclusão de etapa sem alterar a demanda, aula criada pela tela com ocorrências e sem gerar demanda, bloco vencido, e os números do Dashboard comparados com contagens feitas direto no banco.

Esse teste encontrou um defeito que o simulado não pegava (aula terminando ao meio-dia aparecia também na tarde, porque o banco devolve horas com segundos). Corrigido em `8243fd7`.

Não verificado:

- Arraste por toque em celular real. No celular o caminho é tocar no cartão e usar "Mover para outro período".
- Duas pessoas reais usando ao mesmo tempo; o conflito foi simulado com uma segunda chamada ao banco.
- Qualquer coisa no banco de produção, inclusive as consultas da seção 4.

## 3. Migrações novas e ordem

Somente estes três arquivos vão para produção, nesta ordem:

| Ordem | Arquivo | O que faz | Reexecutável |
|---|---|---|---|
| 1 | `supabase/migration-maker-planning.sql` | Cria 4 tabelas `maker_*`, 9 funções e 5 gatilhos (um deles em `ticket_tasks`). RLS restrita a `authenticated` presentes em `app_users`; `anon` sem acesso. | Não. É uma transação: se falhar, nada é aplicado; se passar, uma segunda execução falha com "already exists". |
| 2 | `supabase/migration-ticket-entregue-em.sql` | Cria `tickets.entregue_em`, a função `tickets_registrar_entrega` e um gatilho em `tickets`. | Sim. |
| 3 | `supabase/migration-maker-assisted-planning.sql` | Planejamento assistido: 6 colunas em `maker_work_items`, 1 em `maker_blocks`, 3 tabelas (`maker_estimate_log`, `maker_person_settings`, `maker_time_off`), 5 funções e 1 gatilho. Recria `maker_check_block` para descontar feriados e ausências; a regra de capacidade é a mesma. | Não. É uma transação. |

As três são aditivas: não apagam nem alteram demandas, tarefas, prazos ou campos financeiros. A 3 depende da 1; a 2 é independente. **A 1 e a 2 devem estar aplicadas antes de publicar o frontend.** A 3 pode vir depois: sem ela o frontend funciona e apenas oculta o planejamento assistido (verificado na homologação).

A migração 3 só mexe em objetos do próprio módulo de planejamento. A única coisa já existente que ela altera é a função `maker_check_block`, criada pela migração 1.

Por serem aditivas, o frontend atual deve continuar funcionando depois delas, o que permite aplicá-las com antecedência. Isso não foi testado com o frontend atual: a homologação usou o frontend novo. O passo 5 da seção 5.2 existe para conferir.

**Não usar em produção:** a sequência de montagem de banco novo e `tests/homolog/dados-ficticios.sql`, descritos em `docs/HOMOLOGACAO.md`. Servem só para criar um banco de teste. O script de dados fictícios se recusa a rodar em um banco que tenha demandas.

## 4. Consultas para conferir o banco existente

Todas são somente leitura. Rodar no SQL Editor do projeto de produção **antes** das migrações e guardar o resultado. As consultas e os comandos de recuperação deste documento foram executados em um banco em memória montado com os scripts do repositório, não em produção.

**4.1 Versão do PostgreSQL.** A migração 1 usa `range_agg`, que exige a versão 14 ou superior.

```sql
select current_setting('server_version') as versao,
       current_setting('server_version_num')::int >= 140000 as atende;
```

**4.2 Tabelas e colunas de que as migrações dependem.** Esperado: 13 linhas, com os tipos indicados.

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (table_name, column_name) in (
    ('app_users', 'id'),               -- uuid
    ('tickets', 'id'),                 -- uuid
    ('tickets', 'status'),             -- text
    ('tickets', 'data_entrega'),       -- date
    ('tickets', 'responsavel_id'),     -- uuid
    ('tickets', 'excluida_em'),        -- timestamp with time zone
    ('ticket_tasks', 'id'),            -- bigint
    ('ticket_tasks', 'ticket_id'),     -- uuid
    ('ticket_tasks', 'titulo'),        -- text
    ('ticket_tasks', 'responsavel_id'),-- uuid
    ('ticket_tasks', 'status'),        -- text
    ('app_users', 'name'),             -- text
    ('app_users', 'can_access_feed')   -- boolean
  )
order by 1, 2;
```

**4.3 Nada com os nomes novos já existe.** Esperado: zero em todas as colunas.

```sql
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'maker\_%') as tabelas_maker,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'maker\_%' or p.proname = 'tickets_registrar_entrega')) as funcoes,
  (select count(*) from pg_trigger where not tgisinternal and (tgname like 'maker\_%' or tgname = 'tickets_registrar_entrega_trigger')) as gatilhos,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tickets' and column_name = 'entregue_em') as coluna_entregue_em;
```

**4.4 Valores de status em uso.** As funções novas dependem de `concluido` em `ticket_tasks` e de `entregue` em `tickets`.

```sql
select 'ticket_tasks' as tabela, status, count(*) from public.ticket_tasks group by 2
union all
select 'tickets', status, count(*) from public.tickets group by 2
order by 1, 2;
```

A linha `tickets / entregue` é a quantidade de entregas que ficarão **sem data registrada**.

**4.5 Gatilhos já existentes nas tabelas que recebem gatilhos novos.**

```sql
select c.relname as tabela, t.tgname as gatilho, p.proname as funcao, t.tgenabled as estado
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal and c.relnamespace = 'public'::regnamespace and c.relname in ('tickets', 'ticket_tasks')
order by 1, 2;
```

O repositório só prevê `tickets_block_executor_assign_trigger` em `tickets`. Qualquer outro foi criado à mão e precisa ser avaliado.

**4.6 Políticas de acesso.** O Planejamento precisa que todos os membros leiam `app_users`.

```sql
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public' and tablename in ('app_users', 'tickets', 'ticket_tasks')
order by 1, 2;
```

Conferir que existe `app_users_select_executor` (de `fix-executor-ver-responsavel.sql`). Sem ela, um executor só enxerga a si mesmo e a agenda aparece com uma pessoa só. Políticas que não estão no repositório indicam ajustes manuais.

**4.7 Papéis em uso e membros da equipe.**

```sql
select role, count(*) from public.app_users group by 1 order by 1;
```

Só quem está em `app_users` acessa o Planejamento. Nenhum script do repositório dá ao papel `admin` permissão de editar demandas; se ele é usado em produção, essa permissão foi criada à mão.

**4.8 Permissões automáticas para tabelas novas.** A migração 1 concede as permissões das tabelas `maker_*` explicitamente; esta consulta confirma as que ela pressupõe.

```sql
select has_table_privilege('authenticated', 'public.tickets', 'select')       as tickets,
       has_table_privilege('authenticated', 'public.ticket_tasks', 'update')  as ticket_tasks,
       has_table_privilege('authenticated', 'public.app_users', 'select')     as app_users;
-- esperado: true, true, true
```

## 5. Backup, publicação e recuperação

### 5.1 Antes

1. **Backup do banco.** Confirmar no painel do Supabase (Database → Backups) se o plano tem backup automático e de quando é o último. Independentemente disso, gerar um dump lógico com a cadeia de conexão do projeto, guardado fora do repositório:

   ```
   pg_dump "<cadeia de conexão de produção>" --schema=public --no-owner --no-privileges -f backup-antes-planejamento.sql
   ```

   Conferir que o arquivo contém `CREATE TABLE public.tickets` e linhas de dados.

2. **Deploy atual.** Anotar na Vercel o identificador do deploy de produção em uso, para poder voltar a ele.
3. **Consultas da seção 4** executadas e guardadas.
4. **Homologação.** Se possível, um preview da branch apontando para um Supabase de teste, nunca para o de produção.

### 5.2 Publicação

1. Rodar `supabase/migration-maker-planning.sql` uma vez. Esperado: sucesso sem linhas.
2. Conferir:

   ```sql
   select
     (select count(*) from information_schema.tables where table_schema = 'public' and table_name like 'maker\_%') as tabelas,
     (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'maker\_%') as funcoes,
     (select count(*) from pg_trigger where not tgisinternal and tgname like 'maker\_%') as gatilhos,
     has_table_privilege('authenticated', 'public.maker_blocks', 'select') as authenticated_le,
     has_table_privilege('anon', 'public.maker_blocks', 'select') as anon_le,
     has_function_privilege('anon', 'public.maker_complete_item(uuid,uuid)', 'execute') as anon_executa;
   -- esperado: 4, 9, 5, true, false, false
   ```

3. Rodar `supabase/migration-ticket-entregue-em.sql`. Conferir:

   ```sql
   select
     (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'tickets' and column_name = 'entregue_em') as coluna,
     (select count(*) from pg_trigger where tgname = 'tickets_registrar_entrega_trigger') as gatilho,
     (select count(*) from public.tickets where entregue_em is not null) as datas_preenchidas;
   -- esperado: 1, 1, 0
   ```

4. Rodar `supabase/migration-maker-assisted-planning.sql` uma vez. Conferir:

   ```sql
   select
     (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'maker_work_items'
       and column_name in ('scope','estimate_mode','work_minutes','protection_minutes','review_on','converted_at')) as colunas_etapa,
     (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'maker_blocks' and column_name = 'purpose') as coluna_bloco,
     (select count(*) from information_schema.tables where table_schema = 'public'
       and table_name in ('maker_estimate_log','maker_person_settings','maker_time_off')) as tabelas,
     (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('maker_accept_plan','maker_convert_to_steps','maker_period_capacity','maker_slack_limit','maker_guard_scope')) as funcoes,
     has_table_privilege('authenticated', 'public.maker_estimate_log', 'update') as historico_editavel,
     has_function_privilege('anon', 'public.maker_accept_plan(jsonb)', 'execute') as anon_executa;
   -- esperado: 6, 1, 3, 5, false, false
   ```

5. Com o frontend **atual** ainda no ar, abrir o site e conferir que listar demandas, mudar um status e concluir uma tarefa continuam funcionando. As migrações acrescentam gatilhos em `tickets` e `ticket_tasks`; este é o momento de notar qualquer efeito inesperado.
6. Publicar o frontend (merge no `main` do repositório ligado à Vercel).
7. Conferir em produção, com um usuário da equipe: Dashboard abre sem o aviso de data de entrega; Planejamento abre sem o aviso de módulo não instalado e mostra toda a equipe; Aulas e eventos abre; os três relatórios abrem e os valores financeiros são os mesmos de antes.
8. Se o Planejamento mostrar erro de "schema cache", recarregar o cache da API: `notify pgrst, 'reload schema';`

### 5.3 Depois

- Configurar os horários reais de cada pessoa em "Horários da equipe" e cadastrar aulas e reuniões fixas. Nada disso é gravado automaticamente.
- Estimar as etapas das demandas em aberto. O sistema não deduz esforço a partir dos cronômetros.

### 5.4 Recuperação

**Problema no frontend novo:** voltar ao deploy anterior na Vercel (Promote/Rollback do deploy anotado em 5.1). As migrações podem ficar: são aditivas e o frontend antigo as ignora.

**Problema causado por um gatilho novo** (por exemplo, erro ao mudar status ou concluir tarefa com o frontend antigo): desligar só o gatilho envolvido, sem perder dados.

```sql
-- gatilho da data de entrega
alter table public.tickets disable trigger tickets_registrar_entrega_trigger;
-- gatilho que sincroniza tarefas com o planejamento
alter table public.ticket_tasks disable trigger maker_existing_task_sync;
```

**Remover só o planejamento assistido** (migração 3), mantendo o restante. Apaga estimativas detalhadas, histórico, folgas configuradas, feriados e ausências; os cartões e blocos continuam existindo como etapas comuns. Exportar antes.

```sql
begin;
drop trigger if exists maker_item_scope on public.maker_work_items;
drop function if exists public.maker_guard_scope(), public.maker_accept_plan(jsonb), public.maker_convert_to_steps(uuid, jsonb);
-- maker_check_block volta à definição da migração 1 (sem feriados e ausências)
create or replace function public.maker_check_block() returns trigger language plpgsql security invoker set search_path = '' as $$
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
drop function if exists public.maker_slack_limit(uuid, date, text), public.maker_period_capacity(uuid, date, text, time);
drop table if exists public.maker_estimate_log, public.maker_person_settings, public.maker_time_off;
drop index if exists public.maker_one_whole_card_per_ticket;
alter table public.maker_blocks drop column if exists purpose;
alter table public.maker_work_items drop constraint if exists maker_whole_ticket_shape,
  drop column if exists scope, drop column if exists estimate_mode, drop column if exists work_minutes,
  drop column if exists protection_minutes, drop column if exists review_on, drop column if exists converted_at;
commit;
```

**Remoção completa**, só se for decidido abandonar a funcionalidade. Se a migração 3 foi aplicada, rodar antes o bloco acima. Apaga todo o planejamento, eventos e datas de entrega registradas; exportar antes.

```sql
begin;
drop trigger if exists maker_existing_task_sync on public.ticket_tasks;
drop table if exists public.maker_blocks, public.maker_availability, public.maker_work_items, public.maker_events cascade;
drop function if exists public.maker_validate_item(), public.maker_validate_event(), public.maker_check_block(),
  public.maker_sync_task(), public.maker_cancel_event_blocks(),
  public.maker_create_event(jsonb, jsonb, integer), public.maker_complete_item(uuid, uuid),
  public.maker_continue_block(uuid, integer, date, text, integer), public.maker_save_availability(uuid, jsonb);
drop trigger if exists tickets_registrar_entrega_trigger on public.tickets;
drop function if exists public.tickets_registrar_entrega();
alter table public.tickets drop column if exists entregue_em;
commit;
```

**Perda de dados existentes:** as migrações não alteram dados existentes; se ainda assim algo for perdido, restaurar a partir do backup de 5.1.

## 6. O que precisa ser confirmado

### Com o administrador do repositório `emanuelstefaness/Espa-oMaker`

- Como a mudança deve chegar: PR a partir do fork `Felipekicula/Espa-oMaker`, ou outro caminho.
- Quem revisa e quem faz o merge; se há proteção no `main`.
- Se há trabalho em andamento no `main` além de `dd9e4c2`.
- Se concorda em tirar as rotas de Estoque e Prefeitura e em redirecionar Agenda e WhatsApp.
- Se aceita `recharts` no bundle e os dois testes opcionais que precisam de Playwright.

### Com o administrador da Vercel

- Existem dois projetos publicando produção a partir do `main` (`espa-o-maker` e `espa-o-maker-v1jy`). Qual é o oficial e o que acontece com o outro.
- Se os dois têm o cron de `/api/resumo-semanal` ativo; nesse caso o e-mail semanal pode estar saindo em dobro.
- Se um merge no `main` publica em produção automaticamente, e como segurar a publicação até as migrações estarem aplicadas.
- Para qual banco apontam as variáveis do ambiente **Preview**. Se for o de produção, um preview desta branch gravaria em produção.
- Se PRs de forks geram preview e quem pode fazer rollback.

### Com o administrador do Supabase

- Quem tem acesso de dono ao projeto e quem executará as migrações.
- Plano contratado: se há backup automático, com que retenção, e se há recuperação pontual.
- Versão do PostgreSQL (consulta 4.1).
- Quais scripts da pasta `supabase/` foram de fato aplicados e se houve ajustes pelo painel (consultas 4.5 e 4.6).
- Se o papel `admin` é usado e com quais permissões (consulta 4.7).
- Se todos os membros da equipe estão em `app_users`.
- Se aceita que as entregas anteriores fiquem sem data, ou se existe outra fonte confiável para preenchê-las. Não usar `updated_at`.
- Se existe ou pode existir um projeto de homologação permanente.

## 7. Observações fora do escopo

Encontradas durante o trabalho e não alteradas:

- `tickets.codigo` é calculado a partir de `data_criacao`, que é uma data sem hora. Demandas criadas no mesmo dia recebem o mesmo código.
- `supabase/` não tem um histórico ordenado de migrações; a ordem para um banco novo foi reconstruída em `docs/HOMOLOGACAO.md`.
