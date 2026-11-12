import { describe, expect, it } from 'vitest';
import { orchestrationRoles, orchestratorOpenCount } from './orchestration';
import type { AgentInfo, OfficeSnapshot, PtyInfo } from './types';

const T = 1_800_000_000_000;
const agent = (id: string, over: Partial<AgentInfo> = {}) => ({ id, kind: 'main', roomId: 'r', startedAt: T, ...over }) as AgentInfo;
const pty = (id: string, agentId: string, over: Partial<PtyInfo> = {}): PtyInfo => ({ id, pid: 1, cwd: 'C:\\x\\loja', account: '.claude', agentId, startedAt: T, ...over });
const snap = (agents: AgentInfo[], ptys: PtyInfo[]) => ({ agents, ptys, rooms: [{ id: 'r', path: 'c:/x/loja/' }] }) as unknown as OfficeSnapshot;

describe('orquestração no escritório', () => {
  it('o orquestrador e as sessões dele; as da pessoa e os terminais fechados ficam de fora', () => {
    const s = snap(
      [agent('.claude:1'), agent('.claude:2'), agent('.claude:3'), agent('.claude:4')],
      [
        pty('p1', '.claude:1', { role: 'orchestrator' }),
        pty('p2', '.claude:2', { by: 'orchestrator' }),
        pty('p3', '.claude:3'),
        pty('p4', '.claude:4', { by: 'orchestrator', exitedAt: T + 1 }),
      ],
    );
    expect([...orchestrationRoles(s)]).toEqual([
      ['.claude:1', 'orchestrator'],
      ['.claude:2', 'delegated'],
    ]);
    expect(orchestratorOpenCount(s)).toBe(1);
    expect(orchestrationRoles(null).size).toBe(0);
  });

  it('Codex: o agente principal que começou na pasta logo depois do terminal (não o que já estava lá)', () => {
    const before = agent('.codex:velho', { provider: 'codex', startedAt: T - 600_000 });
    const after = agent('.codex:novo', { provider: 'codex', startedAt: T + 3_000 });
    const s = snap([before, after], [pty('p1', '.codex:999', { tool: 'codex', by: 'orchestrator' })]);
    expect([...orchestrationRoles(s)]).toEqual([['.codex:novo', 'delegated']]);
    expect(orchestrationRoles(snap([before], s.ptys!)).size).toBe(0);
  });
});
