// Botão "Projetos" na barra de cima: a lista dos seus projetos (nome, pasta, ferramenta e modelo), salva no servidor
// (GET|PUT /api/projects, server/projects/store.ts). "Abrir" começa na hora uma sessão nova do Claude Code ou do Codex,
// no modelo escolhido, nesta pasta: numa janela de terminal do computador (POST /api/projects/open; padrão) ou no
// terminal interativo do Habblaud. Só aparece com o terminal interativo ligado (HABBLAUD_PTY=1).
import { tr } from '../../../shared/i18n';
import type { SavedProject } from '../../../shared/types';
import type { UiContext } from './context';
import { h, iconButton, setText } from './dom';
import { ICONS } from './icons';
import { isValidModel, looksAbsolute, MODEL_SUGGESTIONS, nameFromPath, newProjectId, toolOf, toSaved, type ProjectTool } from './projects-model';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...init });
  } catch {
    throw new Error(tr('o Habblaud não respondeu'));
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? tr('erro {0}', [res.status]));
  return body;
}

export type OpenWhere = 'window' | 'habblaud';
const WHERE_KEY = 'habblaud.projects.where';

function readWhere(): OpenWhere {
  try {
    return localStorage.getItem(WHERE_KEY) === 'habblaud' ? 'habblaud' : 'window';
  } catch {
    return 'window';
  }
}

function writeWhere(w: OpenWhere): void {
  try {
    localStorage.setItem(WHERE_KEY, w);
  } catch {
    // sem armazenamento: vale só nesta página
  }
}

function toolSelect(value: ProjectTool, label: string): HTMLSelectElement {
  const sel = h('select', { class: 'ui-rename__input ui-projects__tool', attrs: { 'aria-label': label } });
  sel.append(h('option', { attrs: { value: 'claude' }, text: 'Claude Code' }), h('option', { attrs: { value: 'codex' }, text: 'Codex' }));
  sel.value = value;
  return sel;
}

/** Campo de modelo com as sugestões da ferramenta (lista própria por campo: a ferramenta pode mudar). */
function modelInput(value: string, tool: ProjectTool, label: string): { input: HTMLInputElement; list: HTMLDataListElement; setTool(t: ProjectTool): void } {
  const id = `ui-projects-models-${Math.random().toString(36).slice(2, 9)}`;
  const list = h('datalist', { attrs: { id } });
  const input = h('input', {
    class: 'ui-rename__input ui-projects__model',
    type: 'text',
    attrs: { list: id, placeholder: tr('modelo padrão'), spellcheck: 'false', autocomplete: 'off', autocapitalize: 'none', maxlength: 80, 'aria-label': label },
  });
  input.value = value;
  const setTool = (t: ProjectTool) => list.replaceChildren(...MODEL_SUGGESTIONS[t].map((m) => h('option', { attrs: { value: m } })));
  setTool(tool);
  return { input, list, setTool };
}

/** Teclas dos campos não vão para o escritório (atalhos como T, P, WASD). */
function keepKeys(el: HTMLElement, onEnter?: () => void): void {
  el.addEventListener('keydown', (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter' && onEnter) {
      e.preventDefault();
      onEnter();
    }
  });
  el.addEventListener('keyup', (e) => e.stopPropagation());
}

export class ProjectsPanel {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private readonly addName: HTMLInputElement;
  private readonly addPath: HTMLInputElement;
  private readonly addTool: HTMLSelectElement;
  private readonly addModel: ReturnType<typeof modelInput>;
  private readonly where: HTMLSelectElement;
  private anchor?: HTMLElement;
  private projects: SavedProject[] = [];
  private busy = false;

  constructor(private readonly ctx: UiContext) {
    this.list = h('ul', { class: 'ui-projects__list', attrs: { 'aria-label': tr('Projetos salvos') } });
    this.status = h('p', { class: 'ui-rename__hint ui-projects__status', attrs: { role: 'status', 'aria-live': 'polite' } });
    this.addName = h('input', { class: 'ui-rename__input', type: 'text', attrs: { maxlength: 60, placeholder: tr('Nome (ex.: Loja)'), 'aria-label': tr('Nome do projeto') } });
    this.addPath = h('input', {
      class: 'ui-rename__input',
      type: 'text',
      attrs: { placeholder: 'C:\\Users\\voce\\projeto', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'none', 'aria-label': tr('Pasta do projeto (caminho absoluto)') },
    });
    this.addTool = toolSelect('claude', tr('Ferramenta do projeto novo'));
    this.addModel = modelInput('', 'claude', tr('Modelo do projeto novo'));
    this.addTool.addEventListener('change', () => this.addModel.setTool(this.addTool.value as ProjectTool));
    this.addPath.addEventListener('change', () => {
      if (!this.addName.value.trim()) this.addName.value = nameFromPath(this.addPath.value);
    });
    for (const f of [this.addName, this.addPath, this.addModel.input]) keepKeys(f, () => void this.add());
    const addBtn = h('button', { class: 'ui-btn', type: 'button', on: { click: () => void this.add() } }, tr('Adicionar'));
    const close = iconButton(ICONS.close, tr('Fechar'), () => this.hide(), 'ui-icon-btn--sm');
    this.where = h('select', { class: 'ui-rename__input ui-projects__where', attrs: { 'aria-label': tr('Onde abrir as sessões') } });
    this.where.append(h('option', { attrs: { value: 'window' }, text: tr('Janela de terminal no computador') }), h('option', { attrs: { value: 'habblaud' }, text: tr('Terminal dentro do Habblaud') }));
    this.where.value = readWhere();
    this.where.addEventListener('change', () => writeWhere(this.where.value === 'habblaud' ? 'habblaud' : 'window'));
    const orchBtn = h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--allow ui-projects__orch', type: 'button', on: { click: () => void this.openOrchestrator() } }, tr('Abrir orquestrador'));
    this.el = h(
      'div',
      { class: 'ui-popover ui-projects', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': tr('Projetos'), id: 'ui-projects', popover: 'auto' } },
      h('div', { class: 'ui-popover__head' }, h('h2', { text: tr('Projetos') }), close),
      h(
        'div',
        { class: 'ui-set-group ui-projects__body' },
        orchBtn,
        h('p', { class: 'ui-rename__hint', text: tr('O orquestrador é um Claude Code (Opus) que recebe as tarefas do dia e abre até 4 sessões nos projetos abaixo. As permissões das sessões continuam vindo para você.') }),
        h('label', { class: 'ui-projects__row ui-projects__where-row' }, h('span', { class: 'ui-spawn__label', text: tr('Abrir em') }), this.where),
        this.list,
        h('p', { class: 'ui-spawn__label', text: tr('Adicionar projeto') }),
        h('div', { class: 'ui-projects__add' }, this.addName, this.addPath, h('div', { class: 'ui-projects__row' }, this.addTool, this.addModel.input, this.addModel.list, addBtn)),
        h('p', { class: 'ui-rename__hint', text: tr('Abrir começa uma sessão nova da ferramenta, no modelo escolhido, nesta pasta: numa janela de terminal do computador ou no terminal do Habblaud. Modelo vazio usa o padrão da ferramenta.') }),
        this.status,
      ),
    );
    this.el.addEventListener('toggle', () => this.anchor?.setAttribute('aria-expanded', String(this.isOpen)));
  }

  get isOpen(): boolean {
    try {
      return this.el.matches(':popover-open');
    } catch {
      return this.el.classList.contains('is-open');
    }
  }

  toggle(anchor: HTMLElement): void {
    this.anchor = anchor;
    if (this.isOpen) return this.hide();
    void this.load();
    const r = anchor.getBoundingClientRect();
    this.el.style.top = `${Math.round(r.bottom + 8)}px`;
    this.el.style.right = `${Math.max(8, Math.round(innerWidth - r.right - 4))}px`;
    if (typeof this.el.showPopover === 'function') this.el.showPopover();
    else this.el.classList.add('is-open');
    anchor.setAttribute('aria-expanded', 'true');
  }

  hide(): void {
    if (typeof this.el.hidePopover === 'function' && this.isOpen) this.el.hidePopover();
    this.el.classList.remove('is-open');
    this.anchor?.setAttribute('aria-expanded', 'false');
  }

  private say(text: string, error = false): void {
    setText(this.status, text);
    this.status.classList.toggle('is-error', error);
  }

  private async load(): Promise<void> {
    try {
      const r = await api<{ projects: SavedProject[] }>('/api/projects');
      this.projects = Array.isArray(r.projects) ? r.projects : [];
      this.render();
      this.say(this.projects.length ? '' : tr('Nenhum projeto ainda: adicione o primeiro abaixo.'));
    } catch (err) {
      this.say(tr('Não deu: {0}', [(err as Error).message]), true);
    }
  }

  private async save(next: SavedProject[]): Promise<boolean> {
    try {
      const r = await api<{ projects: SavedProject[] }>('/api/projects', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projects: next }) });
      this.projects = r.projects;
      this.render();
      return true;
    } catch (err) {
      this.say(tr('Não deu: {0}', [(err as Error).message]), true);
      return false;
    }
  }

  private async add(): Promise<void> {
    const path = this.addPath.value.trim();
    const name = this.addName.value.trim() || nameFromPath(path);
    const model = this.addModel.input.value.trim();
    if (!looksAbsolute(path)) return this.say(tr('Informe a pasta com o caminho absoluto.'), true);
    if (!name) return this.say(tr('Dê um nome ao projeto.'), true);
    if (!isValidModel(model)) return this.say(tr('Nome de modelo inválido.'), true);
    const id = newProjectId(name, new Set(this.projects.map((p) => p.id)));
    if (await this.save([...this.projects, toSaved({ id, name, path, tool: this.addTool.value as ProjectTool, model })])) {
      this.addName.value = '';
      this.addPath.value = '';
      this.addModel.input.value = '';
      this.say(tr('Projeto {0} salvo.', [name]));
    }
  }

  private async update(id: string, patch: { tool: ProjectTool; model: string }): Promise<void> {
    if (!isValidModel(patch.model.trim())) return this.say(tr('Nome de modelo inválido.'), true);
    const next = this.projects.map((p) => (p.id === id ? toSaved({ ...p, ...patch }) : p));
    if (await this.save(next)) this.say(tr('Salvo.'));
  }

  private async remove(p: SavedProject): Promise<void> {
    if (await this.save(this.projects.filter((x) => x.id !== p.id))) this.say(tr('Projeto {0} removido.', [p.name]));
  }

  private async open(p: SavedProject, tool: ProjectTool, model: string): Promise<void> {
    if (this.busy) return;
    const where: OpenWhere = this.where.value === 'habblaud' ? 'habblaud' : 'window';
    const router = this.ctx.terminals;
    if (where === 'habblaud' && !router?.interactiveEnabled) return this.say(tr('Ligue o terminal interativo (HABBLAUD_PTY=1) para abrir sessões daqui.'), true);
    this.setBusy(true);
    this.say(tr('Abrindo {0}…', [p.name]));
    try {
      if (where === 'window') {
        await api('/api/projects/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, tool, model: model.trim() }) });
        this.say(tr('{0} aberto numa janela de terminal no computador. Ele aparece no escritório quando a sessão começar.', [p.name]));
        this.ctx.announce(tr('{0} aberto numa janela de terminal.', [p.name]));
      } else {
        await router!.newSession(p.path, undefined, { tool, model: model.trim() || undefined });
        this.say('');
        this.hide();
      }
    } catch (err) {
      this.say(tr('Não deu: {0}', [(err as Error).message]), true);
    } finally {
      this.setBusy(false);
    }
  }

  /** Enquanto abre, os botões Abrir ficam desligados (um clique, uma sessão). */
  private setBusy(on: boolean): void {
    this.busy = on;
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('.ui-projects__open, .ui-projects__orch')) b.disabled = on;
  }

  private async openOrchestrator(): Promise<void> {
    const router = this.ctx.terminals;
    if (!router?.interactiveEnabled) return this.say(tr('Ligue o terminal interativo (HABBLAUD_PTY=1) para abrir sessões daqui.'), true);
    if (this.busy) return;
    this.setBusy(true);
    this.say(tr('Abrindo o orquestrador…'));
    try {
      await router.orchestrator();
      this.say('');
      this.hide();
    } catch (err) {
      this.say(tr('Não deu: {0}', [(err as Error).message]), true);
    } finally {
      this.setBusy(false);
    }
  }

  private render(): void {
    this.list.replaceChildren(
      ...this.projects.map((p) => {
        const tool = toolSelect(toolOf(p), tr('Ferramenta de {0}', [p.name]));
        const model = modelInput(p.model ?? '', toolOf(p), tr('Modelo de {0}', [p.name]));
        const persist = () => void this.update(p.id, { tool: tool.value as ProjectTool, model: model.input.value });
        tool.addEventListener('change', () => {
          model.setTool(tool.value as ProjectTool);
          persist();
        });
        model.input.addEventListener('change', persist);
        keepKeys(model.input, () => void this.open(p, tool.value as ProjectTool, model.input.value));
        const openBtn = h('button', { class: 'ui-btn ui-perm__btn ui-perm__btn--allow ui-projects__open', type: 'button', on: { click: () => void this.open(p, tool.value as ProjectTool, model.input.value) } }, tr('Abrir'));
        const del = iconButton(ICONS.close, tr('Remover {0}', [p.name]), () => void this.remove(p), 'ui-icon-btn--sm');
        return h(
          'li',
          { class: 'ui-projects__item' },
          h('div', { class: 'ui-projects__head' }, h('span', { class: 'ui-spawn__folder-name', text: p.name }), del),
          h('span', { class: 'ui-spawn__folder-path', text: p.path, attrs: { title: p.path } }),
          h('div', { class: 'ui-projects__row' }, tool, model.input, model.list, openBtn),
        );
      }),
    );
  }
}
