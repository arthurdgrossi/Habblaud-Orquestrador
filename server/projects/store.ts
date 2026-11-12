// Projetos salvos (botão "Projetos"): nome, pasta, ferramenta e modelo de cada projeto, para abrir uma sessão nova no
// terminal interativo com um clique. Fica em <dataDir>/projects.json (gravação atômica). Só a pasta e o nome: nada de
// segredo. A mesma lista serve para o orquestrador saber onde pode abrir sessões.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { tr } from '../../shared/i18n';
import type { SavedProject } from '../../shared/types';
import { log } from '../log';

export const PROJECTS_MAX = 50;
const NAME_MAX = 60;
const PATH_MAX = 1024;
/** Mesmo formato aceito pelo terminal (pty/manager.ts): sem espaço nem nada de shell. */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export class InvalidProjects extends Error {}

/** Valida a lista vinda da página. Lança InvalidProjects com o motivo. */
export function parseProjects(raw: unknown, isAbs: (p: string) => boolean = isAbsolute): SavedProject[] {
  if (!Array.isArray(raw)) throw new InvalidProjects(tr('esperado {projects: lista}'));
  if (raw.length > PROJECTS_MAX) throw new InvalidProjects(tr('no máximo {0} projetos', [PROJECTS_MAX]));
  const ids = new Set<string>();
  return raw.map((item, i) => {
    const r = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const n = i + 1;
    const id = typeof r.id === 'string' && ID.test(r.id) ? r.id : undefined;
    if (!id || ids.has(id)) throw new InvalidProjects(tr('projeto {0}: id inválido ou repetido', [n]));
    ids.add(id);
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name || name.length > NAME_MAX) throw new InvalidProjects(tr('projeto {0}: nome de 1 a {1} caracteres', [n, NAME_MAX]));
    const path = typeof r.path === 'string' ? r.path.trim() : '';
    if (!path || path.length > PATH_MAX || path.includes('\0') || !isAbs(path)) throw new InvalidProjects(tr('projeto {0}: informe a pasta com o caminho absoluto', [n]));
    if (r.tool !== undefined && r.tool !== 'claude' && r.tool !== 'codex') throw new InvalidProjects(tr('projeto {0}: ferramenta desconhecida', [n]));
    const model = typeof r.model === 'string' ? r.model.trim() : '';
    if (model && !MODEL_NAME.test(model)) throw new InvalidProjects(tr('projeto {0}: nome de modelo inválido', [n]));
    const out: SavedProject = { id, name, path };
    if (r.tool === 'codex') out.tool = 'codex';
    if (model) out.model = model;
    return out;
  });
}

export class ProjectStore {
  private cache: SavedProject[] | undefined;

  constructor(private readonly file: string) {}

  list(): SavedProject[] {
    if (!this.cache) {
      try {
        this.cache = parseProjects((JSON.parse(readFileSync(this.file, 'utf8')) as { projects?: unknown }).projects);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('{0} estragado, começando sem projetos: {1}', [this.file, (err as Error).message]));
        this.cache = [];
      }
    }
    return this.cache.map((p) => ({ ...p }));
  }

  /** Troca a lista inteira (já validada por parseProjects). */
  replace(projects: SavedProject[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify({ projects }, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
    this.cache = projects.map((p) => ({ ...p }));
  }
}
