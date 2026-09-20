-- ============================================================================
--  MANUAL DO AURIA no banco (item 52) — gerado por gen_manual_sql.py a partir de
--  docs/manual_auria.md. Reaplicável: substitui todos os capítulos.
--  ajuda_manual(): devolve o texto com SÓ os capítulos do papel de quem chama.
-- ============================================================================
create table if not exists public.ajuda_manual_auria (
  capitulo int primary key, titulo text not null, corpo text not null, atualizado_em timestamptz default now());
alter table public.ajuda_manual_auria enable row level security;
revoke all on public.ajuda_manual_auria from anon, authenticated;   -- só via RPC
delete from public.ajuda_manual_auria;
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (0, $man$Introdução$man$, $man$# Manual do Auria

> Fonte única da ajuda do Auria: alimenta o assistente de IA (suporte) e a página de ajuda. Escrito a partir do sistema em produção (set/2026).

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (1, $man$O que é o Auria$man$, $man$## 1. O que é o Auria

O Auria é a plataforma de **coordenação de projetos com BIM** para construtoras. Reúne, num só lugar e com papéis bem definidos:

- **CDE** — ambiente comum de dados (ISO 19650) com controle de revisão, estados de liberação, QR por prancha, busca no conteúdo dos PDFs e **modelos BIM (IFC)** convertidos para visualização 3D no navegador.
- **Auria App** — a estação de trabalho da coordenação: pranchas 2D e modelos 3D federados lado a lado, apontamentos ancorados na prancha ou na peça, medições, cortes, caminhar pelo modelo, propriedades IFC, filtros e regras de verificação, e uma **IA integrada** para análise avançada de pranchas e documentação (leitura de trechos da prancha, achados que viram apontamentos, assistente com visão).
- **Apontamentos** — compatibilização com três faixas de visibilidade (coordenação, projeto, público), prazos, responsáveis por disciplina, mensagens e negociação de prazo, indicadores por empreendimento.
- **Contratação e custos** — cotação de projetistas, propostas, mapa de equalização (MDE) com R$/m², contrato automático, parcelas por etapa, autorização de faturamento, aditivos, notas fiscais com janela de recebimento e painel administrativo-financeiro.
- **Acessos** — matriz por disciplina para fornecedores, níveis para obra, setor interno, visualizador, e acesso temporário por link.
- **Cronograma, agenda, kanban e mensagens** por empreendimento.

**Endereço:** `https://auria.solutions` — login único; o sistema abre o painel certo para o seu papel.

### Estrutura

- **Grupo** — a conta-cliente (ex.: um grupo construtor). Tem gestores, analistas e adm-fin.
- **Empresa (construtora)** — construtoras do grupo. Cada uma tem sigla, logo e **padrão de codificação** (convenção com a lista de disciplinas).
- **Empreendimento** — a obra/projeto. Tem sigla, logo, construtora, ficha, pavimentos, cronograma, CDE, contratos, cotações.
- **Disciplinas** — áreas de projeto (ARQ, EST, HID…). A convenção da construtora lista todas; cada empreendimento **ativa** só as que usa.

### Papéis

| Papel | Quem | Painel |
|---|---|---|
| **Gestor** | Diretoria/gerência do grupo | Painel da Gestão |
| **Analista** | Coordenador de projetos da construtora | Painel do Analista + Auria App + CDE |
| **Projetista** | Escritório contratado (fornecedor) e seus profissionais | Painel do Projetista |
| **Adm-fin** | Administrativo-financeiro do grupo | Painel Administrativo Financeiro |
| **Obra** | Equipe de canteiro — engenheiro chefe, coordenação de campo, equipe de campo | Página da Obra / CDE |
| **Setor interno** | Orçamento, suprimentos, planejamento | Consulta ao CDE |
| **Acesso temporário** | Convidado por link, por prazo (ex.: escritório orçando) | Página do link |
| **Super admin** | Administração do Auria (grupos) | Painel do CEO — fora do login comum |

Um analista é **coordenador** (gere) ou **visualizador** (só consulta) em cada empreendimento — definido pela gestão na Distribuição / mapa de vínculos.

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (2, $man$Acesso e login$man$, $man$## 2. Acesso e login

- **Entrar:** `auria.solutions` → e-mail e senha → o roteador abre o painel do seu papel.
- **Primeiro acesso:** e-mail de convite do Auria com o link "Ativar conta"; define a senha e entra. O link é de uso único — "expirado" = pedir novo convite a quem convidou.
- **Esqueci a senha:** na tela de login → e-mail com link para nova senha.
- **Projetista sem cadastro:** o escritório se cadastra pelo link enviado pela coordenação/gestão; após **aprovação pela gestão**, os profissionais recebem o convite.
- **E-mails** vêm de `avisos@auria.solutions` / `convites@auria.solutions`. Não chegou: Spam/Promoções → marcar como confiável.
- **Sair:** canto superior direito de qualquer painel.

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (3, $man$Painel da Gestão (gestor)$man$, $man$## 3. Painel da Gestão (gestor)

Menu: **Dashboard · Empreendimentos · Empresas · Usuários · Distribuição · Fornecedores · Disciplinas · Custos & NFs**. Barra superior: logo do grupo (clique = Empresas), data, "Atualizar".

### 3.1 Dashboard

- **Faixa:** empreendimentos, apontamentos em aberto/em atraso, resolvidos, resposta dos projetistas, **decisões pendentes**. Chips clicáveis; filtro por empresa, ordenação, busca; trilho de siglas das empresas à direita filtra tudo.
- **Ações rápidas:** + Empreendimento (a partir de modelo) · Convidar fornecedor · Convidar analista · Distribuição de acessos.
- **Precisa de você** (só decisões do gestor): cadastros de fornecedor a aprovar · MDE aguardando assinatura (TOTVS Sign) · disciplina nova criada por analista para validar · empreendimento sem coordenador · implantação incompleta.
- **Cards:** logo/sigla, construtora, disciplinas ativas, revisões; **bolinha de saúde** (verde ok · âmbar atenção · vermelho atraso ou 2+ avisos · laranja em implantação); apontamentos + linha dos últimos 10 dias; avisos (cronograma sem atualização > 30 d, disciplina sem revisão > 30 d, disciplina com arquivo mas sem fornecedor, cotação vencida sem proposta, propostas aguardando MDE, sem coordenador); coordenação. Botões: **Abrir · Implantação x/7 · CDE · Cronograma · Custos · Acessos · Editar**.
  - **Em implantação** = ainda sem nenhum arquivo no CDE e com itens de cadastro pendentes. Ao chegar o primeiro arquivo vira **Ativo** (avisos continuam).
- **Cronograma:** marcos vencidos e dos próximos 30 dias de todos os empreendimentos; última atualização de cada um.
- **Financeiro (só leitura):** compromissos do mês, vencido sem pagamento, pago no mês, contratado × pago por empreendimento.
- **Equipe:** carga de cada analista (coordena/visualiza, em aberto, em atraso).

### 3.2 Implantação (checklist do empreendimento)

"Continuar implantação" / "Implantação x/7" abre a lista com um botão por item: **Convenção** (Disciplinas) · **Pavimentos** · **Ficha** (fecha quando todos os itens estão respondidos: Sim/Não/Em processo/Não se aplica) · **Logo** · **Coordenador** (mapa de vínculos) · **Fornecedores** (quais disciplinas ativas ainda não têm fornecedor — **quem atribui é o coordenador**, no Painel do Analista › Acessos; aqui a gestão cadastra/convida) · **Cronograma**.

### 3.3 Empreendimentos

- **Novo:** nome, **sigla** (obrigatória, até 6 caracteres, única no grupo — aparece em cards, CDE e apontamentos), empresa, cidade/UF, logo, tipologia, pavimentos (gera automaticamente por faixa de tipos, subsolos, sobressolos, edículas; vistas implantação/cortes/fachadas; grupos), ficha. **Importar de modelo** salvo ou clonar de outro empreendimento (convenção + pavimentos + config + ficha).
- **Editar:** mesmos campos; Pavimentos e Ficha têm editores próprios. Pavimento com prancha vinculada é desativado, não apagado.
- **Ficha (briefing):** características (áreas, unidades, vagas, CA, taxa de ocupação, recuos, zoneamento, coordenadas, norte…) e documentos/viabilidades (água, esgoto, energia, gás, alvará, RRT/ART, book, matrícula, aprovação, habite-se, licença ambiental…) com **Sim · Não · Em processo · Não se aplica**, condicionais (E.T.A./E.T.E., protocolo, tipo de gás) e vínculo a PDFs do CDE. Aparece no CDE e no acesso temporário.
- **Arquivar:** o empreendimento sai das listas e dos painéis, mas **nada é apagado** — pranchas, apontamentos, contratos e histórico ficam guardados. Ele aparece em **Empreendimentos › Arquivo**, de onde pode ser **Restaurado** a qualquer momento.

### 3.4 Empresas

Construtoras do grupo: nome, **sigla** (obrigatória), logo. A logo do grupo também é trocada aqui.

### 3.5 Usuários

Analistas e gestores. **+ Convidar Analista**, **+ Adicionar Gestor**. **Mapa de vínculos:** clique no analista e no empreendimento para alternar coordenador → visualizador → sem vínculo (laranja coordena, azul visualiza; salva na hora).

### 3.6 Distribuição

Por empreendimento: analistas marcados e o papel de cada um.

### 3.7 Fornecedores

Link público de cadastro (copiar / novo link) · convite por e-mail com empreendimento e logo · **fila de aprovação** (Aprovar/Reprovar; bolinha no menu) · lista de fornecedores (empresa, CNPJ, profissionais, disciplinas, logo). Profissional sem disciplina herda as da empresa.

### 3.8 Disciplinas

Padrão de codificação por construtora (ou do grupo): código e nome. **Aplicar a outras empresas…** copia a lista (construtora sem padrão recebe a convenção completa). Disciplinas criadas por analistas aparecem no alto para validar.

### 3.9 Acessos do empreendimento (botão no card)

Coordenação (atalho Distribuição) · pessoas com acesso ao CDE (setor e obra, nível editável, Remover) · **Convidar**: Setor interno · Obra (3 níveis) · Analista (→ Distribuição) · Projetista (→ Fornecedores com o e-mail preenchido) · **Acesso temporário por link** (capítulo 10).

### 3.10 Custos & NFs (na gestão)

Resumo das notas e contratos. A operação é do adm-fin (capítulo 8).

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (4, $man$Painel do Analista (coordenador / visualizador)$man$, $man$## 4. Painel do Analista (coordenador / visualizador)

### 4.1 Faixa e cards

- **Faixa:** apontamentos em atraso / em aberto / abertos pela obra ou projetista, arquivos recebidos (S0), em análise, solicitações de NF, vencem em 7 dias. Chip = filtro da fila.
- **Cards:** papel (COORDENADOR/VISUALIZADOR), recebidos/em análise, apontamentos, **Implantação x/6** quando há pendência (fornecedores e cronograma com ação direta; os demais são da gestão). Botões: **Auria App · CDE · Cronograma** (abre abaixo) · **Apontamentos** (indicadores) · seletor ✉ de e-mail do CDE (a cada upload · resumo diário 17h · sem e-mail) · **Contratos · Acessos**. Visualizador: **🔕 Silenciar** (sai da fila, dos contadores e dos e-mails).
- Clique no card = empreendimento **em foco**; trilho de disciplinas à direita filtra a fila.

### 4.2 Fila da coordenação

Por urgência: apontamentos em atraso → revisões S0 a analisar → abertos por obra/projetista → solicitações de faturamento → vencem em 7 dias → demais. Cada linha leva ao App, ao CDE ou ao contrato.

### 4.3 Abas

**Fila · Agenda · Kanban · Mensagens · Custos e NF · Fornecedores · Painel de Apontamentos** — abrem abaixo, no tema do painel; **Cronograma · SIGLA** quando aberto pelo card.

### 4.4 Empreendimento em foco

- **Pipeline do CDE por disciplina** — só as **ativas** (padrão ARQ, EST, SON, FUN + as adicionadas em "＋ Adicionar disciplina…" + as que já têm fornecedor ou documento): fornecedor, S0, em análise, liberado, última entrega, ação (Analisar / Atribuir fornecedor / Continuar). × tira disciplina sem fornecedor e sem documento.
- **Equipe** (coordenação, obra, setor, fornecedores) · **Eventos** recentes do CDE · ferramentas (App, CDE, Cronograma, Apontamentos, Contratos e Faturas, Acessos).

### 4.5 Acessos

- **Equipe de obra:** convidar (e-mail + nível). Trocar nível / remover.
- **Clientes internos (setor):** "＋ Dar acesso a alguém".
- **Fornecedores — atribuição disciplina → fornecedor → profissional responsável.** É o que libera o upload da disciplina, a matriz e o painel do projetista; ao atribuir, o profissional recebe o convite se ainda não tem conta. Depois, a **matriz** (capítulo 6.4).
- **Acesso temporário por link** (capítulo 10).

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (5, $man$Auria App (estação de trabalho da coordenação)$man$, $man$## 5. Auria App (estação de trabalho da coordenação)

Abre pelo card (Auria App) ou pela fila. Um empreendimento por vez; painéis internos (agenda, kanban, mensagens, painel de apontamentos) abrem em pop-up sem sair da tela, e qualquer painel pode ir para uma **janela separada** (2ª tela).

### 5.1 Pranchas 2D

- **Carregar pranchas do CDE** (PDF): a primeira é a **base** (referência de posição); outras se sobrepõem com posição/escala/alinhamento ajustáveis, opacidade e cor por camada — é assim que se compatibiliza ARQ × EST × HID visualmente. "Trocar por outra prancha do CDE" substitui a camada mantendo a posição.
- **Prancha/disciplina ativa:** novos apontamentos herdam a disciplina dela; os pins aparecem em qualquer prancha visível e somem ao ocultar a camada.
- **Medidas:** calibrar escala e medir distâncias (cotas), lista de cotas, apagar.
- **Desenhos** livres sobre a prancha (marcações), apagáveis.
- **QR** e revisão: a prancha carregada é a revisão vigente do CDE; "sem publicação" indica que não há revisão liberada.

### 5.2 Apontamentos

- **Criar** clicando na prancha (pin) ou na peça 3D; título, disciplina, tipo, criticidade, prazo, descrição, **visibilidade** (Coordenação · Projeto · Público), responsáveis por disciplina (e-mails do fornecedor atribuído).
- **Ciclo:** Em aberto → Em análise → Resolvido; prazo com aviso de atraso; conversa por apontamento (mensagens, anexos, **negociação de prazo**); e-mails automáticos aos participantes.
- **Frente BIM:** um problema visto na prancha pode abrir uma frente no 3D com prazo e responsável próprios.
- **Painel de Apontamentos (BI):** indicadores por empreendimento — abertos, em atraso, resolvidos, por disciplina, por fornecedor, tempo de resposta.

### 5.3 IA integrada

- **Analisar uma região da prancha:** arraste um retângulo — a IA lê o trecho (texto, cotas, símbolos) e devolve achados; cada achado pode **virar apontamento** com um clique.
- **Analisar a prancha inteira (por disciplina):** a IA lê a prancha em foco como um coordenador BIM/CAD sênior da disciplina, **sugere apontamentos** (cada sugestão vira apontamento com um clique, já posicionado) e escreve um parecer geral. Você pode pedir para **verificar um ponto específico** ("o que é esse detalhe?", "a cota fecha?") e ela explica o que está vendo.
- **Checar normativas:** ao analisar ou perguntar, a IA cita a **NBR/norma** aplicável ao que apontou (ex.: NBR 9050 acessibilidade, NBR 6118 concreto, NBR 5410 elétrica). A citação é apoio: a conferência final é do coordenador.
- **Assistente de IA com visão:** conversa sobre a prancha/modelo em foco; propriedades IFC do elemento selecionado entram no contexto.
- **No 3D (BIM):** a IA ajuda a **classificar** (identifica a classe IFC/bSDD e as propriedades de uma peça ou seleção) e a **quantificar** ("quantas portas no 3º pavimento?", "volume das vigas da torre A") — ela monta o filtro e destaca as peças no modelo para você conferir.
- A IA não navega na internet: só vê o que está na tela e no CDE.

### 5.4 BIM 3D (modelos IFC)

- **Carregar modelos** do CDE (menu Modelos BIM): a lista mostra cada disciplina com olho (mostrar/ocultar) e árvore espacial; os modelos são **federados** (alinhados automaticamente pela origem do IFC).
- **Navegação:** enquadrar tudo; **pavimentos visíveis** (isolar um pavimento; subir/descer com setas); **raio-X** com profundidade 1/2/3 camadas (a peça sob o cursor fica transparente; clique direito esconde a peça); **plano de corte** com hachura, inverter lado, remover; **caminhar pelo modelo** a 1,70 m do piso; entorno translúcido (contexto).
- **Seleção:** isolar elemento, grupo ou nível; **propriedades IFC** (aba fixa; padronização pela bSDD) ao clicar na peça; escolher cor de visualização.
- **Medições 3D:** distância entre dois pontos (livre ou ortogonal X/Y/Z); **nível (cota Z)** — clique numa superfície e fixa o símbolo de nível (+1,55 m), com cota real do IFC.
- **Apontamentos 3D:** "virar apontamento" a partir de uma medida ou de um ponto (pino 3D, com ou sem cota); "ver no modelo" leva ao pin.
- **Filtro & Análise do modelo:** condições por classe bSDD, disciplina, pavimento, material, tipo e dimensão; ações isolar/ocultar/colorir; filtros salvos (meus/equipe); a IA pode montar o filtro a partir de uma frase — confira as condições antes de rodar.
- **Regras de verificação** e **clash** (interferências entre disciplinas): lista de conflitos com zoom, contexto e "abrir apontamento a partir deste achado"; exportar.
- **Dividir a tela:** 2D e 3D lado a lado; mostrar/ocultar a prancha 2D ao lado; abrir no Auria BIM completo em janela separada.
- **Cronograma** do empreendimento e **Agenda** (pendências do dia) também abrem dentro do App.

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (6, $man$CDE — Ambiente Comum de Dados (ISO 19650)$man$, $man$## 6. CDE — Ambiente Comum de Dados (ISO 19650)

Cabeçalho: sigla, nome e logo do empreendimento; **Padrão** (gestão), **← Painel**, **Ficha**, **Organizar QR**, **Enviar arquivo(s)**.

### 6.1 Conceitos e controle de revisão

- **Documento** (código único pela convenção, ex.: `PINI-EST-EX-0112`; campos: projeto, disciplina, fase/etapa, número, local/pavimento, revisão) → **Revisões** (R00, R01…) → **Arquivos** (PDF principal, DWG, DXF, IFC, RVT…).
- **Estados ISO 19650** de cada revisão:
  - **RECEBIDO (WIP):** **S0 Recebido** — chegou do projetista, privado da coordenação; **Devolvido ao projetista** — precisa de correção.
  - **COMPARTILHADO:** **S1** para compatibilização · **S2** para informação · **S3** em análise · **S4** para aprovação de etapa.
  - **PUBLICADO:** **A1 Liberado para obra** · **B1 Liberado com ressalvas** (com texto das ressalvas).
  - **ARQUIVO:** **Substituído** por revisão mais nova (histórico preservado).
- **As-built** é etapa (AB), não status; segue o fluxo e é liberado com A1/B1.
- **Regras de revisão:** nova revisão do mesmo código substitui a anterior; o projetista pode **excluir o próprio envio enquanto S0** (antes de virar revisão analisada); a coordenação registra protocolo/transmittal, analisado por / aprovado por, ressalvas e motivo de devolução; cada mudança gera **evento** (quem, quando, de → para) visível no CDE e no painel.
- **Convenção:** o código é decomposto nos campos da convenção da construtora; documento fora do padrão é apontado no envio e o projetista **corrige o código** antes de entrar.

### 6.2 Fluxo de uma entrega

1. **Projetista envia** (Painel do Projetista › Entregas, ou CDE) na disciplina contratada; escolhe pavimento/vista; o arquivo entra como **S0**. A coordenação recebe e-mail (na hora ou no resumo das 17h).
2. **Coordenação analisa** no CDE: move para S1–S4, **devolve** ou **libera** (A1/B1). O projetista é avisado.
3. **Liberado** = visível para obra e setor (QR, App, acesso temporário).

### 6.3 BIM no CDE

- Modelos **IFC** (e RVT) entram como documentos de modelo com revisão e status, como qualquer prancha. Aparecem na aba **BIM** do trilho da direita e também dentro da aba da própria disciplina (ARQ, EST…).
- **Converter para 3D:** no card do modelo, botão **🧊 Converter para 3D** gera o modelo leve usado pelo visualizador; roda em segundo plano ("Processando…", pode levar minutos em modelos grandes; "Falhou — tentar de novo" repete). Quando pronto, o card mostra **👁 Ver em 3D**.
- **Abrir um modelo:** card do modelo › **👁 Ver em 3D** — abre uma janela 3D dentro do CDE (mesmo visualizador do App): orbitar, cortes, medir, caminhar pelo modelo, propriedades da peça.
- **Federar (várias disciplinas na mesma cena):** na coluna da direita, clique em **☑ Selecionar várias**, marque os modelos desejados (na aba BIM ou na aba de cada disciplina) e clique em **🧊 Ver federado aqui** na barra que aparece embaixo. Só entram modelos já convertidos; os outros são listados antes de abrir. Alternativa: **🔍 Analisar no App** leva a mesma seleção para o Auria App, onde a análise vira apontamento. Depois de abrir, a seleção é desmarcada sozinha.
- **Download:** só a revisão **liberada para obra** pode ser baixada por obra/setor; "Em análise — não liberado para execução" bloqueia o download (o engenheiro chefe vê o em-análise na tela, mas não baixa).
- **Propriedades do elemento:** clique numa peça do modelo e o painel da direita mostra Identificação, Quantidades, **Dimensões medidas na geometria** (altura, comprimento, largura/espessura reais, mesmo com a peça girada), Material e Propriedades (Psets). O **funil** ao lado de "Propriedades" escolhe o que mostrar (blocos, códigos internos, conjuntos de propriedades) — a escolha fica salva para você.
- Apontamentos abertos no 3D ficam ligados à revisão do modelo.

### 6.4 Níveis de acesso aos arquivos (matriz)

Quem vê o quê, por empreendimento:

| Sujeito | Escopo | Permissões (por disciplina quando aplicável) |
|---|---|---|
| **Coordenação** (analista coordenador) | tudo | tudo (linha travada) |
| **Analista visualizador** | tudo | só leitura; pode silenciar |
| **Fornecedor/projetista** | disciplinas **contratadas** (verde) + outras liberadas na matriz | ver não publicado · baixar · **enviar** (só na contratada) · excluir S0 · ler/abrir/editar apontamentos próprios · BIM ver/ler/abrir |
| **Obra — Engenheiro chefe** | todas as disciplinas | vê **inclusive não liberado** (sem baixar o em-análise), baixa o liberado, abre e responde apontamentos, Organizar QR, Diário de Obra, Fila da obra |
| **Obra — Coordenação de campo** | todas | só o **liberado**, abre apontamentos de obra |
| **Obra — Equipe de campo** | todas | só o liberado; lê apontamentos |
| **Setor interno** | todas | só o liberado; sem apontamentos |
| **Acesso temporário** | disciplinas escolhidas | ver (e baixar se permitido) — liberado ou liberado + compartilhado; nunca S0 |
| **QR público** (`v.html`) | 1 prancha | sempre a revisão liberada, só leitura |

A matriz é editada em Analista › Acessos (chips por disciplina e colunas: Ñ-pub, Baixar, Enviar, Excl. S0, Ler ap., Abrir ap., Edit., BIM, BIM ler, BIM abrir). A **apontamento** tem ainda a faixa de visibilidade (Coordenação/Projeto/Público) — obra e setor só veem Público; projetistas veem Projeto e Público.

### 6.5 Encontrar arquivos: busca, filtro, ordem

- **Buscar pelo nome/código:** campo **🔎 Buscar arquivo pelo nome** no alto da coluna da direita; digite e a lista filtra na hora (atravessa todas as disciplinas). **Esc** limpa.
- **Buscar DENTRO dos PDFs (conteúdo):** ao lado do campo de busca há o botão **Aa** — clique para ligar a busca no texto; aí o que você digitar é procurado dentro das pranchas (texto indexado). O botão fica destacado enquanto está ligado; clique de novo para voltar à busca por nome. A indexação é automática: na primeira vez que o **Aa** é ligado, os PDFs ainda sem texto são indexados em segundo plano (o campo mostra o andamento), e cada novo envio já entra indexado. PDFs sem camada de texto (escaneados/vetorizados sem texto) não são encontrados.
- **Filtrar:** botão **funil** (ao lado da busca) — por disciplina, etapa, status e formato; o número no funil mostra quantos filtros estão ativos. **Limpar filtros** zera.
- **Ordenar:** botão **↕** — por código, data, revisão ou status.
- **Trilho de disciplinas** (borda direita): clique numa sigla (ARQ, EST…) para ver só ela; **BIM** mostra só os modelos 3D.
- **Selecionar várias de uma vez:** com **☑ Selecionar várias** ligado, aparece **☑ Todas as visíveis (N)** — marca tudo o que está na lista atual (disciplina/filtro/busca/grupo) — e cada pasta de etapa ganha uma caixinha para marcar/desmarcar a pasta inteira; **☐** desmarca tudo.
- **Mudar o status de várias pranchas (coordenação):** **☑ Selecionar várias** › marque › **🔁 Mudar status** › escolha o status (para *Liberado com ressalvas* e *Devolvido* o texto informado vale para todas) › **Aplicar**. É a mesma transição feita uma a uma: a revisão vigente de cada prancha recebe o status e o próprio evento no histórico, e devolvida/liberada avisa o projetista por e-mail.
- **Baixar vários arquivos de uma vez (zip):** **☑ Selecionar várias** › marque as pranchas › **⬇ Baixar (.zip)** › escolha os formatos (PDF, DWG…) › **Gerar .zip**. O zip vem com pastas por disciplina e só com o que o seu perfil pode baixar.
- **Girar a prancha:** botão **↻ Girar** na barra da prancha aberta (ao lado de "Ajustar à tela") gira 90° por clique. A coordenação salva a posição para todos; os pins acompanham a rotação.
- **Recodificar pranchas (corrigir o código):** coordenação › **☑ Selecionar várias** › **✎ Recodificar** › edite os campos do código (validados pelo padrão; não pode repetir) › **Aplicar**. Fica o evento "Recodificada" no histórico; o arquivo gravado e o QR não mudam.

### 6.6 Aba Grupos (coleções de pranchas)

Na coluna da direita, o seletor **Disciplinas | Grupos** troca a organização da lista. **Grupos** são coleções de pranchas com nome próprio dentro do empreendimento (ex.: "Kit obra — subsolo", "Aprovação prefeitura"); não mudam o código nem o status, só agrupam. Há dois tipos:
- **Automáticos:** **📍 Por localização** (pavimentos/vistas, a partir do cadastro de pavimentos) e **🏗 Por etapa** (a partir da convenção) — sempre refletem os arquivos atuais.
- **Criados por você:** na aba Grupos › **+ Novo grupo**; para incluir uma prancha, abra-a e use **＋ Grupo** na barra da janela. Renomear/excluir pelo menu do grupo. Criar/editar grupos é da coordenação; os demais só consultam.

*Atenção ao termo:* nesta aba "grupo" é uma coleção de pranchas. "Grupo" como conta-cliente (empresa dona das construtoras) é outro conceito, do Painel da Gestão.

### 6.7 QR por prancha

Toda prancha tem um **QR fixo** (não muda entre revisões) que abre uma página pública só-leitura com a **revisão liberada** atual — quem lê o QR na obra vê sempre a versão vigente. Só pranchas **liberadas** (A1/B1) geram material de QR; quem usa é a coordenação e o perfil Obra.

- **Baixar uma prancha com o QR carimbado:** card da prancha › menu **⋮** › **Baixar prancha com QR (PDF)** — gera um PDF novo com o QR e a logo no canto superior esquerdo, sem alterar o original. **Baixar QR (imagem grande)** dá só o código, para colar onde quiser.
- **Organizar QR (folha para impressão):** botão **🖨 Organizar QR** no cabeçalho do CDE › escolha **Formato** (A4/A3) e **Por página** (4/6/8) › marque as pranchas (busca por código/disciplina/título; filtro por **pavimento**; **Selecionar / limpar tudo**) › **Gerar PDF**. O PDF sai com uma página por pavimento e o nome do pavimento no canto superior esquerdo, pronto para plotar e afixar na obra.
- No perfil **Obra**, a prancha aberta na tela leva **marca-d'água** com o nome de quem está vendo.

### 6.8 Outras funções

**Ficha** (leitura da ficha do empreendimento) · **Padrão** (padrão de codificação, gestão) · **⬆ Enviar arquivo(s)** (coordenação e projetista da disciplina) · **Comparar** duas revisões lado a lado.

### 6.9 Diário de Obra (RDO)

Botão **📓 Diário** no cabeçalho do CDE. Um registro por dia: **clima** (manhã/tarde), **efetivo** por função (com total), **atividades executadas** por pavimento/local, **ocorrências** (chuva, falta de material, acidente, visita…), **observações** e **fotos** (tiradas do celular; ficam comprimidas). **+ Novo dia** abre o dia de hoje; o seletor no alto navega pelos dias já registrados; **Salvar diário** grava; **⬇ Exportar PDF** imprime o dia com logo e cabeçalho. Escrevem: coordenação, engenheiro chefe e coordenação de campo; equipe de campo, setor e projetista só leem. Nada é apagado — o dia é editado. O diário registrado aparece na **Fila da obra**.

### 6.10 Fila da obra (perfil obra)

Botão **📋 Fila da obra** no cabeçalho (só perfil obra), com contador do que ainda não foi visto: **revisões liberadas** (e quando substituem uma anterior — clique abre a prancha), **respostas** da coordenação/projetista aos apontamentos que a obra abriu, **mudanças de status** desses apontamentos e **diário** registrado. Últimos 60 dias; **✓ Tudo visto** limpa o contador; abre sozinha na primeira novidade do dia.

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (7, $man$Painel do Projetista (escritório / profissional)$man$, $man$## 7. Painel do Projetista (escritório / profissional)

Cabeçalho: logo do escritório (clique para trocar), **nota geral** (índice de resposta do escritório), Mensagens, Tema, Sair.

### 7.1 Meus empreendimentos

Um card por empreendimento em que o escritório atende alguma disciplina (disciplinas contratadas, prazos, pendências).

### 7.2 Apontamentos (responder, prazo, atendido)

Os apontamentos das suas disciplinas: abrir, **responder**, anexar prints/prancha/PDF, **negociar prazo** por mensagem, marcar como **atendido**. Você recebe e-mail a cada novo apontamento e mensagem.

### 7.3 Custos: solicitar faturamento e enviar nota fiscal (NF)
Menu **Custos**: contratos por empreendimento com parcelas e status. **Solicitar faturamento** numa parcela *a faturar* (vai para o coordenador autorizar) · **Enviar NF** numa parcela *autorizada* — só com a **janela de recebimento aberta**; o formulário traz construtora, empreendimento, disciplina e parcela do contrato e pede nº da NF, data de emissão, valor, CNPJ (pré-preenchido), **conteúdo entregue** e o PDF. Histórico das NFs enviadas com status (enviada → recebida → encaminhada → paga). Aditivos aparecem no contrato.
### 7.4 Entregas: enviar arquivos ao CDE

Menu **Entregas**: arraste os arquivos (PDF + DWG juntos) das disciplinas contratadas; o nome precisa seguir o padrão da construtora (o sistema valida e pede correção do código quando necessário); veja o status de cada revisão (S0 → … → A1/B1 ou Devolvido); é possível **excluir** um envio ainda em S0; **Abrir o CDE** mostra o acervo.

### 7.5 Mensagens

Conversa com a coordenação, por apontamento ou avulsa.

### 7.6 Cotações e propostas

O escritório convidado recebe e-mail e envia a proposta pela página pública (valor, prazo, etapas %, validade, PDF); se vencer, é convidado a se cadastrar e fica registrado como responsável pela disciplina.

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (8, $man$Painel Administrativo Financeiro (adm-fin)$man$, $man$## 8. Painel Administrativo Financeiro (adm-fin)

Faixa com contadores por status (**enviadas** = precisa de ação, recebidas, encaminhadas, pagas, canceladas), período, empresa, empreendimento, disciplina, busca; trilho de empresas.

### 8.1 Fila de NFs

Ordem de urgência (enviadas primeiro). Ações: **Marcar recebida → Encaminhar → Marcar paga** (Voltar desfaz). PDF: Ver/Baixar. NF do link público vem marcada **sem contrato**, com CNPJ e conteúdo entregue. Abaixo: por empreendimento, por mês, por disciplina.

### 8.2 Recebimento de NFs (janela)

O adm-fin **abre o recebimento** por período (abertura/fechamento, competência, mensagem, e-mails extras, chave "só contrato cadastrado"). Ao abrir: e-mail aos projetistas com parcela autorizada (link do painel) e aos e-mails extras (link público). **Fora da janela ninguém envia NF.** "Fechar agora" encerra; "Cancelar próxima" desfaz uma futura. Link público: razão social, CNPJ, e-mail, construtora, empreendimento, disciplina, parcela, nº, emissão, valor, conteúdo, PDF.

### 8.3 Contratos por empreendimento · Pastas de NFs

Contratos com parcelas e % executado; pastas Empresa → Ano → Mês → Empreendimento com .zip.

### 8.4 Cronograma de custos (parcelas mês a mês)

Aba **Cronograma de custos**: grade **mês × empreendimento › disciplina › contrato** com o que vence em cada mês — parcelas dos contratos pelo **vencimento** e NFs enviadas pelo link público (**sem contrato**) pela data de emissão. Cores por status (a faturar cinza · solicitada laranja · autorizada azul · faturada roxo · paga verde); gráfico de barras no topo = **previsto × realizado** por mês; linhas **Total do mês** e **Acumulado**; colunas **antes / depois / sem data** guardam o que cai fora do período. **Vermelho = parcela venceu e ainda não foi faturada** (KPI "Vencidas e não faturadas"). Setas ◄ ► andam 3 meses; "Hoje" volta; 6/12/24 meses; filtros por empreendimento, disciplina e "só previsto / só realizado". Clique numa célula para ver as parcelas do mês (com atalho ao resumo do contrato); **Excel** baixa a grade e a lista de parcelas com a logo do Auria.

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (9, $man$Controle de custos (visão de ponta a ponta)$man$, $man$## 9. Controle de custos (visão de ponta a ponta)

1. **Cotação** (analista): empreendimento, disciplina, escopo, área m², prazo, etapas % sugeridas, anexos, convidados → e-mail com link.
2. **Propostas:** pelo link público (valor, prazo, etapas %, validade, PDF) ou registro manual. "Lembrar" aos que não responderam.
3. **MDE** (mapa de equalização): propostas lado a lado, **R$/m²** e faixa de referência do grupo (histórico de contratos do mesmo tipo); PDF gerado → assinatura do gestor (TOTVS Sign) → anexar assinado.
4. **Vencedora → Contrato automático:** valor, disciplina, objeto, projetista e **parcelas geradas das etapas %** (os percentuais são livres e definidos na cotação; um exemplo comum: estudo preliminar 15 · anteprojeto 15 · pré-executivo 20 · executivo 40 · final 10). Vencedor sem cadastro é convidado; ao contratar, é **registrado como responsável pela disciplina** no empreendimento.
5. **Parcelas:** *a faturar → solicitada* (projetista) *→ autorizada/recusada* (coordenador) *→ faturada* (NF enviada) *→ paga* (adm-fin). **Aditivos** alteram valor/parcelas com registro.
6. **NF:** dentro da **janela**; PDF cifrado no cofre; fila do adm-fin; pastas por competência.
7. **Painéis:** gestão vê compromissos do mês, vencido sem pagamento, pago, contratado × pago; adm-fin vê tudo por status e o **cronograma de custos** mês a mês (8.4); projetista vê os seus.

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (10, $man$Acesso temporário por link (sem login)$man$, $man$## 10. Acesso temporário por link (sem login)

Criado em **Acessos** (gestão ou analista): e-mail, nome, **disciplinas** (caixa de busca: digite a sigla, Enter marca), **alcance** — *só liberado para obra (A1/B1)* ou *liberado + compartilhado (S1–S4, marcado como preliminar)*; nunca S0 —, **permissão** (só visualizar / ver e baixar), **duração** (24 h · 48 h · 3 dias · 7 dias), mensagem. O convidado recebe o e-mail com `acesso.html?t=…`: ficha do empreendimento + última revisão de cada documento das disciplinas, com a situação de cada um; PDF abre na página; "Baixar" só quando permitido; IFC listado (download quando permitido). Expira sozinho; o coordenador vê aberturas, copia o link, estende (+24 h) ou encerra. Nada além disso existe para o convidado.

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (11, $man$Obra e Setor$man$, $man$## 11. Obra e Setor

- **Obra:** entra direto no empreendimento (ou escolhe). CDE publicado, apontamentos de obra (níveis 1 e 2 abrem; 3 lê), Organizar QR (engenheiro chefe e coordenação de campo), 3D publicado. Engenheiro chefe vê também o não liberado.
- **Setor interno:** Consulta ao CDE — só o publicado; sem apontamentos.

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (12, $man$E-mails que o Auria envia$man$, $man$## 12. E-mails que o Auria envia

| Quando | Para quem |
|---|---|
| Convite de conta (analista, gestor, obra, setor, projetista) | convidado |
| Convite de cadastro de fornecedor · cadastro **aprovado** (o convite de login de cada projetista chega quando a coordenação vincula a empresa a um empreendimento) ou **reprovado** (com o motivo) | escritório |
| Novo apontamento / mensagem no apontamento | participantes / equipe |
| Arquivo recebido no CDE (na hora ou resumo 17h) | analistas do empreendimento |
| Confirmação de recepção da revisão (enviada pelo analista no CDE, botão de e-mail) | projetista |
| Revisão **devolvida** (com o motivo) · **liberada** (A1) · **liberada com ressalvas** (B1, com as ressalvas) | projetista que enviou + projetistas do fornecedor da disciplina |
| Solicitação de faturamento | analistas + gestores |
| Parcela autorizada/recusada · NF recebida | projetista |
| Recebimento de NF aberto | projetistas com parcela autorizada + e-mails extras |
| NF recebida pelo link público | adm-fin + confirmação ao remetente |
| Cotação: convite, lembrete, proposta recebida | escritórios / analista |
| Acesso temporário | convidado |

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (13, $man$Mensagens de erro comuns$man$, $man$## 13. Mensagens de erro comuns

| Mensagem | Significado | O que fazer |
|---|---|---|
| "Link inválido ou expirado" (ativação) | link de uso único já usado/expirou | pedir novo convite ou "Esqueci minha senha" |
| "Você não coordena este empreendimento" / "Sem permissão" | visualizador ou sem vínculo | gestão › Distribuição |
| "Recebimento de NF fechado. Próxima janela: …" | fora da janela | aguardar a data da mensagem |
| "Formato .xxx não aceito aqui" / "Tipo de arquivo não permitido" | o Auria só aceita formatos de projeto (PDF, DWG, DXF, IFC, RVT, ZIP, imagens, planilhas); executáveis e scripts nunca entram | converter/exportar no formato certo |
| "O conteúdo não corresponde a um .pdf válido" / "renomeado" | o arquivo foi renomeado ou está corrompido — o conteúdo não bate com a extensão | exportar de novo do programa de origem |
| "PDF com conteúdo ativo (JavaScript, /Launch, arquivo embutido)" | o PDF traz script, ação que abre programa ou anexo — não é aceito por segurança | pedir ao projetista uma exportação simples (sem scripts/anexos); "Imprimir em PDF" resolve |
| "Arquivo recusado pelo servidor" | a conferência no servidor reprovou o conteúdo depois do envio; o arquivo foi apagado | mesmo caso acima |
| "A parcela precisa estar AUTORIZADA para enviar a NF" | coordenador não autorizou | solicitar/aguardar |
| "Já existe um empreendimento com a sigla X" | sigla única por grupo | outra sigla |
| "Esta construtora ainda não tem padrão de codificação" | convenção não definida | gestão › Disciplinas (ou Aplicar de outra empresa) |
| "Código fora do padrão" no envio | nome do arquivo não segue a convenção | corrigir o código no envio |
| "Em análise — não liberado para execução" / "Só a revisão liberada pode ser baixada" | revisão ainda não A1/B1 | aguardar liberação |
| "Link inválido" (proposta / NF / acesso temporário) | token errado, revogado ou expirado | pedir novo link |
| "Falhou — tentar de novo" (conversão BIM) | conversão do IFC falhou | tentar de novo; persistindo, avisar o Auria |
| "Could not find the function … in schema cache" | função nova ainda não visível (segundos) | tentar de novo |
| Página em branco / lista vazia | sessão expirada ou cache | Ctrl+F5; entrar de novo |

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (14, $man$Perguntas frequentes$man$, $man$## 14. Perguntas frequentes

- **Onde troco a logo do empreendimento?** Gestão › Empreendimentos › Editar (ou Implantação › Logo).
- **Como dou acesso a alguém da obra?** Gestão › card › Acessos › papel Obra + nível; ou Analista › Acessos › Convidar para a obra.
- **Por que o projetista não vê uma disciplina / não consegue enviar?** Falta a **atribuição disciplina → fornecedor** em Analista › Acessos › Fornecedores.
- **Por que a prancha não aparece para a obra?** Ainda não está **liberada** (A1/B1).
- **Como libero uma prancha para a obra?** Coordenação: CDE › abra a prancha › **Detalhes / status** › mude o status para **A1 Liberado para obra** (ou **B1 com ressalvas**). O projetista recebe e-mail; a obra passa a ver.
- **Como giro uma prancha?** CDE › prancha aberta › **↻ Girar** (a posição fica salva).
- **Como baixo várias pranchas de uma vez?** CDE › **☑ Selecionar várias** › **⬇ Baixar (.zip)**.
- **Como paro de receber e-mail de um empreendimento?** Seletor ✉ no card (sem e-mail de arquivos); visualizador pode 🔕 Silenciar.
- **Como um escritório novo vê o projeto para orçar?** Acessos › Acesso temporário por link (alcance "liberado + compartilhado" para preliminares).
- **Quem aprova cadastro de fornecedor?** A gestão. O analista convida e atribui.
- **O que falta para o empreendimento ficar pronto?** Implantação x/7 (gestão) / Implantação x/6 (analista).
- **Quem abre a janela de NF?** O adm-fin.
- **Posso mandar NF sem contrato?** Só pelo link público, na janela, se o adm-fin não marcou "só contrato cadastrado".
- **O modelo 3D não abre.** A conversão do IFC roda em segundo plano; aguarde ou clique em "tentar de novo" no CDE. Modelos muito grandes demoram minutos.
- **Como federo modelos BIM (várias disciplinas juntas)?** CDE › coluna da direita › **☑ Selecionar várias** › marque os modelos › **🧊 Ver federado aqui** (ou **Analisar no App**).
- **Como busco dentro dos arquivos (texto das pranchas)?** CDE › ligue o botão **Aa** ao lado da busca › digite o termo. A indexação é automática (PDFs escaneados sem texto não entram).
- **Como imprimo os QR das pranchas para afixar na obra?** CDE › **🖨 Organizar QR** › formato e quantidade por página › marque as pranchas › **Gerar PDF**. Para uma prancha só: menu **⋮** › **Baixar prancha com QR (PDF)**.
- **O que é a aba Grupos do CDE?** Coleções de pranchas com nome (automáticas por localização/etapa, ou criadas pela coordenação). Não confundir com "Grupo" = conta-cliente da gestão.
- **Os modelos das disciplinas não coincidem no 3D.** O alinhamento usa a origem do IFC; peça aos projetistas o mesmo ponto de origem/coordenadas.
- **Como comparo duas revisões?** No App, carregue as duas pranchas como camadas (opacidade/cor) ou use a análise de documentação com IA.

---$man$);
insert into public.ajuda_manual_auria (capitulo, titulo, corpo) values (15, $man$Glossário$man$, $man$## 15. Glossário

**CDE** ambiente comum de dados · **S0** recebido · **S1–S4** compartilhado (compatibilização, informação, análise, aprovação de etapa) · **A1/B1** liberado para obra (com ressalvas) · **Devolvido** correção pedida · **Substituído** revisão antiga · **WIP** trabalho em andamento · **Convenção / padrão de codificação** regra de nomes por construtora · **Disciplina ativa** disciplina usada no empreendimento · **Fragments** modelo 3D leve gerado do IFC · **Federação** vários modelos alinhados no mesmo 3D · **bSDD** dicionário de dados da buildingSMART (padroniza propriedades) · **MDE** mapa de equalização · **RFP/cotação** pedido de proposta · **Parcela** etapa de pagamento · **Janela de NF** período de recebimento de notas · **Vínculo** analista × empreendimento · **Matriz de acessos** permissões por disciplina · **Visibilidade do apontamento** Coordenação / Projeto / Público.$man$);

-- Capítulos por papel (mesma tabela do auria_ajuda.js): gestor recebe tudo.
create or replace function public.ajuda_manual()
returns text language plpgsql security definer set search_path = public as $$
declare v_role text; v_caps int[]; v_txt text; v_faq text;
begin
  if auth.uid() is null then raise exception 'Não autenticado.'; end if;
  v_role := public.minha_role_auria();
  v_caps := case v_role
    when 'gerente'     then null
    when 'super_admin' then null
    when 'analista'    then array[0,1,2,4,5,6,9,10,12,13,14,15]
    when 'projetista'  then array[0,1,2,6,7,13,15]
    when 'financeiro'  then array[0,1,2,8,9,12,13,15]
    when 'obra'        then array[0,1,2,6,11,13,15]
    when 'setor'       then array[0,1,2,6,11,13,15]
    else array[0,1,2,13,15] end;
  v_txt := (select string_agg(corpo, E'\n\n---\n\n' order by capitulo)
              from public.ajuda_manual_auria
             where v_caps is null or capitulo = any(v_caps));
  -- FAQ promovida pelo CEO (item 52a): anexa só as ativas do papel. Cabeçalho SEM número
  -- para o corte por capítulo (servidor e auria_ajuda.js) não a descartar.
  v_faq := (select string_agg('**P: '||f.pergunta||E'**\n'||f.resposta, E'\n\n' order by f.criado_em)
              from public.ajuda_faq_auria f
             where f.ativo and (f.papeis is null or v_role in ('gerente','super_admin') or v_role = any(f.papeis)));
  if v_faq is not null then
    v_txt := v_txt || E'\n\n---\n\n## Perguntas frequentes — respostas da equipe Auria\n\n' || v_faq;
  end if;
  return v_txt;
end $$;
grant execute on function public.ajuda_manual() to authenticated;
revoke execute on function public.ajuda_manual() from anon;

select capitulo, titulo, length(corpo) as chars from public.ajuda_manual_auria order by 1;