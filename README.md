# Upway Drop-off Portal

Ferramenta de balcão do UpCenter. Quando um cliente traz a e-bike para venda, o operador
encontra o agendamento do dia, confere os dados da bike, registra o que foi entregue de
fato e gera o **Einlieferungsbeleg** — o comprovante de entrega, impresso para o cliente
e arquivado no Drive.

Substitui um app Streamlit local que exigia instalação em cada máquina e guardava
credenciais do Metabase em disco.

Roda como **Google Apps Script** preso à planilha de destino. Não há etapa de build: os
arquivos em `src/` são exatamente os arquivos do projeto Apps Script.

---

## Como as peças conversam

```
                    Operador (navegador, conta @upway.shop)
                                    │
                                    │  google.script.run
                                    ▼
   ┌─────────────────────────  src/*.gs  ─────────────────────────┐
   │                                                              │
   │  Gateway.gs ──UrlFetchApp──► Gateway Hub ──► Metabase 10495   │
   │                              (outro Apps Script)             │
   │                                                              │
   │  Beleg.gs   ──► Shared Drive  {ano}/{MM-DD}/{ID} {Marca}.pdf │
   │                                                              │
   │  Sheet.gs   ──► aba "Drop-offs" (registro + snapshot)        │
   └──────────────────────────────────────────────────────────────┘
```

**O portal não guarda credencial nenhuma.** O acesso ao Metabase é intermediado pelo
Gateway Hub, que recebe o token OAuth da própria execução no header `Authorization`.
Nenhuma senha, chave ou token existe neste repositório — nem no histórico.

O app Streamlit antigo continua em `legacy_python_app/` na máquina de quem migrou, fora
do controle de versão (`.gitignore`): ele carrega `credentials.json` e `secret.key` reais.
Nunca foi rastreado — `git ls-files legacy_python_app` volta vazio.

## Estrutura

| Caminho | Papel |
|---|---|
| `src/Config.gs` | Constantes, dados dos armazéns, helpers de formatação. Não fala com API |
| `src/Portal.gs` | Entradas: menu da planilha, web app, serviço do HTML |
| `src/Gateway.gs` | Único caminho até o Gateway Hub e normalização das linhas do card |
| `src/Sheet.gs` | Aba Drop-offs: o que foi arquivado, o snapshot para reabrir, e a poda |
| `src/Beleg.gs` | Geração do Beleg e arquivamento no Drive |
| `src/Diagnostics.gs` | Diagnósticos rodáveis do menu ou do editor |
| `src/CheckinPortal.html` | Cliente: as três telas (fila, check-in, documento) |
| `src/ReviewBadge.html` | Selo "Review us on Google" em data URI. É um asset, não uma página |
| `test/` | 221 checks executáveis com `npm test` |
| `docs/design-handoff/` | Especificação visual e o Beleg legado de Berlim |

`rootDir: "src"` no `.clasp.json` define a fronteira: só o que está em `src/` vai para o
Apps Script. Testes, docs e configuração de CI ficam fora por construção, não por lista
de exclusão.

## Modelo de acesso

```json
"webapp": { "executeAs": "USER_DEPLOYING", "access": "DOMAIN" }
```

Entram só contas `@upway.shop`; tudo executa com as permissões do dono da implantação; a
trilha de auditoria é a coluna `Operador` na aba Drop-offs, preenchida por
`Session.getActiveUser()`.

Uma porta só: a associação ao domínio. Nenhum operador precisa de acesso próprio ao
Gateway Hub, ao Shared Drive ou à planilha — o que elimina a manutenção de três listas de
permissão por pessoa.

O custo consciente: como tudo roda com a conta do dono, o Drive registra todo PDF no nome
dele. Por isso a coluna `Operador` existe — ela é a trilha de auditoria, e o Beleg é
documento com valor legal.

`executeAs` vale **apenas para a URL do web app**. Função disparada pelo menu da planilha
roda sempre como quem está usando a planilha, e aí a conta dela precisaria de acesso
próprio ao hub. Use a URL, e mantenha a planilha compartilhada só com quem administra.

## Rodar os checks

```bash
npm install
npm test
```

221 checks, sem rede e sem Apps Script. Rodam no CI a cada PR
([`.github/workflows/test.yml`](.github/workflows/test.yml)).

| Arquivo | O que cobre |
|---|---|
| `test/selfchecks.mjs` | Helpers puros: formatação alemã, casamento de armazém, nome de arquivo, markup do Beleg |
| `test/pipeline.test.mjs` | `getMetabaseData` contra o formato real do gateway, a leitura da aba e a poda |
| `test/harness.mjs` | Monta o harness do portal a partir do `src/`, sem substituição nenhuma |
| `test/portal.test.mjs` | O portal em jsdom: fila, busca, check-in, reabertura, documento, impressão, erros |
| `test/apps-script.mjs` | Carrega os `.gs` concatenados, como o Apps Script faz |

Dois detalhes deliberados nos testes:

- `test/apps-script.mjs` concatena os `.gs` num escopo global único. Se uma divisão futura
  criar dependência de ordem no topo de um arquivo, os testes quebram aqui — que é o único
  sintoma que o Apps Script daria, e só em produção.
- `test/harness.mjs` carrega o `CheckinPortal.html` **sem nenhuma substituição** e falha se
  encontrar scriptlet de template. Houve um bug em que o HTML entregue pelo servidor
  divergia do arquivo em disco, e nenhum teste podia pegá-lo. Servindo estático, o que o
  teste carrega é o que o operador recebe.

Alguns checks existem para travar coisas que não são código, e sim acordos: os endereços
dos armazéns vivem em `Config.gs` **e** no HTML, e um teste compara os dois armazém por
armazém; outro falha se alguém voltar a escrever uma data fixa no markup da fila.

No editor do Apps Script, três funções rodáveis (também no menu da planilha):

| Função | Responde |
|---|---|
| `runSelfChecks()` | Os helpers puros continuam corretos? |
| `diagnoseGateway()` | O que o hub respondeu, quantos bytes, e o cache está quente? |
| `diagnoseRows()` | A fila está vazia por falha ou por filtro? |

## Triggers

Duas rotinas de fundo. Instalar **uma vez cada**, do editor, com a conta dona da
implantação — é o token dela que o Gateway Hub libera.

| Instalador | Frequência | Faz |
|---|---|---|
| `installWarmTrigger()` | 5 min | Enche o cache do card antes de alguém abrir o portal |
| `installGcTrigger()` | 2 dias, ~4h | Poda os snapshots da aba mais velhos que 30 dias |

Os dois instaladores são idempotentes: removem o trigger anterior do mesmo handler antes
de criar o novo. Rodar duas vezes não gera dois triggers — o que, no caso do aquecimento,
dobraria a carga no Metabase.

A poda **não apaga linha**. A aba é a trilha de auditoria de um documento legal: Bike ID,
operador, data e o link do PDF ficam para sempre. O que cresce sem teto é o snapshot do
formulário (um JSON por linha), que só serve para reabrir um Beleg — e um drop-off de mês
passado não vai ser reaberto. Linha com data ilegível não é tocada.

## Publicar

```bash
npm run push                                   # clasp push --force
clasp list-deployments                         # descubra o ID da implantação em uso
clasp create-deployment -i <id> -d "descrição" # nova versão, MESMA URL
```

A URL `/exec` serve a última **implantação**, não o código atual: `push` sozinho não muda
o que a equipe vê. Passar `-i <id>` cria uma versão e repontua aquela implantação, o que
preserva a URL — sem `-i`, sai uma URL nova e a equipe fica com o atalho velho.

Menu da planilha, editor e triggers rodam sempre o código atual (HEAD), então para eles
o `push` basta.

O bloco `webapp` do manifest só se aplica a implantações novas — depois de mudar acesso,
confira o campo em *Gerenciar implantações*.

## Concorrência e latência

Dimensionado para os balcões dos oito UpCenters operando ao mesmo tempo.

- **O card do Metabase é buscado uma vez e reaproveitado.** A resposta fica em
  `CacheService` por 420s, gravada em pedaços de 90 KB. O pedaço importa: o teto é 100 KB
  por chave e o `put` acima disso falha **calado** — com o card grande, o cache nunca
  ligava e toda abertura pagava a query inteira.
- **O trigger de aquecimento tira a query fria do caminho do operador.** Sem ele, quem
  abre o portal primeiro no dia espera pela query; com ele, o cache nunca está frio no
  horário de balcão. O TTL é maior que o intervalo de propósito, para não haver janela
  entre o vencimento e o próximo aquecimento.
- **Trocar de armazém não vai ao servidor.** O cliente memoiza o resultado por
  (armazém, período) por 60s. Reclicar o período já ativo força a ida ao servidor.
- **A leitura da aba é uma coluna, não a aba inteira.** Só os Bike IDs são lidos (e
  cacheados por 300s, invalidados na gravação); os snapshots vêm depois, só das linhas que
  a fila vai mostrar.
- **A gravação na planilha é serializada.** `logDropoffToSheet` pega `LockService` antes do
  read-modify-write: sem ele, dois balcões arquivando ao mesmo tempo podiam fazer o
  `setValues` sobrescrever a linha de outro drop-off. A poda pega o mesmo lock.
- **A preferência de armazém é por operador** (`UserProperties`). Em `ScriptProperties` era
  um valor único do script, e Berlim sobrescrevia Düsseldorf. A gravação só acontece quando
  o armazém muda, não a cada carga de tela.
- **Quota:** com `executeAs: USER_DEPLOYING` todas as execuções contam no bucket do dono —
  o teto relevante é *30 execuções simultâneas*. Cada ação do portal dura poucos segundos,
  e a geração do PDF (~4s) é o trecho mais longo; dez operadores ficam uma ordem de
  grandeza abaixo do limite. O sintoma, se um dia encostar, é
  `Too many simultaneous invocations`.

## Decisões que parecem estranhas e não são

Cada uma destas custou uma sessão de depuração. Estão comentadas no código também.

- **O portal é HTML estático, sem `createTemplateFromFile`.** Já foi templated, injetando
  armazéns e assets por scriptlet. O resultado no navegador era `Uncaught SyntaxError:
  Unexpected end of input` — o HTML entregue não era o arquivo do disco, e nenhum teste
  local podia pegar isso porque o teste lia o disco. Os assets do documento vêm por
  `google.script.run` (`getDocAssets`).
- **O favicon passa por `withFavicon()`, com `try`.** `setFaviconUrl` *lança* quando o
  Google não aceita o tipo da imagem, e a chamada mora dentro do `doGet`. Um data URI de
  SVG derrubou o portal inteiro em produção: sem `try`, um enfeite tinha poder de deixar o
  balcão sem tela.
- **A fila carrega com skeleton, não com overlay.** O overlay tapava com blur justamente o
  que estava chegando, e deixava os contadores em `0` visíveis por trás — indistinguível de
  "não há nada hoje". O overlay continua na gravação no Drive, onde bloquear é o certo.
- **A data do cabeçalho é calculada no boot, antes de qualquer fetch.** Ela não depende do
  servidor, só do relógio. Antes havia um dia escrito à mão no markup, que o operador lia
  como agendamento real enquanto a fila carregava.
- **Impressão fixa em milímetros, com `print-color-adjust: exact`.** A folha da tela já é
  A4 (794×1123px a 96dpi); o `width: 100%` anterior a esticava na largura do papel. E o
  Chrome imprime com "gráficos de segundo plano" desligado por padrão, o que descartava o
  fundo azul dos checkboxes e as réguas das seções.
- **Todo filete e caixa no HTML do PDF leva um `&nbsp;` com `font-size: 0`.** O conversor
  HTML→PDF do Apps Script colapsa elemento vazio, mesmo com `width` e `height` explícitos.
  Era por isso que os checkboxes do Zubehör saíam invisíveis no Beleg arquivado.
- **Pastas do dia são `MM-DD`, não `DD.MM`.** O Drive lista alfabeticamente; com `DD.MM`
  todo dia 1 de todos os meses ficava agrupado.
- **Acessórios nascem desmarcados.** O handoff sugeria pré-marcar Akku e Ladegerät, mas o
  Beleg *declara* o que o cliente entregou: pré-marcado, um operador com pressa assina
  afirmando ter recebido peça que não recebeu.
- **A pasta do Drive é constante, não `PropertiesService`.** Um ID errado gravado lá vencia
  a constante e os PDFs iam para o Drive errado sem aviso.
- **`Print & save` usa `window.print()`, não um iframe com o PDF.** No sandbox do Apps
  Script o iframe carregado de um `blob:` recebe origem opaca,
  `frame.contentWindow.print()` levanta `SecurityError`, e o fallback de abrir aba caía no
  bloqueador de popup.

## Pendências

**Nome de armazém ≠ cidade em três casos.** Os galpões de Stuttgart, Antwerp e Los Angeles
ficam hoje em Illingen, Mechelen e Redondo Beach. Os endereços já estão corretos; os
**nomes** continuam os antigos de propósito, porque o nome é a chave de casamento com o
campo `dropOffWarehouse` do card. Renomear sem alinhar com o Metabase esvazia a fila
daquele balcão, e faz `getDocAssets` cair no fallback e imprimir o QR de Berlim no Beleg
de outro UpCenter. Para resolver: rodar `diagnoseRows()`, ver o valor cru que o card
devolve, e mudar chave, nome e casamento juntos.

**Gateway Hub desatualizado.** A implantação que este portal chama serve código de maio,
sem cache de sessão do Metabase — ou seja, um login completo por requisição. A versão
atual do hub já resolve isso e ainda liga uma camada de validação que hoje não existe em
produção. É a maior latência que sobrou, e mora no outro repositório.

**Outras:**

- Os `gpageId` de avaliação só existem para Berlim (decodificado do QR do Beleg legado).
  Os outros sete armazéns caem numa busca do Google Maps até alguém preencher — ver
  `WAREHOUSE_MAP` em `src/Config.gs`.
- O texto jurídico do Beleg foi herdado do recibo legado e não passou pelo Legal.
- Existem sete implantações; só uma está em uso. Consolidar.
- O card 10495 traz uma coluna `type`. Se ele devolver também coletas em casa, falta
  filtrar por `DROPOFF_WAREHOUSE`.
- `CONFIG.HUB_URL` está versionada em `src/Config.gs`. A URL de um web app do Apps Script
  vale como segredo — se este repositório for público, ela precisa sair daqui e virar
  Script Property.
