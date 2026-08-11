# Upway Drop-off Portal

Ferramenta de balcão do UpCenter: o operador encontra o agendamento do dia, confere os
dados da bike, registra o que o cliente entregou e gera o **Einlieferungsbeleg** (recibo
de entrega) — impresso para o cliente e arquivado no Drive.

Roda como **Google Apps Script** preso à planilha de destino. Não há build: os arquivos
deste repositório são os arquivos do projeto Apps Script.

## Como as peças conversam

```
Operador (navegador)
   │  google.script.run
   ▼
Code.gs  ──UrlFetchApp──►  Gateway Hub (outro Apps Script)  ──►  Metabase card 10495
   │
   ├──►  Shared Drive  0ANJ1ayRr35D2Uk9PVA / {ano} / {MM-DD} / {BIKE-ID} {Marca}.pdf
   └──►  aba "Drop-offs" da planilha (registro + snapshot para reabrir)
```

O portal **não guarda credencial nenhuma**. O acesso ao Metabase é intermediado pelo
Gateway Hub, que recebe o token OAuth da execução no header `Authorization`.

## Arquivos

| Arquivo | Papel |
|---|---|
| `Code.gs` | Servidor: config, gateway, planilha, geração do Beleg, diagnósticos |
| `CheckinPortal.html` | Cliente: as três telas (fila, check-in, documento) |
| `ReviewBadge.html` | Selo "Review us on Google" em data URI (asset, não é página) |
| `appsscript.json` | Manifest: escopos OAuth e configuração do web app |
| `test/` | Checks que rodam com `npm test` (node + jsdom, sem Apps Script) |
| `design_handoff_dropoff_portal/` | Especificação visual e o Beleg legado de Berlim |

`.claspignore` restringe o push a `Code.gs`, `CheckinPortal.html`, `appsscript.json` e
`ReviewBadge.html` — o resto do repositório não vai para o Apps Script.

## Modelo de acesso

```json
"webapp": { "executeAs": "USER_DEPLOYING", "access": "DOMAIN" }
```

- **`access: DOMAIN`** — só contas `@upway.shop` abrem a URL do web app.
- **`executeAs: USER_DEPLOYING`** — o script roda com a conta do dono da implantação.
  Por isso nenhum operador precisa de acesso próprio ao Gateway Hub, ao Shared Drive
  ou à planilha: uma porta só, a do domínio.
- Como o Drive passa a registrar todo PDF no nome do dono, **a trilha de auditoria é a
  coluna `Operador`** da aba Drop-offs, preenchida com `Session.getActiveUser()`.

⚠️ `executeAs` vale **apenas para a URL do web app**. Função disparada pelo menu da
planilha roda sempre como quem está usando a planilha — e aí a conta dele precisaria de
acesso ao hub. Use a URL, e mantenha a planilha compartilhada apenas com quem administra.

## Rodar os checks

```bash
npm install
npm test
```

152 checks, sem rede e sem Apps Script:

- `test/selfchecks.mjs` — helpers puros do `Code.gs` (formatação alemã, casamento de
  armazém, nome de arquivo, markup do Beleg).
- `test/pipeline.test.mjs` — `getMetabaseData` contra o formato real do gateway, incluindo
  os casos de 401/403.
- `test/portal.test.mjs` — o portal em jsdom: fila, busca, check-in, reabertura, documento,
  impressão e estados de erro.

O `test/harness.mjs` carrega o `CheckinPortal.html` **sem nenhuma substituição** e falha se
encontrar scriptlet de template no arquivo. Isso é deliberado: houve um bug em que o HTML
entregue pelo servidor divergia do arquivo em disco, e nenhum teste podia pegá-lo. Servindo
estático, o que o teste carrega é o que o operador recebe.

No editor do Apps Script há dois diagnósticos rodáveis, também no menu da planilha:
`diagnoseGateway()` (o que o hub respondeu) e `diagnoseRows()` (por que a fila está vazia).

## Publicar

```bash
clasp push --force                     # envia o código
clasp create-version "descrição"       # congela uma versão
clasp update-deployment <id> -V <n>    # aponta a implantação existente (mantém a URL)
```

A URL `/exec` serve a última **implantação**, não o código atual — `push` sozinho não muda
o que a equipe vê. `clasp list-deployments` mostra o que está no ar.

## Pendências conhecidas

- Os `gpageId` de avaliação só existem para Berlim (decodificado do Beleg legado). Os outros
  sete armazéns caem numa busca do Google Maps até alguém preencher — ver `WAREHOUSE_MAP`.
- Confirmar os endereços dos armazéns contra o master data.
- O texto jurídico do Beleg foi herdado do recibo legado; falta validação do Legal.
- Existe uma segunda implantação servindo versão antiga; consolidar em uma só.
- O card 10495 traz uma coluna `type`; se ele devolver também coletas em casa, falta
  filtrar por `DROPOFF_WAREHOUSE`.
