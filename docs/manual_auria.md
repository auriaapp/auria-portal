# Manual do Auria

> Fonte única da ajuda do Auria: alimenta o assistente de IA (suporte) e a página de ajuda. Escrito a partir do sistema em produção (set/2026). Marcações **[revisar]** indicam pontos a confirmar.

---

## 1. O que é o Auria

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

---

## 2. Acesso e login

- **Entrar:** `auria.solutions` → e-mail e senha → o roteador abre o painel do seu papel.
- **Primeiro acesso:** e-mail de convite do Auria com o link "Ativar conta"; define a senha e entra. O link é de uso único — "expirado" = pedir novo convite a quem convidou.
- **Esqueci a senha:** na tela de login → e-mail com link para nova senha.
- **Projetista sem cadastro:** o escritório se cadastra pelo link enviado pela coordenação/gestão; após **aprovação pela gestão**, os profissionais recebem o convite.
- **E-mails** vêm de `avisos@auria.solutions` / `convites@auria.solutions`. Não chegou: Spam/Promoções → marcar como confiável.
- **Sair:** canto superior direito de qualquer painel.

---

## 3. Painel da Gestão (gestor)

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
- **Arquivar:** o empreendimento sai das listas; o histórico fica. **[revisar]**

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

---

## 4. Painel do Analista (coordenador / visualizador)

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

---

## 5. Auria App (estação de trabalho da coordenação)

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
- **Análise de documentação:** selecione PDFs e abra uma análise (comparação entre pranchas/revisões, verificação de coerência). **[revisar: descrever os tipos de análise disponíveis]**
- **Assistente de IA com visão:** conversa sobre a prancha/modelo em foco; propriedades IFC do elemento selecionado entram no contexto.
- A IA não navega na internet: só vê o que está na tela e no CDE.

### 5.4 BIM 3D (modelos IFC)

- **Carregar modelos** do CDE (menu Modelos BIM): a lista mostra cada disciplina com olho (mostrar/ocultar) e árvore espacial; os modelos são **federados** (alinhados automaticamente pela origem do IFC).
- **Navegação:** enquadrar tudo; **pavimentos visíveis** (isolar um pavimento; subir/descer com setas); **raio-X** com profundidade 1/2/3 camadas (a peça sob o cursor fica transparente; clique direito esconde a peça); **plano de corte** com hachura, inverter lado, remover; **caminhar pelo modelo** a 1,70 m do piso; entorno translúcido (contexto).
- **Seleção:** isolar elemento, grupo ou nível; **propriedades IFC** (aba fixa; padronização pela bSDD) ao clicar na peça; escolher cor de visualização.
- **Medições 3D:** distância entre dois pontos (livre ou ortogonal X/Y/Z); **nível (cota Z)** — clique numa superfície e fixa o símbolo de nível (+1,55 m), com cota real do IFC.
- **Apontamentos 3D:** "virar apontamento" a partir de uma medida ou de um ponto (pino 3D, com ou sem cota); "ver no modelo" leva ao pin.
- **Filtro & Análise do modelo:** condições por classe bSDD, disciplina, pavimento, material, tipo e dimensão; ações isolar/ocultar/colorir; filtros salvos (meus/equipe); a IA pode montar o filtro a partir de uma frase. **[revisar: estado da implementação]**
- **Regras de verificação** e **clash** (interferências entre disciplinas): lista de conflitos com zoom, contexto e "abrir apontamento a partir deste achado"; exportar.
- **Dividir a tela:** 2D e 3D lado a lado; mostrar/ocultar a prancha 2D ao lado; abrir no Auria BIM completo em janela separada.
- **Cronograma** do empreendimento e **Agenda** (pendências do dia) também abrem dentro do App.

---

## 6. CDE — Ambiente Comum de Dados (ISO 19650)

Cabeçalho: sigla, nome e logo do empreendimento; **Padrão** (gestão), **← Painel**, **Ficha**, **Diário** (obra), **Organizar QR**, **Enviar arquivo(s)**.

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

- Modelos **IFC** (e RVT) entram como documentos de modelo (M3) com revisão e status, como qualquer prancha.
- **Conversão** para modelo leve (fragments) roda em segundo plano ("gera o modelo leve usado pelo visualizador 3D"; pode levar minutos em modelos grandes; falhou → tentar de novo).
- **Abrir o visualizador 3D** direto do CDE; **caminhar pelo modelo**; o mesmo visualizador do App.
- **Download:** só a revisão **liberada para obra** pode ser baixada por obra/setor; "Em análise — não liberado para execução" bloqueia.
- Apontamentos abertos no 3D ficam ligados à revisão do modelo.

### 6.4 Níveis de acesso aos arquivos (matriz)

Quem vê o quê, por empreendimento:

| Sujeito | Escopo | Permissões (por disciplina quando aplicável) |
|---|---|---|
| **Coordenação** (analista coordenador) | tudo | tudo (linha travada) |
| **Analista visualizador** | tudo | só leitura; pode silenciar |
| **Fornecedor/projetista** | disciplinas **contratadas** (verde) + outras liberadas na matriz | ver não publicado · baixar · **enviar** (só na contratada) · excluir S0 · ler/abrir/editar apontamentos próprios · BIM ver/ler/abrir |
| **Obra — Engenheiro chefe** | todas as disciplinas | vê **inclusive não liberado**, baixa, abre e responde apontamentos, Diário de Obra |
| **Obra — Coordenação de campo** | todas | só o **liberado**, abre apontamentos de obra |
| **Obra — Equipe de campo** | todas | só o liberado; lê apontamentos |
| **Setor interno** | todas | só o liberado; sem apontamentos |
| **Acesso temporário** | disciplinas escolhidas | ver (e baixar se permitido) — liberado ou liberado + compartilhado; nunca S0 |
| **QR público** (`v.html`) | 1 prancha | sempre a revisão liberada, só leitura |

A matriz é editada em Analista › Acessos (chips por disciplina e colunas: Ñ-pub, Baixar, Enviar, Excl. S0, Ler ap., Abrir ap., Edit., BIM, BIM ler, BIM abrir). A **apontamento** tem ainda a faixa de visibilidade (Coordenação/Projeto/Público) — obra e setor só veem Público; projetistas veem Projeto e Público.

### 6.5 Outras funções

Pastas virtuais e grupos · filtro/ordenação por disciplina, status, pavimento · **busca** por código/título e **no conteúdo dos PDFs** (indexar) · **QR por prancha** (página pública com a revisão liberada; Organizar QR para impressão; carimbo do QR no PDF **[revisar: pendente]**) · **Ficha** (leitura) · **Diário de Obra** (registro diário da equipe de campo) · Padrão de codificação.

---

## 7. Painel do Projetista (escritório / profissional)

Cabeçalho: logo do escritório (clique para trocar), **nota geral** (índice de resposta do escritório), Mensagens, Tema, Sair.

- **Meus empreendimentos:** um card por empreendimento em que o escritório atende alguma disciplina (disciplinas contratadas, prazos, pendências).
- **Apontamentos:** os das suas disciplinas — abrir, responder, anexar prints/prancha/PDF, **negociar prazo** por mensagem, marcar como atendido; e-mail a cada novo apontamento e mensagem.
- **Custos (contratos e faturas):** contratos por empreendimento com parcelas e status. **Solicitar faturamento** numa parcela *a faturar* (vai para o coordenador autorizar) · **Enviar NF** numa parcela *autorizada* — só com a **janela de recebimento aberta**; o formulário traz construtora, empreendimento, disciplina e parcela do contrato e pede nº da NF, data de emissão, valor, CNPJ (pré-preenchido), **conteúdo entregue** e o PDF. Histórico das NFs enviadas com status (enviada → recebida → encaminhada → paga). Aditivos aparecem no contrato.
- **Entregas (CDE):** enviar arquivos das disciplinas contratadas (com validação do código pela convenção e correção quando necessário), ver status de cada revisão (S0 → … → A1/B1 ou Devolvido), excluir envio ainda em S0, abrir o CDE.
- **Mensagens:** conversa com a coordenação (por apontamento ou avulsa).
- **Cotações:** o escritório convidado recebe e-mail e envia a proposta pela página pública (valor, prazo, etapas %, validade, PDF); se vencer, é convidado a se cadastrar/registrado como responsável pela disciplina.

---

## 8. Painel Administrativo Financeiro (adm-fin)

Faixa com contadores por status (**enviadas** = precisa de ação, recebidas, encaminhadas, pagas, canceladas), período, empresa, empreendimento, disciplina, busca; trilho de empresas.

### 8.1 Fila de NFs

Ordem de urgência (enviadas primeiro). Ações: **Marcar recebida → Encaminhar → Marcar paga** (Voltar desfaz). PDF: Ver/Baixar. NF do link público vem marcada **sem contrato**, com CNPJ e conteúdo entregue. Abaixo: por empreendimento, por mês, por disciplina.

### 8.2 Recebimento de NFs (janela)

O adm-fin **abre o recebimento** por período (abertura/fechamento, competência, mensagem, e-mails extras, chave "só contrato cadastrado"). Ao abrir: e-mail aos projetistas com parcela autorizada (link do painel) e aos e-mails extras (link público). **Fora da janela ninguém envia NF.** "Fechar agora" encerra; "Cancelar próxima" desfaz uma futura. Link público: razão social, CNPJ, e-mail, construtora, empreendimento, disciplina, parcela, nº, emissão, valor, conteúdo, PDF.

### 8.3 Contratos por empreendimento · Pastas de NFs

Contratos com parcelas e % executado; pastas Empresa → Ano → Mês → Empreendimento com .zip.

---

## 9. Controle de custos (visão de ponta a ponta)

1. **Cotação** (analista): empreendimento, disciplina, escopo, área m², prazo, etapas % sugeridas, anexos, convidados → e-mail com link.
2. **Propostas:** pelo link público (valor, prazo, etapas %, validade, PDF) ou registro manual. "Lembrar" aos que não responderam.
3. **MDE** (mapa de equalização): propostas lado a lado, **R$/m²** e faixa de referência do grupo (histórico de contratos do mesmo tipo); PDF gerado → assinatura do gestor (TOTVS Sign) → anexar assinado.
4. **Vencedora → Contrato automático:** valor, disciplina, objeto, projetista e **parcelas geradas das etapas %** (padrão: estudo preliminar 15 · anteprojeto 15 · pré-executivo 20 · executivo 40 · final 10 **[revisar]**). Vencedor sem cadastro é convidado; ao contratar, é **registrado como responsável pela disciplina** no empreendimento.
5. **Parcelas:** *a faturar → solicitada* (projetista) *→ autorizada/recusada* (coordenador) *→ faturada* (NF enviada) *→ paga* (adm-fin). **Aditivos** alteram valor/parcelas com registro.
6. **NF:** dentro da **janela**; PDF cifrado no cofre; fila do adm-fin; pastas por competência.
7. **Painéis:** gestão vê compromissos do mês, vencido sem pagamento, pago, contratado × pago; adm-fin vê tudo por status; projetista vê os seus.

---

## 10. Acesso temporário por link (sem login)

Criado em **Acessos** (gestão ou analista): e-mail, nome, **disciplinas** (caixa de busca: digite a sigla, Enter marca), **alcance** — *só liberado para obra (A1/B1)* ou *liberado + compartilhado (S1–S4, marcado como preliminar)*; nunca S0 —, **permissão** (só visualizar / ver e baixar), **duração** (24 h · 48 h · 3 dias · 7 dias), mensagem. O convidado recebe o e-mail com `acesso.html?t=…`: ficha do empreendimento + última revisão de cada documento das disciplinas, com a situação de cada um; PDF abre na página; "Baixar" só quando permitido; IFC listado (download quando permitido). Expira sozinho; o coordenador vê aberturas, copia o link, estende (+24 h) ou encerra. Nada além disso existe para o convidado.

---

## 11. Obra e Setor

- **Obra:** entra direto no empreendimento (ou escolhe). CDE publicado, apontamentos de obra (níveis 1 e 2 abrem; 3 lê), Diário de Obra (engenheiro chefe), 3D publicado. Engenheiro chefe vê também o não liberado.
- **Setor interno:** Consulta ao CDE — só o publicado; sem apontamentos.

---

## 12. E-mails que o Auria envia

| Quando | Para quem |
|---|---|
| Convite de conta (analista, gestor, obra, setor, projetista) | convidado |
| Convite de cadastro de fornecedor / cadastro aprovado ou reprovado **[revisar]** | escritório |
| Novo apontamento / mensagem no apontamento | participantes / equipe |
| Arquivo recebido no CDE (na hora ou resumo 17h) | analistas do empreendimento |
| Mudança de status da revisão (devolvido, liberado) **[revisar]** | projetista |
| Solicitação de faturamento | analistas + gestores |
| Parcela autorizada/recusada · NF recebida | projetista |
| Recebimento de NF aberto | projetistas com parcela autorizada + e-mails extras |
| NF recebida pelo link público | adm-fin + confirmação ao remetente |
| Cotação: convite, lembrete, proposta recebida | escritórios / analista |
| Acesso temporário | convidado |

---

## 13. Mensagens de erro comuns

| Mensagem | Significado | O que fazer |
|---|---|---|
| "Link inválido ou expirado" (ativação) | link de uso único já usado/expirou | pedir novo convite ou "Esqueci minha senha" |
| "Você não coordena este empreendimento" / "Sem permissão" | visualizador ou sem vínculo | gestão › Distribuição |
| "Recebimento de NF fechado. Próxima janela: …" | fora da janela | aguardar a data da mensagem |
| "A parcela precisa estar AUTORIZADA para enviar a NF" | coordenador não autorizou | solicitar/aguardar |
| "Já existe um empreendimento com a sigla X" | sigla única por grupo | outra sigla |
| "Esta construtora ainda não tem padrão de codificação" | convenção não definida | gestão › Disciplinas (ou Aplicar de outra empresa) |
| "Código fora do padrão" no envio | nome do arquivo não segue a convenção | corrigir o código no envio |
| "Em análise — não liberado para execução" / "Só a revisão liberada pode ser baixada" | revisão ainda não A1/B1 | aguardar liberação |
| "Link inválido" (proposta / NF / acesso temporário) | token errado, revogado ou expirado | pedir novo link |
| "Falhou — tentar de novo" (conversão BIM) | conversão do IFC falhou | tentar de novo; persistindo, avisar o Auria |
| "Could not find the function … in schema cache" | função nova ainda não visível (segundos) | tentar de novo |
| Página em branco / lista vazia | sessão expirada ou cache | Ctrl+F5; entrar de novo |

---

## 14. Perguntas frequentes

- **Onde troco a logo do empreendimento?** Gestão › Empreendimentos › Editar (ou Implantação › Logo).
- **Como dou acesso a alguém da obra?** Gestão › card › Acessos › papel Obra + nível; ou Analista › Acessos › Convidar para a obra.
- **Por que o projetista não vê uma disciplina / não consegue enviar?** Falta a **atribuição disciplina → fornecedor** em Analista › Acessos › Fornecedores.
- **Por que a prancha não aparece para a obra?** Ainda não está **liberada** (A1/B1).
- **Como paro de receber e-mail de um empreendimento?** Seletor ✉ no card (sem e-mail de arquivos); visualizador pode 🔕 Silenciar.
- **Como um escritório novo vê o projeto para orçar?** Acessos › Acesso temporário por link (alcance "liberado + compartilhado" para preliminares).
- **Quem aprova cadastro de fornecedor?** A gestão. O analista convida e atribui.
- **O que falta para o empreendimento ficar pronto?** Implantação x/7 (gestão) / Implantação x/6 (analista).
- **Quem abre a janela de NF?** O adm-fin.
- **Posso mandar NF sem contrato?** Só pelo link público, na janela, se o adm-fin não marcou "só contrato cadastrado".
- **O modelo 3D não abre.** A conversão do IFC roda em segundo plano; aguarde ou clique em "tentar de novo" no CDE. Modelos muito grandes demoram minutos.
- **Os modelos das disciplinas não coincidem no 3D.** O alinhamento usa a origem do IFC; peça aos projetistas o mesmo ponto de origem/coordenadas.
- **Como comparo duas revisões?** No App, carregue as duas pranchas como camadas (opacidade/cor) ou use a análise de documentação com IA.

---

## 15. Glossário

**CDE** ambiente comum de dados · **S0** recebido · **S1–S4** compartilhado (compatibilização, informação, análise, aprovação de etapa) · **A1/B1** liberado para obra (com ressalvas) · **Devolvido** correção pedida · **Substituído** revisão antiga · **WIP** trabalho em andamento · **Convenção / padrão de codificação** regra de nomes por construtora · **Disciplina ativa** disciplina usada no empreendimento · **Fragments** modelo 3D leve gerado do IFC · **Federação** vários modelos alinhados no mesmo 3D · **bSDD** dicionário de dados da buildingSMART (padroniza propriedades) · **MDE** mapa de equalização · **RFP/cotação** pedido de proposta · **Parcela** etapa de pagamento · **Janela de NF** período de recebimento de notas · **Vínculo** analista × empreendimento · **Matriz de acessos** permissões por disciplina · **Visibilidade do apontamento** Coordenação / Projeto / Público.
