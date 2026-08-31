-- Rode este script no SQL Editor do Supabase.
-- Adiciona a coluna "registrado_por": identifica quem preencheu o formulário
-- público (/solicitar) em nome de um cliente que chegou pelo WhatsApp ou outro canal
-- (ex.: "Bianca", "Dani"). Diferente de solicitante_nome, que é o nome do cliente.

alter table public.tickets
add column if not exists registrado_por text;
