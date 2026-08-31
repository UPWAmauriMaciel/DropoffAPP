# Snapshot agendado do card + filtro no cliente

**Data:** 2026-08-31 · **Estado:** implementado

## Problema

Três coisas, uma causa comum.

1. O portal sentia "loading" a cada clique — trocar de armazém, de período, arquivar um
   Beleg. A suspeita era a query do Metabase; não era. `hubRequest()` já baixava o card
   inteiro e o cache respondia. O custo era o **round trip de Apps Script** repetido a
   cada troca de view, mais renormalizar o card e reler a aba.
2. Um trigger de aquecimento rodava de 5 em 5 minutos, 24/7 — ~288 queries/dia no
   Metabase para um balcão que abre de manhã, de segunda a sexta.
3. Nada guardava o resultado da query fora do `CacheService`, cujo teto de TTL é 6h. O vão
   das 12:03 até as 08:03 do dia seguinte é de 20h: o cache morre no meio da noite e o
   primeiro operador da manhã pagava a query inteira.

## Decisões

| Questão | Decisão | Alternativa descartada |
|---|---|---|
| Frescor | 2 refreshes/dia + botão manual; trigger de 5 min removido | Manter aquecimento no horário do balcão (~130 queries/dia) |
| Idade do dado | Só no `title` do botão | Carimbo permanente na toolbar |
| Payload | Card inteiro sem os snapshots de formulário | Com snapshots (cresce com a aba para sempre) |
| Falha do refresh | Mantém a fila boa; botão vira "Retry" | Esvaziar a tela e mostrar card de erro |

A escolha do tooltip tem custo conhecido: numa fila vazia, "não há ninguém hoje" e "o
snapshot é de ontem" ficam idênticos até alguém passar o mouse. Aceito; promover o
carimbo para a toolbar depois não exige refazer nada.

## Arquitetura

```
08:03 e 12:03, seg–sex  ──┐
botão Update ─────────────┼──►  refreshSnapshot()
                          │       ├─ fetchHubDataUncached()   ← único caminho ao Metabase
                          │       ├─ normalizeCardRows()
                          │       └─ grava JSON no Drive (setContent) + aquece o cache
                          │
abertura do portal ───────────►  loadSnapshot()
                                  ├─ CacheService chunked (6h)
                                  ├─ senão: lê o JSON do Drive
                                  └─ senão: refreshSnapshot()   ← cold start
```

`src/Snapshot.gs` (novo) é dono de tudo acima. `Gateway.gs` ganhou `normalizeCardRows()` e
`scheduleRow()` extraídas do `getMetabaseData`, e perdeu `fetchHubData`, `warmHubCache` e
`installWarmTrigger`.

**Drive:** `_snapshot/card-10495.json` dentro de `CONFIG.SHARED_DRIVE_FOLDER_ID`.
`setContent()` mantém o mesmo file ID e empurra a versão anterior para o histórico de
revisões — auditoria de graça, sem um arquivo por execução.

**Triggers:** dois `everyDays(1).atHour(8|12).nearMinute(3)`, com a guarda de dia útil no
handler. Via `onWeekDay()` seriam 10 triggers contra a cota de 20 por script.
`nearMinute(3)` não garante 08:03 — a janela do Apps Script é de ~15 min.

**Cliente:** `state.allRows` recebe o card inteiro numa carga. Armazém, período e busca
viram filtro em memória (`applyFilters()`), espelhando `matchesWarehouse` e o filtro de
data do servidor. O memo por (armazém, período) foi removido: existia para disfarçar o
round trip que deixou de existir.

**Reopen:** `saved` não vai no payload da fila. Vem por `getSavedSnapshot(bikeId)` quando
o operador reabre aquela linha, e fica em cache no objeto (`undefined` = não buscado,
`null` = buscado e não existe).

## Invariantes que os testes protegem

- Com snapshot gravado, nenhuma carga vai ao Metabase; só `refreshSnapshot` vai.
- Refresh que falha não sobrescreve o snapshot bom nem descarta a fila da tela.
- Falha **sem nada carregado** continua dando erro visível e fila vazia — nunca dado
  inventado numa mesa de check-in.
- Sábado e domingo não gastam query.
- As duas formas de card do Metabase (array e envelope `cols`/`rows`) normalizam igual.
- Trocar de armazém e de período: zero chamadas ao servidor.
- `getMetabaseData` mantém assinatura e comportamento — é o contrato que o
  `pipeline.test.mjs` verifica e o que os diagnósticos do menu imprimem.

## Não feito

- Auto-refresh em background com a aba aberta. O botão cobre o caso; adicionar quando o
  operador reclamar de apertar Update demais.
- Carimbo de idade visível na toolbar. Ver o custo aceito acima.
