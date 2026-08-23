import { describe, expect, it } from 'vitest';
import { checkNetworkContent, formatNetworkReportContext } from './network-content-policy';

describe('checkNetworkContent — vocabulário comercial fixo, apanha os casos da lista', () => {
  const shouldBlock = [
    'Here is our pricing for the enterprise tier.',
    'Check out our product — it solves exactly this.',
    'Can we book a demo next week?',
    'We have a special offer for you this month.',
    'I can give you a 20% discount if you sign today.',
    'This is a great partnership opportunity for both of us.',
    "Let's collaborate on a joint offering.",
    'I have a business proposal for your startup.',
    'We are looking for a reseller in your region.',
    'We could do a white-label deal.',
    'Are you the right person to talk to about procurement?',
    'Quick question about your budget for next quarter.',
    'Aqui tens os nossos preços para o plano enterprise.',
    'Vem conhecer o nosso produto.',
    'Podemos agendar uma demo?',
    'Temos uma oferta especial este mês.',
    'Posso dar-te um desconto se assinares hoje.',
    'Isto é uma óptima oportunidade de parceria.',
    'Vamos colaborar em algo em conjunto.',
    'Tenho uma proposta comercial para a tua startup.',
    'Procuramos um revendedor na tua região.',
    'És a pessoa certa para falar sobre isto?',
    'Pergunta rápida sobre o teu orçamento.',
  ];

  it.each(shouldBlock)('bloqueia: %s', (text) => {
    expect(checkNetworkContent(text)).toEqual({ blocked: true, reason: expect.any(String) });
  });

  const shouldPass = [
    'Posso apresentar-te a um advogado de cap tables que me ajudou muito.',
    'Boa sorte com a ronda — qualquer coisa em que eu possa ajudar, diz.',
    'Também já passei por isto, conta comigo se precisares de trocar notas.',
    'Achas que faz sentido falarmos com o mesmo investidor sobre isto?',
    'I can introduce you to a lawyer who helped me with my cap table.',
    'Happy to share notes on how our fundraise went so far.',
  ];

  it.each(shouldPass)('não bloqueia texto legítimo de entreajuda: %s', (text) => {
    expect(checkNetworkContent(text)).toEqual({ blocked: false });
  });
});

describe('formatNetworkReportContext — chega a support_tickets.context com os dados certos, formato que a acção de strike consegue reler', () => {
  it('report de um post produz network_post:{id}, mesmo com reportedActorId também presente', () => {
    expect(formatNetworkReportContext({ postId: 'post-1', reportedActorId: 'actor-1' })).toBe('network_post:post-1');
  });

  it('report de um perfil (sem post) produz network_actor:{id}', () => {
    expect(formatNetworkReportContext({ reportedActorId: 'actor-1' })).toBe('network_actor:actor-1');
  });
});
