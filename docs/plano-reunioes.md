# Plano: reuniões no Habblaud

> Rascunho para decisão. Nada disto está implementado. Leitura de ~10 minutos.

## Resumo e recomendação

A ideia é ter uma **sala de reuniões** no escritório. O Arthur clica nela, escolhe quais agentes participam e começa
uma conversa por turnos com o orquestrador (Guilherme) moderando. Primeiro em texto, depois por voz.

**Por onde começar:** uma **reunião em texto num painel**, sem sala no mapa e sem voz, montada sobre peças que o
Habblaud já tem:
- a fala chega a cada agente pela **caixa de mensagens** que já existe;
- a resposta volta lida do **transcript**, como as Entregas já fazem;
- o servidor guarda a reunião, a fila de turnos e a ata.

Isso prova o que é difícil (turnos, contexto e o que acontece com o trabalho do agente) em 2 a 4 dias. A sala no
mapa e a voz entram depois, por cima. A voz em si é a parte mais fácil: o Habblaud já transcreve fala localmente
(Whisper) e o navegador já fala (`speechSynthesis`).

Uma expectativa precisa ficar clara desde já: **não vai ser uma conversa em tempo real**. Cada agente leva de
segundos a minutos para responder. A boa experiência aqui é a de uma **reunião por turnos bem moderada**, não a de
uma chamada de vídeo.

---

## 1. O que o Habblaud já tem e dá para reaproveitar

| Peça | Onde está | Como serve à reunião |
|---|---|---|
| Estado de cada agente (status, atividade, tarefas, sala, se recebe mensagens) | `shared/types.ts` (`AgentInfo`), `server/model/office.ts` | Escolher participantes, mostrar quem está livre e quem está ocupado, saber quando alguém terminou de responder (`status` volta a `idle`). |
| Caixa de mensagens | `server/messages/registry.ts` + plugin `mod/habblaud-mensagens` | Entrega o texto na sessão como se a pessoa tivesse digitado (`$.prompt.submit({asUser: true})`). Com a sessão ocupada, espera o fim do turno. É o canal de **ida** da reunião. |
| Leitura do transcript | `server/sources/terminal.ts`, `server/deliveries/deliveries.ts` | As Entregas já separam "o pedido" e "a resposta" de cada turno. É o canal de **volta**: a última resposta em texto depois da mensagem da reunião. |
| MCP do orquestrador | `mod/habblaud-orquestrador/mcp.mjs` | Já tem `listar_agentes`, `mandar_mensagem`, `abrir_sessao` e `encerrar_sessao`. Ganharia ferramentas de reunião (ver §4). |
| Regra de permissões | `server/pty/manager.ts` (`orchestratorSend`) | O orquestrador não digita em sessões da pessoa e nunca com o agente esperando uma permissão. A reunião herda isso. |
| Ditado (fala para texto) | `server/dictation/*` + microfone do Novo agente | Whisper **local** (`whisper-cli`), sem mandar a voz para fora. É o STT da reunião. |
| Áudio no navegador | `client/src/audio/*` | Sons sintetizados (WebAudio). Serve para os avisos de "sua vez" e "reunião começou". |
| Vida social no mapa | `client/src/world/social/*` | Já leva personagens até lugares e os faz "conversar" com balões. Base para andar até a sala e sentar à mesa. |
| Núcleo do prédio | `client/src/world/layout/core.ts` | Recepção, banheiros, copa e lounge têm layout fixo. A sala de reuniões seria mais uma área do núcleo. |
| Ata em disco | padrão `~/.habblaud/*` (projetos, timeline) | Onde salvar ata, decisões e tarefas (`~/.habblaud/meetings/`). |

**O que falta:** um registro de reuniões no servidor (participantes, pauta, fila de turnos, transcrição), a UI da
reunião, a sala no mapa e a voz de saída (TTS).

---

## 2. A experiência

1. **Abrir.** No mapa, uma **Sala de reuniões** no núcleo do prédio. No MVP, um botão na barra de cima faz o mesmo.
   Clicar abre o painel da reunião.
2. **Montar.** Escolher os participantes numa lista com status:
   - livre: pode ser chamado;
   - trabalhando: aparece como "ocupado" e entra quando terminar o turno;
   - esperando você: não pode ser chamado até a permissão ser resolvida.

   O orquestrador entra sempre como moderador. Escrever uma **pauta** curta (3 a 5 itens).
3. **Entrar.** Os personagens escolhidos andam até a sala e se sentam. Quem estava trabalhando termina o turno
   antes (ver §4). Um aviso diz "Reunião começou" para cada um.
4. **Turnos.** O orquestrador abre o item da pauta e **passa a palavra** a um agente por vez. Cada resposta aparece
   no painel (e é falada, na fase de voz). Regras:
   - uma fala por vez, e o orquestrador decide a próxima;
   - limite de tamanho por fala (ex.: 120 palavras), pedido na própria mensagem da reunião;
   - quem já falou no item só fala de novo se o orquestrador chamar.
5. **Arthur interrompe.** Um botão **Levantar a mão** (ou segurar espaço para falar) põe o Arthur **na frente da
   fila**. A fala em andamento (TTS) para na hora. A fala dele vai para o orquestrador, que decide o que fazer.
   Uma resposta que um agente já está gerando não dá para cancelar sem mexer na sessão. Ela chega e fica marcada
   como "chegou depois da interrupção".
6. **Encerrar.** O Arthur clica em **Encerrar**, ou o orquestrador propõe encerrar ao fim da pauta. Os agentes
   voltam às mesas.
7. **O que sobra:** um arquivo `~/.habblaud/meetings/AAAA-MM-DD-HHMM.md` com:
   - participantes e pauta;
   - transcrição completa;
   - **decisões** e **tarefas** (quem, o quê), redigidas pelo orquestrador no fim.

   As tarefas viram sugestões que **o Arthur confirma**. Só então o orquestrador as distribui (`abrir_sessao` ou
   `mandar_mensagem`).

---

## 3. A voz

### Captura (STT)

| Opção | Privacidade | Custo | Latência | Observações |
|---|---|---|---|---|
| **Whisper local (já existe)** | A voz não sai do computador | Zero | 1 a 5 s por fala, conforme o modelo e a máquina | Transcreve o áudio inteiro depois de soltar o botão. Precisa de `whisper-cli`, `ffmpeg` e um modelo; o Diagnóstico pode avisar quando faltar. |
| Web Speech API do navegador (`SpeechRecognition`) | No Chrome, o áudio vai para o serviço do Google | Zero | Quase imediata, com texto parcial | Não funciona em todo navegador. Bom como opção "rápida" desligada por padrão. |
| STT na nuvem (OpenAI, Google, Azure, Deepgram…) | O áudio vai para o fornecedor | Cobrança por minuto de áudio | Baixa, com streaming | Exige chave de API e conta. Preços mudam: conferir antes de escolher. |

**Recomendação:** começar com **apertar para falar + Whisper local**. É o que o Habblaud já faz no ditado, e a voz
fica na máquina.

### Resposta falada (TTS)

| Opção | Privacidade | Custo | Qualidade |
|---|---|---|---|
| **`speechSynthesis` do navegador** | Vozes do sistema; no Windows e no macOS são locais | Zero | Robótica, mas compreensível. Várias vozes por idioma. |
| TTS na nuvem (OpenAI, ElevenLabs, Azure, Google) | O texto da fala vai para o fornecedor | Cobrança por caractere ou minuto | Natural. Algumas permitem muitas vozes distintas. |
| TTS local (ex.: Piper) | Local | Zero | Boa. Exige instalar um binário e modelos de voz, como o Whisper. |

**Vozes por agente:** a voz sai do `seed` do personagem, como a aparência. Cada agente sempre soa igual, e a voz do
orquestrador fica fixa. Velocidade e tom variam um pouco por personalidade (`social/persona.ts`).

**Recomendação:** `speechSynthesis` no início, sem custo e sem configuração. TTS local ou na nuvem fica como opção
depois, escolhida nas Configurações, com aviso claro de privacidade quando for na nuvem.

### Latência realista de um turno

Fala do Arthur → STT (1 a 5 s) → orquestrador decide (5 a 20 s) → agente responde (5 s a alguns minutos, se usar
ferramentas) → TTS (imediato). Por isso:
- mostrar "Guilherme está pensando…" e "vez de Ana" no painel e nos balões do mapa;
- pedir respostas curtas e **sem usar ferramentas** durante a reunião (instrução na mensagem, ver §5);
- **fallback em texto** sempre: tudo o que é falado também aparece escrito, e dá para digitar em vez de falar.

---

## 4. Arquitetura

### Quem guarda o quê

- **Servidor (`server/meetings/`, novo):** `MeetingRegistry` com a reunião ativa (uma por vez no MVP), os
  participantes, a pauta, a fila de turnos, a transcrição e o estado ("aberta", "vez de X", "encerrada"). Também
  grava a ata. É a **fonte da verdade**, auditável e independente de qualquer modelo.
- **Orquestrador:** decide **quem fala** e redige a ata. Ganha ferramentas no MCP:
  - `reuniao_estado`: pauta, participantes, transcrição recente;
  - `reuniao_passar_palavra {agente_id, pergunta}`: o servidor manda a pergunta ao agente;
  - `reuniao_falar {texto}`: a fala do próprio orquestrador;
  - `reuniao_registrar {decisoes, tarefas}`;
  - `reuniao_encerrar`.
- **Navegador:** painel da reunião, microfone, TTS e a sala no mapa. Recebe o estado pelo SSE que já existe
  (`OfficeSnapshot` ganha `meeting?`).

### Como a fala vai e volta

1. O servidor monta a mensagem do turno: um cabeçalho fixo, o contexto e a pergunta. Exemplo:

   ```
   [Reunião no Habblaud, sua vez] Pauta: … Últimas falas: … Pergunta do Guilherme: …
   Responda em até 120 palavras, sem usar ferramentas.
   ```

   A mensagem vai pela **caixa de mensagens** (`MessageRegistry`).
2. O plugin entrega a mensagem quando a sessão está livre.
3. O servidor acompanha o transcript daquela sessão e pega **a primeira resposta em texto depois daquele prompt**.
   É a mesma lógica das Entregas: o pedido vai de um prompt até o seguinte. A resposta vira a fala na transcrição.
4. Prazo por turno (ex.: 3 min). Passou disso, "Ana não respondeu a tempo" e a vez passa adiante.

### O agente em reunião deixa de trabalhar?

| Opção | Como | A favor | Contra |
|---|---|---|---|
| **A. Mesma sessão (recomendada no MVP)** | A pergunta entra como um prompt normal na sessão do agente | Ele responde com todo o contexto do que estava fazendo; não precisa de nada novo | Interrompe o trabalho: a pergunta só entra no fim do turno, e a resposta fica no histórico da sessão. Um agente no meio de uma tarefa longa demora a "entrar". |
| B. Sessão separada | Abrir uma cópia da conversa para a reunião (`claude --resume <sessão>` com bifurcação, a verificar se o Claude Code atual suporta), ou uma sessão nova só com um resumo | O trabalho original segue; a reunião não suja o histórico | Mais terminais e mais custo de tokens; a cópia não vê o que o original fizer depois; precisa do terminal interativo. |
| C. Só ouvinte | O agente não recebe nada; o orquestrador fala por ele usando o que o Habblaud já sabe (atividade, tarefas, entregas) | Zero interrupção | Não é uma conversa de verdade. Serve para "status da equipe". |

**Recomendação:** começar com **A** só para agentes **livres**, e **C** para os ocupados (o orquestrador resume o
que eles estão fazendo). **B** fica para uma fase posterior, depois de confirmar o suporte do Claude Code.

### Contexto compartilhado

Cada agente só vê o que lhe é mandado. O servidor monta o contexto de cada turno: pauta, item atual e as últimas N
falas (resumidas pelo orquestrador quando passarem de um limite). A transcrição completa fica no servidor e na ata,
nunca inteira na mensagem.

### Codex

As sessões do Codex não têm o plugin de mensagens. A entrega depende do binário do Codex (`codex queue`, já usado
em `server/messages/codex.ts`). Sem ele, o agente do Codex entra só como **ouvinte** (opção C). Hoje este
computador está nesse caso: o log avisa que o binário do Codex não está no PATH.

---

## 5. Riscos e perguntas em aberto

**Permissões (regra fixa):**
- Pedidos de permissão das sessões continuam indo **só para o Arthur**, no escritório, como hoje.
- O orquestrador **não ganha** ferramenta de aprovar, nem em reunião.
- O servidor **não manda turno** a agente que está "esperando você". O mesmo vale para o turno em andamento: se o
  agente parar para pedir permissão, a vez passa adiante e o pedido continua com o Arthur.
- "Sem usar ferramentas" vai na mensagem, mas é só um pedido. Se o agente usar ferramentas mesmo assim, as
  permissões continuam funcionando normalmente, e o prazo do turno evita travar a reunião.

**Outros riscos:**
- **Custo de tokens:** cada turno é um prompt numa sessão com contexto grande. Uma reunião de 5 agentes × 10 turnos
  pode custar caro. É preciso limitar turnos e tamanho, e mostrar o uso da conta, que o Habblaud já mede.
- **Histórico das sessões:** na opção A, a reunião fica no histórico do agente e pode desviar o trabalho dele
  depois. O cabeçalho "[Reunião]" e um "[Fim da reunião, volte ao que estava fazendo]" ajudam.
- **Respostas fora de ordem:** um agente lento responde depois que a vez passou. A resposta entra marcada como
  atrasada, sem furar a fila.
- **Privacidade da voz:** STT e TTS locais por padrão. Nuvem só por escolha explícita, com aviso.
- **Acesso pelo celular:** a reunião manda mensagens às sessões. Deveria exigir o mesmo acesso de "mensagens"
  (`--allow messages`), e o microfone pelo celular só funciona com HTTPS.

**Perguntas para o Arthur:**
1. Reunião só com agentes livres no começo (opção A + C), ou é importante já poder "puxar" quem está trabalhando?
2. As tarefas da ata são distribuídas pelo orquestrador **depois de você confirmar** (proposta), ou só registradas?
3. Voz local (de graça, robótica) basta no começo, ou a qualidade da voz é parte do valor desde o início?
4. A sala no mapa é essencial no MVP, ou um botão na barra serve até a reunião provar valor?
5. Limite de participantes por reunião (sugestão: até 4 agentes + orquestrador)?

---

## 6. Fases e esforço

Estimativas grosseiras, em dias de trabalho focado (de uma pessoa ou de uma sessão de agente bem dirigida), já
contando testes e traduções.

| Fase | O que entrega | Esforço |
|---|---|---|
| **0. Reunião em texto (MVP)** | `MeetingRegistry` no servidor; painel com participantes, pauta, transcrição e campo de texto; turnos manuais (o Arthur escolhe quem fala); ida pela caixa de mensagens, volta pelo transcript; prazo por turno; ata em Markdown. Só agentes livres (A) e ouvintes (C). | 2 a 4 dias |
| **1. Orquestrador modera** | Ferramentas `reuniao_*` no MCP; o orquestrador passa a palavra, resume e redige decisões e tarefas; o Arthur confirma as tarefas antes da distribuição. | 2 a 3 dias |
| **2. Voz** | Apertar para falar com o Whisper local (reaproveita o ditado); TTS com `speechSynthesis` e uma voz por agente; interrupção (para o TTS e põe o Arthur na frente da fila); fallback em texto sempre. | 2 a 3 dias |
| **3. Sala no mapa** | Área nova no núcleo do prédio (mesa, cadeiras, tela); personagens andam até a sala e sentam; balão de "falando" e de "vez de"; clicar na sala abre o painel. | 3 a 5 dias (arte e layout) |
| **4. Opções** | Sessão separada para a reunião (B), STT/TTS local melhor (Piper) ou na nuvem, Codex como participante pleno, reunião pelo celular. | Conforme a escolha |

**Começar pela fase 0.** Ela responde às perguntas que podem derrubar a ideia (custo por turno, tempo de resposta,
se a reunião atrapalha o trabalho dos agentes) com o mínimo de código. Se ela funcionar bem em texto, a voz e o
mapa só melhoram uma coisa que já se provou útil.
