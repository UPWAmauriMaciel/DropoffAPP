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

## Estrutura

| Caminho | Papel |
|---|---|
| `src/Config.gs` | Constantes, dados dos armazéns, helpers de formatação. Não fala com API |
| `src/Portal.gs` | Entradas: menu da planilha, web app, serviço do HTML |
| `src/Gateway.gs` | Único caminho até o Gateway Hub e normalização das linhas do card |
| `src/Sheet.gs` | Aba Drop-offs: o que foi arquivado e o snapshot para reabrir |
| `src/Beleg.gs` | Geração do Beleg e arquivamento no Drive |
| `src/Diagnostics.gs` | Diagnósticos rodáveis do menu ou do editor |
| `src/CheckinPortal.html` | Cliente: as três telas (fila, check-in, documento) |
| `src/ReviewBadge.html` | Selo "Review us on Google" em data URI. É um asset, não uma página |
| `test/` | 152 checks executáveis com `npm test` |
| `docs/design-handoff/` | Especificação visual e o Beleg legado de Berlim |

`rootDir: "src"` no `.clasp.json` define a fronteira: só o que está em `src/` vai para o
Apps Script. Testes, docs e configuração de CI ficam fora por construção, não por
lista de exclusão.

## Modelo de acesso

```json
"webapp": { "executeAs": "USER_DEPLOYING", "access": "DOMAIN" }
```

| | |
|---|---|
| **Quem entra** | Só contas `@upway.shop` (`access: DOMAIN`) |
| **Com quais permissões** | Do dono da implantação (`executeAs: USER_DEPLOYING`) |
| **Trilha de auditoria** | Coluna `Operador` na aba Drop-offs, via `Session.getActiveUser()` |

Uma porta só: a associação ao domínio. Nenhum operador precisa de acesso próprio ao
Gateway Hub, ao Shared Drive ou à planilha — o que elimina a manutenção de três listas
de permissão por pessoa.

O custo consciente: como tudo roda com a conta do dono, o Drive registra todo PDF no nome
dele. Por isso a coluna `Operador` existe — ela é a trilha de auditoria, e o Beleg é
documento com valor legal.

> ⚠️ `executeAs` vale **apenas para a URL do web app**. Função disparada pelo menu da
> planilha roda sempre como quem está usando a planilha, e aí a conta dela precisaria de
> acesso próprio ao hub. Use a URL, e mantenha a planilha compartilhada só com quem
> administra.

## Rodar os checks

```bash
npm install
npm test
```

152 checks, sem rede e sem Apps Script. Rodam no CI a cada PR
([`.github/workflows/test.yml`](.github/workflows/test.yml)).

| Arquivo | O que cobre |
|---|---|
| `test/selfchecks.mjs` | Helpers puros: formatação alemã, casamento de armazém, nome de arquivo, markup do Beleg |
| `test/pipeline.test.mjs` | `getMetabaseData` contra o formato real do gateway, incluindo 401/403 |
| `test/portal.test.mjs` | O portal em jsdom: fila, busca, check-in, reabertura, documento, impressão, erros |
| `test/apps-script.mjs` | Carrega os `.gs` concatenados, como o Apps Script faz |

Dois detalhes deliberados nos testes:

- `test/apps-script.mjs` concatena os seis `.gs` num escopo global único. Se uma divisão
  futura criar dependência de ordem no topo de um arquivo, os testes quebram aqui — que
  é o único sintoma que o Apps Script daria, e só em produção.
- `test/harness.mjs` carrega o `CheckinPortal.html` **sem nenhuma substituição** e falha
  se encontrar scriptlet de template. Houve um bug em que o HTML entregue pelo servidor
  divergia do arquivo em disco, e nenhum teste podia pegá-lo. Servindo estático, o que o
  teste carrega é o que o operador recebe.

No editor do Apps Script, três funções rodáveis (também no menu da planilha):

| Função | Responde |
|---|---|
| `runSelfChecks()` | Os helpers puros continuam corretos? |
| `diagnoseGateway()` | O que exatamente o hub respondeu? |
| `diagnoseRows()` | A fila está vazia por falha ou por filtro? |

## Publicar

```bash
npm run push                            # clasp push --force
clasp create-version "descrição"
clasp update-deployment <id> -V <n>     # aponta a implantação existente, mantém a URL
clasp list-deployments                  # o que está no ar
```

A URL `/exec` serve a última **implantação**, não o código atual: `push` sozinho não muda
o que a equipe vê. E o bloco `webapp` do manifest só se aplica a implantações novas —
depois de mudar acesso, confira o campo em *Gerenciar implantações*.

## Concorrência

Dimensionado para os balcões dos oito UpCenters operando ao mesmo tempo.

- **Uma query no Metabase por minuto, não por clique.** A resposta do card fica em
  `CacheService` por 60s (`Gateway.gs`). O filtro de armazém e período é aplicado em
  memória, então trocar de aba não gera tráfego. Dez balcões abrindo o portal ao mesmo
  tempo = **uma** query.
- **A gravação na planilha é serializada.** `logDropoffToSheet` pega `LockService` antes do
  read-modify-write: sem ele, dois balcões arquivando ao mesmo tempo podiam fazer o
  `setValues` sobrescrever a linha de outro drop-off.
- **A preferência de armazém é por operador** (`UserProperties`). Em `ScriptProperties` era
  um valor único do script, e Berlim sobrescrevia Düsseldorf.
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

- Os `gpageId` de avaliação só existem para Berlim (decodificado do QR do Beleg legado).
  Os outros sete armazéns caem numa busca do Google Maps até alguém preencher — ver
  `WAREHOUSE_MAP` em `src/Config.gs`.
- Confirmar os endereços dos armazéns contra o master data.
- O texto jurídico do Beleg foi herdado do recibo legado e não passou pelo Legal.
- Existe uma segunda implantação servindo versão antiga; consolidar em uma só.
- O card 10495 traz uma coluna `type`. Se ele devolver também coletas em casa, falta
  filtrar por `DROPOFF_WAREHOUSE`.
