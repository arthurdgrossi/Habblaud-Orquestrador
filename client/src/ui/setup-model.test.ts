import { describe, expect, it } from 'vitest';
import type { SetupClaudeAccount, SetupReport } from '../../../shared/types';
import { CMD, pendingCommands, pendingCount, setupSections } from './setup-model';

const claude = (over: Partial<SetupClaudeAccount> = {}): SetupClaudeAccount => ({
  provider: 'claude',
  id: '.claude',
  name: 'Conta C',
  settings: 'ok',
  mod: 'on',
  permissions: 'on',
  messages: 'on',
  legacyTap: false,
  legacyHook: false,
  hooksDisabled: false,
  usage: 'ok',
  ...over,
});
const report = (over: Partial<SetupReport> = {}): SetupReport => ({ docker: false, windows: false, pty: { enabled: true }, accounts: [claude()], ...over });

describe('diagnóstico: linhas', () => {
  it('tudo instalado: nenhuma pendência', () => {
    const s = setupSections(report());
    expect(pendingCount(s)).toBe(0);
    expect(s[1].rows.every((r) => r.state === 'ok')).toBe(true);
  });

  it('conta sem nada: mod, permissões e mensagens pendentes, um comando só', () => {
    const s = setupSections(report({ accounts: [claude({ mod: 'missing', permissions: 'missing', messages: 'missing', usage: 'disabled' })] }));
    expect(s[1].rows.map((r) => r.state)).toEqual(['todo', 'todo', 'todo']);
    expect(pendingCount(s)).toBe(3);
    expect(pendingCommands(s)).toEqual([CMD.mod]);
  });

  it('jeito antigo junto com o novo pede para tirar o antigo', () => {
    const s = setupSections(report({ accounts: [claude({ legacyTap: true, legacyHook: true })] }));
    expect(pendingCommands(s)).toEqual([CMD.usageOff, CMD.hooksOff]);
  });

  it('jeito antigo sozinho é só informação; disableAllHooks é problema', () => {
    const old = setupSections(report({ accounts: [claude({ mod: 'missing', permissions: 'missing', legacyTap: true, legacyHook: true })] }));
    expect(pendingCount(old)).toBe(0);
    const off = setupSections(report({ accounts: [claude({ hooksDisabled: true })] }));
    expect(off[1].rows[0].state).toBe('warn');
  });

  it('Codex, nenhuma conta, terminal desligado e Docker', () => {
    const s = setupSections({
      docker: true,
      windows: false,
      pty: { enabled: false, reason: 'indisponível no Docker' },
      accounts: [{ provider: 'codex', id: '.codex', name: 'Codex', hooks: 'missing', permissionHook: false }],
    });
    // No Docker, ligar o terminal interativo não é um comando: ele não existe lá.
    expect(s[0].rows.find((r) => r.state === 'info' && r.fix)).toBeUndefined();
    expect(pendingCommands(s)).toEqual([CMD.codex]);
    // Fora do Docker, o comando de ligar segue o sistema do servidor; o nome "Codex" não se repete no título.
    expect(setupSections(report({ windows: true, pty: { enabled: false } }))[0].rows[0].fix).toBe(CMD.ptyWindows);
    expect(s[1].title).toBe('Codex');
    const empty = setupSections(report({ accounts: [] }));
    expect(empty[0].rows[0].state).toBe('todo');
    expect(empty).toHaveLength(1);
  });
});
