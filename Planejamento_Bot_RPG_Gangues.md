# Planejamento completo — Bot de RPG automático para Discord

> Especificação funcional e técnica preparada para orientar uma IA ou equipe de desenvolvimento.

## 1. Visão do produto

Criar um bot de Discord que transforme automaticamente um servidor em um RPG social de gangues e divisões, inspirado na atmosfera de animes de delinquentes juvenis, porém com identidade visual e narrativa próprias. O bot deve combinar diversão, organização da comunidade, moderação, engajamento e marketing do servidor.

Ao ser instalado, o bot deve iniciar um assistente de configuração, criar a estrutura básica do RPG e cadastrar os membros elegíveis usando somente dados disponibilizados pela API do Discord e autorizados pelo servidor. A experiência deve funcionar principalmente por botões, menus, modais, cards e mensagens privadas, evitando a dependência de comandos difíceis.

### Objetivos

- Aumentar participação saudável em textos, chamadas e eventos.
- Organizar membros em divisões competitivas e cooperativas.
- Dar responsabilidades reais a líderes e sublíderes.
- Transformar atividades do servidor em progresso de RPG.
- Apoiar campanhas de crescimento sem incentivar spam.
- Criar uma identidade visual memorável e personalizável.
- Oferecer administração simples por Discord e painel web.

### Limites do conceito

- Não copiar personagens, ilustrações, símbolos, nomes ou logotipos de *Tokyo Revengers* em uma versão pública ou comercial.
- Usar uma marca original baseada em gangues, divisões, honra, território e temporadas.
- Não acessar mensagens privadas nem dados externos sem consentimento.
- Não recompensar spam, assédio, atividade falsa ou divulgação não autorizada.

## 2. Perfis e hierarquia

### 2.1 Cargos do sistema

1. **Dono do servidor:** autoridade máxima e responsável pela instalação.
2. **Administrador do RPG:** configura temporadas, economia, missões e divisões.
3. **Líder geral:** comanda a gangue, nomeia ou remove capitães e vice-capitães dentro dos limites definidos.
4. **Capitão de divisão:** administra sua divisão e pode receber poderes de moderação.
5. **Vice-capitão:** auxilia ou substitui o capitão e pode receber poderes de moderação menores.
6. **Oficial:** cargo opcional para membros veteranos, sem administração completa.
7. **Membro:** participa de missões, eventos, rankings e progressão.
8. **Recruta:** perfil inicial até concluir a introdução.

### 2.2 Relação com cargos reais do Discord

Os cargos narrativos e as permissões reais devem ser separados. Ser capitão não concede automaticamente poder administrativo ilimitado. O dono escolhe quais permissões cada função receberá.

Perfis sugeridos:

| Perfil | Permissões sugeridas |
| --- | --- |
| Capitão moderador | Gerenciar mensagens, silenciar temporariamente, advertir, abrir/fechar tickets e gerenciar apelidos permitidos |
| Vice-capitão moderador | Advertir, silenciar por período curto, gerenciar mensagens da própria divisão e encaminhar casos |
| Capitão narrativo | Gerenciar equipe e missões, sem moderação real |
| Vice narrativo | Auxiliar missões e aprovar ações simples, sem moderação real |

### 2.3 Regras de segurança da moderação

- Nunca conceder `Administrador` automaticamente.
- O cargo do bot precisa estar acima dos cargos que ele gerencia.
- Aplicar o princípio do menor privilégio.
- Permitir limitar capitães aos canais da própria divisão.
- Exigir motivo para advertências, silenciamentos, expulsões e alterações importantes.
- Manter log imutável de autor, alvo, motivo, duração e horário.
- Impedir que capitães punam líderes, administradores, outros capitães ou cargos protegidos, salvo autorização explícita.
- Oferecer botão de recurso para punições configuradas pelo bot.
- Permitir aprovação de um administrador para ações graves.
- Definir limites diários e períodos máximos de silenciamento por cargo.
- Remover permissões reais imediatamente quando a pessoa perde a liderança.
- Nunca vincular promoção de moderação somente à quantidade de XP.

## 3. Instalação e início automático

### 3.1 Assistente inicial

Quando adicionado, o bot deve:

1. Validar permissões e posição do cargo do bot.
2. Solicitar nome, sigla, cor e emblema da gangue.
3. Definir dono, administradores do RPG e líder geral.
4. Perguntar quantidade inicial de divisões.
5. Escolher modelo de distribuição de membros.
6. Configurar canais públicos, privados, logs e anúncios.
7. Escolher regras de XP, missões e temporadas.
8. Configurar poderes de capitães e vice-capitães.
9. Mostrar uma prévia de tudo antes da criação.
10. Criar cargos, canais, painel e primeira temporada após confirmação.

Todas as etapas devem ser retomáveis. Se a configuração for interrompida, o progresso fica salvo como rascunho.

### 3.2 Cadastro dos membros

Dados permitidos:

- ID do servidor e do usuário.
- Nome público, apelido, avatar e cargos.
- Data de entrada disponibilizada pelo Discord.
- Eventos ocorridos após a ativação do bot, conforme permissões e consentimento.

O bot não deve inventar histórico anterior. Bots, contas ignoradas, membros que optaram por não participar e cargos excluídos não entram no RPG.

### 3.3 Modelos de entrada

- **Escolha livre:** membro seleciona uma divisão com vagas.
- **Convite:** capitão convida e o membro aceita.
- **Teste de perfil:** perguntas leves sugerem uma divisão.
- **Balanceamento automático:** distribui considerando vagas e atividade recente permitida.
- **Período de recrutamento:** usuário permanece como recruta antes de escolher.

## 4. Sistema de divisões

Cada divisão deve possuir:

- Nome, número, cor, emblema e lema.
- Capitão e vice-capitão.
- Membros e limite configurável.
- Canal de texto, voz e mural opcionais.
- Pontuação semanal, sazonal e histórica.
- Nível coletivo e habilidades cosméticas.
- Missões exclusivas e missões coletivas.
- Registro de alterações e moderação.

### 4.1 Ações do líder geral

- Criar, editar, arquivar e reorganizar divisões.
- Nomear, substituir ou remover capitães e vice-capitães.
- Abrir candidatura ou eleição opcional.
- Transferir membros com confirmação ou regra administrativa.
- Convocar reunião e evento geral.
- Distribuir objetivos entre divisões.
- Consultar relatórios, sem acessar conteúdo privado.

Mudanças sensíveis podem exigir confirmação do dono ou administrador, conforme configuração.

### 4.2 Ações de capitães e vice-capitães

- Convidar e remover membros da divisão conforme as regras.
- Criar propostas de missão para aprovação.
- Organizar eventos e chamadas.
- Publicar avisos no canal da divisão.
- Consultar desempenho agregado.
- Aplicar apenas as ações de moderação explicitamente concedidas.
- Encaminhar casos graves para administradores.

## 5. Progressão e pontuação

### 5.1 Indicadores

- **XP:** progresso individual e nível permanente.
- **Influência:** contribuição para o crescimento e divulgação do servidor.
- **Honra:** ajuda, participação positiva e confiança.
- **Pontos da divisão:** pontuação competitiva reiniciada a cada temporada.
- **Reputação de liderança:** indicador privado baseado em conduta e avaliações administrativas; nunca apenas em popularidade.

### 5.2 Regras gerais

- Conceder XP por intervalos de atividade significativa, não por mensagem isolada.
- Aplicar limite diário, tempo de espera e redução por repetição.
- Não pontuar mensagens muito curtas, repetidas, apagadas rapidamente ou enviadas em canais excluídos.
- Não pontuar reações repetitivas ou coordenadas artificialmente.
- Em voz, exigir pelo menos duas pessoas elegíveis e desconsiderar usuário ausente, ensurdecido por longos períodos ou sozinho.
- Nunca analisar o significado de conversas privadas.
- Permitir multiplicadores temporários com teto máximo.
- Registrar toda concessão ou remoção manual de pontos.

### 5.3 Exemplo de recompensas padrão

| Atividade | Recompensa | Regra sugerida |
| --- | ---: | --- |
| Participação textual válida | 3 XP | Uma vez a cada 3 minutos, com teto diário |
| 30 minutos em chamada válida | 20 XP | Até duas recompensas por dia |
| Participação em evento | 50 XP | Confirmação automática ou do organizador |
| Missão diária | 25 XP | Uma por dia |
| Missão semanal | 100 XP | Uma por semana |
| Ajuda confirmada | 15 Honra | Confirmação e limite semanal |
| Divulgação aprovada | 50 Influência | Link ou prova e revisão |
| Convite qualificado | 80 Influência | Convidado permanece e participa legitimamente |

Os valores devem ser configuráveis. O sistema precisa simular o impacto antes de publicar mudanças na economia.

## 6. Missões

### 6.1 Tipos

- Diárias, semanais, sazonais e especiais.
- Individuais, de divisão e globais.
- Automáticas, parcialmente verificadas ou manuais.
- Competitivas, cooperativas, narrativas e de marketing.

### 6.2 Exemplos verificáveis pelo Discord

- Participar de chamada válida por determinado tempo.
- Comparecer a um evento agendado.
- Responder uma enquete.
- Reagir a uma mensagem específica.
- Participar de um quiz ou minijogo.
- Conversar em dias diferentes, respeitando a validação antispam.
- Completar uma missão cooperativa.
- Ajudar a receber novos membros.

### 6.3 Missões externas e marketing

Exemplos: publicar conteúdo, divulgar convite, criar meme, fanart ou vídeo. O fluxo deve ser:

1. Membro aceita a missão.
2. Bot mostra regras, prazo e recompensa.
3. Membro envia link e, quando necessário, imagem de comprovação.
4. Sistema procura duplicidade e organiza a prova.
5. Moderador revisa e aprova, rejeita ou solicita correção.
6. Bot registra a decisão e entrega a recompensa.

A IA pode classificar e resumir provas, mas não deve aprovar de forma definitiva atividades externas sem opção de revisão humana. Não incentivar spam, marcações em massa, contas falsas ou violação de regras de outras plataformas.

### 6.4 Gerador inteligente de missões

O administrador informa um objetivo em linguagem natural, como “aumentar a participação em chamadas”. O sistema sugere:

- Nome e descrição da missão.
- Critério mensurável.
- Duração e público elegível.
- Recompensa equilibrada.
- Limites contra abuso.
- Método de comprovação.
- Mensagem e card de divulgação.

Nada é publicado sem confirmação.

## 7. Temporadas, narrativa e batalhas

Uma temporada dura, por padrão, entre quatro e oito semanas e contém:

- Tema original e gangues rivais fictícias.
- Capítulos semanais.
- Decisões coletivas por votação.
- Missões que alteram o rumo da história.
- Batalhas entre divisões ou contra chefes.
- Territórios simbólicos.
- Ranking e premiação final.
- Epílogo criado a partir dos resultados reais.

O desempenho em atividades reais converte-se em recursos de batalha. As batalhas devem ter estratégia e limites para que a maior divisão não vença automaticamente. A narrativa gerada por IA deve passar por filtros, respeitar regras do servidor e não atribuir falas falsas a membros.

## 8. Sistemas de diversão

- Perfil e ficha de personagem.
- Títulos e molduras colecionáveis.
- Conquistas públicas e secretas.
- Mascote coletivo da gangue.
- Jornal semanal com acontecimentos públicos.
- Quiz, duelo de conhecimento e desafios rápidos.
- Batalha de memes com votação.
- Eventos surpresa e chefes cooperativos.
- Loja de itens exclusivamente virtuais ou cosméticos.
- Inventário, emblemas, banners e efeitos de perfil.
- Hall da fama de temporadas anteriores.
- Sistema opcional de alianças e rivalidades amigáveis.

Evitar recompensas que concedam poder real de moderação por sorte, compra ou pontuação.

## 9. Experiência e design

### 9.1 Direção visual

Estética urbana contemporânea com inspiração em mangá, sem copiar uma franquia: preto, creme, vermelho escuro e dourado; textura leve de papel e tinta; emblemas originais; tipografia forte; ilustrações próprias e composição de pôster.

### 9.2 Princípios de interface

- Priorizar botões, menus e modais.
- Usar no máximo uma ação principal destacada por card.
- Manter textos curtos com opção “Ver detalhes”.
- Padronizar cores por estado: sucesso, atenção, perigo e informação.
- Exibir progresso por barras e valores numéricos acessíveis.
- Não depender apenas de cor para transmitir significado.
- Fornecer texto alternativo e bom contraste.
- Usar respostas privadas para dados e configurações pessoais.
- Atualizar painéis existentes em vez de poluir canais com novas mensagens.

### 9.3 Painel principal no Discord

Botões sugeridos:

- Minha ficha
- Missões
- Minha divisão
- Ranking
- Temporada
- Ajuda

### 9.4 Cards gerados

- Perfil individual.
- Identidade da divisão.
- Missão e progresso.
- Resultado de batalha.
- Promoção de liderança.
- Jornal semanal.
- Resumo da temporada.

Os cards devem usar templates em camadas, cache, tamanhos controlados e alternativa textual completa.

## 10. Painel web administrativo

### Áreas

- Visão geral e indicadores.
- Editor de identidade visual.
- Organizador de divisões com arrastar e soltar.
- Gestão de líderes e permissões.
- Editor e biblioteca de missões.
- Temporadas e narrativa.
- Revisão de provas externas.
- Moderação, recursos e auditoria.
- Economia, recompensas e simulação.
- Integrações e webhooks.
- Privacidade, retenção e exportação de dados.

### Autenticação

- Login com OAuth2 do Discord.
- Acesso apenas a servidores em que o usuário possua a permissão necessária.
- Sessões seguras, expiração e proteção CSRF.
- Autorização verificada no backend a cada ação sensível.
- Nunca confiar apenas em cargos enviados pelo frontend.

## 11. Moderação integrada

### Funcionalidades

- Advertências graduais.
- Silenciamento temporário dentro dos limites permitidos.
- Exclusão controlada de mensagens.
- Tickets e encaminhamento para administradores.
- Fila de denúncias.
- Registro de evidências e decisões.
- Recurso de punição.
- Escalas e plantões opcionais.
- Relatórios de atuação de capitães e vice-capitães.

### Fluxo recomendado

1. Moderador escolhe uma ação.
2. Backend verifica cargo atual, escopo e hierarquia.
3. Moderador informa motivo e duração.
4. Casos graves exigem segunda confirmação ou aprovação superior.
5. Discord executa a ação.
6. Sistema registra auditoria e informa o usuário quando apropriado.
7. Usuário pode recorrer pelo fluxo configurado.

O módulo de IA pode indicar possíveis casos e resumir contexto público relevante, mas nunca deve banir, expulsar ou aplicar punição grave autonomamente.

## 12. Proteção contra abuso

- Rate limiting por usuário, servidor, comando e ação.
- Detecção de mensagens repetidas e fazenda de reações.
- Validação de permanência real em voz.
- Controle de convites qualificados e contas recém-criadas.
- Hash ou identificador de provas para detectar reenvios.
- Aprovação em duas etapas para concessões grandes.
- Idempotência para impedir recompensa duplicada.
- Transações no banco para pontos e inventário.
- Backups e trilha de auditoria.
- Lista de cargos protegidos.
- Alertas de comportamento anormal de moderadores.
- Botão de emergência para suspender pontuação, missões ou poderes delegados.

## 13. Privacidade e conformidade

- Consentimento e opção de não participar do RPG.
- Página clara indicando quais eventos são registrados.
- Coletar apenas dados necessários.
- Política configurável de retenção.
- Exportação e exclusão de dados do usuário.
- Exclusão ou anonimização quando o bot sai do servidor, conforme política definida.
- Dados isolados por servidor.
- Segredos e tokens criptografados ou mantidos em cofre de segredos.
- Seguir os Termos do Discord e a legislação aplicável, incluindo a LGPD.

## 14. Comandos e interações

### Membros

- `/iniciar` — entrar no RPG e concluir introdução.
- `/perfil [membro]` — visualizar ficha permitida.
- `/missoes` — abrir painel de missões.
- `/divisao` — acessar informações da divisão.
- `/ranking` — consultar ranking por período e categoria.
- `/inventario` — visualizar e equipar cosméticos.
- `/temporada` — acompanhar história e progresso.
- `/privacidade` — preferências, dados e saída do RPG.

### Liderança

- `/lideranca painel` — painel contextual de gestão.
- `/divisao convidar` — convidar membro.
- `/divisao evento` — propor ou criar evento.
- `/moderacao advertir` — advertência com motivo.
- `/moderacao encaminhar` — encaminhar caso para nível superior.

### Administração

- `/configurar` — continuar assistente ou abrir configurações.
- `/missoes criar` — editor guiado.
- `/temporada criar` — criar rascunho de temporada.
- `/auditoria` — consultar registros autorizados.
- `/emergencia` — suspender sistemas sensíveis.

Todos os comandos devem possuir equivalentes por botão quando possível.

## 15. Arquitetura técnica sugerida

### Stack

- **Bot:** Node.js, TypeScript e Discord.js.
- **Backend/API:** NestJS com API REST; WebSocket para atualizações necessárias.
- **Painel:** React com TypeScript.
- **Banco:** PostgreSQL; MySQL é uma alternativa válida se for padrão da equipe.
- **Cache e filas:** Redis com BullMQ.
- **Arquivos:** armazenamento compatível com S3.
- **Cards:** Canvas/SVG renderizado pelo backend e armazenado em cache.
- **Infraestrutura:** Docker Compose no desenvolvimento e containers em produção.
- **Observabilidade:** logs estruturados, métricas, alertas e rastreamento de erros.

### Módulos do backend

- Auth e autorização.
- Discord gateway e interações.
- Servidores e configuração.
- Usuários e consentimento.
- Divisões e liderança.
- Atividade e pontuação.
- Missões e comprovações.
- Temporadas e narrativa.
- Batalhas e eventos.
- Inventário e cosméticos.
- Moderação e recursos.
- Notificações.
- Auditoria.
- Analytics agregados.
- Integrações.

### Processamento por eventos

Eventos do Discord devem ser validados, normalizados e enviados para filas. Trabalhadores processam pontuação, progresso de missões e agregações. A resposta a interações deve ser rápida; tarefas demoradas devem ser assíncronas e idempotentes.

## 16. Modelo de dados inicial

Entidades principais:

- `Guild`: servidor e configuração.
- `GuildMember`: participação, consentimento e progresso.
- `RpgRole`: papel narrativo e vínculo opcional com cargo Discord.
- `Division`: identidade, temporada e configurações.
- `DivisionMembership`: membro, função e datas.
- `LeadershipGrant`: poderes delegados e escopo.
- `Season`: período, estado, regras e tema.
- `Mission`: definição, critérios, recompensa e validação.
- `MissionAssignment`: participante, progresso e estado.
- `Submission`: prova externa e revisão.
- `ActivityEvent`: evento normalizado e deduplicado.
- `PointLedger`: razão imutável de entradas e saídas de pontos.
- `Achievement`: definição de conquista.
- `MemberAchievement`: desbloqueios.
- `InventoryItem`: item pertencente ao membro.
- `ModerationCase`: ocorrência, ação, motivo e recurso.
- `AuditLog`: alterações sensíveis.
- `Notification`: entrega e estado.

### Regras importantes do banco

- Usar IDs do Discord como strings/BigInt sem conversão insegura.
- Toda pontuação deve nascer no `PointLedger`; saldos podem ser projeções recalculáveis.
- Criar chaves únicas para impedir recompensa duplicada.
- Usar transações na troca de divisão, liderança, recompensas e inventário.
- Aplicar `guild_id` em todas as entidades pertencentes a servidor.
- Registrar datas em UTC.
- Preferir exclusão lógica em registros de auditoria e moderação.

## 17. API inicial sugerida

- `GET /guilds/:guildId/dashboard`
- `PATCH /guilds/:guildId/settings`
- `GET /guilds/:guildId/divisions`
- `POST /guilds/:guildId/divisions`
- `POST /divisions/:divisionId/leaders`
- `POST /divisions/:divisionId/members`
- `GET /guilds/:guildId/rankings`
- `GET /guilds/:guildId/missions`
- `POST /guilds/:guildId/missions`
- `POST /missions/:missionId/accept`
- `POST /assignments/:assignmentId/submissions`
- `POST /submissions/:submissionId/review`
- `GET /guilds/:guildId/moderation/cases`
- `POST /guilds/:guildId/moderation/cases`
- `POST /moderation/cases/:caseId/appeal`
- `GET /guilds/:guildId/audit`

Cada endpoint deve verificar autenticação, servidor, permissão, escopo e hierarquia no backend.

## 18. Estados importantes

### Missão

`DRAFT -> SCHEDULED -> ACTIVE -> UNDER_REVIEW -> COMPLETED | FAILED | CANCELLED`

### Comprovação

`PENDING -> APPROVED | REJECTED | CHANGES_REQUESTED`

### Temporada

`DRAFT -> SCHEDULED -> ACTIVE -> CALCULATING -> FINISHED -> ARCHIVED`

### Caso de moderação

`OPEN -> ACTIONED -> APPEALED -> REVIEWED -> CLOSED`

Transições inválidas devem ser bloqueadas no domínio, não apenas na interface.

## 19. Inteligência artificial

### Usos permitidos e úteis

- Sugerir missões equilibradas.
- Criar rascunhos de capítulos e eventos.
- Resumir resultados públicos da semana.
- Gerar descrições e variações de cards.
- Classificar provas para priorização humana.
- Detectar padrões anormais de pontuação.
- Explicar regras do RPG usando a documentação aprovada.
- Sugerir ajustes de equilíbrio com justificativa.

### Restrições

- Não aplicar punições graves automaticamente.
- Não promover moderadores automaticamente.
- Não conceder grandes recompensas externas sem revisão.
- Não expor mensagens privadas ou inferir atributos sensíveis.
- Marcar conteúdo gerado e permitir edição antes da publicação.
- Usar saída estruturada e validação de esquema antes de salvar ações sugeridas.

## 20. Métricas

### Produto e comunidade

- Membros que iniciaram e concluíram a introdução.
- Usuários ativos diários e semanais no RPG.
- Retenção em 7 e 30 dias.
- Participação em missões e eventos.
- Distribuição de membros entre divisões.
- Uso do painel e dos comandos.

### Marketing

- Convites qualificados.
- Origem de campanhas.
- Conversão de entrada para membro ativo.
- Retenção por campanha.
- Conteúdos externos aprovados.

### Saúde e segurança

- Spam bloqueado.
- Recompensas revertidas.
- Ações de moderadores e taxa de recursos.
- Tempo de resolução de casos.
- Alertas de abuso e falsos positivos.

Métricas devem ser agregadas e acessíveis somente a pessoas autorizadas.

## 21. MVP e roadmap

### Fase 1 — Fundação

- Instalação e assistente inicial.
- Cadastro e consentimento.
- Divisões, capitão e vice-capitão.
- Cargos narrativos e permissões configuráveis.
- Perfil, XP, ranking e auditoria básica.
- Missões automáticas simples.
- Painel principal no Discord.

### Fase 2 — Administração e marketing

- Painel web.
- Criador de missões.
- Provas externas e revisão.
- Convites qualificados.
- Moderação delegada com logs e recursos.
- Cards personalizados.

### Fase 3 — RPG avançado

- Temporadas e capítulos.
- Batalhas, territórios e chefes.
- Inventário, loja e conquistas.
- Jornal semanal.
- IA assistiva e balanceamento.

### Fase 4 — Escala

- Internacionalização.
- Templates de configuração.
- Integrações e webhooks.
- Sharding do bot.
- Recursos premium sustentáveis, sem pay-to-win.

## 22. Critérios de aceite do MVP

- Instalação concluída sem edição manual obrigatória de banco ou código.
- Administrador consegue criar divisões e nomear capitão e vice.
- Permissões reais são opcionais, configuráveis e removidas com a liderança.
- Membro consegue entrar, ver perfil e concluir uma missão.
- Pontuação não é duplicada ao reprocessar um evento.
- Atividade textual e de voz respeita limites antispam.
- Ranking individual e de divisão é atualizado corretamente.
- Toda ação sensível gera auditoria.
- Missões externas exigem revisão.
- Usuário consegue consultar preferências de privacidade e sair do RPG.
- O sistema continua seguro quando faltam permissões do Discord.

## 23. Testes essenciais

- Testes unitários das regras de pontos, limites e hierarquia.
- Testes de integração com banco e filas.
- Testes de idempotência dos eventos.
- Testes de autorização para cada papel.
- Testes de perda e recuperação de conexão com Discord.
- Testes de concorrência em recompensas e trocas de divisão.
- Testes de acessibilidade do painel.
- Testes de carga em rankings, eventos e cards.
- Testes de restauração de backup.
- Ambiente de servidor sandbox antes da produção.

## 24. Requisitos não funcionais

- Responder ou reconhecer interações rapidamente e concluir tarefas longas em segundo plano.
- Escalar por servidor e por trabalhadores independentes.
- Manter disponibilidade mesmo com falhas temporárias em IA ou geração de imagens.
- Não tornar recursos principais dependentes de IA.
- Registrar erros sem expor tokens ou conteúdo sensível.
- Possuir backups, migrações versionadas e plano de recuperação.
- Oferecer idioma português inicialmente, com estrutura pronta para tradução.

## 25. Instruções para a IA implementadora

Ao implementar este projeto:

1. Não tente construir tudo de uma vez. Comece pela Fase 1.
2. Gere primeiro arquitetura, entidades, permissões e fluxos críticos.
3. Trate toda entrada do Discord e do painel como não confiável.
4. Valide autorização no backend e compare a hierarquia real do Discord.
5. Use transações, idempotência e razão de pontos.
6. Crie interfaces por contrato entre bot, API e trabalhadores.
7. Não codifique valores de pontuação diretamente; use configuração versionada.
8. Separe cargos narrativos de permissões reais.
9. Mantenha toda ação grave dependente de humano autorizado.
10. Inclua testes junto de cada módulo.
11. Produza migrações reversíveis e dados iniciais seguros.
12. Documente variáveis de ambiente sem incluir segredos reais.
13. Use uma identidade original e ativos licenciados ou produzidos para o projeto.
14. Antes de cada fase, apresente arquivos que serão criados, decisões técnicas e critérios de conclusão.
15. Ao encontrar ambiguidade de produto, preserve dados e segurança e solicite decisão ao responsável.

## 26. Primeira entrega recomendada

A primeira entrega funcional deve permitir instalar o bot em um servidor de testes, executar o assistente, criar duas divisões, nomear capitães e vice-capitães, configurar poderes moderadores limitados, cadastrar membros com consentimento, acompanhar atividade válida, publicar três modelos de missão, calcular ranking semanal e consultar a auditoria. Isso valida a proposta central antes de investir em IA narrativa, batalhas e cosméticos avançados.

