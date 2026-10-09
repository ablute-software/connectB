# Calls, Etapa 0 — Parte A: envio de email (relatório, 09/10/2026)

Prompt 904, Parte A. Nada foi alterado em Supabase, Resend ou Vercel. Esta sessão não tem
acesso à Management API do Supabase (sem token no ambiente), por isso A2 e a configuração
de SMTP ficam como passos para o Nuno no painel.

## A1 — Remetente que a produção usa hoje (Resend)

Lido (só leitura) em `public.email_send_log`, projeto `wkjcaoqdvhykrfacsylr`:

- **Remetente em uso:** `Sherlock Deal <noreply@sherlockdeal.com>`. Não é o remetente de
  teste `onboarding@resend.dev`.
- **Volume:** 13 envios nos últimos 30 dias.
- **Destinatários que não são o dono da conta Resend:** sim, todos. Logo o domínio está
  verificado e a entrega a terceiros funciona (o remetente de teste não o permitiria).
- **Falhas:** 4 históricas, todas de quando o `from` ainda era um valor placeholder. Já não
  se repetem com o remetente atual.
- **DNS público de `sherlockdeal.com`:** SPF, DKIM e DMARC presentes.

Conclusão A1: **não há ação a tomar** para as notificações da plataforma, exceto o que se
segue.

**Ação do Nuno (Vercel), recomendada:** confirmar que `RESEND_REPLY_TO` está definido
(respostas dos candidatos tem de ir para uma caixa que alguém lê). Caminho: Vercel →
projeto `connect-b` → Settings → Environment Variables → `RESEND_REPLY_TO`
(production + preview). `RESEND_FROM_EMAIL` já está efetivo: não mexer.

## A2 — Como o Supabase Auth envia email

**Não consegui ler a configuração** (sem Management API). O que sei sem ela:

- O projeto não está documentado como tendo SMTP próprio. Sem SMTP próprio, o Supabase usa
  o seu serviço integrado, que serve só para testes: limite de poucos emails por hora, para
  todo o projeto. Com 200 candidatos isso falha.
- O advisor de segurança mostra "leaked password protection" desligada (relacionado com
  palavras-passe, não com email; fica como nota para a Parte B).

**O que o Nuno deve verificar no painel** (Supabase → projeto → ):

1. **Authentication → Emails → SMTP Settings:** "Enable custom SMTP" ligado? Se estiver
   desligado, é este o problema principal.
2. **Authentication → Rate Limits:** valor de "Rate limit for sending emails" (por hora) e
   de "Rate limit for token verifications" (por 5 minutos, por IP).
3. **Authentication → Sign In / Providers → Email:** "Email OTP Expiration" (segundos) e
   "Email OTP Length".

**Valores recomendados** (só se aplicam depois de o Nuno os confirmar):

| Definição | Valor |
| --- | --- |
| SMTP | Próprio. Pode ser o do Resend: host `smtp.resend.com`, porta `465`, utilizador `resend`, palavra-passe = uma API key do Resend com permissão de envio. Remetente `noreply@sherlockdeal.com`. |
| Comprimento do código | 6 |
| Expiração do código | 1800 s |
| Limite de envio de emails | pelo menos 300 por hora (ver A3) |
| Limite de verificações de token | 150 por 5 min por IP no mínimo (ver nota abaixo) |

**Nota importante sobre limites por IP.** O Supabase limita as verificações por IP. Na
Parte B a verificação do código passa por uma rota nossa no Vercel, por isso **o Supabase vê
sempre o mesmo IP (o do Vercel)** e todos os candidatos partilham o mesmo limite. É por isso
que o limite de verificações tem de ser subido (ou o IP do cliente reencaminhado, o que o
Supabase só suporta no plano Pro com a opção certa). A nossa rota aplica o seu próprio
limite por email e por IP de cliente, de modo que subir o do Supabase não desprotege nada.

## A3 — Volume estimado para uma call de 200 candidatos

Cálculo (spec §23, "pelo menos 4 emails por candidato"):

| Origem | Contas |
| --- | --- |
| Candidatos: código de registo (1 + ~0,5 reenvios), confirmação de candidatura, lembrete de prazo, resultado | ≈ 200 × 4,5 = **900** |
| Equipa (10 avaliadores + PV + backoffice): convites, atribuições, resumos | ≈ **100** |
| **Total** | **≈ 1 000 emails por call** |

Concentração: é razoável que 50 a 60% das candidaturas cheguem nas últimas 48 horas. Isso
dá ≈ 450 emails em 48 h, com picos de 80 a 120 por hora, e **os códigos de registo (os mais
sensíveis ao atraso) são quase todos dessa janela**.

Comparação (valores dos planos como os conheço; **o Nuno deve confirmar em Resend →
Settings → Billing e Supabase → Settings → Billing**, porque mudam):

- **Resend:** o plano gratuito tem um teto diário baixo (da ordem de 100 emails por dia) e
  3 000 por mês. 1 000 emails numa call, 450 em dois dias, **estoura o teto diário**.
  O plano pago de entrada (Pro, 50 000 por mês e sem teto diário) cobre com folga uma call
  e várias. **Recomendação: subir para o Pro antes de abrir a primeira call real.** Não
  comprei nem subi nada.
- **Supabase Auth:** os emails de autenticação (só os códigos, ≈ 300 por call) saem pelo
  SMTP configurado. Com SMTP próprio, o limite passa a ser definido por nós; o valor por
  omissão após ligar SMTP próprio é baixo (da ordem de 30 por hora), o que **também estoura**
  no pico. Subir para ≥ 300 por hora (tabela A2).
- **Plano do Supabase:** a opção de reencaminhar o IP do cliente nas verificações é do plano
  Pro. Para o piloto não é necessária se subirmos o limite por IP (nota em A2); confirmar se
  o projeto já está em Pro.

Ação resumida: **plano Resend Pro durante a call + SMTP próprio no Supabase + limites
subidos.** Sem isto, num dia de prazo, candidatos ficam sem código.

## A4 — Template "Confirm signup" para colar no painel

Caminho: Supabase → Authentication → Emails → Templates → **Confirm signup**.

**Subject:** `Your Sherlock Deal confirmation code: {{ .Token }}`

**Message (HTML):**

```html
<div style="font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #111827;">
  <h2 style="font-size: 18px; margin: 0 0 12px;">Confirm your email</h2>
  <p style="font-size: 14px; line-height: 1.5; margin: 0 0 16px;">
    Enter this code on the page where you registered. It expires in 30 minutes.
  </p>
  <p style="font-size: 32px; font-weight: 700; letter-spacing: 8px; text-align: center; margin: 0 0 20px; padding: 16px; background: #F3F4F6; border-radius: 8px;">
    {{ .Token }}
  </p>
  <p style="font-size: 13px; line-height: 1.5; color: #4B5563; margin: 0 0 8px;">
    Prefer a link? You can also confirm with one click:
  </p>
  <p style="margin: 0 0 20px;">
    <a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=%2Fportal"
       style="display: inline-block; background: #0E7490; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 10px 18px; border-radius: 8px;">
      Confirm my email
    </a>
  </p>
  <p style="font-size: 12px; color: #6B7280; margin: 0;">
    If you did not register on Sherlock Deal, you can ignore this email.
  </p>
</div>
```

Notas:

- O link usa `/auth/confirm` (página com botão, Prompt 86), que protege o token contra
  scanners de email que fazem GET automático. O destino `next=%2Fportal` é o valor atual e
  será ajustado na Etapa 1 consoante a call. Se o Nuno colar o template já, o código e o link
  funcionam.
- `{{ .Token }}` só tem 6 dígitos se "Email OTP Length" for 6 (A2).
- "30 minutes" só é verdade com expiração a 1800 s (A2). Se a expiração ficar noutro valor,
  alterar este texto.
- Texto genérico: não revela se a conta já existia (princípio do Prompt 564). O email
  "já tem conta" para quem se regista com um email existente é um segundo email que a Parte B
  envia pelo Resend, não por este template.

## O que depende do Nuno (resumo de A)

1. Supabase → Authentication → Emails → SMTP Settings: ativar SMTP próprio (Resend).
2. Supabase → Authentication → Rate Limits: emails ≥ 300/h; verificações de token subidas.
3. Supabase → Email OTP: comprimento 6, expiração 1800.
4. Supabase → Templates → Confirm signup: colar o template acima.
5. Resend: confirmar plano e subir para Pro antes de uma call real (sem teto diário).
6. Vercel: confirmar `RESEND_REPLY_TO`.
7. Dizer-me quando 1–4 estiverem feitos: a Parte B só se testa em produção depois disso.
