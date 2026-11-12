// Quem é quem na orquestração: o agente do orquestrador e as sessões que ele abriu (terminais com `by:
// 'orchestrator'`). Puro; usado pela barra lateral, pela gaveta e pela etiqueta do personagem no mapa.
import type { OfficeSnapshot } from './types';

/** Terminais que o orquestrador pode manter abertos ao mesmo tempo (fora ele mesmo); o servidor recusa o próximo. */
export const ORCHESTRATOR_MAX = 4;

export type OrchRole = 'orchestrator' | 'delegated';

/**
 * Uma sessão do Codex chega ao escritório com outro id (conta:thread), não o do terminal: vale o agente principal do
 * Codex que começou na pasta do terminal até este tempo depois de o terminal abrir.
 */
const CODEX_MATCH_MS = 120_000;

const pathKey = (p: string): string => p.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Papel na orquestração de cada agente (só os que têm um). */
export function orchestrationRoles(snap: Pick<OfficeSnapshot, 'ptys' | 'agents' | 'rooms'> | null | undefined): Map<string, OrchRole> {
  const out = new Map<string, OrchRole>();
  if (!snap?.ptys?.length) return out;
  const live = snap.ptys.filter((p) => p.exitedAt === undefined && (p.role === 'orchestrator' || p.by === 'orchestrator'));
  if (!live.length) return out;
  const ids = new Set(snap.agents.map((a) => a.id));
  const roomPath = new Map(snap.rooms.map((r) => [r.id, pathKey(r.path)]));
  for (const p of live) {
    const role: OrchRole = p.role === 'orchestrator' ? 'orchestrator' : 'delegated';
    if (ids.has(p.agentId)) {
      out.set(p.agentId, role);
      continue;
    }
    if (p.tool !== 'codex') continue;
    const cwd = pathKey(p.cwd);
    const match = snap.agents
      .filter((a) => a.kind === 'main' && a.provider === 'codex' && !out.has(a.id) && roomPath.get(a.roomId) === cwd)
      .filter((a) => a.startedAt >= p.startedAt - 5_000 && a.startedAt <= p.startedAt + CODEX_MATCH_MS)
      .sort((a, b) => a.startedAt - b.startedAt)[0];
    if (match) out.set(match.id, role);
  }
  return out;
}

/** Sessões abertas agora pelo orquestrador (o "3/4" do crachá). */
export function orchestratorOpenCount(snap: Pick<OfficeSnapshot, 'ptys'> | null | undefined): number {
  return (snap?.ptys ?? []).filter((p) => p.exitedAt === undefined && p.by === 'orchestrator').length;
}
