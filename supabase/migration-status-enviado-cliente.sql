-- Rode APENAS este script no SQL Editor do Supabase.
-- Adiciona o novo status "enviado_cliente" ao fluxo da caixa de entrada:
--   recebida → orcamento_em_criacao → aguardando_aprovacao (esperando aprovação Pedro)
--   → enviado_cliente (enviado ao cliente) → aprovado → ...
--
-- Depois que este rodar sem erro, o app aceita mover demandas para "Enviado ao cliente".

alter table public.tickets drop constraint if exists tickets_status_check;

alter table public.tickets
add constraint tickets_status_check check (
  status in (
    'recebida',
    'em_analise',
    'orcamento_em_criacao',
    'aguardando_aprovacao',
    'enviado_cliente',
    'aprovado',
    'em_producao',
    'pos_processo',
    'pronta',
    'entregue',
    'cancelada'
  )
);
