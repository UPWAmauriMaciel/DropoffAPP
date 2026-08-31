/**
 * ============================================================================
 * UPWAY DROP-OFF PORTAL — PORTAL
 *
 * Pontos de entrada: menu da planilha, web app e servico do HTML.
 *
 * O portal e servido como arquivo ESTATICO, sem avaliacao de template — ver o
 * comentario em renderPortal() para o motivo.
 * ============================================================================
 */


/**
 * Standalone Web App Entry Point
 */
function doGet(e) {
    // O favicon vem daqui, não de um <link rel="icon"> no HTML: o portal é servido dentro
    // do iframe do sandbox do Apps Script, e quem controla o ícone da ABA é o container.
    return withFavicon(renderPortal().setTitle('Dropoff Upway'))
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


/**
 * Aplica o favicon sem poder derrubar o portal.
 *
 * setFaviconUrl LANÇA quando o Google não aceita o tipo da imagem ("The favicon icon image
 * type is not supported") — foi o que um data URI de SVG causou aqui. Como a chamada mora
 * dentro do doGet, um ícone recusado deixava o balcão sem portal NENHUM. Um enfeite não
 * pode ter esse poder.
 *
 * Tenta as URLs em ordem e para na primeira aceita. Se nenhuma passar, a aba fica com o
 * ícone padrão do Google — exatamente o que havia antes de existir favicon aqui.
 */
function withFavicon(out) {
    for (var i = 0; i < FAVICON_URLS.length; i++) {
        try {
            return out.setFaviconUrl(FAVICON_URLS[i]);
        } catch (e) {
            console.warn('favicon recusado (' + FAVICON_URLS[i] + '): ' + (e.message || e));
        }
    }
    return out;
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
        .addItem('🚀 Open Check-in Portal', 'showCheckinPortal')
        .addSeparator()
        .addItem('🔄 Update the schedule now', 'refreshSnapshot')
        .addSeparator()
        .addItem('🔌 Test Gateway connection', 'diagnoseGateway')
        .addItem('🔎 Inspect card rows', 'diagnoseRows')
        .addItem('⏱️ Time the queue load', 'diagnoseSnapshotTiming')
        .addItem('🧹 Reset sheet formatting', 'resetSheetFormatting')
        .addItem('⏰ Install the daily refreshes', 'installRefreshTriggers')
        .addToUi();
}


/**
 * Displays the main HTML Portal Modal Dialog scaled to user screen
 */
function showCheckinPortal() {
    const html = renderPortal()
        .setWidth(1400)
        .setHeight(880)
        .setTitle('Dropoff Upway');
    SpreadsheetApp.getUi().showModalDialog(html, 'Dropoff Upway');
}


/**
 * Último armazém escolhido, POR OPERADOR.
 *
 * Ficava em ScriptProperties, que é um valor único para o script inteiro: com Berlim e
 * Düsseldorf abertos ao mesmo tempo, cada carga sobrescrevia a escolha do outro balcão.
 * UserProperties é por conta, que é a granularidade certa para uma preferência de tela.
 */
function getAppConfig() {
    const userProps = PropertiesService.getUserProperties();

    return {
        warehouse: userProps.getProperty('WAREHOUSE') || CONFIG.DEFAULT_WAREHOUSE,
        driveFolderId: CONFIG.SHARED_DRIVE_FOLDER_ID
    };
}


/**
 * Saves application configuration (só o armazém — a pasta do Drive é constante)
 */
function saveAppConfig(warehouse) {
    const userProps = PropertiesService.getUserProperties();
    if (warehouse) userProps.setProperty('WAREHOUSE', warehouse.toLowerCase());

    // Limpa o que versões anteriores gravaram: o ID de pasta do Drive vencia a constante
    // e mandava PDF para o lugar errado; o WAREHOUSE global era o valor compartilhado.
    const props = PropertiesService.getScriptProperties();
    props.deleteProperty('DRIVE_FOLDER');
    props.deleteProperty('WAREHOUSE');
    userProps.deleteProperty('DRIVE_FOLDER');
    return true;
}
