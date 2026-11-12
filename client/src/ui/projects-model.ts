// Regras do painel "Projetos" sem DOM (testáveis): id novo, nome sugerido pela pasta, modelos sugeridos por
// ferramenta e o que vai para o servidor (PUT /api/projects; server/projects/store.ts valida de novo).
import { tr } from '../../../shared/i18n';
import type { SavedProject } from '../../../shared/types';

export type ProjectTool = 'claude' | 'codex';

/** Sugestões do campo de modelo (o campo aceita qualquer nome; vazio = o padrão da ferramenta). */
export const MODEL_SUGGESTIONS: Readonly<Record<ProjectTool, readonly string[]>> = {
  claude: ['opus', 'sonnet', 'haiku', 'opusplan'],
  codex: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-sol', 'gpt-6-luna'],
};

/** Para que serve cada modelo sugerido (aparece ao lado do nome na lista do campo). */
export function modelHint(model: string): string | undefined {
  switch (model) {
    case 'gpt-6.1-sol':
      return tr('Uso geral e programação');
    case 'gpt-6-astra':
      return tr('Tarefas de maior complexidade');
    case 'gpt-6.1-terra':
      return tr('Variante Codex para programação');
    case 'gpt-6-sol':
      return tr('Modelo da geração anterior');
    case 'gpt-6-luna':
      return tr('Opção rápida para tarefas simples');
    default:
      return undefined;
  }
}

/** Mesmo formato aceito pelo servidor: sem espaço nem nada de shell. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;

export function isValidModel(model: string): boolean {
  return model === '' || MODEL_NAME.test(model);
}

/** Pasta absoluta no macOS/Linux (`/…`) ou no Windows (`C:\…`, `C:/…`, `\\servidor\…`). */
export function looksAbsolute(path: string): boolean {
  return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path.trim());
}

/** Nome sugerido: a última parte da pasta. */
export function nameFromPath(path: string): string {
  return path.trim().split(/[\\/]/).filter(Boolean).pop() ?? '';
}

/** Id curto, único na lista. */
export function newProjectId(name: string, taken: ReadonlySet<string>, rand: () => number = Math.random): string {
  const base =
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'projeto';
  if (!taken.has(base)) return base;
  for (;;) {
    const id = `${base}-${Math.floor(rand() * 36 ** 4).toString(36)}`;
    if (!taken.has(id)) return id;
  }
}

/** Projeto como o servidor guarda (Claude Code e modelo vazio não são gravados). */
export function toSaved(p: { id: string; name: string; path: string; tool: ProjectTool; model: string }): SavedProject {
  const out: SavedProject = { id: p.id, name: p.name.trim(), path: p.path.trim() };
  if (p.tool === 'codex') out.tool = 'codex';
  if (p.model.trim()) out.model = p.model.trim();
  return out;
}

export function toolOf(p: SavedProject): ProjectTool {
  return p.tool === 'codex' ? 'codex' : 'claude';
}
