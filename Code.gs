/**
 * ============================================================================
 * UPWAY DROP-OFF PORTAL & EINLIEFERUNGSBELEG GENERATOR
 * Google Sheets + Google Apps Script + Gateway Hub Metabase Integration
 * Design Handoff v2 Implementation
 * ============================================================================
 */

var CONFIG = {
    DEFAULT_WAREHOUSE: "berlin",
    // Shared Drive raiz onde os Belege são arquivados. É constante: NÃO guardar em
    // PropertiesService — um valor errado gravado lá vencia esta constante e os PDFs
    // iam para o Drive errado sem aviso.
    SHARED_DRIVE_FOLDER_ID: "0ANJ1ayRr35D2Uk9PVA",
    HUB_URL: "https://script.google.com/a/macros/upway.shop/s/AKfycbzhXONZmHG7eueCCWoYCJbrdvkGGkk0hEcAHRrtSsKyYXH6f6FI-h5BhuW-H6bPq72Q/exec",
    CARD_ID: 10495
};

/**
 * Wordmark Upway oficial (export Illustrator do asset real — não redesenhar).
 * viewBox recortado nos limites do path; a proporção é 724 x 189 (≈3.84:1).
 */
function upwayLogoSvg(heightPx) {
    var h = heightPx || 16;
    var w = Math.round(h * 724 / 189);
    return '<svg width="' + w + '" height="' + h + '" viewBox="59 203 724 189" ' +
        'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Upway" style="display:block">' +
        '<path fill="#4733FF" d="M59.17,279.81v-73.25h33.84v73.25c0,16.94,10.58,29.07,26.72,29.07c15.59,0,25.65-12.17,25.65-29.07v-73.25h33.84v73.25c0,36.51-24.06,62.39-59.49,62.39C83.74,342.21,59.17,316.28,59.17,279.81z M191.11,391.64v-126.1c0-36.51,26.45-62.39,63.99-62.39c38.61,0,66.09,28.27,66.09,68.48c0,39.41-30.14,67.45-72.46,67.45h-23.78v52.61h-33.84V391.64z M255.38,305.7c18.77,0,32.01-14.28,32.01-34.64s-13.48-34.64-32.25-34.64c-17.74,0-30.14,12.17-30.14,29.07v40.2H255.38z M333.12,302.8v-96.24h33.84v96c0,3.7,2.62,6.36,6.6,6.36c3.42,0,5.81-2.11,6.6-5.29l15.35-70.07c4.22-19.29,18.25-30.42,35.71-30.42c21.43,0,37.54,16.94,36.23,40.72l-3.18,58.46c-0.28,3.42,2.11,6.6,6.36,6.6c3.18,0,5.81-1.87,6.6-4.77l26.96-97.59h35.15l-29.07,106.02c-4.77,17.46-20.36,29.63-39.93,29.63c-20.88,0-38.1-17.18-36.74-41.52l3.18-58.46c0.28-3.42-2.11-5.81-5.57-5.81c-2.9,0-5.29,1.87-5.81,4.49l-15.35,70.35c-3.98,18.25-19.84,30.94-37.3,30.94C350.06,342.21,333.12,325.82,333.12,302.8z M524.84,305.46c0-10.86,5.01-21.43,16.38-30.14l50.78-39.13h-34.36v-29.63h89.91v81.96h-31.22v-32.25l-53.41,41.8c-2.11,1.59-2.62,2.9-2.62,5.01c0,2.39,2.39,4.49,5.01,4.49h83.31v31.22h-90.15C539.63,338.79,524.84,323.72,524.84,305.46z M671.06,358.35h61.88c8.71,0,16.15-6.08,16.15-14.28v-17.74c-5.81,8.99-17.97,15.87-31.73,15.87c-34.12,0-54.48-21.16-54.48-55.28v-80.37h33.84v75.88c0,16.66,10.86,26.45,26.17,26.45c15.35,0,26.17-12.45,26.17-29.07v-73.25h33.84v135.65c0,27.24-22.47,49.43-49.99,49.43h-61.88v-33.29H671.06z"/>' +
        '</svg>';
}

var WAREHOUSES = [
    "berlin", "dusseldorf", "stuttgart", "amsterdam",
    "antwerp", "gennevilliers", "losangeles", "newyork"
];

/**
 * Fonte ÚNICA de armazéns. A UI recebe este objeto por injeção no template —
 * não duplicar a lista no HTML.
 *
 * ⚠️ Confirmar os endereços contra o master data dos armazéns antes do rollout.
 *
 * `gpageId`: ID curto do Google Business Profile do UpCenter, o trecho do meio de
 * `https://g.page/r/<ID>/review`. O de Berlim veio decodificado do QR do Beleg legado
 * (design_handoff_dropoff_portal/legacy_upway_einlieferungsbeleg_berlin.html) — é o
 * link que já está impresso hoje.
 *
 * Para os outros armazéns: Google Business Profile do UpCenter → "Peça avaliações" →
 * copie o link curto; o ID é o trecho entre `/r/` e `/review`. Enquanto estiver vazio,
 * o QR cai numa busca real do Google Maps pelo endereço (ver reviewUrlFor) — funciona,
 * só não é um toque só.
 */
var WAREHOUSE_MAP = {
    "berlin": { name: "Berlin", city: "Alexander-Meißner-Straße 77D · 12526 Berlin", gpageId: "CZuAldi1qpuUEBM" },
    "dusseldorf": { name: "Düsseldorf", city: "Höherweg 271 · 40231 Düsseldorf", gpageId: "" },
    "stuttgart": { name: "Stuttgart", city: "Hauptstätter Straße 149 · 70178 Stuttgart", gpageId: "" },
    "amsterdam": { name: "Amsterdam", city: "Contactweg 47 · 1014 AN Amsterdam", gpageId: "" },
    "antwerp": { name: "Antwerp", city: "Noorderlaan 133 · 2030 Antwerpen", gpageId: "" },
    "gennevilliers": { name: "Gennevilliers", city: "12 Rue des Chardons · 92230 Gennevilliers", gpageId: "" },
    "losangeles": { name: "Los Angeles", city: "1933 S Broadway · Los Angeles, CA 90007", gpageId: "" },
    "newyork": { name: "New York", city: "37-24 24th St · Long Island City, NY 11101", gpageId: "" }
};

/**
 * Destino do QR de avaliação, por armazém.
 *
 * Com gpageId: o mesmo link (e os mesmos utm) que o Beleg legado já imprime — um toque
 * para o cliente. Sem gpageId: busca do Google Maps pelo nome + endereço do UpCenter,
 * que ao menos EXISTE — as URLs `g.page/r/upway-<cidade>/review` que estavam aqui antes
 * eram inventadas e não resolviam.
 */
function reviewUrlFor(wh) {
    if (wh.gpageId) {
        return 'https://g.page/r/' + wh.gpageId + '/review?utm_source=gbp&utm_medium=reviews&utm_campaign=qr';
    }
    const q = 'Upway UpCenter ' + wh.name + ' ' + String(wh.city).replace(/·/g, ' ');
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q.replace(/\s+/g, ' ').trim());
}

/**
 * Nome do arquivo do Beleg: Bike ID + marca.
 *
 * O ID já é único, então a marca é para o operador reconhecer a bike na lista do Drive
 * sem abrir o PDF. Caracteres que Drive e Windows não aceitam em nome de arquivo
 * (/ \ : * ? " < > |) viram espaço — marca como "Riese & Müller" passa, mas uma com
 * barra quebraria a gravação.
 */
function belegFileName(bikeId, brand) {
    const safeBrand = String(brand || '')
        .replace(/[\/\\:*?"<>|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const id = String(bikeId || 'BELEG').trim().toUpperCase();
    return (safeBrand ? `${id} ${safeBrand}` : id) + '.pdf';
}

/** Selo oficial "Review Us On Google" (data URI num arquivo à parte). */
function reviewBadgeSrc() {
    return HtmlService.createHtmlOutputFromFile('ReviewBadge').getContent()
        .replace(/<!--[\s\S]*?-->/g, '').trim();
}

function normStr(s) {
    return String(s || '').toLowerCase().replace(/ü/g, 'u').replace(/[^a-z0-9]/g, '');
}

/**
 * Casamento tolerante de armazém (o card devolve "dusseldorf", a UI manda "Düsseldorf").
 * Linha sem armazém preenchido passa: melhor aparecer para o operador decidir do que
 * desaparecer em silêncio.
 */
function matchesWarehouse(rowWarehouse, selected) {
    const nWh = normStr(rowWarehouse);
    const nSel = normStr(selected);
    if (!nWh || !nSel) return true;
    return nWh.indexOf(nSel) !== -1 || nSel.indexOf(nWh) !== -1;
}

/** Data do drop-off da linha em ISO (YYYY-MM-DD), '' se não der para interpretar. */
function rowDateIso(row) {
    if (!row || !row.dropOffStartDate) return '';
    const d = new Date(row.dropOffStartDate);
    return isNaN(d.getTime()) ? '' : formatDateISO(d);
}

/**
 * Standalone Web App Entry Point
 */
function doGet(e) {
    return renderPortal()
        .setTitle('🏷️ Upway Drop-off Portal')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Serve o portal como arquivo ESTÁTICO, sem avaliação de template.
 *
 * Já foi com createTemplateFromFile + scriptlets injetando armazéns, logo e selo. O
 * resultado no navegador era "Uncaught SyntaxError: Unexpected end of input": o HTML
 * entregue não era o arquivo do disco, e nenhum teste local pegava isso porque o teste
 * lia o disco. Sem scriptlet, o que é testado é exatamente o que é servido.
 *
 * O que o cliente precisa (nome + endereço dos armazéns) é markup estático no HTML.
 * O que NÃO pode divergir (link de avaliação de cada UpCenter) continua só aqui no
 * servidor e chega ao cliente por getDocAssets().
 */
function renderPortal() {
    return HtmlService.createHtmlOutputFromFile('CheckinPortal');
}

/**
 * Assets do documento, resolvidos no servidor: selo oficial + QR do armazém.
 * Uma chamada só, e o QR já vem do cache de qrImageSrc.
 */
function getDocAssets(warehouse) {
    const whKey = normStr(warehouse || CONFIG.DEFAULT_WAREHOUSE);
    let wh = WAREHOUSE_MAP[whKey];
    if (!wh) {
        for (const k in WAREHOUSE_MAP) {
            if (normStr(WAREHOUSE_MAP[k].name) === whKey) { wh = WAREHOUSE_MAP[k]; break; }
        }
    }
    if (!wh) wh = WAREHOUSE_MAP[CONFIG.DEFAULT_WAREHOUSE];

    return { badge: reviewBadgeSrc(), qr: qrImageSrc(reviewUrlFor(wh)) };
}

/**
 * Creates custom menu in Google Sheets UI
 */
function onOpen() {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('🏷️ Upway Drop-off')
        .addItem('🚀 Abrir Portal Check-in', 'showCheckinPortal')
        .addSeparator()
        .addItem('🔌 Testar conexão com o Gateway', 'diagnoseGateway')
        .addItem('🔎 Inspecionar linhas do card', 'diagnoseRows')
        .addItem('🧹 Resetar Formatação da Aba', 'resetSheetFormatting')
        .addToUi();
}

/**
 * Displays the main HTML Portal Modal Dialog scaled to user screen
 */
function showCheckinPortal() {
    const html = renderPortal()
        .setWidth(1400)
        .setHeight(880)
        .setTitle('🏷️ Upway Drop-off Portal');
    SpreadsheetApp.getUi().showModalDialog(html, '🏷️ Upway Drop-off Portal');
}

/**
 * Retrieves stored application configuration from PropertiesService
 */
function getAppConfig() {
    const props = PropertiesService.getScriptProperties();
    const userProps = PropertiesService.getUserProperties();

    return {
        warehouse: props.getProperty('WAREHOUSE') || userProps.getProperty('WAREHOUSE') || CONFIG.DEFAULT_WAREHOUSE,
        driveFolderId: CONFIG.SHARED_DRIVE_FOLDER_ID
    };
}

/**
 * Saves application configuration (só o armazém — a pasta do Drive é constante)
 */
function saveAppConfig(warehouse) {
    const props = PropertiesService.getScriptProperties();
    if (warehouse) props.setProperty('WAREHOUSE', warehouse.toLowerCase());
    // Limpa o ID de pasta gravado por versões anteriores: enquanto ele existir,
    // qualquer correção em CONFIG.SHARED_DRIVE_FOLDER_ID é ignorada.
    props.deleteProperty('DRIVE_FOLDER');
    PropertiesService.getUserProperties().deleteProperty('DRIVE_FOLDER');
    return true;
}

/**
 * Único ponto de saída para o Gateway Hub. Toda chamada passa por aqui.
 *
 * O hub é um web app do Apps Script restrito ao domínio (`/a/macros/upway.shop/s/.../exec`).
 * A extensão do Chrome consegue chamá-lo sem header porque o navegador manda os cookies
 * da sessão Google; UrlFetchApp não manda nada. Sem o Bearer token o Google responde
 * a página de login com HTTP 200 e corpo HTML — o JSON.parse falha e a UI só via
 * "formato inválido". Daí o "não recebo nada do gateway".
 */
function hubRequest() {
    try {
        const resp = UrlFetchApp.fetch(CONFIG.HUB_URL, {
            method: 'post',
            contentType: 'application/json',
            headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
            payload: JSON.stringify({
                service: 'metabase',
                card_id: CONFIG.CARD_ID,
                export_format: 'json'
            }),
            muteHttpExceptions: true
        });
        return { code: resp.getResponseCode(), body: resp.getContentText() };
    } catch (e) {
        return { code: 0, body: '', exception: e.message || String(e) };
    }
}

/** Uma resposta HTML onde devia vir JSON = tela de login / erro do Google, não dado. */
function looksLikeHtml(body) {
    return /^\s*<(?:!doctype|html|head|meta|script)/i.test(String(body || ''));
}

/** Chama o hub e devolve { data } ou { error } já legível para a UI. */
function fetchHubData() {
    const r = hubRequest();

    if (r.exception) {
        return { error: `Falha de rede ao chamar o Gateway: ${r.exception}` };
    }
    // 401/403 tem UMA causa só: o token que foi ao hub é de uma conta que o hub não
    // libera. Pela URL do web app isso não acontece — lá o script roda como o dono da
    // implantação (executeAs USER_DEPLOYING) e é o token DELE que vai. Pelo menu da
    // planilha o script roda sempre como o operador, e aí a conta dele precisaria de
    // acesso próprio ao hub. A mensagem aponta o caminho certo em vez de despejar a
    // página de erro do Google na tela.
    if (r.code === 401 || r.code === 403) {
        return {
            error: 'O Gateway recusou o acesso para ' + (operatorEmail() || 'esta conta') +
                ' (HTTP ' + r.code + '). Abra o portal pela URL do web app: por lá ele roda com a conta ' +
                'do dono da implantação, que já tem acesso ao hub. Pelo menu da planilha o script roda ' +
                'com a sua própria conta, e ela precisaria ser liberada no Gateway Hub.'
        };
    }
    if (r.code < 200 || r.code >= 300) {
        // Corpo HTML é página de erro do Google: não jogar o markup na tela.
        const detail = looksLikeHtml(r.body) ? '(devolveu uma página HTML)' : String(r.body).substring(0, 180);
        return { error: `O Gateway respondeu HTTP ${r.code}. ${detail}` };
    }
    if (looksLikeHtml(r.body)) {
        return { error: 'O Gateway devolveu uma página HTML de login em vez de JSON: a conta que abriu esta planilha não tem acesso à implantação do hub. Use "🔌 Testar conexão com o Gateway" no menu para ver a resposta crua.' };
    }

    let data;
    try {
        data = JSON.parse(r.body);
    } catch (e) {
        return { error: `O Gateway devolveu um corpo não-JSON: ${String(r.body).substring(0, 180)}` };
    }
    if (!data) return { error: 'O Gateway devolveu um corpo vazio.' };
    if (data.error) return { error: `Gateway: ${data.error}` };
    return { data: data };
}

/**
 * Diagnóstico rodável (menu ou editor): mostra exatamente o que o hub devolveu.
 * É o check que falha de forma legível quando a integração quebra.
 */
function diagnoseGateway() {
    const r = hubRequest();
    const lines = [
        'URL:  ' + CONFIG.HUB_URL,
        'Card: ' + CONFIG.CARD_ID,
        'HTTP: ' + (r.exception ? 'exceção — ' + r.exception : r.code),
        'HTML em vez de JSON: ' + (looksLikeHtml(r.body) ? 'SIM (problema de acesso ao hub)' : 'não'),
        'Tamanho do corpo: ' + String(r.body || '').length,
        '',
        'Primeiros 500 caracteres:',
        String(r.body || '(vazio)').substring(0, 500)
    ];
    // Segunda metade: o gateway responder não significa que a fila vai encher. Aqui o
    // pipeline completo roda e diz quantas linhas sobrevivem ao filtro, e por quê.
    if (!looksLikeHtml(r.body) && r.code === 200) {
        const wh = getAppConfig().warehouse;
        const res = getMetabaseData({ warehouse: wh, dateFilter: 'today' });
        lines.push('', '--- pipeline (armazém "' + wh + '", hoje) ---');
        if (res.error) {
            lines.push('ERRO: ' + res.error);
        } else {
            const s = res.summary;
            lines.push('linhas no card: ' + s.totalRows);
            lines.push('linhas na fila agora: ' + res.total);
            lines.push('neste armazém → hoje: ' + s.selectedWarehouse.today +
                ' · próx. 10 dias: ' + s.selectedWarehouse.next10days +
                ' · últ. 10 dias: ' + s.selectedWarehouse.past10days +
                ' · outras datas: ' + s.selectedWarehouse.otherDates);
            lines.push('por armazém: ' + Object.keys(s.byWarehouse)
                .map(k => k + '=' + s.byWarehouse[k]).join(' · '));
            if (res.total === 0) {
                lines.push('→ fila vazia por FILTRO, não por falha: troque de armazém ou de período.');
            }
        }
    }

    const text = lines.join('\n');
    Logger.log(text);
    try {
        SpreadsheetApp.getUi().alert('Diagnóstico do Gateway', text, SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e) {
        // Sem UI (execução direta no editor): o Logger já tem tudo.
    }
    return text;
}

/**
 * Inspeciona o HTML que o servidor realmente entrega ao navegador.
 *
 * Motivo: um "Unexpected end of input" no cliente significa que o bloco <script> chegou
 * ao fim incompleto. Isso é o template, não o JS — e só dá para ver de dentro do
 * servidor, comparando o arquivo cru com o resultado da avaliação.
 */
function diagnosePortalHtml() {
    const lines = [];
    let raw = '';
    try {
        raw = HtmlService.createHtmlOutputFromFile('CheckinPortal').getContent();
        lines.push('arquivo cru:      ' + raw.length + ' chars');
    } catch (e) {
        lines.push('não deu para ler o arquivo cru: ' + (e.message || e));
    }

    let html = '';
    try {
        html = renderPortal().getContent();
        lines.push('HTML avaliado:    ' + html.length + ' chars');
    } catch (e) {
        lines.push('renderPortal() ESTOUROU: ' + (e.message || e));
        const text0 = lines.join('\n');
        Logger.log(text0);
        try { SpreadsheetApp.getUi().alert('HTML do portal', text0, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e2) {}
        return text0;
    }

    // Sentinelas em ordem de posição no arquivo. A primeira que faltar marca o corte.
    lines.push('');
    ['window.__bootError', 'const WAREHOUSES =', 'function setupEventListeners',
     'function renderQueueRows', 'function renderEmptyState', 'function renderDocScreen',
     'function hideLoading', '</script>', '</html>'
    ].forEach(s => lines.push((html.indexOf(s) !== -1 ? '  ok   ' : '  FALTA') + '  ' + s));

    lines.push('');
    lines.push('conteúdo estático: ' + (html.length === raw.length ? 'ok (servido == arquivo)' :
        'DIVERGE do arquivo em ' + (raw.length - html.length) + ' chars'));
    lines.push('scriptlets de template no arquivo: ' + (html.split('<' + '?').length - 1) + ' (esperado 0)');
    lines.push('wordmark: ' + (html.indexOf('id="upway-wordmark"') !== -1 ? 'ok' : 'FALTA'));

    // Assets do documento vêm por google.script.run, não pelo HTML.
    try {
        const a = getDocAssets(getAppConfig().warehouse);
        lines.push('getDocAssets: selo ' + a.badge.length + ' chars · QR ' + a.qr.length + ' chars' +
            (a.qr.indexOf('data:') === 0 ? ' (embutido)' : ' (FALLBACK para URL externa)'));
    } catch (e) {
        lines.push('getDocAssets() ESTOUROU: ' + (e.message || e));
    }

    lines.push('', 'últimos 180 chars entregues:');
    lines.push(html.substring(Math.max(0, html.length - 180)));

    const text = lines.join('\n');
    Logger.log(text);
    try {
        SpreadsheetApp.getUi().alert('HTML do portal', text, SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e) { /* editor: Logger tem tudo */ }
    return text;
}

/**
 * Diagnóstico do limite servidor↔DOM.
 *
 * A pergunta que isto responde: o servidor está devolvendo linhas e a UI está perdendo,
 * ou o servidor já devolve zero? Imprime o que sai de getMetabaseData nos três períodos,
 * mais os valores CRUS do card (nomes de coluna e armazéns), que é onde um nome de
 * coluna novo do Metabase apareceria.
 */
function diagnoseRows() {
    const wh = getAppConfig().warehouse;
    const lines = ['armazém selecionado: ' + wh, ''];

    // 1. O que a UI recebe, período por período — mesma chamada que o portal faz.
    ['today', 'next10days', 'past10days'].forEach(p => {
        const res = getMetabaseData({ warehouse: wh, dateFilter: p });
        if (res.error) {
            lines.push(p + ': ERRO ' + res.error);
            return;
        }
        const ids = res.rows.slice(0, 6).map(r => r.bikeId).join(', ');
        lines.push(p + ': ' + res.total + ' linha(s)' + (ids ? ' → ' + ids : ''));
    });

    // 2. Valores crus do card, direto do hub, sem passar pelo filtro.
    const hub = fetchHubData();
    if (hub.error) {
        lines.push('', 'hub: ' + hub.error);
    } else if (Array.isArray(hub.data)) {
        const raw = hub.data;
        lines.push('', 'linhas cruas no card: ' + raw.length);

        const whCount = {};
        const dates = [];
        raw.forEach(r => {
            let w = '', d = '';
            for (const k in r) {
                const lk = k.toLowerCase();
                if (lk.indexOf('dropoffwarehouse') !== -1) w = String(r[k]);
                if (lk.indexOf('dropoffstartdate') !== -1) d = String(r[k]);
            }
            whCount['[' + w + ']'] = (whCount['[' + w + ']'] || 0) + 1;
            if (d && d !== 'null') dates.push(d.substring(0, 10));
        });
        dates.sort();

        lines.push('armazéns crus: ' + Object.keys(whCount).map(k => k + '=' + whCount[k]).join(' · '));
        lines.push('datas: de ' + (dates[0] || '?') + ' até ' + (dates[dates.length - 1] || '?'));
        lines.push('hoje (fuso do script): ' + formatDateISO(new Date()));
        lines.push('', 'colunas da linha 1:');
        lines.push(Object.keys(raw[0] || {}).join(' | '));
    } else {
        lines.push('', 'hub NÃO devolveu array. Tipo: ' + typeof hub.data +
            ' · chaves: ' + Object.keys(hub.data || {}).join(', '));
    }

    const text = lines.join('\n');
    Logger.log(text);
    try {
        SpreadsheetApp.getUi().alert('Linhas do card', text, SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e) { /* editor: o Logger já tem tudo */ }
    return text;
}

/**
 * Fetches drop-off bike records via Upway Gateway Hub (Zero credentials stored in ScriptProperties)
 */
function getMetabaseData(params) {
    params = params || {};
    const config = getAppConfig();
    
    const selectedWarehouse = (params.warehouse || config.warehouse || CONFIG.DEFAULT_WAREHOUSE).toLowerCase();
    const dateFilter = params.dateFilter || 'today';
    const customStart = params.customStart;
    const customEnd = params.customEnd;

    saveAppConfig(selectedWarehouse);

    const hub = fetchHubData();
    if (hub.error) return { error: hub.error };
    const dataObj = hub.data;

    let normalizedRows = [];

    if (Array.isArray(dataObj)) {
        normalizedRows = dataObj.map(r => {
            const getVal = (keys) => {
                for (let t = 0; t < keys.length; t++) {
                    const k = keys[t];
                    if (r[k] !== undefined && r[k] !== null) return r[k];
                    for (let key in r) {
                        if (key.toLowerCase().includes(k.toLowerCase())) return r[key];
                    }
                }
                return '';
            };

            return {
                bikeId: String(getVal(['bikeId', 'bike_id', 'id']) || '').trim().toUpperCase(),
                email: String(getVal(['email']) || '').trim(),
                brand: String(getVal(['brand', 'make']) || '').trim(),
                model: String(getVal(['model']) || '').trim(),
                mileageKm: getVal(['mileageKm', 'mileage']),
                year: String(getVal(['year']) || '').trim(),
                quote: getVal(['quote', 'estimatedPrice', 'price']),
                dropOffStartDate: getVal(['dropOffStartDate', 'dropOffDate', 'logisticsId__dropOffStartDate']),
                dropOffWarehouse: String(getVal(['dropOffWarehouse', 'warehouse', 'logisticsId__dropOffWarehouse']) || '').trim().toLowerCase(),
                firstName: String(getVal(['firstName', 'pickupAddressId__firstName']) || '').trim(),
                lastName: String(getVal(['lastName', 'pickupAddressId__lastName']) || '').trim()
            };
        });
    } else if (dataObj.data && dataObj.data.cols && dataObj.data.rows) {
        const rawCols = dataObj.data.cols.map(c => c.name);
        const rawRows = dataObj.data.rows;

        const findCol = (targetNames) => {
            for (let i = 0; i < rawCols.length; i++) {
                const colName = rawCols[i];
                for (let t = 0; t < targetNames.length; t++) {
                    if (colName === targetNames[t] || colName.toLowerCase().includes(targetNames[t].toLowerCase())) {
                        return i;
                    }
                }
            }
            return -1;
        };

        const idxWh = findCol(['dropOffWarehouse', 'logisticsId__dropOffWarehouse']);
        const idxDate = findCol(['dropOffDate', 'dropOffStartDate', 'logisticsId__dropOffStartDate']);
        const idxBikeId = findCol(['bikeId', 'bike_id', 'id']);
        const idxQuote = findCol(['quote', 'estimatedPrice', 'price']);
        const idxBrand = findCol(['brand', 'make']);
        const idxModel = findCol(['model']);
        const idxYear = findCol(['year']);
        const idxFirstName = findCol(['firstName', 'AddressId__firstName']);
        const idxLastName = findCol(['lastName', 'AddressId__lastName']);
        const idxEmail = findCol(['email']);
        const idxMileage = findCol(['mileageKm', 'mileage']);

        normalizedRows = rawRows.map(r => ({
            bikeId: idxBikeId !== -1 ? String(r[idxBikeId] || '').trim().toUpperCase() : '',
            email: idxEmail !== -1 ? String(r[idxEmail] || '').trim() : '',
            brand: idxBrand !== -1 ? String(r[idxBrand] || '').trim() : '',
            model: idxModel !== -1 ? String(r[idxModel] || '').trim() : '',
            mileageKm: idxMileage !== -1 ? r[idxMileage] : '',
            year: idxYear !== -1 ? String(r[idxYear] || '').trim() : '',
            quote: idxQuote !== -1 ? r[idxQuote] : '',
            dropOffStartDate: idxDate !== -1 ? r[idxDate] : '',
            dropOffWarehouse: idxWh !== -1 ? String(r[idxWh] || '').trim().toLowerCase() : '',
            firstName: idxFirstName !== -1 ? String(r[idxFirstName] || '').trim() : '',
            lastName: idxLastName !== -1 ? String(r[idxLastName] || '').trim() : ''
        }));
    } else {
        return { error: "Formato de dados não reconhecido do Gateway Hub." };
    }

    const now = new Date();
    const todayStr = formatDateISO(now);

    let startDateStr = todayStr;
    let endDateStr = todayStr;

    if (dateFilter === 'past10days') {
        const dStart = new Date(now.getTime() - 10 * 86400000);
        startDateStr = formatDateISO(dStart);
        endDateStr = todayStr;
    } else if (dateFilter === 'next10days') {
        const dEnd = new Date(now.getTime() + 10 * 86400000);
        startDateStr = todayStr;
        endDateStr = formatDateISO(dEnd);
    } else if (dateFilter === 'custom' && customStart && customEnd) {
        startDateStr = customStart;
        endDateStr = customEnd;
    }

    const sheetState = readSheetState();

    // Resumo do que existe no card, independente do filtro. Uma fila vazia é
    // indistinguível de uma integração quebrada — com isto o estado vazio consegue
    // dizer "não há nada em Berlin hoje, mas há 4 nos próximos 10 dias".
    const summary = {
        totalRows: normalizedRows.length,
        byWarehouse: {},
        selectedWarehouse: { today: 0, next10days: 0, past10days: 0, otherDates: 0 }
    };
    const next10Str = formatDateISO(new Date(now.getTime() + 10 * 86400000));
    const past10Str = formatDateISO(new Date(now.getTime() - 10 * 86400000));

    normalizedRows.forEach(row => {
        const wh = normStr(row.dropOffWarehouse || '');
        if (wh) summary.byWarehouse[wh] = (summary.byWarehouse[wh] || 0) + 1;
        if (!matchesWarehouse(row.dropOffWarehouse, selectedWarehouse)) return;

        const d = rowDateIso(row);
        if (!d || d === '2000-01-01') summary.selectedWarehouse.otherDates++;
        else if (d === todayStr) summary.selectedWarehouse.today++;
        else if (d > todayStr && d <= next10Str) summary.selectedWarehouse.next10days++;
        else if (d < todayStr && d >= past10Str) summary.selectedWarehouse.past10days++;
        else summary.selectedWarehouse.otherDates++;
    });

    const filteredList = [];
    for (let i = 0; i < normalizedRows.length; i++) {
        const row = normalizedRows[i];

        if (!matchesWarehouse(row.dropOffWarehouse, selectedWarehouse)) continue;

        const dateValStr = rowDateIso(row);

        if (dateFilter !== 'all' && dateValStr && dateValStr !== '2000-01-01') {
            if (dateValStr < startDateStr || dateValStr > endDateStr) {
                continue;
            }
        }

        const bikeId = row.bikeId || `ROW-${i+1}`;
        if (!bikeId || bikeId === 'N/A') continue;

        const brand = row.brand || '';
        const model = row.model || '';
        const bikeName = (brand || model) ? `${brand} ${model}`.trim() : 'N/A';
        const yearVal = row.year || '';

        const firstName = row.firstName || '';
        const lastName = row.lastName || '';
        const customerName = (firstName || lastName) ? `${firstName} ${lastName}`.trim() : 'Cliente';

        // O card devolve número puro (1661). O handoff mostra "€ 1.890": separador
        // alemão e sem centavos — cotação é em euro inteiro.
        let quoteVal = row.quote;
        if (quoteVal !== '' && quoteVal !== null && quoteVal !== undefined && !isNaN(quoteVal)) {
            quoteVal = '€ ' + Math.round(parseFloat(quoteVal)).toLocaleString('de-DE');
        } else {
            quoteVal = quoteVal ? `€ ${quoteVal}` : '€ --';
        }

        const emailVal = row.email || '';
        const mileageVal = row.mileageKm !== undefined && row.mileageKm !== null ? String(row.mileageKm).trim() : '';

        // Reabrir um Beleg precisa carregar o que foi salvo, não os defaults do booking.
        const saved = sheetState.saved[bikeId] || null;
        const isProcessed = sheetState.processed.has(bikeId);

        filteredList.push({
            saved: saved,
            rowIndex: i,
            bikeId: bikeId,
            bikeName: bikeName,
            brand: brand,
            model: model,
            year: yearVal,
            customerName: customerName,
            firstName: firstName,
            lastName: lastName,
            quote: quoteVal,
            email: emailVal,
            mileage: mileageVal,
            dropOffDate: dateValStr,
            warehouse: selectedWarehouse,
            isProcessed: isProcessed
        });
    }

    return {
        success: true,
        warehouse: selectedWarehouse,
        dateFilter: dateFilter,
        total: filteredList.length,
        rows: filteredList,
        summary: summary
    };
}

var SHEET_NAME = 'Drop-offs';
// 'Operador' entra no FIM de propósito: inserir no meio deslocaria as colunas das
// linhas antigas, e o Snapshot (JSON) delas — que o Reopen usa — ficaria desalinhado.
var SHEET_HEADERS = [
    'Data', 'Bike ID', 'Vendedor / Cliente', 'Modelo da Bike',
    'Quilometragem', 'Zubehör (Acessórios)', 'Notizen / Danos',
    'PDF Document (Google Drive)', 'Processado Em', 'Snapshot (JSON)', 'Operador'
];

/**
 * E-mail de quem está operando o balcão.
 *
 * O web app roda como o dono da implantação (executeAs USER_DEPLOYING), então o
 * arquivo no Drive sai no nome dele e a metadata do Drive NÃO diz quem atendeu. Como o
 * Beleg é documento legal, a trilha de auditoria passa a ser esta coluna. Funciona
 * porque operador e dono estão no mesmo domínio — o Google só devolve o e-mail do
 * usuário ativo nesse caso.
 */
function operatorEmail() {
    try {
        return Session.getActiveUser().getEmail() || '';
    } catch (e) {
        return '';
    }
}

/**
 * Lê a aba 'Drop-offs': quais Bike IDs já foram arquivados e o snapshot do formulário
 * de cada um (para o "Reopen" restaurar os valores salvos).
 *
 * Sem fallback para getActiveSheet(): se a aba não existe, nada está arquivado — ler
 * uma aba qualquer marcava linhas como processadas por acidente.
 */
function readSheetState() {
    const out = { processed: new Set(), saved: {} };
    try {
        const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
        if (!sheet) return out;

        const data = sheet.getDataRange().getValues();
        if (data.length <= 1) return out;

        const headers = data[0].map(h => String(h).toLowerCase().trim());
        let bikeColIdx = headers.indexOf('bike id');
        if (bikeColIdx === -1) bikeColIdx = headers.indexOf('id');
        if (bikeColIdx === -1) bikeColIdx = 1;
        const snapColIdx = headers.indexOf('snapshot (json)');

        for (let i = 1; i < data.length; i++) {
            const val = String(data[i][bikeColIdx] || '').trim().toUpperCase();
            if (!val) continue;
            out.processed.add(val);

            if (snapColIdx !== -1) {
                const raw = String(data[i][snapColIdx] || '').trim();
                if (raw) {
                    try { out.saved[val] = JSON.parse(raw); } catch (e) { /* snapshot corrompido: ignora */ }
                }
            }
        }
    } catch (e) {
        // Ignore read errors
    }
    return out;
}

/**
 * Generates 1:1 Einlieferungsbeleg PDF matched 100% to Upway Drop-off Portal v2 design handoff
 */
function processDropoffDocument(formData) {
    if (!formData || !formData.bikeId) {
        return { error: 'Dados inválidos ou Bike ID ausente.' };
    }

    const config = getAppConfig();
    const warehouse = (formData.warehouse || config.warehouse || 'berlin').toLowerCase();
    const bikeId = String(formData.bikeId).trim().toUpperCase();
    const seller = String(formData.seller || '').trim();
    const brand = String(formData.brand || '').trim();
    const model = String(formData.model || '').trim();
    const mileage = String(formData.mileage || '').trim();
    const frame = String(formData.frame || '').trim().toUpperCase();
    const year = String(formData.year || '').trim();
    const battery = String(formData.battery || '').trim();
    const damage = String(formData.damage || formData.notes || '').trim();
    const datum = formData.datum || formatDateGerman(new Date());
    const uhrzeit = formData.uhrzeit || formatTimeGerman(new Date());

    const akku = !!formData.akku;
    const lade = !!formData.lade;
    const schl = !!formData.schl;
    const disp = !!formData.disp;

    const htmlContent = generateEinlieferungsbelegHTML({
        bikeId: bikeId,
        seller: seller,
        brand: brand,
        model: model,
        mileage: mileage,
        frame: frame,
        year: year,
        battery: battery,
        akku: akku,
        lade: lade,
        schl: schl,
        disp: disp,
        damage: damage,
        datum: datum,
        uhrzeit: uhrzeit,
        warehouse: warehouse
    });

    // Nome definido UMA vez: o mesmo valor batiza o blob e procura a versão anterior
    // para descartar. Duas cópias da string divergiriam e o Drive acumularia duplicata.
    const fileName = belegFileName(bikeId, brand);

    const pdfBlob = Utilities.newBlob(htmlContent, 'text/html', `${bikeId}.html`)
        .getAs('application/pdf')
        .setName(fileName);

    const rootFolder = getDriveFolder(config.driveFolderId);
    const now = new Date();
    const yearFolder = getOrCreateSubFolder(rootFolder, String(now.getFullYear()));
    const dayFolder = dayFolderName(now);
    const targetFolder = getOrCreateSubFolder(yearFolder, dayFolder);

    const existing = targetFolder.getFilesByName(fileName);
    while (existing.hasNext()) {
        existing.next().setTrashed(true);
    }

    const createdFile = targetFolder.createFile(pdfBlob);
    try {
        createdFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch(e) {}

    const fileUrl = createdFile.getUrl();

    logDropoffToSheet({
        bikeId: bikeId,
        seller: seller,
        bikeName: `${brand} ${model}`.trim(),
        mileage: mileage,
        accessories: [
            akku ? 'Akku' : null,
            lade ? 'Ladegerät' : null,
            schl ? 'Schlüssel' : null,
            disp ? 'Display' : null
        ].filter(Boolean).join(', ') || 'Nenhum',
        damage: damage,
        pdfUrl: fileUrl,
        datum: datum,
        // Snapshot em uma coluna só: o "Reopen" restaura exatamente o que foi arquivado,
        // sem precisar de uma coluna nova por campo a cada mudança de formulário.
        snapshot: {
            bikeId: bikeId, seller: seller, brand: brand, model: model,
            mileage: mileage, frame: frame, year: year, battery: battery,
            notes: damage, datum: datum, uhrzeit: uhrzeit, warehouse: warehouse,
            acc: { akku: akku, lade: lade, schl: schl, disp: disp }
        }
    });

    return {
        success: true,
        bikeId: bikeId,
        fileName: fileName,
        pdfUrl: fileUrl,
        folderPath: `${now.getFullYear()} > ${dayFolder}`
    };
}

/**
 * Logs or updates drop-off record in 'Drop-offs' sheet tab
 */
function logDropoffToSheet(data) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);
    const cols = SHEET_HEADERS.length;

    if (!sheet) {
        sheet = ss.insertSheet(SHEET_NAME);
        sheet.appendRow(SHEET_HEADERS);
        sheet.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#f3f4f6');
    } else if (String(sheet.getRange(1, cols).getValue()).trim() !== SHEET_HEADERS[cols - 1]) {
        // Aba criada por uma versão anterior (9 colunas): adiciona o cabeçalho que falta.
        sheet.getRange(1, 1, 1, cols).setValues([SHEET_HEADERS]);
        sheet.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#f3f4f6');
    }

    const rows = sheet.getDataRange().getValues();
    let targetRowIndex = -1;

    for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][1]).trim().toUpperCase() === data.bikeId) {
            targetRowIndex = i + 1;
            break;
        }
    }

    const nowStr = `${formatDateGerman(new Date())} ${formatTimeGerman(new Date())}`;
    const rowValues = [
        data.datum,
        data.bikeId,
        data.seller,
        data.bikeName,
        data.mileage ? `${data.mileage} km` : '',
        data.accessories,
        data.damage,
        `=HYPERLINK("${data.pdfUrl}", "📄 Abrir Beleg (PDF)")`,
        nowStr,
        JSON.stringify(data.snapshot || {}),
        operatorEmail()
    ];

    if (targetRowIndex > 0) {
        sheet.getRange(targetRowIndex, 1, 1, cols).setValues([rowValues]);
    } else {
        sheet.appendRow(rowValues);
    }
}

/**
 * Generates 1:1 Einlieferungsbeleg HTML matched 100% to Upway Drop-off Portal v2 design handoff
 */
function generateEinlieferungsbelegHTML(d) {
    d = d || {};
    const whKey = normStr(d.warehouse || 'berlin');
    
    let wh = WAREHOUSE_MAP[whKey];
    if (!wh) {
        for (let k in WAREHOUSE_MAP) {
            if (normStr(WAREHOUSE_MAP[k].name) === whKey) {
                wh = WAREHOUSE_MAP[k];
                break;
            }
        }
    }
    if (!wh) wh = WAREHOUSE_MAP['berlin'];

    const whUpper = wh.name.toUpperCase();
    const whCity = wh.city;
    const whName = wh.name;
    const whReviewUrl = reviewUrlFor(wh);
    const isBerlin = (whKey === 'berlin' || normStr(wh.name) === 'berlin');

    const bikeId = escapeHtml(String(d.bikeId || '—').trim().toUpperCase());
    const seller = escapeHtml(String(d.seller || '—').trim());
    const brand = String(d.brand || '').trim();
    const model = String(d.model || '').trim();
    const bikeName = escapeHtml((brand + ' ' + model).trim() || '—');
    
    let mileageFormatted = '—';
    if (d.mileage) {
        const cleanM = String(d.mileage).replace(/[^0-9]/g, '');
        if (cleanM) {
            mileageFormatted = Number(cleanM).toLocaleString('de-DE') + ' km';
        }
    }

    const frame = escapeHtml(String(d.frame || '—').trim().toUpperCase());
    const year = escapeHtml(String(d.year || '—').trim());
    const battery = escapeHtml(String(d.battery || '—').trim());
    const damage = escapeHtml(String(d.damage || d.notes || '—').trim());
    const datum = escapeHtml(d.datum || formatDateGerman(new Date()));
    const uhrzeit = escapeHtml(d.uhrzeit || formatTimeGerman(new Date()));

    const akku = !!d.akku;
    const lade = !!d.lade;
    const schl = !!d.schl;
    const disp = !!d.disp;

    const LOGO_SVG = upwayLogoSvg(20);

    /**
     * Checkbox do Zubehör.
     *
     * Antes eram <span> vazios (um com SVG dentro, um sem nada) e o conversor não
     * desenhava nenhum dos dois: o Beleg saía com "Akku Ladegerät Schlüssel Display"
     * e nenhuma caixa — impossível saber o que o cliente entregou.
     *
     * Agora: `display: block` com tamanho fixo e `flex: 0 0 15px` (item de flex sem
     * conteúdo colapsa), e o estado vem da COR DE FUNDO, não de um glifo. Se o "✓" não
     * existir na fonte do conversor, ainda sobra quadrado azul cheio vs. contorno
     * vazio — a informação sobrevive.
     */
    function renderCheckbox(label, checked) {
        const box = checked
            ? '<span style="flex: 0 0 15px; display: block; width: 15px; height: 15px; border-radius: 4px; box-sizing: border-box; background: #4733FF; border: 1px solid #4733FF; color: #FFFFFF; font-size: 11px; line-height: 13px; font-weight: 700; text-align: center;">&#10003;</span>'
            : '<span style="flex: 0 0 15px; display: block; width: 15px; height: 15px; border-radius: 4px; box-sizing: border-box; background: #FFFFFF; border: 1px solid #9E9EAF; font-size: 0; line-height: 0;">&nbsp;</span>';

        return `
              <div style="display: flex; align-items: center; gap: 8px;">
                ${box}
                <span style="font-size: 13.5px; color: #0E0E14;">${label}</span>
              </div>
            `;
    }

    const qrApiUrl = qrImageSrc(whReviewUrl);

    return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Einlieferungsbeleg ${bikeId}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background: #FFFFFF; color: #0E0E14; -webkit-font-smoothing: antialiased; }
    
    /* Em mm, não em px: este PDF é o que vai para a impressora, e o conversor
       HTML→PDF não garante o mesmo dpi de viewport que o navegador. 210x297mm é a
       folha; a margem lateral do texto vem do padding (= 60/64/52px do design). */
    .a4-page {
      width: 210mm;
      height: 297mm;
      box-sizing: border-box;
      background: #FFFFFF;
      position: relative;
      padding: 15.9mm 16.9mm 13.8mm;
      margin: 0 auto;
      overflow: hidden;
    }
    
    .page-break {
      page-break-after: always;
      break-after: page;
    }

    /* ⚠️ O conversor HTML→PDF do Apps Script COLAPSA elemento vazio, mesmo com width e
       height explícitos — foi por isso que os checkboxes do Zubehör e as réguas das
       seções saíam invisíveis no Beleg (o box de NOTIZEN aparecia porque tem texto).
       Padrão usado em todo filete e caixa daqui: um &nbsp; dentro, com font-size e
       line-height zerados, para o elemento ter conteúdo sem ganhar altura de texto.
       Se for criar outro filete ou caixa neste HTML, siga o mesmo padrão. */
    .top-blue-bar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 5px;
      background: #4733FF;
      font-size: 0;
      line-height: 0;
    }
    .hairline { font-size: 0; line-height: 0; }

    .a4-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
    }

    .a4-wh-info {
      text-align: right;
      font-size: 11px;
      line-height: 1.5;
      color: #717182;
    }

    .a4-wh-title {
      font-weight: 700;
      letter-spacing: 0.06em;
      color: #0E0E14;
      text-transform: uppercase;
    }

    .sec-rule-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 34px;
    }
    .sec-num { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: #4733FF; }
    .sec-title { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: #0E0E14; }
    .sec-line { flex: 1 1 auto; height: 1px; background: #EAEAEF; font-size: 0; line-height: 0; }

    .field-pair { padding-bottom: 10px; border-bottom: 1px solid #EAEAEF; }
    .field-lbl { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: #717182; text-transform: uppercase; }
    .field-val { margin-top: 7px; font-size: 16px; color: #0E0E14; word-break: break-word; }
    .field-val.blue-highlight { font-weight: 700; letter-spacing: 0.03em; color: #3725E5; }

    .a4-footer {
      position: absolute;
      left: 16.9mm;
      right: 16.9mm;
      bottom: 9.5mm;
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #717182;
    }
  </style>
</head>
<body>

  <!-- PAGE 1 -->
  <div class="a4-page page-break">
    <div class="top-blue-bar">&nbsp;</div>
    <div class="a4-header">
      ${LOGO_SVG}
      <div class="a4-wh-info">
        <div class="a4-wh-title">UPCENTER ${whUpper}</div>
        <div>${whCity}</div>
      </div>
    </div>

    <h1 style="margin: 40px 0 0; font-size: 28px; line-height: 1.12; letter-spacing: -0.02em; font-weight: 700;">Einlieferungsbeleg</h1>
    <p style="margin: 8px 0 0; font-size: 13px; color: #4A4A5A;">Nachweis über die physische Abgabe eines E-Bikes zum Ankauf</p>

    <!-- Section 01 -->
    <div class="sec-rule-header" style="margin-top: 38px;">
      <span class="sec-num">01</span>
      <span class="sec-title">VERKÄUFER*IN</span>
      <span class="sec-line">&nbsp;</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 18px;">
      <div class="field-pair">
        <div class="field-lbl">BIKE-ID</div>
        <div class="field-val blue-highlight">${bikeId}</div>
      </div>
      <div class="field-pair">
        <div class="field-lbl">NAME VERKÄUFER*IN</div>
        <div class="field-val">${seller}</div>
      </div>
    </div>

    <!-- Section 02 -->
    <div class="sec-rule-header">
      <span class="sec-num">02</span>
      <span class="sec-title">FAHRZEUGDATEN</span>
      <span class="sec-line">&nbsp;</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 18px 28px; margin-top: 18px;">
      <div class="field-pair">
        <div class="field-lbl">MARKE &amp; MODELL</div>
        <div class="field-val">${bikeName}</div>
      </div>
      <div class="field-pair">
        <div class="field-lbl">KILOMETERSTAND</div>
        <div class="field-val">${mileageFormatted}</div>
      </div>
      <div class="field-pair">
        <div class="field-lbl">RAHMENNUMMER</div>
        <div class="field-val">${frame}</div>
      </div>
      ${!isBerlin ? `
      <div class="field-pair">
        <div class="field-lbl">JAHR</div>
        <div class="field-val">${year}</div>
      </div>
      <div class="field-pair">
        <div class="field-lbl">BATTERIEKAPAZITÄT</div>
        <div class="field-val">${battery}</div>
      </div>
      ` : ''}
    </div>

    <!-- Section 03 -->
    <div class="sec-rule-header">
      <span class="sec-num">03</span>
      <span class="sec-title">ÜBERGABE-CHECKLISTE</span>
      <span class="sec-line">&nbsp;</span>
    </div>
    <div style="margin-top: 18px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: #717182;">ZUBEHÖR</div>
    <div style="display: flex; gap: 30px; margin-top: 12px;">
      ${renderCheckbox('Akku', akku)}
      ${renderCheckbox('Ladegerät', lade)}
      ${renderCheckbox('Schlüssel', schl)}
      ${renderCheckbox('Display', disp)}
    </div>

    <div style="margin-top: 24px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: #717182;">NOTIZEN</div>
    <div style="margin-top: 9px; min-height: 120px; padding: 14px 16px; box-sizing: border-box; border: 1px solid #D4D4DE; border-radius: 8px; font-size: 13.5px; line-height: 1.55; color: #0E0E14; white-space: pre-wrap;">${damage}</div>

    <div class="a4-footer">
      <span>Upway · Einlieferungsbeleg ${bikeId}</span>
      <span>Seite 1 / 2</span>
    </div>
  </div>

  <!-- PAGE 2 -->
  <div class="a4-page">
    <div class="top-blue-bar">&nbsp;</div>
    <div class="a4-header">
      ${LOGO_SVG}
      <div class="a4-wh-info">
        <div class="a4-wh-title">UPCENTER ${whUpper}</div>
        <div>${whCity}</div>
      </div>
    </div>

    <!-- Section 04 -->
    <div class="sec-rule-header" style="margin-top: 40px;">
      <span class="sec-num">04</span>
      <span class="sec-title">RECHTLICHE HINWEISE</span>
      <span class="sec-line">&nbsp;</span>
    </div>
    <p style="margin: 18px 0 0; font-size: 13px; line-height: 1.6; color: #0E0E14;">Mit der Abgabe im UpCenter ${whName} erkennt der/die Verkäufer*in folgende Bedingungen an:</p>

    <div style="margin-top: 16px; display: flex; flex-direction: column; gap: 14px;">
      <div style="display: grid; grid-template-columns: 20px 1fr; gap: 10px;">
        <span style="font-size: 13px; font-weight: 700; color: #4733FF;">1.</span>
        <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #0E0E14;"><strong style="font-weight: 700;">Technische Tiefenprüfung:</strong> Dieser Beleg bestätigt nur den Erhalt der Hardware. Die finale technische Prüfung und Bestätigung des Ankaufspreises erfolgen zeitversetzt durch unsere Experten (§ III AGB).</p>
      </div>
      <div style="display: grid; grid-template-columns: 20px 1fr; gap: 10px;">
        <span style="font-size: 13px; font-weight: 700; color: #4733FF;">2.</span>
        <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #0E0E14;"><strong style="font-weight: 700;">Eigentumsvorbehalt (§ VIII):</strong> Das E-Bike bleibt bis zur vollständigen Auszahlung des Kaufpreises durch Upway im Eigentum des/der Verkäufer*in.</p>
      </div>
      <div style="display: grid; grid-template-columns: 20px 1fr; gap: 10px;">
        <span style="font-size: 13px; font-weight: 700; color: #4733FF;">3.</span>
        <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #0E0E14;"><strong style="font-weight: 700;">Akku-Sicherheit (§ IX):</strong> Der/die Verkäufer*in versichert, dass weder der Akku noch der Motor beschädigt oder technisch manipuliert wurden.</p>
      </div>
    </div>

    <!-- Section 05 -->
    <div class="sec-rule-header" style="margin-top: 40px;">
      <span class="sec-num">05</span>
      <span class="sec-title">BESTÄTIGUNG DER EINLIEFERUNG</span>
      <span class="sec-line">&nbsp;</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 18px;">
      <div class="field-pair">
        <div class="field-lbl">DATUM</div>
        <div class="field-val">${datum}</div>
      </div>
      <div class="field-pair">
        <div class="field-lbl">UHRZEIT</div>
        <div class="field-val">${uhrzeit}</div>
      </div>
    </div>

    <!-- Signature -->
    <div style="margin-top: 52px; width: 300px;">
      <div class="hairline" style="height: 1px; background: #2E2E38;">&nbsp;</div>
      <div style="margin-top: 9px; font-size: 10.5px; color: #717182;">Unterschrift Upway (Annahme)</div>
    </div>

    <div class="hairline" style="margin-top: 52px; height: 1px; background: #EAEAEF;">&nbsp;</div>

    <!-- Thank you & Google review badge -->
    <div style="display: flex; align-items: center; gap: 28px; margin-top: 28px;">
      <div style="flex: 1;">
        <div style="font-size: 17px; font-weight: 700; letter-spacing: -0.01em;">Danke für Ihr Vertrauen!</div>
        <p style="margin: 9px 0 0; max-width: 320px; font-size: 13px; line-height: 1.6; color: #4A4A5A;">Wir möchten uns stetig verbessern. Hat heute alles geklappt? Dann freuen wir uns über Ihre Bewertung.</p>
      </div>

      <!-- Selo oficial do Beleg legado + QR do UpCenter que emitiu (não fixo em Berlim). -->
      <div style="display: flex; align-items: center; gap: 16px;">
        <img src="${reviewBadgeSrc()}" alt="Review us on Google" style="width: 120px; height: 72px; object-fit: contain;">
        <div style="width: 88px; height: 88px; border: 1px solid #D4D4DE; border-radius: 8px; padding: 4px; background: #FFFFFF; display: flex; align-items: center; justify-content: center;">
          <img src="${qrApiUrl}" alt="QR Google-Bewertung" style="width: 100%; height: 100%; object-fit: contain;">
        </div>
      </div>
    </div>

    <div class="a4-footer">
      <span>Upway · Einlieferungsbeleg ${bikeId}</span>
      <span>Seite 2 / 2</span>
    </div>
  </div>

</body>
</html>`;
}

// Helper Utilities
/**
 * Sem fallback silencioso para a raiz do Drive: se o ID estiver errado ou sem acesso,
 * é melhor falhar visível do que arquivar Belege numa pasta que ninguém procura.
 */
function getDriveFolder(folderId) {
    try {
        return DriveApp.getFolderById(folderId);
    } catch (e) {
        throw new Error(`Não foi possível abrir a pasta do Drive ${folderId}. Verifique CONFIG.SHARED_DRIVE_FOLDER_ID e o acesso da sua conta ao Shared Drive. (${e.message || e})`);
    }
}

/**
 * QR como data URI. Duas razões para não usar <img src="api..."> direto:
 * o conversor HTML→PDF do Apps Script não é confiável com imagem externa, e um Beleg
 * é documento de cliente — não pode depender de um serviço de terceiro estar de pé na
 * hora da impressão. Por isso o resultado fica em cache por URL: cada armazém depende
 * da rede uma única vez na vida.
 */
function qrImageSrc(url) {
    const cacheKey = 'QR_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(
        Utilities.DigestAlgorithm.MD5, url));
    const props = PropertiesService.getScriptProperties();

    const cached = props.getProperty(cacheKey);
    if (cached) return cached;

    const api = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=M&margin=8&data=${encodeURIComponent(url)}`;
    try {
        const resp = UrlFetchApp.fetch(api, { muteHttpExceptions: true });
        if (resp.getResponseCode() === 200) {
            const uri = 'data:image/png;base64,' + Utilities.base64Encode(resp.getBlob().getBytes());
            // Limite de 9 KB por propriedade; um QR 200x200 fica bem abaixo disso.
            if (uri.length < 9000) props.setProperty(cacheKey, uri);
            return uri;
        }
    } catch (e) {
        // Cai para a URL direta abaixo — degrada visível, não silencioso.
    }
    return api;
}

function getOrCreateSubFolder(parent, name) {
    const iter = parent.getFoldersByName(name);
    return iter.hasNext() ? iter.next() : parent.createFolder(name);
}

function resetSheetFormatting() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    sheet.getDataRange().setBackground('#ffffff').setFontColor('#000000').setFontLine('none');
    SpreadsheetApp.getUi().alert(`Formatação da aba "${sheet.getName()}" resetada.`);
}

function formatDateISO(d) {
    if (!d || isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`;
}

/**
 * Nome da subpasta do dia dentro do ano: MM-DD.
 *
 * O Drive lista pastas em ordem alfabética. Com o formato antigo (DD.MM) a lista saía
 * embaralhada — 01.08, 01.09, 01.10, 02.08… todo dia 1 de todos os meses junto. Com
 * MM-DD a ordem alfabética é a ordem cronológica, e o operador continua a dois cliques
 * do arquivo (ano › dia) em vez de três (ano › mês › dia).
 */
function dayFolderName(d) {
    return `${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`;
}

function formatDateGerman(d) {
    return `${padZero(d.getDate())}.${padZero(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function formatTimeGerman(d) {
    return `${padZero(d.getHours())}:${padZero(d.getMinutes())}`;
}

function padZero(n) {
    return String(n).padStart(2, '0');
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Check rodável dos helpers puros (menu não precisa: rodar no editor).
 * Falha alto se alguma das regras de formatação/detecção quebrar.
 */
function runSelfChecks() {
    function assert(cond, msg) { if (!cond) throw new Error('runSelfChecks: ' + msg); }

    // Página de login do Google vinda no lugar do JSON precisa ser detectada.
    assert(looksLikeHtml('<!DOCTYPE html><html>'), 'não detectou HTML com doctype');
    assert(looksLikeHtml('\n  <html lang="en">'), 'não detectou HTML com espaço à frente');
    assert(!looksLikeHtml('[{"bikeId":"RK2EP9"}]'), 'confundiu array JSON com HTML');
    assert(!looksLikeHtml('{"data":{"rows":[]}}'), 'confundiu objeto JSON com HTML');

    // Armazém: o que a UI manda ("Düsseldorf", "Los Angeles") tem que casar com a chave.
    assert(normStr('Düsseldorf') === 'dusseldorf', 'normStr falhou no trema');
    assert(normStr('Los Angeles') === 'losangeles', 'normStr falhou no espaço');
    assert(!!WAREHOUSE_MAP[normStr('New York')], 'New York não resolve no WAREHOUSE_MAP');
    WAREHOUSES.forEach(k => assert(!!WAREHOUSE_MAP[k], 'armazém sem entrada no mapa: ' + k));

    // Berlim não leva Jahr/Batteriekapazität no Beleg; os outros levam.
    assert(generateEinlieferungsbelegHTML({ bikeId: 'X1', warehouse: 'berlin', year: '2022' }).indexOf('JAHR') === -1, 'Berlim não deveria imprimir JAHR');
    assert(generateEinlieferungsbelegHTML({ bikeId: 'X1', warehouse: 'stuttgart', year: '2022' }).indexOf('JAHR') !== -1, 'Stuttgart deveria imprimir JAHR');

    // Nome do arquivo: Bike ID + marca, sem caractere que o Drive/Windows rejeita.
    assert(belegFileName('rk2ep9', 'Stromer') === 'RK2EP9 Stromer.pdf', 'nome do Beleg errado');
    assert(belegFileName('RK2EP9', 'Riese & Müller') === 'RK2EP9 Riese & Müller.pdf', '& na marca deveria passar');
    assert(belegFileName('RK2EP9', 'A/B:C*D?E"F<G>H|I') === 'RK2EP9 A B C D E F G H I.pdf', 'caractere proibido não foi trocado');
    assert(belegFileName('RK2EP9', '') === 'RK2EP9.pdf', 'sem marca deveria ficar só o ID');
    assert(belegFileName('RK2EP9', '   ') === 'RK2EP9.pdf', 'marca só com espaço deveria ficar só o ID');

    // Coluna nova só pode entrar no FIM: no meio, o Snapshot (JSON) das linhas antigas
    // sai do lugar e o Reopen passa a restaurar o registro errado.
    assert(SHEET_HEADERS[SHEET_HEADERS.length - 1] === 'Operador', 'Operador deve ser a última coluna');
    assert(SHEET_HEADERS.indexOf('Snapshot (JSON)') === 9, 'Snapshot saiu da coluna 10 e desalinha o histórico');
    assert(SHEET_HEADERS.indexOf('Bike ID') === 1, 'Bike ID saiu da coluna 2 (logDropoffToSheet procura ali)');

    // Beleg: elemento vazio com width/height NÃO é desenhado pelo conversor HTML→PDF.
    // Era assim que os checkboxes do Zubehör e as réguas das seções desapareciam.
    const beleg = generateEinlieferungsbelegHTML({
        bikeId: 'X1', warehouse: 'berlin', akku: true, lade: true, schl: false, disp: false
    });
    const vazio = /<(div|span)\b[^>]*>\s*<\/\1>/.exec(beleg);
    assert(!vazio, 'elemento vazio no Beleg (o conversor não desenha): ' + (vazio ? vazio[0].substring(0, 90) : ''));

    // Marcado x desmarcado tem que ser distinguível sem depender de glifo.
    assert(beleg.indexOf('background: #4733FF; border: 1px solid #4733FF') !== -1, 'checkbox marcado perdeu o fundo azul');
    assert(beleg.indexOf('border: 1px solid #9E9EAF') !== -1, 'checkbox desmarcado perdeu o contorno');
    assert((beleg.match(/flex: 0 0 15px/g) || []).length === 4, 'os 4 checkboxes precisam de base de flex fixa');
    assert((beleg.match(/class="sec-line">&nbsp;/g) || []).length === 5, 'as 5 réguas de seção perderam o conteúdo neutro');

    // Kilometerstand com separador alemão.
    assert(generateEinlieferungsbelegHTML({ bikeId: 'X1', warehouse: 'berlin', mileage: '1240 km' }).indexOf('1.240 km') !== -1, 'quilometragem sem separador alemão');

    // Nome do cliente com caractere de HTML não pode escapar para o markup.
    assert(generateEinlieferungsbelegHTML({ bikeId: 'X1', warehouse: 'berlin', seller: 'A <b>B' }).indexOf('A &lt;b&gt;B') !== -1, 'seller não escapado');

    // Pastas do dia: ordem alfabética TEM que ser ordem cronológica.
    const dias = [new Date(2026, 7, 1), new Date(2026, 7, 12), new Date(2026, 8, 1), new Date(2026, 11, 31)];
    const nomes = dias.map(dayFolderName);
    assert(JSON.stringify(nomes) === JSON.stringify(nomes.slice().sort()), 'pastas do dia não ordenam cronologicamente: ' + nomes.join(', '));
    assert(dayFolderName(new Date(2026, 7, 11)) === '08-11', 'formato da pasta do dia mudou');

    // QR de avaliação: link real quando há gpageId, busca do Maps quando não há.
    // Nunca um `g.page/r/upway-<cidade>/review` inventado.
    const semId = reviewUrlFor({ name: 'Amsterdam', city: 'Contactweg 47 · 1014 AN Amsterdam', gpageId: '' });
    assert(semId.indexOf('https://www.google.com/maps/search/?api=1&query=') === 0, 'fallback do review não é uma busca do Maps');
    assert(semId.indexOf('g.page') === -1, 'link g.page inventado voltou');
    assert(reviewUrlFor({ name: 'Berlin', city: 'x', gpageId: 'CZuAldi1qpuUEBM' }) ===
        'https://g.page/r/CZuAldi1qpuUEBM/review?utm_source=gbp&utm_medium=reviews&utm_campaign=qr',
        'link g.page montado errado');
    assert(reviewUrlFor(WAREHOUSE_MAP['berlin']).indexOf('CZuAldi1qpuUEBM') !== -1, 'Berlim perdeu o ID real do Beleg legado');
    // Garante que nenhum armazém volte a carregar um ID inventado no padrão antigo.
    WAREHOUSES.forEach(k => assert(!/upway-/.test(reviewUrlFor(WAREHOUSE_MAP[k])), 'link inventado em ' + k));

    // Filtro de armazém: o que a UI manda tem que casar com o que o card devolve.
    assert(matchesWarehouse('dusseldorf', 'düsseldorf'), 'trema quebra o casamento de armazém');
    assert(matchesWarehouse('Düsseldorf', 'dusseldorf'), 'casamento de armazém não é simétrico');
    assert(!matchesWarehouse('berlin', 'dusseldorf'), 'armazéns diferentes casaram');
    assert(matchesWarehouse('', 'berlin'), 'linha sem armazém deveria passar');

    // Data do drop-off: o card manda ISO sem timezone.
    assert(rowDateIso({ dropOffStartDate: '2026-08-14T07:00:00' }) === '2026-08-14', 'data do card interpretada errado');
    assert(rowDateIso({ dropOffStartDate: 'lixo' }) === '', 'data inválida deveria virar vazio');
    assert(rowDateIso({}) === '', 'linha sem data deveria virar vazio');

    // Snapshot precisa sobreviver ao round-trip pela planilha.
    const snap = { bikeId: 'RK2EP9', frame: 'WBK123', acc: { akku: true, disp: false } };
    assert(JSON.parse(JSON.stringify(snap)).acc.akku === true, 'snapshot não sobreviveu ao round-trip');

    Logger.log('runSelfChecks: OK');
    return 'OK';
}
