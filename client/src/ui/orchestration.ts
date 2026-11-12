// Papel de cada agente na orquestração para o snapshot atual (calculado uma vez por snapshot): o crachá das linhas
// e a seção da gaveta usam daqui.
import { orchestrationRoles, orchestratorOpenCount, type OrchRole } from '../../../shared/orchestration';
import type { OfficeSnapshot } from '../../../shared/types';
import type { OrchBadge } from './widgets';

let cached: { snap: OfficeSnapshot | null | undefined; roles: Map<string, OrchRole>; open: number } | undefined;

function compute(snap: OfficeSnapshot | null | undefined): { roles: Map<string, OrchRole>; open: number } {
  if (!cached || cached.snap !== snap) cached = { snap, roles: orchestrationRoles(snap), open: orchestratorOpenCount(snap) };
  return cached;
}

/** Crachá do agente (undefined = sem papel na orquestração). */
export function orchBadgeOf(snap: OfficeSnapshot | null | undefined, agentId: string): OrchBadge | undefined {
  const c = compute(snap);
  const role = c.roles.get(agentId);
  return role ? { role, open: role === 'orchestrator' ? c.open : undefined } : undefined;
}

/** Os agentes com esse papel, na ordem do snapshot. */
export function agentsWithRole(snap: OfficeSnapshot | null | undefined, role: OrchRole): string[] {
  return [...compute(snap).roles].filter(([, r]) => r === role).map(([id]) => id);
}
