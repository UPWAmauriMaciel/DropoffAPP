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


var PROCESSED_CACHE_KEY = 'dropoff_processed_v1';
var PROCESSED_CACHE_TTL = 300;


/**
 * A aba e as colunas que o portal usa, com UMA leitura do cabeçalho.
 *
 * Sem fallback para getActiveSheet(): se a aba não existe, nada está arquivado — ler
 * uma aba qualquer marcava linhas como processadas por acidente.
 */
function dropoffSheetInfo() {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sheet) return null;

    const lastRow = sheet.getLastRow();
    const lastCol = sheet.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return null;

    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).toLowerCase().trim());
    let idIdx = headers.indexOf('bike id');
    if (idIdx === -1) idIdx = headers.indexOf('id');
    if (idIdx === -1) idIdx = 1;

    // 1-based, como getRange espera. Coluna 0 significa "a aba não tem essa coluna".
    return {
        sheet: sheet,
        lastRow: lastRow,
        idCol: idIdx + 1,
        snapCol: headers.indexOf('snapshot (json)') + 1,
        stampCol: headers.indexOf('processado em') + 1
    };
}


/**
 * Bike IDs já arquivados, do cache quando possível.
 *
 * Era getDataRange().getValues() da aba INTEIRA — o que arrasta o Snapshot (um JSON de
 * formulário por linha) e fazia um JSON.parse por linha arquivada, em toda carga de tela e
 * toda troca de armazém, com custo crescendo para sempre. Aqui só a coluna do ID; o
 * snapshot vem depois, e só das linhas que a fila vai mostrar (attachSavedSnapshots).
 *
 * O cache é invalidado na gravação, então um Beleg recém-arquivado aparece na hora.
 * cachePutChunked vive no Gateway.gs — no Apps Script todos os arquivos compartilham o
 * mesmo escopo global.
 */
function readProcessedIds() {
    const cache = CacheService.getScriptCache();

    const hit = cacheGetChunked(cache, PROCESSED_CACHE_KEY);
    if (hit) {
        try { return new Set(JSON.parse(hit)); } catch (e) { cache.remove(PROCESSED_CACHE_KEY); }
    }

    const ids = readProcessedIdsUncached();
    cachePutChunked(cache, PROCESSED_CACHE_KEY, JSON.stringify(ids), PROCESSED_CACHE_TTL);
    return new Set(ids);
}


function readProcessedIdsUncached() {
    const out = [];
    try {
        const info = dropoffSheetInfo();
        if (!info) return out;

        const vals = info.sheet.getRange(2, info.idCol, info.lastRow - 1, 1).getValues();
        for (let i = 0; i < vals.length; i++) {
            const v = String(vals[i][0] || '').trim().toUpperCase();
            if (v) out.push(v);
        }
    } catch (e) {
        // Aba ilegível: "nada arquivado" é a leitura segura. O contrário marcaria
        // drop-offs como já processados por acidente.
    }
    return out;
}


/**
 * Preenche `saved` (o snapshot do formulário, para o Reopen restaurar) nas linhas já
 * arquivadas que a fila vai mostrar. Muta as linhas recebidas.
 *
 * O JSON.parse acontece só nessas linhas — antes era em toda linha da aba, sempre.
 *
 * ponytail: a leitura da coluna Snapshot ainda traz a coluna toda; se a aba passar de
 * alguns milhares de linhas, paginar por faixa de linha ou mover o snapshot para uma aba
 * própria indexada por Bike ID.
 */
function attachSavedSnapshots(rows) {
    const wantedAt = {};
    let any = false;
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].isProcessed) { wantedAt[rows[i].bikeId] = i; any = true; }
    }
    if (!any) return;

    try {
        const info = dropoffSheetInfo();
        if (!info || !info.snapCol) return;

        const n = info.lastRow - 1;
        const ids = info.sheet.getRange(2, info.idCol, n, 1).getValues();
        const snaps = info.sheet.getRange(2, info.snapCol, n, 1).getValues();

        for (let i = 0; i < n; i++) {
            const id = String(ids[i][0] || '').trim().toUpperCase();
            const at = wantedAt[id];
            if (at === undefined) continue;

            const raw = String(snaps[i][0] || '').trim();
            if (!raw) continue;
            try { rows[at].saved = JSON.parse(raw); } catch (e) { /* snapshot corrompido: ignora */ }
        }
    } catch (e) {
        // Sem snapshot o Reopen cai nos dados do booking — degradação visível, não perda.
    }
}


/**
 * Logs or updates drop-off record in 'Drop-offs' sheet tab
 */
function logDropoffToSheet(data) {
    // Ler a planilha, decidir a linha e só então escrever é read-modify-write. Com dois
    // balcões arquivando ao mesmo tempo, a linha alvo pode mudar entre a leitura e a
    // escrita e o setValues sobrescreve o registro de OUTRO drop-off. Num log com valor
    // de auditoria isso é perda de dado, não corrida benigna.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
        throw new Error('The sheet is busy with another counter. The PDF is already in Drive — try "Save to Drive & close" again in a few seconds.');
    }
    try {
        writeDropoffRow(data);
    } finally {
        lock.releaseLock();
        // Sem isto, o Bike ID recém-arquivado só apareceria como processado quando o cache
        // vencesse — e outro balcão veria a linha ainda pendente por até 5 min.
        CacheService.getScriptCache().remove(PROCESSED_CACHE_KEY);
    }
}

/** Corpo da gravação. Só chamar com o lock de logDropoffToSheet em mãos. */
function writeDropoffRow(data) {
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


// ============================================================================
// GARBAGE COLLECTOR
// ============================================================================

var GC_SNAPSHOT_DAYS = 30;


/**
 * 'Processado Em' pode voltar como Date (o Sheets coage o texto conforme a locale) ou
 * como a string 'DD.MM.YYYY HH:MM' que writeDropoffRow grava. Trata os dois.
 * null = não deu para interpretar, e aí a linha NÃO é tocada.
 */
function parseSheetStamp(v) {
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
    const m = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(String(v || '').trim());
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isNaN(d.getTime()) ? null : d.getTime();
}


/**
 * Poda a aba 'Drop-offs'. Alvo do trigger de installGcTrigger().
 *
 * NÃO apaga linha, de propósito: o Beleg é documento legal e esta aba é a trilha de
 * auditoria — data, Bike ID, operador e o link do PDF no Drive. O que cresce sem teto é o
 * Snapshot (JSON), um blob de formulário por linha, e ele existe só para o Reopen
 * restaurar os valores salvos. Um drop-off de mês passado não vai ser reaberto, então o
 * snapshot vence muito antes da linha.
 *
 * Degrada exatamente como o código já espera: attachSavedSnapshots pula célula vazia e o
 * portal cai nos dados do booking quando `saved` é null.
 *
 * Pega o mesmo lock de logDropoffToSheet: sem ele, uma poda no meio de um arquivamento
 * sobrescreveria a coluna com a versão lida antes da gravação do operador.
 */
function collectSheetGarbage() {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
        console.warn('collectSheetGarbage: aba ocupada, nada podado nesta rodada');
        return { cleared: 0, skipped: true };
    }
    try {
        return pruneSnapshots(GC_SNAPSHOT_DAYS);
    } finally {
        lock.releaseLock();
    }
}


/** Corpo da poda. Só chamar com o lock em mãos. Uma leitura e no máximo uma escrita. */
function pruneSnapshots(days) {
    const info = dropoffSheetInfo();
    if (!info || !info.snapCol || !info.stampCol) return { cleared: 0, rows: 0 };

    const n = info.lastRow - 1;
    const snapRange = info.sheet.getRange(2, info.snapCol, n, 1);
    const snaps = snapRange.getValues();
    const stamps = info.sheet.getRange(2, info.stampCol, n, 1).getValues();

    const cutoff = new Date().getTime() - days * 86400000;
    let cleared = 0;

    for (let i = 0; i < n; i++) {
        if (!String(snaps[i][0] || '').trim()) continue;
        const t = parseSheetStamp(stamps[i][0]);
        // Data ilegível: deixa quieto. Apagar por não ter entendido a data é perda de dado
        // disfarçada de faxina.
        if (t === null || t >= cutoff) continue;
        snaps[i][0] = '';
        cleared++;
    }

    if (cleared) snapRange.setValues(snaps);
    console.log('collectSheetGarbage: ' + cleared + ' snapshot(s) podado(s) de ' + n + ' linha(s)');
    return { cleared: cleared, rows: n };
}


/**
 * Instala o trigger da poda. Rodar UMA vez, do editor. Idempotente.
 * 4h no fuso do projeto: fora do horário de balcão, sem disputar o lock com ninguém.
 */
function installGcTrigger() {
    replaceTrigger('collectSheetGarbage').everyDays(2).atHour(4).create();
    return 'trigger collectSheetGarbage instalado (a cada 2 dias, ~4h)';
}


function resetSheetFormatting() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getActiveSheet();
    sheet.getDataRange().setBackground('#ffffff').setFontColor('#000000').setFontLine('none');
    SpreadsheetApp.getUi().alert(`Formatting of sheet "${sheet.getName()}" has been reset.`);
}
