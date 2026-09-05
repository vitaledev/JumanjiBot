# Jumanji RPG Bot

Bot Discord e painel em TypeScript/JavaScript, com PostgreSQL e templates locais de conteúdo. Implementação em andamento: esta rodada foi encerrada a pedido do usuário para economizar tokens. **Ainda não é a entrega completa do plano nem uma versão homologada para produção.**

## Executar a versão atual

1. Use Node.js 22 ou superior e um banco PostgreSQL de desenvolvimento. O banco recomendado para a comunidade é o Postgres do Supabase.
2. Execute `npm install`.
3. Consulte `.env.example` e configure as variáveis ausentes no seu `.env`, preservando os valores existentes. `DATABASE_URL` e `SESSION_SECRET` agora são obrigatórios. Recomenda-se um `PRIVACY_SECRET` separado e estável; não o altere depois de registrar participantes.
4. Para login, configure `DISCORD_CLIENT_SECRET` e registre `http://localhost:4173/api/auth/callback` no Discord Developer Portal. Ajuste a URL se `WEB_ORIGIN` mudar.
5. Confira o destino de `DATABASE_URL` e execute `npm run db:migrate` **no banco de desenvolvimento**. Não execute migrações no banco existente sem backup e revisão.
6. Execute `npm run dev`. O painel fica em `http://localhost:4173` e requer login Discord.

`npm run web` é um alias do mesmo processo: não execute ambos simultaneamente. `npm run build` compila; `npm start` executa a compilação. Para trabalhador separado, use `RUN_WORKER=false` na aplicação e execute `npm run worker` ou `npm run worker:start` após compilar.

O bot precisa estar no servidor da conta autenticada. `TEST_GUILD_ID` limita o registro de comandos a um servidor de testes. Intents de mensagens, membros, voz e reações têm flags próprias; os intents privilegiados também precisam ser habilitados no Developer Portal.

## Banco e dados

### Supabase como banco principal

Use a conexão Postgres Pooler em `DATABASE_URL` (Settings → Database → Connect → Pooler). `SUPABASE_URL` identifica o projeto; `SUPABASE_SERVICE_ROLE_KEY` é opcional e deve ficar somente no backend. Nunca coloque essa chave no painel web ou em `NEXT_PUBLIC_*`.

- Migrações incrementais com trava de execução concorrente.
- Operações do novo runtime usam PostgreSQL, sem fallback em memória.
- `002_runtime.sql` preserva tabelas existentes, cria armazenamento de módulos, fila, sessões e marcadores de opt-out, e ativa RLS sem políticas públicas. Use conexão de backend com privilégios adequados.
- O consentimento legado volta a pendente, porque o cadastro automático antigo não distinguia aceitação explícita. Membros precisam aceitar novamente.
- Arquivos de prova ficam em `FILES_DIR`, fora da pasta web. Não exponha esse diretório diretamente.
- Classes antigas em `src/application` e o handler antigo em `src/discord/commands.ts` permanecem para os testes legados; o novo entrypoint usa `src/core` e `src/discord/runtime.ts`.

## Verificação executada

`npm test`: **25 testes passando**, sendo 14 novos casos com PostgreSQL real isolado, API autenticada, concorrência, tarefas, batalhas e PNG. Os 11 testes anteriores também passam. `npm run build` passou.

Sem `TEST_DATABASE_URL`, os testes iniciam PostgreSQL temporário por `embedded-postgres`, sem ler `DATABASE_URL` do `.env`. Os diretórios temporários são preservados para inspeção. Uma conexão externa de testes deve apontar para banco com nome iniciado por `jumanji_test`.

Nenhuma migração foi aplicada ao banco do usuário. Nenhuma publicação, login ou ação de moderação foi executada no Discord real. Testes de navegador, Docker, CI, backup/restauração e homologação completa ainda estão pendentes.

Veja [IMPLEMENTATION.md](IMPLEMENTATION.md) para cobertura, limitações conhecidas e ordem de continuação.

## Referências técnicas

- [Transações com node-postgres](https://node-postgres.com/features/transactions)
- [OAuth2 do Discord](https://docs.discord.com/developers/topics/oauth2)
- [Travas no PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html)

## GitHub Pages

O workflow em `.github/workflows/pages.yml` publica a pasta `web` automaticamente no GitHub Pages. O painel abre como frontend estático; login Discord, sessões e dados do RPG continuam dependendo do backend Node em execução.

Para usar o painel publicado, defina `window.JUMANJI_API_ORIGIN` em `web/runtime-config.js` com a URL HTTPS pública do backend. No backend, use `WEB_ORIGIN=https://api.seu-dominio.com` para o OAuth e `PANEL_ORIGIN=https://vitaledev.github.io/JumanjiBot` para os links do painel. Registre `https://api.seu-dominio.com/api/auth/callback` no Discord OAuth. O banco Supabase permanece acessado exclusivamente pelo backend; nenhuma chave privada deve ir para o Pages.

Sem API configurada, o endereço `github.io` abre automaticamente em modo demonstração offline, com navegação e dados fictícios para validar o design. Para dados reais, hospede o backend Node e preencha a URL no arquivo de configuração.

### Deploy gratuito recomendado

O arquivo `render.yaml` configura o backend como Web Service Free no Render. No painel do Render, escolha `New → Blueprint`, conecte este repositório e preencha os segredos marcados como `sync: false`. Depois copie a URL `https://...onrender.com` para `web/runtime-config.js`, defina `WEB_ORIGIN` com essa mesma URL, `PANEL_ORIGIN=https://vitaledev.github.io` e `PANEL_URL=https://vitaledev.github.io/JumanjiBot`. Registre `https://...onrender.com/api/auth/callback` no Discord Developer Portal.

