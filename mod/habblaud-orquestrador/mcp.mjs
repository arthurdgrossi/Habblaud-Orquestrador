#!/usr/bin/env node
// MCP do Habblaud para o orquestrador (stdio, JSON-RPC 2.0, uma mensagem JSON por linha). Node puro, sem dependências.
// O Habblaud abre o orquestrador (POST /api/pty/orchestrator) com este servidor em `--mcp-config`; as ferramentas
// chamam a API local do Habblaud (http://127.0.0.1:<HABBLAUD_PORT>, padrão 4747). O Habblaud é quem garante as
// regras: no máximo 4 terminais abertos pelo orquestrador, sessões só em pastas de verdade, permissões sempre com a
// pessoa (este servidor não tem ferramenta para aprovar nada).
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const PORT = Number.parseInt(process.env.HABBLAUD_PORT ?? '', 10) || 4747;
const BASE = `http://127.0.0.1:${PORT}`;
const SERVER_INFO = { name: 'habblaud', version: '1.0.0' };
const PROTOCOL = '2025-06-18';
/** Antes de apertar Enter: o Claude Code trata texto + Enter chegando juntos como colagem (o Enter vira quebra de linha). */
const SUBMIT_DELAY_MS = 250;

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`o Habblaud não respondeu em ${BASE} (ele está aberto?)`);
  }
  if (res.status === 204) return undefined;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `erro ${res.status}`);
  return json;
}

const STATUS = { working: 'trabalhando', waiting: 'esperando você', idle: 'parado', shell: 'esperando um comando', done: 'terminou', offline: 'fora' };

/** Resumo do escritório para o orquestrador: agentes principais com sala, status e atividade, e os terminais. */
export function summarize(snap) {
  const rooms = new Map((snap.rooms ?? []).map((r) => [r.id, r]));
  const ptys = snap.ptys ?? [];
  const ptyOf = new Map(ptys.filter((p) => p.exitedAt === undefined).map((p) => [p.agentId, p]));
  const agents = (snap.agents ?? [])
    .filter((a) => a.kind === 'main')
    .map((a) => {
      const room = rooms.get(a.roomId);
      const pty = ptyOf.get(a.id);
      const out = {
        agente_id: a.id,
        nome: a.name,
        ferramenta: a.provider === 'codex' ? 'codex' : 'claude',
        status: STATUS[a.status] ?? a.status,
        projeto: room?.name,
        pasta: room?.path,
        atividade: a.activity?.text,
      };
      if (a.waitingFor) out.esperando = a.waitingFor;
      if (a.model) out.modelo = a.model;
      if (a.tasks?.length) out.tarefas = a.tasks.map((t) => `${t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '…' : '·'} ${t.title ?? ''}`.trim()).slice(0, 12);
      if (pty) {
        out.terminal_id = pty.id;
        if (pty.by === 'orchestrator') out.aberto_por_voce = true;
        if (pty.role === 'orchestrator') out.e_voce = true;
      }
      return out;
    });
  const linked = new Set(agents.map((a) => a.terminal_id).filter(Boolean));
  // Terminais sem personagem ligado (o Codex chega com outro id; uma sessão recém-aberta ainda não entrou).
  const terminais = ptys
    .filter((p) => p.exitedAt === undefined && !linked.has(p.id) && p.role !== 'orchestrator')
    .map((p) => ({ terminal_id: p.id, pasta: p.cwd, ferramenta: p.tool === 'codex' ? 'codex' : 'claude', modelo: p.model, aberto_por_voce: p.by === 'orchestrator' }));
  const abertos = ptys.filter((p) => p.exitedAt === undefined && p.by === 'orchestrator').length;
  return { agentes: agents, terminais_sem_agente: terminais, abertos_por_voce: abertos, limite: 4 };
}

function findProject(projects, ref) {
  const want = String(ref ?? '').trim().toLowerCase();
  return projects.find((p) => p.id.toLowerCase() === want) ?? projects.find((p) => p.name.toLowerCase() === want);
}

const TOOLS = [
  {
    name: 'listar_projetos',
    description: 'Lista os projetos salvos no Habblaud (botão Projetos): id, nome, pasta, ferramenta e modelo padrão. As sessões só abrem nesses projetos.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async () => (await call('GET', '/api/projects')).projects,
  },
  {
    name: 'listar_agentes',
    description:
      'Mostra o escritório agora: cada agente principal com status (trabalhando, esperando você, parado...), projeto, atividade atual, tarefas e o terminal; quais terminais você abriu e quantos ainda pode abrir (limite 4).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    run: async () => summarize(await call('GET', '/api/snapshot')),
  },
  {
    name: 'abrir_sessao',
    description:
      'Abre uma sessão nova (terminal interativo no Habblaud) num projeto salvo, já com a tarefa. Ferramenta e modelo: os do projeto, se não forem informados. Modelos do Claude Code: opus, sonnet, haiku. No máximo 4 sessões abertas por você ao mesmo tempo.',
    inputSchema: {
      type: 'object',
      properties: {
        projeto: { type: 'string', description: 'id ou nome do projeto (de listar_projetos)' },
        tarefa: { type: 'string', description: 'a tarefa completa, que se explica sozinha: objetivo, área, critério de pronto, o que não fazer' },
        ferramenta: { type: 'string', enum: ['claude', 'codex'] },
        modelo: { type: 'string', description: 'ex.: opus, sonnet, haiku; vazio = o do projeto ou o padrão da ferramenta' },
      },
      required: ['projeto', 'tarefa'],
      additionalProperties: false,
    },
    run: async (a) => {
      const projects = (await call('GET', '/api/projects')).projects ?? [];
      const p = findProject(projects, a.projeto);
      if (!p) throw new Error(`projeto não encontrado: ${a.projeto}. Projetos: ${projects.map((x) => `${x.id} (${x.name})`).join(', ') || 'nenhum salvo'}`);
      const tool = a.ferramenta ?? (p.tool === 'codex' ? 'codex' : 'claude');
      const model = a.modelo || (tool === (p.tool === 'codex' ? 'codex' : 'claude') ? p.model : undefined);
      const info = await call('POST', '/api/pty', { cwd: p.path, tool, model, prompt: a.tarefa, by: 'orchestrator', cols: 120, rows: 32 });
      return { aberto: true, terminal_id: info.id, agente_id: tool === 'claude' ? info.agentId : undefined, projeto: p.name, ferramenta: tool, modelo: model ?? 'padrão' };
    },
  },
  {
    name: 'mandar_mensagem',
    description: 'Manda um texto para um agente: o próximo passo, uma correção ou uma pergunta. Use o agente_id (ou o terminal_id) de listar_agentes.',
    inputSchema: {
      type: 'object',
      properties: { agente_id: { type: 'string' }, terminal_id: { type: 'string' }, texto: { type: 'string' } },
      required: ['texto'],
      additionalProperties: false,
    },
    run: async (a) => {
      const snap = await call('GET', '/api/snapshot');
      const live = (snap.ptys ?? []).filter((p) => p.exitedAt === undefined);
      const pty = live.find((p) => (a.terminal_id && p.id === a.terminal_id) || (a.agente_id && p.agentId === a.agente_id));
      if (pty) {
        // Terminal aberto no Habblaud: digita como a pessoa digitaria.
        await call('POST', `/api/pty/${encodeURIComponent(pty.id)}/input`, { data: a.texto });
        await new Promise((ok) => setTimeout(ok, SUBMIT_DELAY_MS));
        await call('POST', `/api/pty/${encodeURIComponent(pty.id)}/input`, { data: '\r' });
        return { enviado: true, pelo: 'terminal', terminal_id: pty.id };
      }
      if (!a.agente_id) throw new Error('terminal não encontrado (ele já fechou?); informe o agente_id');
      const m = await call('POST', '/api/messages', { agentId: a.agente_id, text: a.texto });
      return { enviado: true, pelo: 'caixa de mensagens', situacao: m?.status ?? 'na fila' };
    },
  },
  {
    name: 'encerrar_sessao',
    description: 'Encerra uma sessão que você abriu (a conversa fica salva). Use quando a tarefa dela terminou.',
    inputSchema: {
      type: 'object',
      properties: { terminal_id: { type: 'string' }, agente_id: { type: 'string' } },
      additionalProperties: false,
    },
    run: async (a) => {
      const snap = await call('GET', '/api/snapshot');
      const pty = (snap.ptys ?? []).find((p) => p.exitedAt === undefined && ((a.terminal_id && p.id === a.terminal_id) || (a.agente_id && p.agentId === a.agente_id)));
      if (!pty) throw new Error('sessão não encontrada entre os terminais abertos');
      if (pty.by !== 'orchestrator') throw new Error('essa sessão não foi aberta por você: peça para a pessoa encerrar');
      await call('POST', `/api/pty/${encodeURIComponent(pty.id)}/close`, {});
      return { encerrado: true, terminal_id: pty.id };
    },
  },
];

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}
function replyError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`);
}

export async function handle(msg) {
  const { id, method, params } = msg ?? {};
  if (id === undefined || id === null) return; // notificação (ex.: notifications/initialized)
  if (method === 'initialize') {
    return reply(id, { protocolVersion: typeof params?.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
  }
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS.map(({ run: _run, ...t }) => t) });
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params?.name);
    if (!tool) return replyError(id, -32602, `ferramenta desconhecida: ${params?.name}`);
    try {
      const out = await tool.run(params?.arguments ?? {});
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] });
    } catch (err) {
      return reply(id, { content: [{ type: 'text', text: `Erro: ${err?.message ?? err}` }], isError: true });
    }
  }
  return replyError(id, -32601, `método desconhecido: ${method}`);
}

function main() {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return replyError(null, -32700, 'JSON inválido');
    }
    void handle(msg);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
