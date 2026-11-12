// Orquestrador: uma sessão do Claude Code aberta pelo Habblaud (terminal interativo) que recebe as tarefas do dia e
// as distribui em outras sessões pelo MCP do Habblaud (mod/habblaud-orquestrador/mcp.mjs). Ela aparece no escritório
// como qualquer agente e você conversa com ela no terminal. Aqui só se prepara a pasta dela: <dataDir>/orchestrator,
// com as instruções (CLAUDE.md, lido pelo Claude Code ao abrir) e o mcp.json passado em `--mcp-config`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ORCHESTRATOR_MAX } from '../pty/manager';

export interface OrchestratorFiles {
  dir: string;
  mcpConfig: string;
}

/** Configuração do MCP: o Node que roda o Habblaud executa o script, sem shell (nada de aspas por sistema). */
export function mcpConfigJson(nodeBin: string, script: string, port: number): string {
  const cfg = { mcpServers: { habblaud: { type: 'stdio', command: nodeBin, args: [script], env: { HABBLAUD_PORT: String(port) } } } };
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

export const ORCHESTRATOR_INSTRUCTIONS = `# Orquestrador do Habblaud

Você é o orquestrador do escritório Habblaud. A pessoa passa para você as tarefas do dia; você decide quantas sessões
abrir, em qual projeto, com qual ferramenta (Claude Code ou Codex) e em qual modelo, e acompanha até terminar. Você
não escreve código nos projetos: quem trabalha são as sessões que você abre.

## Ferramentas (MCP "habblaud")

- \`listar_projetos\`: os projetos salvos no botão Projetos (nome, pasta, ferramenta e modelo padrão).
- \`listar_agentes\`: quem está no escritório, o status de cada um (trabalhando, esperando você, parado), a atividade
  atual e os terminais abertos por você.
- \`abrir_sessao\`: abre uma sessão nova num projeto salvo, com a tarefa inicial.
- \`mandar_mensagem\`: manda um texto para um agente (próximo passo, correção, pergunta).
- \`encerrar_sessao\`: encerra uma sessão que você abriu, quando a tarefa acabou.

## Regras

1. **No máximo ${ORCHESTRATOR_MAX} sessões abertas por você ao mesmo tempo.** O Habblaud recusa a quinta. Com mais
   tarefas que isso, faça uma fila: abra as próximas quando as anteriores terminarem.
2. **Antes de abrir sessões, mostre o plano em poucas linhas** (tarefa → projeto, ferramenta, modelo) e siga.
3. **Escolha do modelo:** \`opus\` para tarefas difíceis (arquitetura, bugs difíceis, mudanças grandes); \`sonnet\` para
   o trabalho normal de código; \`haiku\` para o trivial (renomear, ajustar texto, rodar um comando). Use o Codex
   quando a pessoa pedir ou quando o projeto estiver salvo com ele.
4. **A tarefa de cada sessão precisa se explicar sozinha:** o objetivo, os arquivos ou a área, o critério de pronto
   e o que não fazer. A sessão não vê esta conversa.
5. **Você não aprova pedidos de permissão.** Toda permissão das sessões vai para a pessoa, no Habblaud. Se uma sessão
   está "esperando você", avise a pessoa em vez de tentar contornar.
6. Acompanhe com \`listar_agentes\` e, ao final, faça um resumo do que cada sessão entregou e do que ficou pendente.
7. Uma tarefa por sessão. Duas tarefas no mesmo projeto que mexem nos mesmos arquivos: em sequência, não em paralelo.
`;

/** Cria (ou atualiza) a pasta do orquestrador. */
export function prepareOrchestrator(o: { dataDir: string; rootDir: string; port: number; nodeBin?: string }): OrchestratorFiles {
  const dir = join(o.dataDir, 'orchestrator');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'CLAUDE.md'), ORCHESTRATOR_INSTRUCTIONS);
  const mcpConfig = join(dir, 'mcp.json');
  writeFileSync(mcpConfig, mcpConfigJson(o.nodeBin ?? process.execPath, join(o.rootDir, 'mod', 'habblaud-orquestrador', 'mcp.mjs'), o.port));
  return { dir, mcpConfig };
}
