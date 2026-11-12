// Projetos › Abrir numa janela: começa o Claude Code (ou o Codex) numa janela de terminal de verdade, neste
// computador, já na pasta do projeto e no modelo escolhido. A sessão entra no escritório como qualquer outra (hooks e
// transcript), e os pedidos de permissão vêm para o Habblaud do mesmo jeito.
// - Windows: Windows Terminal (`wt.exe -w new new-tab -d <pasta> <exe> <args>`). Um processo `detached` do Node não
//   serve: no Windows ele nasce sem console (DETACHED_PROCESS) e o Claude Code roda sem janela nenhuma.
// - macOS: Terminal.app pelo `osascript` (`cd <pasta> && exec <exe> <args>`, com aspas de shell).
// Sem shell no Windows; no macOS o comando montado só leva caminhos e argumentos já validados, entre aspas simples.
import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tr } from '../../shared/i18n';
import type { SavedProject } from '../../shared/types';
import { INHERITED_SESSION_VARS, isModelName, newSessionArgs, type PtyTool } from '../pty/manager';

export type WindowResult = { ok: true } | { ok: false; error: string };
export interface WindowRequest {
  bin: string;
  args: string[];
  cwd: string;
  title: string;
}
export type WindowLauncher = (r: WindowRequest) => Promise<WindowResult>;
type Spawner = (bin: string, args: string[], opts: SpawnOptions) => { pid?: number; once(ev: string, fn: (...a: unknown[]) => void): unknown; unref(): void };

/** Pedidos repetidos (duplo clique, Enter + clique) do mesmo projeto e ferramenta dentro deste prazo são ignorados. */
export const REPEAT_MS = 5_000;

/**
 * O `wt.exe` é um alias de execução da Microsoft Store (reparse point): o `stat`/`existsSync` não o segue e diz que
 * ele não existe. O `lstat` olha o próprio link.
 */
function linkExists(p: string): boolean {
  try {
    lstatSync(p);
    return true;
  } catch {
    return existsSync(p);
  }
}

/** Executável do Windows Terminal: o atalho que a Microsoft Store instala em %LOCALAPPDATA%\Microsoft\WindowsApps. */
export function findWindowsTerminal(env: NodeJS.ProcessEnv, exists: (p: string) => boolean = linkExists): string | undefined {
  const local = env.LOCALAPPDATA?.trim();
  const p = local ? join(local, 'Microsoft', 'WindowsApps', 'wt.exe') : undefined;
  return p && exists(p) ? p : undefined;
}

/** Argumentos do `wt.exe`. O `;` separa comandos no wt: um `;` solto na pasta ou nos argumentos vira `\;`. */
export function windowsTerminalArgs(r: WindowRequest): string[] {
  const esc = (s: string) => s.replace(/;/g, '\\;');
  return ['-w', 'new', 'new-tab', '-d', esc(r.cwd), '--title', esc(r.title), r.bin, ...r.args.map(esc)];
}

/** Aspas simples de shell POSIX. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Script do osascript que abre o Terminal.app com o comando (macOS). */
export function terminalAppScript(r: WindowRequest): string {
  const cmd = `cd ${shq(r.cwd)} && exec ${[r.bin, ...r.args].map(shq).join(' ')}`;
  const as = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `tell application "Terminal"\n  do script "${as}"\n  activate\nend tell`;
}

/** Ambiente da janela: sem as variáveis de uma sessão do Claude Code (o Habblaud pode ter sido aberto de dentro de uma). */
export function windowEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out = { ...env };
  for (const k of INHERITED_SESSION_VARS) delete out[k];
  return out;
}

/** Abre um processo de janela e espera ele nascer (ou falhar). */
function launchDetached(spawn: Spawner, bin: string, args: string[], opts: SpawnOptions): Promise<WindowResult> {
  return new Promise((ok) => {
    let child: ReturnType<Spawner>;
    try {
      child = spawn(bin, args, { ...opts, detached: true, stdio: 'ignore', windowsHide: false });
    } catch (err) {
      return ok({ ok: false, error: (err as Error).message });
    }
    child.once('error', (err) => ok({ ok: false, error: (err as Error).message }));
    child.once('spawn', () => {
      child.unref();
      ok({ ok: true });
    });
  });
}

export function createWindowLauncher(o: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv; spawn?: Spawner; exists?: (p: string) => boolean } = {}): WindowLauncher | undefined {
  const platform = o.platform ?? process.platform;
  const env = o.env ?? process.env;
  const spawn = o.spawn ?? (nodeSpawn as unknown as Spawner);
  if (platform === 'win32') {
    const wt = findWindowsTerminal(env, o.exists);
    if (!wt) return undefined;
    return (r) => launchDetached(spawn, wt, windowsTerminalArgs(r), { cwd: r.cwd, env: windowEnv(env) });
  }
  if (platform === 'darwin') return (r) => launchDetached(spawn, 'osascript', ['-e', terminalAppScript(r)], { env: windowEnv(env) });
  return undefined;
}

export type ProjectOpenResult = { ok: true; tool: PtyTool; model?: string } | { ok: false; status: number; error: string };

/** Abre um projeto salvo numa janela de terminal: valida ferramenta e modelo, acha o executável e ignora cliques repetidos. */
export function createProjectWindowOpener(o: {
  launcher?: WindowLauncher;
  claudeBin?: string;
  codexBin?: string;
  isDir: (p: string) => boolean;
  now?: () => number;
}): (p: SavedProject, body: { tool?: unknown; model?: unknown }) => Promise<ProjectOpenResult> {
  const now = o.now ?? Date.now;
  const recent = new Map<string, number>();
  return async (p, body) => {
    if (!o.launcher) return { ok: false, status: 503, error: tr('não achei um terminal para abrir a janela (no Windows, instale o Windows Terminal); use o terminal do Habblaud') };
    if (body.tool !== undefined && body.tool !== 'claude' && body.tool !== 'codex') return { ok: false, status: 400, error: tr('ferramenta desconhecida: use claude ou codex') };
    const tool: PtyTool = body.tool === 'codex' ? 'codex' : body.tool === 'claude' ? 'claude' : p.tool === 'codex' ? 'codex' : 'claude';
    const rawModel = body.model === undefined ? p.model : body.model;
    if (rawModel !== undefined && rawModel !== '' && (typeof rawModel !== 'string' || !isModelName(rawModel))) return { ok: false, status: 400, error: tr('nome de modelo inválido') };
    const model = typeof rawModel === 'string' && rawModel ? rawModel : undefined;
    const bin = tool === 'codex' ? o.codexBin : o.claudeBin;
    if (!bin) return { ok: false, status: 503, error: tool === 'codex' ? tr('o Codex não foi encontrado no PATH (defina HABBLAUD_CODEX_BIN)') : tr('executável "claude" não encontrado no PATH (defina HABBLAUD_CLAUDE_BIN)') };
    if (!o.isDir(p.path)) return { ok: false, status: 400, error: tr('pasta não encontrada neste computador') };
    const key = `${p.id}\0${tool}`;
    const t = now();
    for (const [k, at] of recent) if (t - at > REPEAT_MS) recent.delete(k);
    if (recent.has(key)) return { ok: false, status: 409, error: tr('{0} acabou de ser aberto: espere a janela aparecer', [p.name]) };
    recent.set(key, t);
    const r = await o.launcher({ bin, args: newSessionArgs(tool, model), cwd: p.path, title: `${p.name} · ${tool === 'codex' ? 'Codex' : 'Claude Code'}` });
    if (!r.ok) {
      recent.delete(key);
      return { ok: false, status: 500, error: tr('não consegui abrir a janela do terminal: {0}', [r.error]) };
    }
    return { ok: true, tool, ...(model ? { model } : {}) };
  };
}
