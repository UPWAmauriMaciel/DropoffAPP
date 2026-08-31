/**
 * ============================================================================
 * UPWAY DROP-OFF PORTAL — SNAPSHOT
 *
 * O card do Metabase congelado num JSON no Drive, e quem o atualiza.
 *
 * Fora daqui NINGUEM chama o hub. O portal le sempre este snapshot: trocar de
 * armazem, de periodo ou reabrir a tela nao gera query no Metabase.
 * ============================================================================
 */


var SNAPSHOT_FOLDER = '_snapshot';
var SNAPSHOT_FILE = 'card-' + CONFIG.CARD_ID + '.json';

var SNAPSHOT_CACHE_KEY = 'dropoff_snapshot_v1';
// 6h e o teto do CacheService. O Drive e a fonte de verdade; o cache so evita
// reler e reparsear o arquivo a cada abertura de portal — com varios balcoes
// abrindo de manha isso e a diferenca entre uma leitura do Drive e dez.
var SNAPSHOT_CACHE_TTL = 21600;

// Os dois refreshes do dia. O segundo e 4h depois do primeiro.
var REFRESH_HOURS = [8, 12];


function snapshotFolder() {
    return getOrCreateSubFolder(getDriveFolder(CONFIG.SHARED_DRIVE_FOLDER_ID), SNAPSHOT_FOLDER);
}


function snapshotFile() {
    const it = snapshotFolder().getFilesByName(SNAPSHOT_FILE);
    return it.hasNext() ? it.next() : null;
}


/**
 * O snapshot gravado, do cache ou do Drive. null se nao existir nenhum.
 *
 * NAO cai para busca ao vivo de proposito: quem precisa desse degrau e o
 * loadSnapshot(). Separado, refreshSnapshot() pode consultar o que ja existe sem
 * risco de chamar a si mesmo.
 */
function readStoredSnapshot() {
    const cache = CacheService.getScriptCache();

    const hit = cacheGetChunked(cache, SNAPSHOT_CACHE_KEY);
    if (hit) {
        try { return JSON.parse(hit); } catch (e) { cache.remove(SNAPSHOT_CACHE_KEY); }
    }

    try {
        const file = snapshotFile();
        if (!file) return null;

        const raw = file.getBlob().getDataAsString();
        const snap = JSON.parse(raw);
        if (!snap || !snap.rows) return null;

        cachePutChunked(cache, SNAPSHOT_CACHE_KEY, raw, SNAPSHOT_CACHE_TTL);
        return snap;
    } catch (e) {
        // Arquivo ilegivel ou Drive fora: tratado como "nao existe snapshot", que leva
        // a uma busca ao vivo. Nunca devolver meio card.
        console.warn('snapshot ilegivel: ' + (e.message || e));
        return null;
    }
}


/**
 * Vai ao Metabase e sobrescreve o snapshot. Chamado pelos dois triggers do dia e
 * pelo botao Update do portal — e por mais ninguem.
 *
 * Gateway fora NAO apaga o snapshot bom: devolve o erro e deixa o arquivo como
 * esta. Dado de 4h atras vale mais que uma fila vazia com o cliente no balcao.
 */
function refreshSnapshot() {
    const lock = LockService.getScriptLock();
    // Dois balcoes apertando Update ao mesmo tempo escreveriam o mesmo arquivo em
    // paralelo. Quem perder a corrida le o que o outro acabou de gravar.
    if (!lock.tryLock(15000)) {
        return readStoredSnapshot() || { error: 'Another refresh is running. Try again in a moment.' };
    }

    try {
        const fresh = fetchHubDataUncached();
        if (fresh.error) return { error: fresh.error };

        const rows = normalizeCardRows(fresh.data);
        if (!rows) return { error: 'Unrecognised data format from the Gateway Hub.' };

        const snap = {
            refreshedAt: new Date().toISOString(),
            cardId: CONFIG.CARD_ID,
            rowCount: rows.length,
            rows: rows
        };
        const raw = JSON.stringify(snap);

        // setContent mantem o mesmo file ID e empurra a versao anterior para o
        // historico de revisoes do Drive — da para auditar o que a query devolveu em
        // qualquer dia sem guardar um arquivo por execucao.
        const existing = snapshotFile();
        if (existing) existing.setContent(raw);
        else snapshotFolder().createFile(SNAPSHOT_FILE, raw, 'application/json');

        cachePutChunked(CacheService.getScriptCache(), SNAPSHOT_CACHE_KEY, raw, SNAPSHOT_CACHE_TTL);
        return snap;
    } finally {
        lock.releaseLock();
    }
}


/**
 * O snapshot atual: cache -> Drive -> busca ao vivo.
 *
 * O ultimo degrau existe para a primeira execucao e para o dia em que alguem apagar
 * a pasta. Sem ele o balcao abriria com a fila vazia e sem explicacao.
 */
function loadSnapshot() {
    return readStoredSnapshot() || refreshSnapshot();
}


/**
 * Ponto de entrada do portal: TUDO que a fila precisa, numa chamada so.
 *
 * Manda o card inteiro (todos os armazens, todas as datas) porque o filtro passou a
 * ser do cliente — trocar de armazem ou de periodo deixou de custar round trip.
 *
 * O que NAO vai junto e o snapshot do formulario das linhas arquivadas: e o pedaco
 * pesado, cresce com a aba para sempre, e so importa quando o operador reabre AQUELA
 * linha. Esse vem sob demanda, em getSavedSnapshot().
 */
function getScheduleSnapshot() {
    const snap = loadSnapshot();
    if (snap.error) return { error: snap.error };

    const processed = readProcessedIds();
    const rows = [];

    for (let i = 0; i < snap.rows.length; i++) {
        const bikeId = snap.rows[i].bikeId || ('ROW-' + (i + 1));
        if (!bikeId || bikeId === 'N/A') continue;
        rows.push(scheduleRow(snap.rows[i], bikeId, processed.has(bikeId)));
    }

    return {
        success: true,
        refreshedAt: snap.refreshedAt || '',
        total: rows.length,
        rows: rows
    };
}


/** O que o botao Update do portal chama: atualiza e devolve a fila nova. */
function refreshScheduleSnapshot() {
    const snap = refreshSnapshot();
    if (snap.error) return { error: snap.error };
    return getScheduleSnapshot();
}


/**
 * O que os dois triggers diarios chamam.
 *
 * A guarda de dia util fica AQUI e nao no trigger: seg-sex x 2 horarios via
 * onWeekDay() seriam 10 triggers contra a cota de 20 por script. Dois triggers
 * diarios mais este if custam 8 slots a menos.
 *
 * getDay() usa o fuso do manifesto (Europe/Berlin), que e o do balcao.
 */
function scheduledRefresh() {
    const day = new Date().getDay();
    if (day === 0 || day === 6) return { skipped: 'weekend' };

    const snap = refreshSnapshot();
    if (snap.error) console.warn('scheduledRefresh: ' + snap.error);
    return snap;
}


/**
 * Instala os dois refreshes diarios. Rodar UMA vez, do editor, com a conta DONA da
 * implantacao — e o token dela que o hub libera.
 *
 * nearMinute(3) NAO garante 08:03: a janela do Apps Script e de ~15 min, entao na
 * pratica cai entre ~07:55 e ~08:10. Se o balcao abrir 08:00 em ponto, baixar
 * REFRESH_HOURS para [7, 11] compra a folga.
 */
function installRefreshTriggers() {
    dropTriggers('scheduledRefresh');
    REFRESH_HOURS.forEach(h =>
        ScriptApp.newTrigger('scheduledRefresh').timeBased().everyDays(1).atHour(h).nearMinute(3).create());
    return 'trigger scheduledRefresh instalado (' + REFRESH_HOURS.join('h e ') + 'h, seg-sex)';
}


/**
 * Idade do snapshot em texto, para o diagnóstico do menu e para o tooltip do botão
 * Update. '' quando nunca houve refresh — o portal trata isso como "desconhecido".
 */
function snapshotAge() {
    const snap = readStoredSnapshot();
    if (!snap || !snap.refreshedAt) return 'nenhum (a próxima abertura busca ao vivo)';

    const at = new Date(snap.refreshedAt);
    const horas = (Date.now() - at.getTime()) / 3600000;
    return snap.rowCount + ' linha(s), de ' + formatDateGerman(at) + ' ' + formatTimeGerman(at) +
        ' (' + horas.toFixed(1) + 'h atrás)';
}
