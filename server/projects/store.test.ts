import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { InvalidProjects, parseProjects, PROJECTS_MAX, ProjectStore } from './store';

setQuiet(true);

const posixAbs = (p: string) => p.startsWith('/');
const ok = { id: 'loja', name: 'Loja', path: '/Users/ana/loja' };

describe('parseProjects', () => {
  it('aceita nome, pasta, ferramenta e modelo; limpa espaços e o que não é do formato', () => {
    expect(parseProjects([{ ...ok, name: '  Loja  ', tool: 'codex', model: 'gpt-5.5-codex', extra: 1 }], posixAbs)).toEqual([
      { id: 'loja', name: 'Loja', path: '/Users/ana/loja', tool: 'codex', model: 'gpt-5.5-codex' },
    ]);
    // Claude Code é o padrão: `tool: 'claude'` não fica gravado.
    expect(parseProjects([{ ...ok, tool: 'claude', model: '' }], posixAbs)).toEqual([ok]);
  });

  it('recusa lista inválida, pasta relativa, id repetido, ferramenta e modelo estranhos', () => {
    const bad: unknown[] = [
      'x',
      [{ ...ok, path: 'relativo/loja' }],
      [ok, ok],
      [{ ...ok, name: '' }],
      [{ ...ok, tool: 'bash' }],
      [{ ...ok, model: 'opus; rm -rf /' }],
      [{ ...ok, id: '../x' }],
      Array.from({ length: PROJECTS_MAX + 1 }, (_, i) => ({ ...ok, id: `p${i}` })),
    ];
    for (const raw of bad) expect(() => parseProjects(raw, posixAbs), JSON.stringify(raw).slice(0, 60)).toThrow(InvalidProjects);
  });
});

describe('ProjectStore', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('começa vazio, grava, relê do disco e ignora arquivo estragado', () => {
    dir = mkdtempSync(join(tmpdir(), 'hb-projects-'));
    const file = join(dir, 'sub', 'projects.json');
    expect(new ProjectStore(file).list()).toEqual([]);
    const list = parseProjects([{ ...ok, path: dir }]);
    new ProjectStore(file).replace(list);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ projects: list });
    expect(new ProjectStore(file).list()).toEqual(list);
    writeFileSync(file, '{estragado');
    expect(new ProjectStore(file).list()).toEqual([]);
  });
});
