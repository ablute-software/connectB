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

// Prompt 537 §4.3 — two paths no crawler should ever walk, for ANY user
// agent, not only the AI ones above.
//
// /guest/ is a shared data-room preview: the page carries the invited
// person's email address and the startup's folder and document names. A
// crawler that reached one leaked link would make both permanently
// searchable. /api/ is machine surface with no indexable content at all,
// and several of its routes are deliberately public (the guest resolver
// among them) precisely because they carry no session.
//
// This is a SIGNAL, like the AI-crawler block above: a bot that ignores
// robots.txt is not stopped by it. That is why the guest route also sends
// X-Robots-Tag and its layout declares a noindex meta tag — see both.
// The rest of the site stays fully indexable, which is the point of
// disallowing two prefixes rather than tightening the `*` allow.
export const CRAWLER_DISALLOWED_PATHS = ['/guest/', '/api/'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: CRAWLER_DISALLOWED_PATHS },
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, disallow: '/' })),
    ],
  };
}
