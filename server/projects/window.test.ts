import { describe, expect, it } from 'vitest';
import { createProjectWindowOpener, createWindowLauncher, findWindowsTerminal, REPEAT_MS, terminalAppScript, windowEnv, windowsTerminalArgs, type WindowRequest } from './window';

const req: WindowRequest = { bin: String.raw`C:\Users\a\.local\bin\claude.exe`, args: ['--model', 'opus'], cwd: String.raw`C:\Users\a\Área de Trabalho\loja`, title: 'loja · Claude Code' };

describe('janela de terminal', () => {
  it('Windows Terminal: janela nova na pasta, o executável e os argumentos; ";" escapado', () => {
    expect(windowsTerminalArgs(req)).toEqual(['-w', 'new', 'new-tab', '-d', req.cwd, '--title', req.title, req.bin, '--model', 'opus']);
    expect(windowsTerminalArgs({ ...req, cwd: 'C:\\a;b', args: [] })).toContain('C:\\a\\;b');
    expect(findWindowsTerminal({ LOCALAPPDATA: 'C:\\L' }, (p) => p === 'C:\\L\\Microsoft\\WindowsApps\\wt.exe' || p === 'C:\\L/Microsoft/WindowsApps/wt.exe')).toBeDefined();
    expect(findWindowsTerminal({}, () => true)).toBeUndefined();
  });

  it('macOS: cd na pasta e exec com aspas de shell, escapado para o AppleScript', () => {
    const s = terminalAppScript({ bin: '/usr/local/bin/claude', args: ['--model', 'opus'], cwd: `/Users/a/o "x" it's`, title: 't' });
    expect(s).toContain(`do script "cd '/Users/a/o \\"x\\" it'\\\\''s' && exec '/usr/local/bin/claude' '--model' 'opus'"`);
  });

  it('sem as variáveis de uma sessão do Claude Code no ambiente', () => {
    expect(windowEnv({ CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', PATH: '/bin' })).toEqual({ PATH: '/bin' });
  });

  it('o launcher do Windows espera o processo nascer e solta (detached, com janela)', async () => {
    const calls: unknown[][] = [];
    const spawn = (bin: string, args: string[], opts: object) => {
      calls.push([bin, args, opts]);
      return { once: (ev: string, fn: () => void) => (ev === 'spawn' ? queueMicrotask(fn) : undefined), unref: () => undefined };
    };
    const launch = createWindowLauncher({ platform: 'win32', env: { LOCALAPPDATA: 'L' }, spawn, exists: () => true });
    expect(await launch!(req)).toEqual({ ok: true });
    expect(calls[0][1]).toEqual(windowsTerminalArgs(req));
    expect(calls[0][2]).toMatchObject({ detached: true, windowsHide: false, stdio: 'ignore' });
    expect(createWindowLauncher({ platform: 'win32', env: {}, exists: () => false })).toBeUndefined();
    expect(createWindowLauncher({ platform: 'linux' })).toBeUndefined();
  });

  it('abre o projeto com a ferramenta e o modelo; clique repetido não abre outra janela', async () => {
    let t = 0;
    const opened: WindowRequest[] = [];
    const open = createProjectWindowOpener({
      launcher: async (r) => (opened.push(r), { ok: true }),
      claudeBin: 'claude.exe',
      codexBin: 'codex.exe',
      isDir: () => true,
      now: () => t,
    });
    const p = { id: 'loja', name: 'Loja', path: 'C:\\loja', model: 'sonnet' };
    expect(await open(p, {})).toEqual({ ok: true, tool: 'claude', model: 'sonnet' });
    expect(opened[0]).toMatchObject({ bin: 'claude.exe', args: ['--model', 'sonnet'], cwd: 'C:\\loja' });
    expect(await open(p, {})).toMatchObject({ ok: false, status: 409 });
    expect(await open(p, { tool: 'codex', model: 'gpt-5.5' })).toEqual({ ok: true, tool: 'codex', model: 'gpt-5.5' });
    expect(opened[1]).toMatchObject({ bin: 'codex.exe', args: ['-m', 'gpt-5.5'] });
    t += REPEAT_MS + 1;
    expect(await open(p, { model: '' })).toEqual({ ok: true, tool: 'claude' });
    expect(opened).toHaveLength(3);
    expect(await open(p, { model: 'x; rm' })).toMatchObject({ ok: false, status: 400 });
    expect(await open(p, { tool: 'bash' })).toMatchObject({ ok: false, status: 400 });
  });

  it('falhas: sem terminal, sem executável, pasta sumida, janela que não abre (e aí pode tentar de novo)', async () => {
    const p = { id: 'a', name: 'A', path: '/a' };
    expect(await createProjectWindowOpener({ isDir: () => true, claudeBin: 'c' })(p, {})).toMatchObject({ ok: false, status: 503 });
    expect(await createProjectWindowOpener({ launcher: async () => ({ ok: true }), isDir: () => true })(p, {})).toMatchObject({ ok: false, status: 503 });
    expect(await createProjectWindowOpener({ launcher: async () => ({ ok: true }), claudeBin: 'c', isDir: () => false })(p, {})).toMatchObject({ ok: false, status: 400 });
    let fail = true;
    const open = createProjectWindowOpener({ launcher: async () => (fail ? { ok: false, error: 'ENOENT' } : { ok: true }), claudeBin: 'c', isDir: () => true });
    expect(await open(p, {})).toMatchObject({ ok: false, status: 500, error: expect.stringContaining('ENOENT') });
    fail = false;
    expect(await open(p, {})).toEqual({ ok: true, tool: 'claude' });
  });
});
