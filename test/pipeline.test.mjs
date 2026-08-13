// Roda getMetabaseData do Code.gs real contra o payload REAL do gateway
// (nomes de coluna copiados da resposta do hub, com a seta " → ").
import fs from 'fs';
import path from 'path';
import { gsSource } from './apps-script.mjs';

const iso = d => d.toISOString().slice(0, 10);
const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const stamp = n => iso(shift(n)) + 'T07:00:00';

// Linhas montadas com as chaves exatas do gateway
const row = (bikeId, wh, dayOffset, extra = {}) => ({
  bikeId, email: 'x@y.de', brand: 'Riese & Müller', model: 'Roadster Touring',
  quote: 1661, mileageKm: 3100, year: 2023,
  'CustomerInbound → status': 'PICKUP_SCHEDULED',
  'InboundLeadLogistics - logisticsId → type': 'DROPOFF_WAREHOUSE',
  'InboundLeadLogistics - logisticsId → dropOffStartDate': dayOffset === null ? null : stamp(dayOffset),
  'InboundLeadLogistics - logisticsId → dropOffWarehouse': wh,
  'ShippingAddress - pickupAddressId → firstName': 'Klaus',
  'ShippingAddress - pickupAddressId → lastName': 'Boekels',
  ...extra
});

const PAYLOAD = [
  row('RK2QD3', 'dusseldorf', 3),
  row('RK2AA1', 'berlin', 0),
  row('RK2BB2', 'berlin', 4),
  row('RK2CC3', 'berlin', -2),
  row('RK2DD4', 'Düsseldorf', 0),
  row('RK2EE5', '', 0),
  row('RK2FF6', 'berlin', 40)
];

// ---- stubs Apps Script ----
const props = {};
globalThis.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: k => props[k] || null,
    setProperty: (k, v) => { props[k] = v; },
    deleteProperty: k => { delete props[k]; }
  }),
  getUserProperties: () => ({
    getProperty: k => props['u:'+k] || null,
    setProperty: (k, v) => { props['u:'+k] = v; },
    deleteProperty: k => { delete props['u:'+k]; }
  })
};
globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) };
globalThis.__rows = [];
globalThis.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
let cacheStore = {};
globalThis.CacheService = { getScriptCache: () => ({
  get: k => (k in cacheStore ? cacheStore[k] : null),
  getAll: ks => { const o = {}; ks.forEach(k => { if (k in cacheStore) o[k] = cacheStore[k]; }); return o; },
  put: (k,v) => { cacheStore[k]=v; },
  putAll: (o) => { Object.assign(cacheStore, o); },
  remove: k => { delete cacheStore[k]; }
}) };
globalThis.__cache = { clear: () => { cacheStore = {}; }, size: () => Object.keys(cacheStore).length };
globalThis.Logger = { log: m => console.log(m) };
globalThis.HtmlService = { createHtmlOutputFromFile: () => ({ getContent: () => 'data:image/png;base64,AAA' }) };
globalThis.Utilities = {
  base64Encode: () => 'AAAA', base64EncodeWebSafe: () => 'KEY',
  computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
};
globalThis.ScriptApp = { getOAuthToken: () => 'tok' };
globalThis.Session = { getActiveUser: () => ({ getEmail: () => 'amigo@gmail.com' }) };
let lastFetchHeaders = null;
let hubCalls = 0;
let hubStatus = 200;
globalThis.UrlFetchApp = {
  fetch: (url, opts) => {
    if (url.indexOf('qrserver') !== -1) return { getResponseCode: () => 500, getContentText: () => '' };
    lastFetchHeaders = opts.headers;
    hubCalls++;
    if (hubStatus !== 200) {
      // pagina de erro do Google, como veio na conta sem acesso ao hub
      return { getResponseCode: () => hubStatus, getContentText: () => '<!DOCTYPE html><html lang="en"><head><script nonce="x">window[\'ppConfig\'] = {productName: \'abc\'}' };
    }
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(PAYLOAD) };
  }
};

const code = gsSource();
new Function(code + '\n;Object.assign(globalThis,{getMetabaseData,runSelfChecks,matchesWarehouse,rowDateIso,reviewUrlFor,dayFolderName,fetchHubDataUncached,logDropoffToSheet,SHEET_HEADERS,readProcessedIds,collectSheetGarbage,parseSheetStamp,WAREHOUSES,WAREHOUSE_MAP,normStr});')();

let fails = 0;
const ok = (c, n) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fails++; };

runSelfChecks();
console.log('');

// --- Berlin / hoje ---
const berlinToday = getMetabaseData({ warehouse: 'berlin', dateFilter: 'today' });
ok(!berlinToday.error, 'sem erro no pipeline');
ok(lastFetchHeaders && /^Bearer /.test(lastFetchHeaders.Authorization), 'header Authorization enviado ao hub');
ok(berlinToday.total === 2, 'Berlin/hoje: 2 linhas (a de berlin hoje + a sem armazém) — veio ' + berlinToday.total);
ok(berlinToday.rows.some(r => r.bikeId === 'RK2AA1'), 'inclui a bike de Berlin de hoje');
ok(berlinToday.rows.some(r => r.bikeId === 'RK2EE5'), 'inclui a linha sem armazém (não desaparece em silêncio)');
ok(!berlinToday.rows.some(r => r.bikeId === 'RK2QD3'), 'exclui a de Düsseldorf');

// --- o resumo explica a fila ---
const s = berlinToday.summary;
ok(s.totalRows === 7, 'resumo conta as 7 linhas do card');
ok(s.byWarehouse.dusseldorf === 2, 'agrupa "dusseldorf" e "Düsseldorf" na mesma chave');
ok(s.selectedWarehouse.today === 2, 'resumo: 2 hoje neste armazém');
ok(s.selectedWarehouse.next10days === 1, 'resumo: 1 nos próximos 10 dias');
ok(s.selectedWarehouse.past10days === 1, 'resumo: 1 nos últimos 10 dias');
ok(s.selectedWarehouse.otherDates === 1, 'resumo: 1 fora das janelas (+40 dias)');

// --- períodos ---
ok(getMetabaseData({ warehouse: 'berlin', dateFilter: 'next10days' }).total === 3, 'next10days inclui hoje + futuro próximo');
ok(getMetabaseData({ warehouse: 'berlin', dateFilter: 'past10days' }).total === 3, 'past10days inclui hoje + passado próximo');

// --- armazém como a UI manda: "düsseldorf" com trema e minúsculo ---
const dus = getMetabaseData({ warehouse: 'düsseldorf', dateFilter: 'today' });
ok(dus.rows.some(r => r.bikeId === 'RK2DD4'), 'UI manda "düsseldorf" e casa com "Düsseldorf" do card');
ok(getMetabaseData({ warehouse: 'los angeles', dateFilter: 'today' }).total === 1, '"los angeles" não casa com nada além da linha sem armazém');

// --- campos normalizados a partir das chaves com seta ---
const r0 = getMetabaseData({ warehouse: 'dusseldorf', dateFilter: 'next10days' }).rows.find(r => r.bikeId === 'RK2QD3');
ok(!!r0, 'linha de Düsseldorf aparece em next10days');
ok(r0.customerName === 'Klaus Boekels', 'nome do cliente vem da coluna "ShippingAddress - pickupAddressId → firstName"');
ok(r0.bikeName === 'Riese & Müller Roadster Touring', 'marca + modelo');
ok(r0.mileage === '3100', 'quilometragem');
ok(r0.dropOffDate === iso(shift(3)), 'data do drop-off interpretada');
ok(r0.quote === '€ 1.661', 'quote em formato alemao sem centavos (veio ' + r0.quote + ')');

// --- QR: link real de Berlim, e degradação visível quando o serviço cai ---
ok(reviewUrlFor({ name: 'Berlin', city: 'x', gpageId: 'CZuAldi1qpuUEBM' })
   === 'https://g.page/r/CZuAldi1qpuUEBM/review?utm_source=gbp&utm_medium=reviews&utm_campaign=qr',
   'Berlim usa o link g.page real decodificado do Beleg legado');

// --- conta sem acesso ao hub: mensagem acionavel, sem HTML na tela ---
for (const status of [403, 401]) {
  hubStatus = status;
  globalThis.__cache.clear();
  const denied = getMetabaseData({ warehouse: 'berlin', dateFilter: 'today' });
  ok(!!denied.error, status + ': devolve erro');
  ok(denied.error.indexOf('amigo@gmail.com') !== -1, status + ': nomeia a conta que foi recusada');
  ok(/web app URL/.test(denied.error), status + ': aponta a URL do web app como caminho');
  ok(denied.error.indexOf('<') === -1 && denied.error.indexOf('ppConfig') === -1,
     status + ': nao despeja o HTML da pagina de erro do Google');
  ok(!denied.rows, status + ': nao devolve linha nenhuma');
}
hubStatus = 500;
globalThis.__cache.clear();
const boom = getMetabaseData({ warehouse: 'berlin', dateFilter: 'today' });
ok(boom.error.indexOf('HTTP 500') !== -1 && boom.error.indexOf('HTML page') !== -1,
   '500 com corpo HTML: reporta o status sem colar o markup');
hubStatus = 200;


// --- 10 balcoes ao mesmo tempo: estado compartilhado e carga no Metabase ---
globalThis.__cache.clear();
hubCalls = 0;
for (let i = 0; i < 10; i++) getMetabaseData({ warehouse: 'berlin', dateFilter: 'today' });
ok(hubCalls === 1, '10 cargas simultaneas = 1 query no Metabase (veio ' + hubCalls + ')');

hubCalls = 0;
getMetabaseData({ warehouse: 'dusseldorf', dateFilter: 'next10days' });
getMetabaseData({ warehouse: 'stuttgart', dateFilter: 'past10days' });
ok(hubCalls === 0, 'trocar armazem e periodo filtra em memoria, sem ir ao hub');

hubCalls = 0;
fetchHubDataUncached();
ok(hubCalls === 1, 'diagnostico ignora o cache e ve o hub agora');

// preferencia de armazem e POR OPERADOR: em ScriptProperties um balcao sobrescrevia o outro
ok(props['u:WAREHOUSE'] === 'stuttgart', 'armazem escolhido vai para UserProperties');
ok(props['WAREHOUSE'] === undefined, 'nada de WAREHOUSE global em ScriptProperties');

// --- enderecos: vivem em DOIS arquivos e nao podem divergir ---
// O Config.gs se descreve como "fonte unica", mas o portal deixou de ser template e ganhou
// lista propria. Corrigir um so faz a tela mostrar um endereco e o Beleg imprimir outro —
// e o Beleg e documento legal. O endereco tambem decide o destino do QR de avaliacao dos
// armazens sem gpageId (reviewUrlFor cai numa busca do Maps por nome + endereco).
const portalHtml = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'CheckinPortal.html'), 'utf8');
const htmlWh = [...portalHtml.matchAll(/\{\s*name:\s*"([^"]+)",\s*city:\s*"([^"]+)"\s*\}/g)].map(m => [m[1], m[2]]);
ok(htmlWh.length === WAREHOUSES.length, 'portal lista os mesmos ' + WAREHOUSES.length + ' armazens do Config.gs (veio ' + htmlWh.length + ')');
htmlWh.forEach(([name, city]) => {
  const rec = WAREHOUSE_MAP[normStr(name)];
  ok(!!rec, 'armazem "' + name + '" do portal existe no WAREHOUSE_MAP');
  ok(!!rec && rec.city === city, 'endereco de ' + name + ' identico nos dois arquivos');
});

// --- leitura da aba: coluna do ID + snapshot so das linhas que a fila mostra ---
// getDataRange().getValues() arrastava a aba INTEIRA (inclusive um JSON de formulario por
// linha) e fazia um JSON.parse por linha, em toda carga e toda troca de armazem.
const SNAP = JSON.stringify({ frame: 'WBK1234567', notes: 'Kratzer am Rahmen' });
const grid = [
  SHEET_HEADERS,
  ['11.08.2026', 'RK2AA1', 'Klaus', 'RM', '10 km', '', '', '', '11.08.2026 09:00', SNAP, 'a@upway.shop']
];
let rangeReads = [];
globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ({
  getSheetByName: (name) => name !== 'Drop-offs' ? null : {
    getLastRow: () => grid.length,
    getLastColumn: () => SHEET_HEADERS.length,
    getRange: (row, col, numRows, numCols) => {
      rangeReads.push([row, col, numRows, numCols]);
      const out = [];
      for (let r = row - 1; r < row - 1 + numRows; r++) out.push(grid[r].slice(col - 1, col - 1 + numCols));
      return {
        getValues: () => out,
        setValues: (vals) => {
          for (let i = 0; i < vals.length; i++) {
            for (let j = 0; j < vals[i].length; j++) grid[row - 1 + i][col - 1 + j] = vals[i][j];
          }
        }
      };
    }
  }
}) };

globalThis.__cache.clear();
rangeReads = [];
const comAba = getMetabaseData({ warehouse: 'berlin', dateFilter: 'today' });
const arquivada = comAba.rows.find(r => r.bikeId === 'RK2AA1');
ok(!!arquivada && arquivada.isProcessed === true, 'Bike ID da aba vem marcado como arquivado');
ok(!!arquivada && !!arquivada.saved && arquivada.saved.frame === 'WBK1234567', 'snapshot restaurado na linha arquivada (o Reopen depende disto)');
const pendente = comAba.rows.find(r => r.bikeId === 'RK2EE5');
ok(!!pendente && pendente.isProcessed === false && pendente.saved === null, 'linha nao arquivada nao carrega snapshot');
// A faixa larga E longa e a assinatura do getDataRange da aba inteira: nao pode voltar.
ok(!rangeReads.some(r => r[2] > 1 && r[3] > 1), 'nenhuma leitura larga e longa da aba (veio ' + JSON.stringify(rangeReads) + ')');

rangeReads = [];
getMetabaseData({ warehouse: 'berlin', dateFilter: 'past10days' });
const idCols = rangeReads.filter(r => r[1] === 2 && r[3] === 1).length;
ok(idCols === 1, 'coluna de IDs lida UMA vez na troca de periodo: a de readProcessedIds vem do cache (veio ' + idCols + ')');

// Beleg recem-arquivado nao pode esperar o TTL para aparecer como arquivado.
grid.push(['12.08.2026', 'RK2BB2', 'X', 'Y', '', '', '', '', '', '{}', 'a@upway.shop']);
CacheService.getScriptCache().remove('dropoff_processed_v1');
ok(readProcessedIds().has('RK2BB2'), 'invalidar o cache faz o novo arquivado aparecer na hora');

// --- garbage collector: poda o Snapshot velho e NAO toca na trilha de auditoria ---
const gcDate = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear() + ' 09:00'; };
const gcRow = (id, dias, snap) => ['x', id, 'Cliente', 'Bike', '', '', '', '=HYPERLINK("u","pdf")', gcDate(dias), snap, 'op@upway.shop'];
grid.length = 1;                                  // so o cabecalho
grid.push(gcRow('OLD001', 90, '{"frame":"A"}'));  // velho, com snapshot
grid.push(gcRow('NEW001', 3,  '{"frame":"B"}'));  // recente, com snapshot
grid.push(gcRow('OLD002', 90, ''));               // velho, ja sem snapshot
grid.push(['x', 'BAD001', 'C', 'B', '', '', '', 'u', 'data ilegivel', '{"frame":"D"}', 'op@upway.shop']);

const gc = collectSheetGarbage();
ok(gc.cleared === 1, 'poda exatamente 1 snapshot (veio ' + gc.cleared + ')');
ok(grid[1][9] === '', 'snapshot de 90 dias apagado');
ok(grid[2][9] === '{"frame":"B"}', 'snapshot de 3 dias preservado (o Reopen recente continua funcionando)');
ok(grid[4][9] === '{"frame":"D"}', 'data ilegivel: nao apaga (nao entender a data nao autoriza perder dado)');
// A trilha de auditoria e o motivo de nao apagar linha: o Beleg e documento legal.
ok(grid.length === 5, 'nenhuma linha removida');
ok(grid[1][1] === 'OLD001' && grid[1][10] === 'op@upway.shop' && grid[1][7].indexOf('HYPERLINK') !== -1,
   'linha podada mantem Bike ID, operador e link do PDF');
ok(collectSheetGarbage().cleared === 0, 'rodar de novo nao tem nada para fazer (idempotente)');

// gravacao na planilha sob lock
let locks = 0, releases = 0;
globalThis.LockService = { getScriptLock: () => ({ tryLock: () => { locks++; return true; }, releaseLock: () => { releases++; } }) };
const sheetRows = [];
globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ({
  getSheetByName: () => ({
    getRange: () => ({ getValue: () => 'Operador', setValues: () => {}, setFontWeight: () => ({ setBackground: () => {} }) }),
    getDataRange: () => ({ getValues: () => [SHEET_HEADERS] }),
    appendRow: (r) => sheetRows.push(r)
  })
}) };
logDropoffToSheet({ bikeId: 'RK2AA1', datum: '11.08.2026', seller: 'X', bikeName: 'Y', mileage: '10', accessories: 'Akku', damage: '', pdfUrl: 'u', snapshot: {} });
ok(locks === 1 && releases === 1, 'gravacao pega e solta o lock (read-modify-write protegido)');
ok(sheetRows.length === 1 && sheetRows[0].length === SHEET_HEADERS.length, 'linha gravada com todas as colunas');
ok(sheetRows[0][10] === 'amigo@gmail.com', 'coluna Operador preenchida (trilha de auditoria)');

console.log('\n' + (fails ? fails + ' FALHA(S)' : 'pipeline: todos os checks passaram'));
process.exit(fails ? 1 : 0);
