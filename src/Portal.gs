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
