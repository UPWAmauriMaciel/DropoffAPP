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
  getUserProperties: () => ({ getProperty: () => null, deleteProperty: () => {} })
};
globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) };
globalThis.__rows = [];
globalThis.Logger = { log: m => console.log(m) };
globalThis.HtmlService = { createHtmlOutputFromFile: () => ({ getContent: () => 'data:image/png;base64,AAA' }) };
globalThis.Utilities = {
  base64Encode: () => 'AAAA', base64EncodeWebSafe: () => 'KEY',
  computeDigest: () => [1], DigestAlgorithm: { MD5: 'MD5' }
};
globalThis.ScriptApp = { getOAuthToken: () => 'tok' };
globalThis.Session = { getActiveUser: () => ({ getEmail: () => 'amigo@gmail.com' }) };
let lastFetchHeaders = null;
let hubStatus = 200;
globalThis.UrlFetchApp = {
  fetch: (url, opts) => {
    if (url.indexOf('qrserver') !== -1) return { getResponseCode: () => 500, getContentText: () => '' };
    lastFetchHeaders = opts.headers;
    if (hubStatus !== 200) {
      // pagina de erro do Google, como veio na conta sem acesso ao hub
      return { getResponseCode: () => hubStatus, getContentText: () => '<!DOCTYPE html><html lang="en"><head><script nonce="x">window[\'ppConfig\'] = {productName: \'abc\'}' };
    }
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(PAYLOAD) };
  }
};

const code = gsSource();
new Function(code + '\n;Object.assign(globalThis,{getMetabaseData,runSelfChecks,matchesWarehouse,rowDateIso,reviewUrlFor,dayFolderName});')();

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
  const denied = getMetabaseData({ warehouse: 'berlin', dateFilter: 'today' });
  ok(!!denied.error, status + ': devolve erro');
  ok(denied.error.indexOf('amigo@gmail.com') !== -1, status + ': nomeia a conta que foi recusada');
  ok(/URL do web app/.test(denied.error), status + ': aponta a URL do web app como caminho');
  ok(denied.error.indexOf('<') === -1 && denied.error.indexOf('ppConfig') === -1,
     status + ': nao despeja o HTML da pagina de erro do Google');
  ok(!denied.rows, status + ': nao devolve linha nenhuma');
}
hubStatus = 500;
const boom = getMetabaseData({ warehouse: 'berlin', dateFilter: 'today' });
ok(boom.error.indexOf('HTTP 500') !== -1 && boom.error.indexOf('página HTML') !== -1,
   '500 com corpo HTML: reporta o status sem colar o markup');
hubStatus = 200;

console.log('\n' + (fails ? fails + ' FALHA(S)' : 'pipeline: todos os checks passaram'));
process.exit(fails ? 1 : 0);
