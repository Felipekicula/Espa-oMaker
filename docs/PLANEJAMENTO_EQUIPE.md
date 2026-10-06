# Planejamento de equipe e eventos

Implementação em `feat/planejamento-equipe-eventos`, baseada no commit `dd9e4c2`.

## Comportamento

- Menu: Principal, Operações, Gestão e Financeiro, na ordem validada com Felipe.
- Agenda antiga redireciona para Planejamento; WhatsApp para Todas as demandas. Estoque e Prefeitura deixam de ter rotas acessíveis. Nenhuma tabela ou pedido desses módulos é removido.
- Dashboard: leitura visual com filtros de período e responsável. Cards (em aberto, entregues no período, atrasadas, % de entregas no prazo), entregas por semana/mês, pontualidade, em aberto por etapa, demandas por responsável, capacidade da equipe nos próximos 10 dias úteis e alertas do planejamento. Clicar em um indicador abre a lista correspondente. Fila ativa e alertas rápidos continuam na tela. Dados paginados integralmente, em vez do limite antigo de 200; nenhuma regra financeira alterada.
- Entregas e pontualidade usam `tickets.entregue_em`, gravado por gatilho quando o status passa para Entregue (`supabase/migration-ticket-entregue-em.sql`). Antes dessa migração o sistema não registrava a data da entrega: demandas entregues anteriormente ficam sem data, aparecem separadas e não entram nos gráficos nem no percentual. "Pronta" não conta como entregue, e `updated_at` não é usado. A pontualidade compara com o prazo atualmente cadastrado, pois não há histórico de alterações de prazo; entregas sem prazo ficam fora do cálculo, e o card mostra quantas entraram.
- Capacidade no Dashboard usa só horários configurados, aulas/eventos e reservas do planejamento. Períodos sem horário configurado aparecem como disponibilidade desconhecida. Cronômetros não entram.
- Relatórios: um menu com Indicadores gerais, Financeiro e Relatório mensal. Cálculos, filtros e exportações existentes preservados.
- Eventos: cadastro direto, participantes, horários, local, preparação e de 1 a 52 ocorrências semanais. Cada ocorrência tem suas etapas. Um conflito desfaz o cadastro inteiro. Cancelamento vale apenas para a ocorrência escolhida e libera seus blocos de preparação.
- Planejamento: agenda semanal de arrastar e soltar. À esquerda, blocos que precisam de remanejamento e etapas com trabalho ainda sem reserva (nome, projeto, responsável e horas que faltam agendar). No centro, a semana por pessoa, manhã/tarde, com horas livres e barra de ocupação por período; aulas e reuniões aparecem como ocupações fixas. Vários blocos cabem no mesmo período e a mesma etapa pode ocupar vários dias.
- Arrastar uma etapa para um período pergunta a duração e cria a reserva; o saldo restante continua na lista. Arrastar um bloco em dia remaneja só aquele bloco, sem formulário, mantendo duração e histórico (o bloco anterior fica como `superseded`). Para um bloco vencido, confirma-se o trabalho restante e a nova duração. Durante o arraste os períodos válidos são destacados e os demais mostram o motivo (outro responsável, encerrado, indisponível, sem horas livres, ocupado por evento). Arrastar nunca muda responsável nem prazo oficial.
- Arrastar não é obrigatório: clicar em um cartão abre detalhes, histórico e as ações Concluir etapa, Continuar depois e Mover para outro período; esta última mostra um botão "Colocar aqui" em cada período válido e funciona por teclado e toque.
- Toda gravação é validada pelo banco. A tela só anuncia sucesso depois da confirmação; se o banco recusar (por exemplo, por outra reserva feita ao mesmo tempo), nada sai do lugar, o motivo é exibido e a agenda é recarregada. A prévia de destinos válidos na tela é apenas orientação.
- Check: conclui a etapa, não a demanda. Quando a etapa está vinculada a uma tarefa existente, conclui essa tarefa. Outros blocos pendentes dessa etapa são cancelados para não reservar trabalho já encerrado.
- Continuar depois: informar trabalho total restante e duração do próximo bloco. Mostra períodos conhecidos com espaço, períodos desconhecidos e opções após o prazo identificadas. Trabalho pode ser dividido. As demais reservas da etapa ficam visíveis.
- Decidir depois: grava `needs_reschedule`, mantendo alerta. Reagendamento grava o novo bloco e preserva o anterior como `superseded`; tudo na mesma transação.
- Blocos não concluídos após o término do período configurado ficam vermelhos. Sem horário conhecido, o alerta automático aparece após o dia terminar; não se inventa um horário de encerramento.
- Horários por pessoa e dia útil: em branco significa desconhecido; indisponível significa zero. Eventos reduzem capacidade, incluindo todos os participantes. Eventos sobrepostos descontam a união dos intervalos, sem descontar duas vezes.
- Estimativa restante, reservas e execução são separados dos cronômetros existentes.
- Dados compartilhados no Supabase; nenhum planejamento fica salvo apenas no navegador. Recarrega a cada minuto e ao voltar à janela. Operações de capacidade são conferidas novamente no banco.

## Instalação

1. Obter checkout atualizado do repositório e aplicar esta branch/patch. Resolver eventuais mudanças posteriores à base antes de publicar.
2. Em um ambiente de homologação Supabase com `schema.sql` e `migration-ticket-tasks.sql`, aplicar **uma vez** `supabase/migration-maker-planning.sql`. A migração cria tabelas/funções/triggers próprios, não apaga demandas nem modifica campos financeiros. Se uma instrução falhar, a transação é revertida. Aplicar também `supabase/migration-ticket-entregue-em.sql` (aditiva e reexecutável: uma coluna e um gatilho em `tickets`); sem ela o Dashboard abre normalmente, mas avisa que entregas por período e pontualidade estão indisponíveis.
3. Manter as variáveis existentes `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Nunca colocar service-role no frontend.
4. Executar `npm ci`, `npm test` e `npm run build`.
5. Confirmar o teste com dois membros da equipe no ambiente de homologação; publicar o frontend depois da migração aprovada.
6. Configurar horários reais. Felipe e Gabriel: 8h nominais/dia; Manu e Jhonny: 6h. Segunda a sexta. Jhonny só à tarde. Felipe e Manu têm aula terça de manhã inteira. Reunião sexta ocupa a maior parte da manhã, sem Jhonny. Confirmar início/fim e intervalo; cadastrar os compromissos com os horários reais. Nenhum desses horários foi inventado ou gravado automaticamente.
7. Adicionar/estimar etapas das demandas em aberto; o sistema não infere esforço a partir de horas de cronômetro ou de tarefas já concluídas.

## Permissões e consistência

O acesso novo é restrito ao papel `authenticated` e a usuários existentes em `app_users`. Esses membros podem organizar o planejamento compartilhado, seguindo o modelo colaborativo já adotado nas tarefas. `anon` não recebe acesso às novas tabelas nem às RPCs de escrita. RPCs usam `security invoker`, respeitando RLS. Escritas atômicas de eventos, conclusão, disponibilidade e remanejamento são funções do banco.

Mudança no responsável de uma tarefa existente acompanha o responsável oficial e deixa seus blocos pendentes de remanejamento. Conclusão feita na página antiga da tarefa também libera as reservas. Excluir uma tarefa mantém a etapa de planejamento como registro vinculado à demanda, removendo só o vínculo à tarefa excluída.

Reservas com disponibilidade desconhecida são permitidas e explicitamente sinalizadas, para evitar que a falta de configuração paralise a organização; não são apresentadas como prova de viabilidade. Reservas acima da capacidade conhecida são rejeitadas pelo banco. Eventos confirmados e mudanças de horário podem reduzir a capacidade já reservada; o calendário e a avaliação da etapa mostram o excesso para replanejar.

Metas internas não mudam o prazo oficial. Para avaliar a etapa, usa-se a menor data entre meta interna e data oficial/evento. A avaliação depende das estimativas e dos compromissos cadastrados; não garante entrega, não avalia dependências entre etapas, estoque ou fila de máquinas.

## Validação e limites

- Testes `node:test`: cálculos e funções SQL executadas no PostgreSQL embarcado de teste (PGlite), sem acesso à produção. Cobrem RLS, capacidade, eventos recorrentes atômicos, remanejamento, conclusão e sincronização de tarefas.
- Interface testada no Chromium com autenticação e respostas Supabase simuladas: alerta, decidir depois, remanejar, concluir etapa, cadastrar evento e navegação dos relatórios. Desktop e largura de celular. Isso não substitui a homologação no Supabase real.
- Lint dos novos módulos passa. O lint geral mantém falhas pré-existentes de outras partes do repositório; não se alterou calculadora/orçamentos para resolver avisos fora do escopo.
- Build de produção passa, com aviso de tamanho de bundle já presente na aplicação.
- Recorrência é finita: as ocorrências escolhidas são materializadas, não há geração infinita/background. Alterações de série em lote e notificações externas não fazem parte desta entrega.
- Sugestões de reservas cobrem até o prazo + uma semana, com limite de um ano. Períodos de mesma manhã/tarde são blocos de esforço agregados, sem horário exato individual.
- Nenhuma migração nem escrita foi executada no banco de produção durante o desenvolvimento. Publicação depende de acesso autenticado ao GitHub e ao projeto Supabase correto.

Para repetir o smoke test de interface: instalar Playwright no ambiente de teste (`npm install --no-save playwright`; `npx playwright install chromium`) e executar `node tests/ui-smoke.cjs`. O próprio script inicia o Vite com um Supabase fictício e intercepta requisições; não usar credenciais de produção.
