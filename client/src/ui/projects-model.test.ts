import { describe, expect, it } from 'vitest';
import { isValidModel, looksAbsolute, nameFromPath, newProjectId, toolOf, toSaved } from './projects-model';

describe('painel Projetos', () => {
  it('pasta absoluta no Windows, macOS e Linux; nome sugerido pela última parte', () => {
    for (const p of ['C:\\Users\\ana\\loja', 'd:/proj', '/Users/ana/loja', '\\\\servidor\\x']) expect(looksAbsolute(p), p).toBe(true);
    for (const p of ['loja', './loja', '~/loja', '']) expect(looksAbsolute(p), p).toBe(false);
    expect(nameFromPath('C:\\Users\\ana\\Loja Nova\\')).toBe('Loja Nova');
    expect(nameFromPath('/Users/ana/loja')).toBe('loja');
  });

  it('id curto e único; modelo sem espaço nem shell', () => {
    expect(newProjectId('Pressmix — Pedidos', new Set())).toBe('pressmix-pedidos');
    expect(newProjectId('Loja', new Set(['loja']), () => 0.5)).toMatch(/^loja-[a-z0-9]+$/);
    expect(newProjectId('!!!', new Set())).toBe('projeto');
    for (const m of ['', 'opus', 'claude-opus-5-5', 'gpt-5.5-codex', 'sonnet[1m]']) expect(isValidModel(m), m).toBe(true);
    for (const m of ['a b', 'opus;ls', '--yolo']) expect(isValidModel(m), m).toBe(false);
  });

  it('grava só o necessário: Claude Code e modelo vazio ficam de fora', () => {
    expect(toSaved({ id: 'a', name: ' A ', path: ' /x ', tool: 'claude', model: ' ' })).toEqual({ id: 'a', name: 'A', path: '/x' });
    const codex = toSaved({ id: 'b', name: 'B', path: '/y', tool: 'codex', model: 'gpt-5.5-codex' });
    expect(codex).toEqual({ id: 'b', name: 'B', path: '/y', tool: 'codex', model: 'gpt-5.5-codex' });
    expect(toolOf(codex)).toBe('codex');
    expect(toolOf({ id: 'a', name: 'A', path: '/x' })).toBe('claude');
  });
});
