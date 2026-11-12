import { describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sem tipos (Node puro, roda fora do build)
import { handle, summarize } from '../../mod/habblaud-orquestrador/mcp.mjs';
import { mcpConfigJson, ORCHESTRATOR_INSTRUCTIONS } from './setup';

describe('orquestrador', () => {
  it('mcp.json roda o script pelo Node, sem shell, com a porta', () => {
    const node = String.raw`C:\Program Files\nodejs\node.exe`;
    const script = String.raw`C:\h\mod\habblaud-orquestrador\mcp.mjs`;
    const cfg = JSON.parse(mcpConfigJson(node, script, 4747));
    expect(cfg.mcpServers.habblaud).toEqual({ type: 'stdio', command: node, args: [script], env: { HABBLAUD_PORT: '4747' } });
    expect(ORCHESTRATOR_INSTRUCTIONS).toMatch(/No máximo 4 sessões/);
    expect(ORCHESTRATOR_INSTRUCTIONS).toMatch(/não aprova pedidos de permissão/);
  });

  it('resumo do escritório: agentes principais, terminais do orquestrador e o limite', () => {
    const snap = {
      rooms: [{ id: 'r', name: 'loja', path: '/x/loja' }],
      agents: [
        { id: 'acc:1', kind: 'main', name: 'Ana', status: 'waiting', waitingFor: 'permissão', roomId: 'r', activity: { text: 'Editando a.ts' }, tasks: [{ title: 'testes', status: 'in_progress' }] },
        { id: 'acc:1/sub', kind: 'sub', name: 'Sub', status: 'working', roomId: 'r' },
      ],
      ptys: [
        { id: 'p1-1', agentId: 'acc:1', cwd: '/x/loja', by: 'orchestrator' },
        { id: 'p2-2', agentId: 'codex:2', cwd: '/x/loja', tool: 'codex', by: 'orchestrator' },
        { id: 'p3-3', agentId: 'acc:3', cwd: '/o', role: 'orchestrator' },
        { id: 'p4-4', agentId: 'acc:4', cwd: '/x', by: 'orchestrator', exitedAt: 1 },
      ],
    };
    const out = summarize(snap);
    expect(out.agentes).toEqual([
      { agente_id: 'acc:1', nome: 'Ana', ferramenta: 'claude', status: 'esperando você', projeto: 'loja', pasta: '/x/loja', atividade: 'Editando a.ts', esperando: 'permissão', tarefas: ['… testes'], terminal_id: 'p1-1', aberto_por_voce: true },
    ]);
    expect(out.terminais_sem_agente).toEqual([{ terminal_id: 'p2-2', pasta: '/x/loja', ferramenta: 'codex', modelo: undefined, aberto_por_voce: true }]);
    expect(out.abertos_por_voce).toBe(2);
  });

  it('protocolo: initialize e tools/list (sem ferramenta de aprovar)', async () => {
    const lines: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string) => (lines.push(s), true)) as typeof process.stdout.write;
    try {
      await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
      await handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
      await handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    } finally {
      process.stdout.write = write;
    }
    expect(lines).toHaveLength(2);
    const names = (JSON.parse(lines[1]).result.tools as { name: string }[]).map((t) => t.name);
    expect(names).toEqual(['listar_projetos', 'listar_agentes', 'abrir_sessao', 'mandar_mensagem', 'encerrar_sessao']);
  });
});
