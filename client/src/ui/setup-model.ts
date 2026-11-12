// Diagnóstico (Configurações): o relatório de GET /api/setup vira linhas com o estado, o que significa e o comando
// que resolve. Puro (testado em setup-model.test.ts); a tela fica em setup.ts.
import { tr } from '../../../shared/i18n';
import type { SetupClaudeAccount, SetupCodexAccount, SetupReport } from '../../../shared/types';

/** ok = tudo certo; todo = falta instalar; warn = instalado com problema; info = só para saber. */
export type SetupRowState = 'ok' | 'todo' | 'warn' | 'info';

export interface SetupRow {
  state: SetupRowState;
  label: string;
  detail?: string;
  /** Comando que resolve (roda na pasta do Habblaud). */
  fix?: string;
}

export interface SetupSection {
  title: string;
  rows: SetupRow[];
}

export const CMD = {
  mod: 'npm run mod:install',
  codex: 'npm run codex:install',
  usageOff: 'npm run usage:uninstall',
  hooksOff: 'npm run hooks:uninstall',
  pty: 'HABBLAUD_PTY=1 npm start',
  ptyWindows: '$env:HABBLAUD_PTY=1; npm start',
} as const;

function claudeRows(a: SetupClaudeAccount): SetupRow[] {
  const rows: SetupRow[] = [];
  if (a.settings === 'error') rows.push({ state: 'warn', label: tr('settings.json ilegível'), detail: tr('O Habblaud não conseguiu ler o settings.json desta conta: confira se o JSON está válido.') });
  if (a.hooksDisabled) rows.push({ state: 'warn', label: tr('disableAllHooks ligado'), detail: tr('Com ele no settings.json desta conta, nenhum mod nem hook roda. Tire a opção para o Habblaud receber o uso, os pedidos e as mensagens.') });

  if (a.mod === 'on') rows.push({ state: 'ok', label: tr('Mod do Habblaud'), detail: tr('Uso do plano ao vivo, aviso de "precisa de você" e o /habblaud.') });
  else if (a.mod === 'off') rows.push({ state: 'warn', label: tr('Mod do Habblaud desligado'), detail: tr('Instalado, mas desligado nesta conta.'), fix: CMD.mod });
  else if (a.legacyTap) rows.push({ state: 'info', label: tr('Uso pelo jeito antigo'), detail: tr('O tap de statusline funciona, mas o mod o substitui e traz mais recursos.'), fix: CMD.mod });
  else rows.push({ state: 'todo', label: tr('Mod do Habblaud não instalado'), detail: tr('Sem ele, o uso aparece como "sem dados".'), fix: CMD.mod });

  if (a.permissions === 'on') rows.push({ state: 'ok', label: tr('Responder permissões pelo escritório') });
  else if (a.legacyHook) rows.push({ state: 'info', label: tr('Permissões pelo jeito antigo'), detail: tr('O hook do settings.json funciona; o plugin de permissões o substitui.'), fix: CMD.mod });
  else rows.push({ state: 'todo', label: tr('Responder permissões pelo escritório'), detail: tr('Sem o plugin, os pedidos de permissão ficam só no terminal.'), fix: CMD.mod });

  if (a.messages === 'on') rows.push({ state: 'ok', label: tr('Mandar mensagens pelo escritório') });
  else rows.push({ state: 'todo', label: tr('Mandar mensagens pelo escritório'), detail: tr('Sem o plugin, as mensagens não chegam às sessões desta conta.'), fix: CMD.mod });

  if (a.legacyTap && a.mod === 'on') rows.push({ state: 'warn', label: tr('Tap de statusline antigo junto com o mod'), detail: tr('O mod já faz o trabalho dele: dá para tirar.'), fix: CMD.usageOff });
  if (a.legacyHook && a.permissions === 'on') rows.push({ state: 'warn', label: tr('Hook de permissão antigo junto com o plugin'), detail: tr('Os dois respondem ao mesmo pedido: tire o antigo.'), fix: CMD.hooksOff });

  if (a.usage === 'stale') rows.push({ state: 'info', label: tr('Uso desatualizado'), detail: tr('Os números chegam depois da próxima resposta numa sessão aberta desta conta.') });
  else if (a.usage === 'disabled' && (a.mod === 'on' || a.legacyTap)) {
    rows.push({ state: 'info', label: tr('Uso ainda sem dados'), detail: tr('Chega depois da próxima resposta numa sessão aberta. Numa sessão aberta antes da instalação, rode /reload-plugins ou reabra a sessão.') });
  }
  return rows;
}

function codexRows(a: SetupCodexAccount): SetupRow[] {
  if (a.hooks === 'error') return [{ state: 'warn', label: tr('hooks.json ilegível'), detail: tr('O Habblaud não conseguiu ler o hooks.json desta pasta do Codex: confira se o JSON está válido.') }];
  if (a.hooks === 'missing') return [{ state: 'todo', label: tr('Hooks do Codex não instalados'), detail: tr('Sem eles, o Codex aparece só pelos registros, sem os pedidos de aprovação no escritório.'), fix: CMD.codex }];
  const rows: SetupRow[] = [];
  if (a.hooks === 'partial') rows.push({ state: 'warn', label: tr('Hooks do Codex incompletos'), detail: tr('Faltam alguns eventos: instale de novo.'), fix: CMD.codex });
  else rows.push({ state: 'ok', label: tr('Hooks do Codex'), detail: tr('Depois de instalar ou atualizar, aprove os hooks do Habblaud em /hooks no Codex.') });
  if (!a.permissionHook && a.hooks === 'partial') rows.push({ state: 'todo', label: tr('Aprovações do Codex pelo escritório'), fix: CMD.codex });
  return rows;
}

export function setupSections(r: SetupReport): SetupSection[] {
  const general: SetupRow[] = [];
  if (!r.accounts.length) {
    general.push({
      state: 'todo',
      label: tr('Nenhuma conta encontrada'),
      detail: tr('Abra o Claude Code (ou o Codex) uma vez neste computador, ou indique as pastas em HABBLAUD_CLAUDE_DIRS e HABBLAUD_CODEX_DIRS.'),
    });
  }
  if (r.pty.enabled) general.push({ state: 'ok', label: tr('Terminal interativo ligado'), detail: tr('Projetos, orquestrador e abrir, assumir e encerrar sessões pelo escritório.') });
  else {
    general.push({
      state: 'info',
      label: tr('Terminal interativo desligado'),
      detail: r.pty.reason ? tr('Opcional: liga os Projetos e o orquestrador. Agora: {0}.', [r.pty.reason]) : tr('Opcional: liga os Projetos e o orquestrador.'),
      fix: r.docker ? undefined : r.windows ? CMD.ptyWindows : CMD.pty,
    });
  }
  if (r.docker) general.push({ state: 'info', label: tr('Rodando no Docker'), detail: tr('Os comandos abaixo rodam no computador, na pasta do Habblaud (fora do container).') });
  return [
    { title: tr('Geral'), rows: general },
    ...r.accounts.map((a) => ({ title: a.provider === 'codex' && !/codex/i.test(a.name) ? tr('{0} (Codex)', [a.name]) : a.name, rows: a.provider === 'codex' ? codexRows(a) : claudeRows(a) })),
  ];
}

/** Quantas linhas pedem alguma ação (falta instalar ou instalado com problema). */
export function pendingCount(sections: readonly SetupSection[]): number {
  return sections.reduce((n, s) => n + s.rows.filter((r) => r.state === 'todo' || r.state === 'warn').length, 0);
}

/** Comandos distintos que resolvem as pendências, na ordem em que aparecem. */
export function pendingCommands(sections: readonly SetupSection[]): string[] {
  const out: string[] = [];
  for (const s of sections) for (const r of s.rows) if ((r.state === 'todo' || r.state === 'warn') && r.fix && !out.includes(r.fix)) out.push(r.fix);
  return out;
}
