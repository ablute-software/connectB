-- Prompt 202 §D — PROPOSTO, NÃO APLICADO (aplica o Nuno).
--
-- Quanto foi pedido NESTE contacto. O outbound original à Adara Ventures
-- (web form, 2025-11-27) ficou sem valor nenhum registado — hoje não
-- sabemos se lhes pedimos €1.3M ou €0.3M, e quando responderam nove meses
-- depois não havia como saber que pitch tinham recebido.
--
-- Por interação e não por org de propósito: o valor pedido muda ao longo de
-- uma ronda (e entre investidores), e o que interessa quando alguém responde
-- meses depois é o que lhes foi pedido na altura, não o que a ronda é hoje.
-- É a mesma lógica do §F para a versão do documento.
--
-- Nullable sem default: "não registado" e "€0" são coisas diferentes, e o
-- histórico está cheio de linhas antigas em que a resposta honesta é a
-- primeira. Nada de backfill — inventar valores retroactivos seria
-- exactamente o problema que isto vem resolver.
alter table interactions add column if not exists ask_amount_eur numeric;

comment on column interactions.ask_amount_eur is
  'Valor pedido neste contacto especifico (EUR). Null = nao registado, nunca zero. Prompt 202 D.';
