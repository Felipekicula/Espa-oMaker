# Homologação com Supabase separado

Como montar um banco de teste, rodar o app local contra ele e executar o teste opcional de ponta a ponta. Nada aqui usa dados ou credenciais de produção.

## 1. Banco de homologação

Crie um projeto Supabase novo, só para testes, e rode no SQL Editor, **uma vez e nesta ordem**:

| # | Script (`supabase/`) | Para quê |
|---|---|---|
| 1 | `schema.sql` | Tabelas principais, buckets e políticas |
| 2 | `fix-executor-ver-responsavel.sql` | Executor enxerga a equipe (o Planejamento precisa) |
| 3 | `fix-excluida-em.sql` | Coluna `excluida_em` |
| 4 | `migration-ticket-tasks.sql` | Tarefas das demandas |
| 5 | `migration-feed.sql` | Feed e bucket `feed-files` |
| 6 | `migration-feed-comments.sql` | Depende do 5 |
| 7 | `migration-feed-posts-update-delete.sql` | Depende do 5 |
| 8 | `migration-custo-tickets.sql` | Coluna `custo` |
| 9 | `migration-ticket-work-sessions.sql` | Cronômetros |
| 10 | `migration-ticket-files-delete.sql` | Excluir anexos |
| 11 | `migration-tipo-receita-contrapartida.sql` | Relatórios financeiros |
| 12 | `migration-orcamento-pago.sql` | Relatórios financeiros |
| 13 | `migration-pagamento-receita.sql` | Relatórios financeiros |
| 14 | `migration-pagamento-receita-pago.sql` | Relatórios financeiros |
| 15 | `migration-receita-recorrente.sql` | Relatórios financeiros |
| 16 | `migration-app-users-can-access-feed.sql` | Coluna `can_access_feed`, lida no login |
| 17 | `migration-estoque-prefeitura-calculadora.sql` | Tabelas da calculadora |
| 18 | `migration-registrado-por.sql` | Formulário público |
| 19 | `migration-maker-planning.sql` | Planejamento e eventos |
| 20 | `migration-ticket-entregue-em.sql` | Data de entrega (Dashboard) |

Não rode os demais scripts da pasta em um banco novo:

- `fix-origem-formulario.sql`, `fix-formulario-fotos.sql`, `fix-executor-pode-tudo.sql` e `fix-valor-dificuldade-avatar-realtime.sql` já estão contidos no `schema.sql` e falham por política duplicada.
- `fix-categoria-constraint.sql`, `migrate-categorias-materiais.sql`, `migration-status-enviado-cliente.sql`, `fix-feed-bucket.sql` e `ATUALIZAR_SUPABASE_TUDO.sql` são redundantes.
- `fix-triagem-policy.sql` recria uma política antiga, já substituída.
- `delete-tasks-felipe.sql`, `excluir-todas-canceladas.sql` e `script-limpar-horas-trabalhadas.sql` alteram dados, não estrutura.

`schema.sql` e os scripts 9, 10, 15 e 19 falham se executados duas vezes.

Os scripts antigos não têm `GRANT`: dependem da permissão automática do Supabase para tabelas novas. Confira depois de montar o banco:

```sql
select has_table_privilege('authenticated', 'public.tickets', 'select') as authenticated_le,
       has_table_privilege('anon', 'public.maker_blocks', 'select') as anon_le_planejamento;
-- esperado: true, false
```

## 2. Usuários e dados fictícios

1. Em **Authentication → Sign In / Providers → Email**, desligue "Confirm email".
2. Em **Authentication → Users**, crie `ana.teste@example.com` e `bruno.teste@example.com` com senhas inventadas para o teste, marcando "Auto Confirm User".
3. Registre-os no app:

```sql
insert into public.app_users (id, name, role, can_access_feed)
select id,
       case email when 'ana.teste@example.com' then 'Ana Teste' else 'Bruno Teste' end,
       case email when 'ana.teste@example.com' then 'felipe' else 'executor' end,
       true
from auth.users
where email in ('ana.teste@example.com', 'bruno.teste@example.com');
```

4. Rode `tests/homolog/dados-ficticios.sql`. Ele cria horários para os dois, uma demanda de roteiro e 64 demandas para os gráficos do Dashboard. O script se recusa a rodar se o banco tiver outros usuários ou alguma demanda, e não desliga nenhuma regra do banco. Resultado esperado: `65, 18, 40, 5, 20`.

## 3. App local

Crie `.env.local` na raiz (o arquivo é ignorado pelo Git):

```
VITE_SUPABASE_URL=https://<projeto-de-homologacao>.supabase.co
VITE_SUPABASE_ANON_KEY=<chave publishable ou anon do projeto de homologação>
HOMOLOG_EMAIL=ana.teste@example.com
HOMOLOG_SENHA=<senha fictícia>
```

- Use só a chave pública. Nunca a `secret`/`service_role`.
- `HOMOLOG_*` não têm o prefixo `VITE_`, então não entram no site; servem apenas ao teste abaixo.
- As variáveis de servidor do resumo semanal (`SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` etc.) não são necessárias.

`npm run dev` sobe o app em `http://localhost:5173`.

## 4. Teste opcional de ponta a ponta

Não faz parte de `npm test`. Precisa do Playwright (`npm install --no-save playwright` e `npx playwright install chromium`).

```
npm run test:homolog
```

Antes de qualquer gravação, o teste confere o destino e para se algo não bater:

1. o login é de um usuário fictício (`@example.com`);
2. a URL do `.env.local` é diferente da usada pelo site de produção;
3. todos os usuários do banco são fictícios (nome terminado em "Teste");
4. todas as demandas têm título de dado fictício.

O que ele faz:

- Entra pela tela de login e usa a agenda de outra pessoa (não a de quem fez login), em duas semanas livres a partir de três semanas à frente, para não mexer no que estiver sendo testado à mão.
- Grava apenas pelas mesmas operações da tela. Não desliga gatilhos nem políticas.
- Define horários padrão para essa pessoa durante o teste e restaura os originais ao final.
- Cria registros com título "AUTO …", guarda os ids e, ao final, apaga **somente** esses registros. Se encontrar registros "AUTO" que não criou, para sem apagar nada.
- Capturas de tela vão para a pasta temporária do sistema, fora do repositório.

Cenários: evento como ocupação fixa; reserva parcial por arraste; vários cartões no período; destinos recusados com motivo; reserva sem arrastar; recusas do próprio banco (capacidade, evento, outro responsável, passado); conflito com outra sessão; remanejamento com histórico; conclusão de etapa sem concluir a demanda; aula cadastrada pela tela com ocorrências e preparação, sem passar pela triagem; bloco vencido; números do Dashboard comparados com o banco.

### Bloco vencido sem contornar o banco

O banco recusa reservas no passado. Para ter um bloco vencido de verdade, o teste reserva um bloco para **hoje** enquanto o período está aberto e depois encurta o horário de trabalho desse período para terminar agora, pela mesma função usada em "Horários da equipe". Só funciona de segunda a sexta.

Para avaliar esse caso à mão:

```
npm run test:homolog -- --preparar-vencido   # deixa "AUTO Bloco vencido" na agenda da outra pessoa
npm run test:homolog -- --restaurar          # restaura o horário e remove o que foi criado
```

Entre os dois comandos, o período de hoje dessa pessoa aparece como encerrado.

### Se uma execução for interrompida

O que foi criado fica anotado em um arquivo na pasta temporária do sistema. A próxima execução, ou `--restaurar`, desfaz tudo a partir dele.

## O que este teste não cobre

- Arrastar com o dedo em um celular de verdade (no celular, use "Mover para outro período").
- Duas pessoas reais trabalhando ao mesmo tempo; o conflito é simulado com uma segunda chamada ao banco.
- Um bloco que vence pela passagem natural do tempo.
