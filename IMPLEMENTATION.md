# Execução do plano Jumanji

Escopo aprovado: 14 blocos e recursos avançados, batalhas assíncronas, templates sem IA paga, execução local e Docker, sem deploy. `.env` não deve ser alterado ou impresso. Testes não publicam no Discord real.

## Critérios
- PostgreSQL como fonte de verdade; transações, isolamento por servidor e idempotência.
- OAuth Discord e autorização compartilhada, consentimento explícito e opt-out persistente.
- Fluxos reais para painel, bot, tarefas e módulos avançados.
- Testes de domínio, banco isolado, API, Discord simulado e navegador.
- Documentar limitações externas e verificações realmente executadas.

## Estado inicial
11 testes passando; TypeScript válido. Banco não conectado aos serviços, painel sem autenticação, recursos incompletos. Git, Docker e PostgreSQL não encontrados no PATH.

## Progresso da rodada encerrada

O usuário pediu para terminar apenas o processo atual e economizar tokens. A implementação foi interrompida depois da validação desta rodada, sem declarar conclusão do plano inteiro.

Implementado e conectado ao novo entrypoint:
- Migração incremental, repositório PostgreSQL por servidor e transações serializadas por servidor.
- OAuth Discord, sessões, CSRF, limites HTTP, rotas autenticadas e arquivos privados.
- Consentimento, opt-out, pontos, divisões, lideranças, rascunhos e fila persistente.
- Camada de aplicação para missões, presença, provas, campanhas, temporadas, moderação, batalhas, loja, templates e outros módulos avançados.
- Painel modular com dados reais, formulários, estados de carregamento e erro.
- Gateway Discord e trabalhador de tarefas. Efeitos reais não foram homologados.

## Validação executada
- `npm test`: 25 testes passando (11 legados + 14 novos).
- Novos testes usam PostgreSQL real temporário, incluindo concorrência, isolamento, rollback, nova conexão, API, fila, compras, revisão de provas e apuração sazonal.
- `npm run build`: passou.
- `.env` preservado; não foi lido ou alterado nesta implementação.
- Banco do usuário e Discord real não receberam ações de teste.

## Pendências antes de considerar o plano concluído

1. Completar testes de navegador e corrigir os fluxos encontrados: prévias em modais consecutivos, formulários com muitas opções, upload de prova pela UI e navegação de todos os papéis. Playwright está instalado, mas a suíte de navegador não foi escrita/executada.
2. Revisar a consistência da exclusão/anonimização em referências dentro de documentos JSON e snapshots; conciliar saldos após exclusão/reentrada e implementar reconstrução contábil. Não há afirmação de conclusão da privacidade.
3. Revisar elegibilidade de pontuação e efeitos durante pausas, contagem de voz após mudanças de outros participantes, uso de atividade válida em batalhas e referências de temporada em reversões.
4. Completar interfaces de convites recebidos, revisão/votação de desafios, recursos de moderação do membro, mascote, conquistas e sequência tolerante a descanso; vários serviços já existem, mas faltam interfaces correspondentes.
5. Completar sugestão de divisão por questionário, poderes configuráveis, aplicação de resultado eleitoral, fechamento de atribuições expiradas e importação das missões/provas legadas.
6. Fortalecer revisão de moderação e autorização no momento do efeito, retries após efeitos externos parcialmente concluídos, reconciliação de falhas e registro de resultados de notificações bloqueadas.
7. Completar métricas por campanha e resultados de experimentos, programação do jornal/reconhecimento, disparo de webhooks e proteção de seus segredos armazenados. Atualmente definições persistem, mas esses fluxos não estão completos.
8. Acrescentar Docker Compose, CI, scripts de backup/restauração, teste de migração de banco legado preenchido e teste de recuperação operacional. Docker/Git não foram encontrados no PATH.
9. Homologar OAuth e Gateway em servidor de teste, conferir permissões/intents e remover código legado não utilizado após consolidar os testes.

Não realizar deploy nem habilitar módulos avançados em uma comunidade real antes de resolver essas pendências e validar os fluxos integrados.
