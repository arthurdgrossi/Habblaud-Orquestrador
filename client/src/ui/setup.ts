// Configurações › Diagnóstico: o que falta instalar em cada conta (GET /api/setup), com o comando que resolve e um
// botão de copiar. Carrega ao abrir as Configurações e no "Verificar de novo"; só no acesso local (o servidor recusa
// pela porta remota). As linhas vêm de setup-model.ts.
import { access } from '../net/access';
import type { UiContext } from './context';
import { copyText, h, iconButton, setHidden, setText, setTitle } from './dom';
import { ICONS } from './icons';
import { pendingCount, setupSections, type SetupRow, type SetupRowState } from './setup-model';
import { tr } from '../../../shared/i18n';
import type { SetupReport } from '../../../shared/types';

const MARK: Record<SetupRowState, string> = { ok: '✓', todo: '!', warn: '!', info: 'i' };

function stateLabel(s: SetupRowState): string {
  return s === 'ok' ? tr('ok') : s === 'todo' ? tr('falta instalar') : s === 'warn' ? tr('atenção') : tr('informação');
}

function copyButton(cmd: string): HTMLButtonElement {
  const label = tr('Copiar o comando');
  const b = iconButton(
    ICONS.copy,
    label,
    async () => {
      const ok = await copyText(cmd);
      b.classList.toggle('is-done', ok);
      b.innerHTML = ok ? ICONS.check : ICONS.copy;
      setTitle(b, ok ? tr('Copiado!') : tr('Não foi possível copiar'));
      setTimeout(() => {
        b.classList.remove('is-done');
        b.innerHTML = ICONS.copy;
        setTitle(b, label);
      }, 1400);
    },
    'ui-icon-btn--sm',
  );
  return b;
}

function rowEl(r: SetupRow): HTMLElement {
  const li = h(
    'li',
    { class: `ui-setup__row is-${r.state}` },
    h('span', { class: 'ui-setup__mark', text: MARK[r.state], attrs: { 'aria-label': stateLabel(r.state), role: 'img' } }),
    h('div', { class: 'ui-setup__text' }, h('span', { class: 'ui-set__label', text: r.label }), r.detail ? h('span', { class: 'ui-set__hint', text: r.detail }) : null),
  );
  if (r.fix) li.querySelector('.ui-setup__text')!.append(h('div', { class: 'ui-setup__fix' }, h('code', { text: r.fix }), copyButton(r.fix)));
  return li;
}

export class SetupGroup {
  readonly el: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly body: HTMLElement;
  private readonly refreshBtn: HTMLButtonElement;
  private loading = false;

  constructor(private readonly ctx: UiContext) {
    this.summary = h('p', { class: 'ui-set__hint', attrs: { role: 'status', 'aria-live': 'polite' } });
    this.body = h('div', { class: 'ui-setup__body' });
    this.refreshBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Verificar de novo'), on: { click: () => void this.refresh() } }) as HTMLButtonElement;
    this.el = h(
      'div',
      { class: 'ui-set-group ui-setup', hidden: true },
      h('h3', { text: tr('Diagnóstico') }),
      this.summary,
      this.body,
      h('p', { class: 'ui-set__hint', text: tr('Os comandos rodam num terminal, na pasta do Habblaud. Depois, clique em Verificar de novo.') }),
      this.refreshBtn,
    );
  }

  /** Visível só no acesso local, fora do demo e do timelapse. */
  render(): void {
    const { store } = this.ctx;
    setHidden(this.el, !access().local || store.mock);
  }

  async refresh(): Promise<void> {
    if (this.loading || !access().local || this.ctx.store.mock) return;
    this.loading = true;
    this.refreshBtn.disabled = true;
    setText(this.summary, tr('Verificando…'));
    try {
      const res = await fetch('/api/setup', { credentials: 'same-origin', cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as SetupReport & { error?: string };
      if (!res.ok) throw new Error(body.error ?? tr('erro {0}', [res.status]));
      this.show(body);
    } catch (err) {
      setText(this.summary, tr('Não deu para verificar: {0}', [(err as Error).message]));
      this.body.replaceChildren();
    } finally {
      this.loading = false;
      this.refreshBtn.disabled = false;
    }
  }

  private show(r: SetupReport): void {
    const sections = setupSections(r);
    const n = pendingCount(sections);
    setText(this.summary, n ? (n === 1 ? tr('1 pendência: veja abaixo o comando que resolve.') : tr('{0} pendências: veja abaixo o comando que resolve cada uma.', [n])) : tr('Tudo certo: nada falta instalar.'));
    this.el.classList.toggle('has-pending', n > 0);
    this.body.replaceChildren(
      ...sections
        .filter((s) => s.rows.length)
        .map((s) => h('section', { class: 'ui-setup__section' }, h('h4', { class: 'ui-setup__title', text: s.title }), h('ul', { class: 'ui-setup__list' }, ...s.rows.map(rowEl)))),
    );
  }
}
