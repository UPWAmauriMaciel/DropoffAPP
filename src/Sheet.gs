/**
 * ============================================================================
 * UPWAY DROP-OFF PORTAL — SHEET
 *
 * Aba "Drop-offs": o que ja foi arquivado e o snapshot para reabrir.
 *
 * Coluna nova entra sempre no FIM — inserir no meio desalinha o snapshot das
 * linhas antigas e o Reopen passa a restaurar o registro errado.
 * ============================================================================
 */


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


function resetSheetFormatting() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    sheet.getDataRange().setBackground('#ffffff').setFontColor('#000000').setFontLine('none');
    SpreadsheetApp.getUi().alert(`Formatação da aba "${sheet.getName()}" resetada.`);
}
