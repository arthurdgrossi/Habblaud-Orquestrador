// Diagnóstico da instalação (GET /api/setup; Configurações › Diagnóstico): o que falta em cada conta, sem rodar nada.
// Lê só o settings.json de cada conta do Claude Code e o hooks.json de cada pasta do Codex, e devolve só estados
// (ligado/desligado/ausente): nenhum caminho, comando ou outro valor desses arquivos sai daqui.
//
// Os marcadores são os mesmos dos instaladores (scripts/mod-install.ts, hooks-install.ts, statusline-install.ts e
// codex-install.ts). Eles não são importados daqui de propósito: cada script roda o próprio main() quando o
// import.meta.url bate com o arquivo executado, e no servidor empacotado (um arquivo só) isso sempre bateria.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SetupClaudeAccount, SetupCodexAccount, SetupPluginState, SetupReport } from '../../shared/types';

const MARKETPLACE = 'habblaud';
export const SETUP_PLUGINS = { mod: `habblaud@${MARKETPLACE}`, permissions: `habblaud-permissoes@${MARKETPLACE}`, messages: `habblaud-mensagens@${MARKETPLACE}` } as const;
/** scripts/statusline-install.ts (TAP_NAME). */
const TAP_NAME = 'statusline-tap.mjs';
/** scripts/hooks-install.ts (HOOK_NAME), no evento PermissionRequest. */
const HOOK_NAME = 'permission-hook.mjs';
/** scripts/codex-install.ts (HOOK_MARK e EVENTS). */
const CODEX_HOOK_MARK = /habblaud-codex[\\/]+hook\.mjs/;
export const CODEX_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd', 'PermissionRequest'] as const;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);

/** Arquivo JSON (objeto): lido, ausente ou ilegível. */
export type JsonFile = { state: 'ok'; data: Rec } | { state: 'missing' } | { state: 'error' };

export function readJsonFile(file: string): JsonFile {
  if (!existsSync(file)) return { state: 'missing' };
  try {
    const raw = readFileSync(file, 'utf8');
    if (!raw.trim()) return { state: 'ok', data: {} };
    const data = rec(JSON.parse(raw));
    return data ? { state: 'ok', data } : { state: 'error' };
  } catch {
    return { state: 'error' };
  }
}

function plugin(settings: Rec, id: string): SetupPluginState {
  const enabled = rec(settings.enabledPlugins);
  if (!enabled || !(id in enabled)) return 'missing';
  return enabled[id] === true ? 'on' : 'off';
}

/** Algum handler (em grupos {hooks: [...]}) de um evento cujo comando passa no teste. */
function hasHandler(list: unknown, test: (command: string) => boolean): boolean {
  if (!Array.isArray(list)) return false;
  return list.some((g) => {
    const hooks = rec(g)?.hooks;
    return Array.isArray(hooks) && hooks.some((h) => typeof rec(h)?.command === 'string' && test(rec(h)!.command as string));
  });
}

export function claudeAccountSetup(a: { id: string; name: string; usage: SetupClaudeAccount['usage'] }, file: JsonFile): SetupClaudeAccount {
  const s = file.state === 'ok' ? file.data : {};
  const statusLine = rec(s.statusLine)?.command;
  return {
    provider: 'claude',
    id: a.id,
    name: a.name,
    settings: file.state,
    mod: plugin(s, SETUP_PLUGINS.mod),
    permissions: plugin(s, SETUP_PLUGINS.permissions),
    messages: plugin(s, SETUP_PLUGINS.messages),
    legacyTap: typeof statusLine === 'string' && statusLine.includes(TAP_NAME),
    legacyHook: hasHandler(rec(s.hooks)?.PermissionRequest, (c) => c.includes(HOOK_NAME)),
    hooksDisabled: s.disableAllHooks === true,
    usage: a.usage,
  };
}

export function codexAccountSetup(a: { id: string; name: string }, file: JsonFile): SetupCodexAccount {
  if (file.state === 'error') return { provider: 'codex', id: a.id, name: a.name, hooks: 'error', permissionHook: false };
  const hooks = file.state === 'ok' ? (rec(file.data.hooks) ?? {}) : {};
  const ours = CODEX_EVENTS.filter((e) => hasHandler(hooks[e], (c) => CODEX_HOOK_MARK.test(c)));
  return {
    provider: 'codex',
    id: a.id,
    name: a.name,
    hooks: ours.length === CODEX_EVENTS.length ? 'ok' : ours.length ? 'partial' : 'missing',
    permissionHook: ours.includes('PermissionRequest'),
  };
}

export interface SetupInput {
  docker: boolean;
  windows?: boolean;
  pty: { enabled: boolean; reason?: string };
  accounts: ReadonlyArray<{ id: string; provider: 'claude' | 'codex'; name: string; dir: string; usage: SetupClaudeAccount['usage'] }>;
  /** Lê um JSON (testes injetam). */
  read?: (file: string) => JsonFile;
}

export function setupReport(o: SetupInput): SetupReport {
  const read = o.read ?? readJsonFile;
  return {
    docker: o.docker,
    windows: o.windows ?? process.platform === 'win32',
    pty: o.pty,
    accounts: o.accounts.map((a) =>
      a.provider === 'codex' ? codexAccountSetup(a, read(join(a.dir, 'hooks.json'))) : claudeAccountSetup(a, read(join(a.dir, 'settings.json'))),
    ),
  };
}
