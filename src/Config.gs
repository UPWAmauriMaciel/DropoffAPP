/**
 * ============================================================================
 * UPWAY DROP-OFF PORTAL — CONFIG
 *
 * Constantes, dados mestres dos armazens e helpers de formatacao.
 *
 * Nada aqui fala com API: e o vocabulario que os outros arquivos usam.
 * ============================================================================
 */

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


/**
 * Favicon da aba, em ordem de preferência — ver withFavicon() no Portal.gs.
 *
 * 1º: o ícone do backoffice, o mesmo que a equipe já vê na aba do backoffice.upway.app.
 * 2º: o que a loja publica no `<link rel="shortcut icon">` dela, PNG, como reserva caso o
 *     Apps Script recuse `.ico`.
 *
 * Nenhuma cópia local de propósito: quando a marca trocar de ícone, as duas URLs
 * acompanham sem ninguém lembrar deste arquivo.
 *
 * Já foi data URI de um SVG montado a partir do path do wordmark, e o Apps Script recusou
 * com "The favicon icon image type is not supported" — setFaviconUrl valida o tipo e quer
 * imagem hospedada, não data URI.
 */
var FAVICON_URLS = [
    'https://backoffice.upway.app/favicon.ico',
    'https://upway.fr/cdn/shop/files/logo-256_32x32.png?v=1678123878'
];


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
    "dusseldorf": { name: "Düsseldorf", city: "Reisholzer Bahnstraße 39 · 40599 Düsseldorf", gpageId: "" },
    // O galpão fica em Illingen, não em Stuttgart. O NOME continua "Stuttgart" porque é
    // ele que o card do Metabase devolve em dropOffWarehouse e é por ele que a fila casa
    // (matchesWarehouse) — renomear esvazia a fila deste balcão. Ver o comentário abaixo.
    "stuttgart": { name: "Stuttgart", city: "Jakob-Friedrich-Wanner-Straße 6 · 75428 Illingen", gpageId: "" },
    "amsterdam": { name: "Amsterdam", city: "Keienbergweg 20 · 1101 GB Amsterdam", gpageId: "" },
    // Mesmo caso: o galpão é em Mechelen, o nome continua "Antwerp" pelo casamento.
    "antwerp": { name: "Antwerp", city: "Kruisbaan 66B · 2800 Mechelen", gpageId: "" },
    "gennevilliers": { name: "Gennevilliers", city: "5 Rue Olympe de Gouges · 92230 Gennevilliers", gpageId: "" },
    // Mesmo caso: o galpão é em Redondo Beach.
    "losangeles": { name: "Los Angeles", city: "2400 Marine Ave · Redondo Beach, CA 90278", gpageId: "" },
    "newyork": { name: "New York", city: "134 Morgan Ave · Brooklyn, NY 11237", gpageId: "" }
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
