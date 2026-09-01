import type { MetadataRoute } from 'next';

// Prompt 514 — sinal de política explícito, espelhando o robots.txt do
// Crunchbase: bloqueia crawlers de IA conhecidos (treino E os que fazem
// fetch ao vivo por pergunta do utilizador — o pedido foi "outras IAs
// conhecidas, chat gpt, etc", não só as de treino). Isto é um SINAL, não
// uma barreira técnica: um bot que ignore robots.txt não é impedido por
// isto — só a cláusula 7.1 dos Termos dá base contratual para agir contra
// isso. Os crawlers das grandes labs (OpenAI, Anthropic, Google, Meta...)
// respeitam robots.txt pelas suas próprias políticas publicadas.
// Motores de busca normais (Googlebot, Bingbot, Applebot, DuckDuckBot...)
// NÃO estão aqui de propósito: o site tem de continuar indexável.
const AI_CRAWLERS = [
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot',                                    // OpenAI
  'ClaudeBot', 'anthropic-ai', 'Claude-Web', 'Claude-SearchBot', 'Claude-User', // Anthropic
  'Google-Extended',                                                            // Google — treino Gemini (distinto do Googlebot de pesquisa, que fica livre)
  'CCBot',                                                                      // Common Crawl — reusado para treinar muitos modelos
  'Bytespider', 'TikTokSpider',                                                 // ByteDance
  'Applebot-Extended',                                                          // Apple Intelligence (distinto do Applebot de pesquisa)
  'Meta-ExternalAgent', 'Meta-ExternalFetcher', 'FacebookBot',                  // Meta
  'PerplexityBot', 'Perplexity-User',                                           // Perplexity
  'Amazonbot',                                                                  // Amazon
  'cohere-ai', 'cohere-training-data-crawler',                                  // Cohere
  'MistralAI-User',                                                             // Mistral
  'AI2Bot', 'Diffbot', 'Omgili', 'Omgilibot', 'Timpibot', 'YouBot', 'ImagesiftBot',
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, disallow: '/' })),
    ],
  };
}
