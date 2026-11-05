# Prompt 929 — parte A: o limite total de candidaturas (04/11/2026)

Decisões em `DECISIONS.md` («Prompt 929, parte A»). Migração aditiva `20261104100000_calls_max_applications.sql`, aplicada antes do código. A **Parte B** (dicas a quem não foi selecionado) vem a seguir, noutro merge.

## O que há
- **Setup → General → «Maximum number of applications»** (opcional; só contam as submetidas) e «Show how many places are left». Pode mudar-se com a call aberta.
- **Quando enche** a call diz **«Full»** (não «Closed»): «This call has reached its maximum number of applications.». Ninguém novo começa nem submete, também pela API; quem já tem rascunho ou candidatura mantém o acesso.
- **Corrida:** a contagem e a submissão são uma só transação com um bloqueio da call: dois candidatos ao último lugar nunca o ocupam os dois.
- **Avisos:** quem tinha rascunho é avisado uma vez pela entidade; quem chega depois recebe a mensagem e, uma só vez, um email da Sherlock Deal (só se não recusou as dicas) com o link «Unsubscribe from Sherlock Deal tips».
- **Subir ou tirar o limite** reabre a call (dentro do prazo) e avisa os rascunhos.
- **A equipa** vê «182 / 200 applications» no Summary e na lista de Calls.

## Lista de cliques para o Nuno
1. Numa call de teste, em **Setup → General**, põe **Maximum number of applications = 1** e liga «Show how many places are left». Valida e publica.
2. Com a startup A começa uma candidatura; com a B também (os dois rascunhos existem). A A submete: a call passa a **Full**.
3. A B tenta submeter: diz «This call has reached its maximum number of applications.» e tinha recebido o aviso da entidade.
4. Com uma terceira startup abre o link da call: vê a mensagem (sem «Start application») e recebe o email da Sherlock Deal; o link do rodapé recusa as dicas.
5. Em Setup → General sobe o limite para 2: a call volta a aceitar e a B recebe «is accepting applications again».
6. Na lista de Calls e no Summary vês «1 / 2 applications».

## Limite honesto
Não há capturas do ecrã de entrada nem dos emails: o teste do Chrome cobre os ecrãs da seriação, e aqui testei a lógica, as rotas, a corrida e os textos. O email só está em inglês; a língua da call entra com a Parte B.
