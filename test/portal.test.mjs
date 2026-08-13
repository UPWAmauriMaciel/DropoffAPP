import fs from 'fs';
import path from 'path';
import { srcPath } from './apps-script.mjs';
import { JSDOM } from 'jsdom';

const html = fs.readFileSync(path.join(import.meta.dirname,'portal_harness.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://example.org/' });
const { window } = dom;
const doc = window.document;
const $ = s => doc.querySelector(s);
const txt = s => ($(s) ? $(s).textContent.trim() : '(missing)');

let fails = 0;
const ok = (cond, name) => { console.log((cond ? 'PASS ' : 'FAIL ') + name); if (!cond) fails++; };
const wait = ms => new Promise(r => window.setTimeout(r, ms));
const click = el => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const input = el => el.dispatchEvent(new window.Event('input', { bubbles: true }));

await new Promise(r => window.addEventListener('load', r));
await wait(300);

// guardado para restaurar depois das secoes que sequestram o handler
const origSuccess = window.google.script.run.withSuccessHandler;

// --- 1. Fila carregada do gateway stub ---
const rows = doc.querySelectorAll('#table-rows-container .table-row');
ok(rows.length === 3, 'fila renderiza as 3 linhas do gateway (veio ' + rows.length + ')');
ok(txt('#cnt-scheduled') === '3' && txt('#cnt-filed') === '1' && txt('#cnt-pending') === '2', 'contadores 3/2/1');
ok($('#queue-feedback').style.display === 'none', 'sem card de erro no caminho feliz');
ok(txt('#queue-eyebrow') === "Today's schedule", 'eyebrow = Today');
ok(!html.includes('MOCK_APPTS'), 'constante MOCK_APPTS removida do app');

// --- 2. Escaping: apostrofo e <GT> chegam como TEXTO, nao como markup ---
// (innerHTML re-serializa: a prova certa e o texto renderizado bater 1:1 com o dado)
const cells = [...doc.querySelectorAll('#table-rows-container .table-row')][1].children;
ok(cells[2].textContent.trim() === "Tobias O'Brien & Sohn", 'apostrofo e & do cliente renderizam intactos (veio "' + cells[2].textContent.trim() + '")');
ok(cells[1].textContent.includes('<GT>'), 'modelo com <GT> renderiza como texto (veio "' + cells[1].textContent.trim() + '")');
ok(doc.querySelectorAll('#table-rows-container gt, #table-rows-container script, #table-rows-container img').length === 0, 'nenhum elemento injetado pelos dados');

// --- 3. BUG do indice filtrado: buscar e clicar tem que abrir a bike certa ---
const search = $('#search-input');
search.value = 'Cube';
input(search);
const visible = doc.querySelectorAll('#table-rows-container .table-row');
ok(visible.length === 1, 'busca filtra para 1 linha');
click(visible[0].querySelector('[data-open-bike]'));
ok($('#input-bike-id').value === 'RK2GU8', 'abriu a bike buscada, nao a do indice 0 (abriu ' + $('#input-bike-id').value + ')');
ok($('#screen-form').classList.contains('active'), 'trocou para a tela de check-in');

// --- 4. Reopen restaura o snapshot salvo ---
click($('#btn-back-queue'));
search.value = '';
input(search);
const filedBtn = doc.querySelector('#table-rows-container .filed-row [data-open-bike]');
ok(filedBtn && filedBtn.textContent.trim() === 'Reopen', 'linha arquivada mostra Reopen');
click(filedBtn);
ok($('#input-frame').value === 'WBK1234567', 'Rahmennummer salva restaurada (veio "' + $('#input-frame').value + '")');
ok($('#input-notes').value === 'Kratzer am Rahmen', 'Notizen salvas restauradas');
ok(txt('#handover-meta-cnt') === '3 of 4 handed over', 'acessorios salvos restaurados (3 de 4)');

// --- 4b. E-Mail do cliente: vem do gateway, editavel, e sai no Beleg ---
ok(!!$('#input-email'), 'campo E-Mail existe no card 1 (Seller & appointment)');
ok($('#input-email').type === 'email', 'input do tipo email');
ok($('#input-email').value === 'lena.arquivada@gmx.de',
   'reabrir restaura o e-mail ARQUIVADO, nao o do agendamento (veio "' + $('#input-email').value + '")');
ok(/E-Mail/.test(doc.querySelector('#summary-rows-container').textContent), 'painel lateral lista o E-Mail');

// bike sem snapshot: o e-mail vem prefilled do gateway
click($('#btn-back-queue'));
const semSnapshot = [...doc.querySelectorAll('#table-rows-container [data-open-bike]')]
  .find(b => b.getAttribute('data-open-bike') === 'RK2FP1');
click(semSnapshot);
ok($('#input-email').value === 'tobias@web.de',
   'sem snapshot, prefill vem do gateway (veio "' + $('#input-email').value + '")');
ok($('#input-seller').value === "Tobias O'Brien & Sohn", 'o nome do vendedor continua no card 1');

// editar o campo atualiza estado e painel
$('#input-email').value = 'novo@upway.shop';
input($('#input-email'));
ok(/novo@upway\.shop/.test(doc.querySelector('#summary-rows-container').textContent),
   'editar o e-mail reflete no painel lateral');

// e chega ao Beleg
click($('#btn-generate-beleg'));
await wait(60);
ok(txt('#doc-email') === 'novo@upway.shop', 'Beleg mostra o e-mail (veio "' + txt('#doc-email') + '")');
const sec2 = doc.querySelector('#doc-sec2-grid').textContent;
ok(sec2.indexOf('RAHMENNUMMER') < sec2.indexOf('E-MAIL'), 'E-MAIL fica ao lado da RAHMENNUMMER');

// volta para a bike do snapshot para as secoes seguintes
click($('#btn-doc-back'));
click(doc.querySelector('#table-rows-container [data-open-bike]'));

// --- 5. Rahmennummer: valor maiusculo, sem text-transform no elemento ---
const frame = $('#input-frame');
frame.value = 'wbk99xz';
input(frame);
ok(frame.value === 'WBK99XZ', 'valor da Rahmennummer vira maiuscula no input');
ok(!/frame-input\s*\{[^}]*text-transform/.test(html), 'CSS .frame-input sem text-transform');

// --- 6. Berlim esconde Jahr/Batterie; outro armazem mostra ---
ok([...doc.querySelectorAll('.non-berlin-field')].every(e => e.style.display === 'none'), 'Berlim esconde Jahr + Batteriekapazitat');
window.selectWarehouse('Stuttgart');
await wait(250);
ok([...doc.querySelectorAll('.non-berlin-field')].every(e => e.style.display === 'block'), 'Stuttgart mostra Jahr + Batteriekapazitat');
ok(doc.querySelector('#summary-rows-container').textContent.includes('Batterie'), 'painel lateral ganha a linha Batterie');
window.selectWarehouse('Berlin');
await wait(250);

// --- 7. Periodo manda o vocabulario do servidor ---
const logs = [];
const origLog = window.console.log;
window.console.log = (...a) => { logs.push(a.join(' ')); origLog(...a); };
click([...doc.querySelectorAll('.segment-btn')].find(b => b.textContent.includes('Next')));
await wait(250);
ok(logs.some(l => l.includes('"dateFilter":"next10days"')), 'segmento Next manda dateFilter=next10days');
ok(txt('#queue-eyebrow') === 'Next 10 days', 'eyebrow acompanha o periodo');
ok(txt('#queue-date-title').includes('–'), 'titulo mostra o intervalo, nao a data de hoje');

// --- 8. Documento ---
click(doc.querySelector('#table-rows-container [data-open-bike]'));
click($('#btn-generate-beleg'));
ok($('#screen-doc').classList.contains('active'), 'Generate beleg abre a tela do documento');
await wait(200); // selo + QR chegam do servidor (getDocAssets)
const badge = doc.querySelector('.a4-page img[alt="Review us on Google"]');
ok(!!badge && (badge.getAttribute('src') || '').startsWith('data:image/png;base64,'), 'selo Google vem do servidor como data URI');
ok(badge.getAttribute('style').includes('120px') && badge.getAttribute('style').includes('72px'), 'selo em 120x72 conforme o handoff');
ok(!doc.body.innerHTML.includes('4.9 · Upway') && !doc.body.innerHTML.includes('★★★★★'), 'selo Google com nota inventada removido');
const qrImg = $('#doc-qr-container img');
ok(!!qrImg && (qrImg.getAttribute('src') || '').startsWith('data:image/png;base64,QR'), 'QR vem do servidor, nao de URL externa no cliente');
ok(!html.includes('api.qrserver.com'), 'nenhuma chamada a servico de QR no cliente');
ok(!/reviewUrl|g\.page/.test(html), 'link de avaliacao nao tem copia no cliente');

// logo: um <symbol>, reusado — nao tres copias do path
ok(doc.querySelectorAll('#upway-wordmark').length === 1, 'wordmark definido uma vez como <symbol>');
ok(doc.querySelectorAll('use[href="#upway-wordmark"]').length === 3, 'reusado nos 3 lugares (header + 2 folhas)');
ok(doc.querySelectorAll('.a4-page').length === 2, 'duas folhas A4');

// --- 9. Logo real, nao o redesenho ---
ok(!!$('.app-header svg[aria-label="Upway"]'), 'logo oficial no header');
ok($('.app-header svg[aria-label="Upway"]').getAttribute('height') === '16', 'logo do header em 16px (spec)');
ok(doc.querySelectorAll('.a4-page svg[aria-label="Upway"]').length === 2, 'logo oficial nas duas folhas');
ok(doc.querySelector('#upway-wordmark path').getAttribute('fill') === '#4733FF', 'wordmark azul (#4733FF)');
ok(doc.querySelector('#upway-wordmark').getAttribute('viewBox') === '59 203 724 189', 'viewBox recortado nos limites do desenho');
ok(!html.includes('M14.2 0H20.4V14.8'), 'logo redesenhado a mao nao voltou');

// --- 9a. Checkmark do Zubehor: texto com base de flex, nao SVG que encolhe ---
const accBoxes = [...doc.querySelectorAll('#doc-acc-checkboxes > div')];
ok(accBoxes.length === 4, 'quatro itens de Zubehor no documento');
ok(doc.querySelectorAll('#doc-acc-checkboxes svg').length === 0, 'sem SVG na marca (SVG em flex encolhia para zero)');
const marcado = accBoxes.map(d => d.firstElementChild).filter(b => b.textContent.trim() === '✓');
ok(marcado.length > 0, 'item marcado mostra o glifo de certo');
marcado.forEach(b => {
  ok(/flex:\s*0 0 15px/.test(b.getAttribute('style')), 'caixa marcada tem base de flex fixa');
  ok(/background:\s*var\(--blue-500\)/.test(b.getAttribute('style')), 'estado tambem vem do fundo azul, nao so do glifo');
});
// impressao: sem isto o Chrome descarta o fundo azul e o check branco fica invisivel
ok(/print-color-adjust:\s*exact/.test(html), 'forca as cores de fundo na impressao');
ok(/-webkit-print-color-adjust:\s*exact/.test(html), 'variante -webkit para o Chrome');

// --- 9a2. Nenhum acessorio pre-marcado ---
ok(!html.includes('acc-tile active'), 'markup estatico nao nasce com tile marcado');
ok(html.includes('>0 of 4 handed over'), 'contador inicial em 0 de 4');
ok(/acc:\s*\{\s*akku:\s*false,\s*lade:\s*false,\s*schl:\s*false,\s*disp:\s*false\s*\}/.test(html), 'estado inicial todo desmarcado');

// --- 9a3. Icones de chave e display na geometria do Lucide ---
ok(html.includes('cx="7.5" cy="15.5" r="5.5"'), 'chave: anel do Lucide (embaixo a esquerda)');
ok(html.includes('M15.5 7.5l3 3L22 7l-3-3'), 'chave: dentes do Lucide');
ok(!html.includes('M11.2 11.2L21 21'), 'chave antiga (invertida) removida');
ok(html.includes('x="2" y="3" width="20" height="14"'), 'display: tela 20x14 do Lucide');
ok(!html.includes('<rect x="3" y="4" width="18" height="12" rx="2"></rect>'), 'display antigo removido');
ok(html.includes('M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z'), 'carregador: corpo do plug do Lucide');
ok(!html.includes('<rect x="6" y="8" width="12" height="7" rx="2"></rect>'), 'carregador retangular removido');

// Os 4 icones PRECISAM ser SVG com currentColor: e o que faz a cor mudar ao selecionar.
// Trocar por <img>/PNG quebraria isso em silencio.
const tileIcons = [...doc.querySelectorAll('.acc-tile .tile-icon')];
ok(tileIcons.length === 4, 'quatro tiles de acessorio');
tileIcons.forEach((el, i) => {
  const svg = el.querySelector('svg');
  ok(!!svg, 'tile ' + i + ' usa SVG inline');
  ok(svg.getAttribute('stroke') === 'currentColor', 'tile ' + i + ' herda a cor (currentColor)');
  ok(svg.getAttribute('stroke-width') === '1.8', 'tile ' + i + ' com stroke 1.8 do handoff');
  ok(svg.getAttribute('viewBox') === '0 0 24 24', 'tile ' + i + ' na grade 24x24');
});
ok(doc.querySelectorAll('.acc-tile img').length === 0, 'nenhum bitmap nos tiles (nao recoloriria)');
ok(/\.acc-tile\.active \.tile-icon \{ color: var\(--blue-600\)/.test(html), 'ativo pinta o icone de azul');

// --- 9a4. Nome do PDF = ID + marca ---
ok($('#doc-filename-pill').textContent === 'RK2EP9 Stromer.pdf', 'pill mostra ID + marca (veio "' + $('#doc-filename-pill').textContent + '")');

// --- 9b. Print & save: botao azul, imprime o PDF do servidor, limpa blob e iframe ---
const printBtn = $('#btn-doc-print');
ok(printBtn.textContent.trim() === 'Print & save', 'botao diz "Print & save"');
ok(printBtn.classList.contains('btn-primary'), 'botao de impressao e o primario (azul)');
ok(!$('#btn-doc-save').classList.contains('btn-primary'), 'o de salvar deixou de ser o primario');
ok([...doc.querySelectorAll('.doc-actions-right .btn')].pop() === printBtn, 'primario fica na ponta direita');

// instrumenta print/popup: nenhum dos dois pode virar aba nova ou blob
let printCalls = 0, opened = [], blobs = 0;
window.print = () => { printCalls++; };
window.open = (u) => { opened.push(u); return null; };
window.URL.createObjectURL = () => { blobs++; return 'blob:nope'; };

let sentPayload = null;
window.google.script.run.processDropoffDocument = function (p) {
  sentPayload = p;
  setTimeout(() => window.__printH({ success: true, bikeId: p.bikeId, folderPath: '2026 > 08-11',
    pdfUrl: 'https://drive.google.com/file/d/abc/view' }), 40);
  return window.google.script.run;
};
window.google.script.run.withSuccessHandler = function (h) { window.__printH = h; return window.google.script.run; };

click(printBtn);
ok(printCalls === 1, 'imprime a janela atual, direto (sem esperar o Drive)');
ok(opened.length === 0, 'nao abre aba nova — era o que disparava o bloqueio de popup');
ok(blobs === 0, 'nao monta blob: no sandbox do Apps Script o iframe blob da SecurityError');
ok(doc.querySelectorAll('iframe[src^="blob:"]').length === 0, 'nenhum iframe de PDF criado');
ok(sentPayload && sentPayload.bikeId === 'RK2EP9' && sentPayload.warehouse === 'berlin', 'grava o beleg atual em paralelo');
ok(!('includePdf' in sentPayload), 'nao pede os bytes do PDF (payload enxuto)');

await wait(150);
ok($('#btn-doc-save').textContent.trim() === 'Close', 'apos gravar, o botao vira Close (nao regrava)');
ok($('#doc-filename-pill').textContent.includes('2026 > 08-11'), 'pill mostra onde foi arquivado');

// segundo clique em Print & save nao regrava o mesmo beleg
sentPayload = null;
click(printBtn);
ok(printCalls === 2, 'reimprime');
ok(sentPayload === null, 'mas nao grava de novo o que ja esta no Drive');

// "Close" nao pode disparar outra gravacao
sentPayload = null;
click($('#btn-doc-save'));
await wait(120);
ok(sentPayload === null, 'Close so navega, nao grava de novo');
ok($('#screen-queue').classList.contains('active'), 'Close volta para a fila');

// --- 9c. Margens de impressao: folha em mm, sem pagina em branco no fim ---
ok(/@page\s*\{\s*size:\s*A4;\s*margin:\s*0/.test(html), '@page A4 com margem 0');
ok(/width:\s*210mm\s*!important/.test(html), 'folha fixada em 210mm (nao width:100%)');
ok(!/width:\s*100%\s*!important/.test(html), 'width:100% na impressao removido — era o que esticava');
ok(/padding:\s*15\.9mm\s*16\.9mm/.test(html), 'margem lateral de 16.9mm (= 64px do design)');
ok(/\.a4-page:last-child[\s\S]{0,120}break-after:\s*auto/.test(html), 'ultima folha nao gera pagina em branco');
ok(/height:\s*296mm\s*!important/.test(html), 'folha com 1mm de folga (297mm exatos transbordam e geram folha em branco)');
ok(/min-height:\s*0\s*!important/.test(html), 'min-height zerado, senao venceria a reducao da altura');
ok(!/min-height:\s*297mm/.test(html), 'min-height de 297mm removido');
ok(/overflow:\s*hidden\s*!important/.test(html), 'conteudo que nao cabe e cortado, nao empurrado para outra folha');

// volta para a tela do documento com uma bike DIFERENTE (beleg novo, ainda nao gravado)
click([...doc.querySelectorAll('#table-rows-container [data-open-bike]')][1]);
click($('#btn-generate-beleg'));
await wait(60);
ok($('#btn-doc-save').textContent.trim() === 'Save to Drive & close', 'beleg novo volta a oferecer a gravacao');

// --- 10. Save silencioso: retorno com error NAO pode parecer sucesso ---
window.google.script.run.withSuccessHandler = function (h) { window.__h = h; return window.google.script.run; };
click($('#btn-doc-save'));
window.__h({ error: 'Nao foi possivel abrir a pasta do Drive' });
ok($('#screen-doc').classList.contains('active'), 'erro no save mantem o operador na tela do documento');
ok($('#doc-error-box') && $('#doc-error-box').textContent.includes('Not saved to Drive'), 'erro do save fica visivel');

// --- 11. Falha do gateway: erro visivel, zero dados inventados ---
window.google.script.run.withSuccessHandler = function (h) { window.__h2 = h; return window.google.script.run; };
window.loadScheduleData(true);  // force: sem isto o memo de (armazem, periodo) responde e nao ha round trip
window.__h2({ error: 'The Gateway returned an HTML login page instead of JSON' });
ok($('#queue-feedback').style.display === 'block', 'card de erro aparece');
ok($('#queue-feedback').textContent.includes('login'), 'mensagem real do gateway e mostrada');
ok(doc.querySelector('#screen-queue .table-card').style.display === 'none', 'tabela escondida no erro');
ok(doc.querySelectorAll('#table-rows-container .table-row').length === 0, 'nenhuma linha inventada no erro');
ok(txt('#cnt-scheduled') === '0', 'contador zerado no erro');
ok(!!$('#btn-retry-load'), 'botao Try again presente');

// --- 11b. Fila vazia por FILTRO: nao e beco sem saida, diz onde estao os drop-offs ---
window.google.script.run.withSuccessHandler = origSuccess; // devolve o stub real
window.clearScheduleMemo();  // (berlin|today) ja esta memoizado da secao 1 com 3 linhas
window.__emptyNext = true;
window.setPeriod('today');
await wait(250);
const empty = doc.querySelector('#table-rows-container').textContent;
ok(doc.querySelector('#screen-queue .table-card').style.display !== 'none', 'tabela continua visivel (nao e erro, e filtro)');
ok(empty.includes('No drop-offs for Berlin today'), 'diz qual armazem e qual periodo estao vazios');
ok(/2 in the next 10 days/.test(empty), 'aponta que ha 2 nos proximos 10 dias');
ok(/1 in the past 10 days/.test(empty), 'aponta que ha 1 nos ultimos 10 dias');
ok(/Düsseldorf \(12\)/.test(empty), 'lista outros armazens com contagem');
// o atalho tem que realmente trocar o periodo e o segmento ativo
click(doc.querySelector('[data-jump-period="next10days"]'));
await wait(250);
ok($('.segment-btn.active').textContent.includes('Next'), 'atalho do estado vazio muda o segmento ativo');

// --- 11c. Memo por (armazem, periodo): trocar de balcao e voltar nao volta ao servidor ---
// Era aqui que estavam os ~5s da troca de armazem: um round trip inteiro de Apps Script
// para refiltrar o MESMO card que o servidor ja tem em cache.
const realGet = window.google.script.run.getMetabaseData;
let hubCalls = 0;
window.google.script.run.getMetabaseData = function (p) {
  hubCalls++;
  return realGet.call(window.google.script.run, p);
};
window.clearScheduleMemo();
for (const wh of ['Stuttgart', 'Berlin', 'Stuttgart', 'Berlin']) {
  window.selectWarehouse(wh);
  await wait(150);
}
ok(hubCalls === 2, '4 trocas entre 2 armazens = 2 chamadas ao servidor (veio ' + hubCalls + ')');
ok(txt('#wh-label') === 'Berlin', 'o memo serve o armazem certo, nao o ultimo carregado');

// --- 11d. Skeleton na carga: nem data fixa, nem "0" com cara de dado real ---
ok(!html.includes('Monday, 10 August'), 'data fixa removida do markup (era lida como agendamento real durante a carga)');
window.google.script.run.withSuccessHandler = function (h) { window.__hSk = h; return window.google.script.run; };
window.clearScheduleMemo();
window.loadScheduleData(true);
ok(doc.querySelectorAll('#table-rows-container .skeleton-row').length === 4, 'skeleton com 4 linhas fantasma durante a carga');
ok(doc.querySelectorAll('#table-rows-container .table-row').length === 0, 'skeleton nao conta como linha de dado');
ok(txt('#cnt-scheduled') === '—', 'contador neutro na carga: um traco nao e "0 agendamentos"');
ok(!$('#queue-date-title').querySelector('.sk-bar') && txt('#queue-date-title').length > 3,
   'data do cabecalho vem do relogio no boot, sem esperar o servidor (veio "' + txt('#queue-date-title') + '")');
ok(!$('#loading-overlay').classList.contains('active'), 'carga da fila nao bloqueia a tela com overlay');
window.__hSk({ success: true, total: 0, rows: [], summary: { totalRows: 0, byWarehouse: {}, selectedWarehouse: { today: 0, next10days: 0, past10days: 0, otherDates: 0 } } });
ok(doc.querySelectorAll('#table-rows-container .skeleton-row').length === 0, 'skeleton sai quando o dado chega');
ok(txt('#cnt-scheduled') === '0', 'contador volta a ser numero depois da resposta');
window.google.script.run.withSuccessHandler = origSuccess;

// --- 11e. "Drop-off desk": peso, cor e tamanho casado com a altura do wordmark ---
ok(txt('.header-title') === 'Drop-off desk', 'frase do cabecalho');
const hdr = /\.header-title\s*\{([^}]*)\}/.exec(html);
ok(!!hdr, 'regra .header-title existe');
ok(/font-weight:\s*700/.test(hdr[1]), 'peso 700');
ok(/font-size:\s*16px/.test(hdr[1]), 'font-size 16px = caixa-alta da Inter batendo com a do wordmark de 16px');
ok(/line-height:\s*1\b/.test(hdr[1]), 'line-height 1: sem isso o flex centraliza caixas de altura diferente e o texto desce');
ok(/color:\s*var\(--blue-500\)/.test(hdr[1]), 'azul da marca pelo token');
ok(!/#4733FF/i.test(hdr[1]), 'sem hex solto: o token e o mesmo valor que o fill do wordmark');
ok(/font-family:\s*'Inter'/.test(hdr[1]), 'pilha de fonte declarada na propria regra');

// --- 12. Sem cores fora do design system ---
ok(!html.includes('#FFFBEB') && !html.includes('#FCD34D') && !html.includes('#92400E'), 'banner ambar removido');
ok(!html.includes('rgba(15, 23, 42'), 'overlay usa ink-900, nao slate do Tailwind');

console.log('\n' + (fails ? fails + ' FALHA(S)' : 'todos os checks passaram'));
process.exit(fails ? 1 : 0);
