import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CODEX_EVENTS, setupReport, type JsonFile } from './check';

const hook = (command: string) => [{ matcher: '*', hooks: [{ type: 'command', command }] }];

function report(files: Record<string, JsonFile>) {
  return setupReport({
    docker: false,
    windows: false,
    pty: { enabled: false, reason: 'desligado' },
    accounts: [
      { id: '.claude', provider: 'claude', name: 'Conta C', dir: '/h/.claude', usage: 'ok' },
      { id: '.claude-d', provider: 'claude', name: 'Conta D', dir: '/h/.claude-d', usage: 'disabled' },
      { id: '.codex', provider: 'codex', name: 'Codex', dir: '/h/.codex', usage: 'disabled' },
    ],
    read: (f) => files[f] ?? { state: 'missing' },
  });
}

describe('diagnóstico da instalação', () => {
  it('conta do Claude Code: plugins pelo enabledPlugins, jeito antigo e disableAllHooks', () => {
    const r = report({
      [join('/h/.claude', 'settings.json')]: {
        state: 'ok',
        data: {
          enabledPlugins: { 'habblaud@habblaud': true, 'habblaud-permissoes@habblaud': false, 'outro@x': true },
          statusLine: { type: 'command', command: '"node" "/r/scripts/statusline-tap.mjs" --orig abc' },
          hooks: { PermissionRequest: hook('node /r/scripts/permission-hook.mjs') },
          disableAllHooks: true,
          env: { SEGREDO: 'não sai daqui' },
        },
      },
    });
    expect(r.accounts[0]).toEqual({
      provider: 'claude',
      id: '.claude',
      name: 'Conta C',
      settings: 'ok',
      mod: 'on',
      permissions: 'off',
      messages: 'missing',
      legacyTap: true,
      legacyHook: true,
      hooksDisabled: true,
      usage: 'ok',
    });
    // Nada do settings.json além dos estados.
    expect(JSON.stringify(r)).not.toMatch(/SEGREDO|statusline-tap|permission-hook/);
    // Conta sem settings.json: tudo ausente.
    expect(r.accounts[1]).toMatchObject({ settings: 'missing', mod: 'missing', permissions: 'missing', messages: 'missing', legacyTap: false, legacyHook: false });
  });

  it('pasta do Codex: todos os eventos, só alguns, nenhum ou hooks.json ilegível', () => {
    const all = Object.fromEntries(CODEX_EVENTS.map((e) => [e, hook('"C:/n/node.exe" "C:/h/mod/habblaud-codex/hook.mjs"')]));
    const file = join('/h/.codex', 'hooks.json');
    expect(report({ [file]: { state: 'ok', data: { hooks: all } } }).accounts[2]).toEqual({ provider: 'codex', id: '.codex', name: 'Codex', hooks: 'ok', permissionHook: true });
    const some = { SessionStart: all.SessionStart, Stop: hook('outro-hook.sh') };
    expect(report({ [file]: { state: 'ok', data: { hooks: some } } }).accounts[2]).toMatchObject({ hooks: 'partial', permissionHook: false });
    expect(report({}).accounts[2]).toMatchObject({ hooks: 'missing', permissionHook: false });
    expect(report({ [file]: { state: 'error' } }).accounts[2]).toMatchObject({ hooks: 'error' });
  });
});
