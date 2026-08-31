/**
 * ============================================================================
 * UPWAY DROP-OFF PORTAL — GATEWAY
 *
 * Unico caminho ate o Gateway Hub, e a normalizacao das linhas do card.
 *
 * Toda chamada ao hub passa por hubRequest(). Mexer em autenticacao ou em
 * tratamento de erro do gateway e aqui, e em nenhum outro lugar.
 * ============================================================================
 */


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


// Teto do CacheService: 100 KB por chave. 90 KB deixa folga para a chave-indice.
var CACHE_CHUNK = 90000;


/**
 * Grava um valor grande no CacheService em pedacos.
 *
 * O teto e 100 KB POR CHAVE e o put acima disso falha CALADO. Com o card grande isso
 * significava que o cache nunca ligava e toda abertura pagava a query inteira.
 *
 * A chave-indice guarda quantos pedacos existem. Se faltar qualquer um (eviccao
 * parcial), a leitura devolve null e vai a fonte — nunca um card truncado passando
 * por completo.
 */
function cachePutChunked(cache, key, raw, ttl) {
    const parts = {};
    const n = Math.ceil(raw.length / CACHE_CHUNK);
    for (let i = 0; i < n; i++) {
        parts[key + ':' + i] = raw.substring(i * CACHE_CHUNK, (i + 1) * CACHE_CHUNK);
    }
    parts[key] = String(n);
    cache.putAll(parts, ttl);
}


/** Remonta o valor de cachePutChunked, ou null se algum pedaço faltar. */
function cacheGetChunked(cache, key) {
    const n = parseInt(cache.get(key) || '0', 10);
    if (!n) return null;

    const keys = [];
    for (let i = 0; i < n; i++) keys.push(key + ':' + i);
    const parts = cache.getAll(keys);

    let raw = '';
    for (let i = 0; i < n; i++) {
        const part = parts[keys[i]];
        if (part === undefined || part === null) return null;
        raw += part;
    }
    return raw;
}


/**
 * Remove os triggers de um handler.
 *
 * Sem a remoção, rodar o instalador duas vezes deixa DOIS triggers do mesmo handler —
 * dobra de execuções, e no caso do refresh dobra de query no Metabase.
 */
function dropTriggers(handler) {
    ScriptApp.getProjectTriggers().forEach(t => {
        if (t.getHandlerFunction() === handler) ScriptApp.deleteTrigger(t);
    });
}


/** dropTriggers + o builder do novo, para quem instala UM trigger só. */
function replaceTrigger(handler) {
    dropTriggers(handler);
    return ScriptApp.newTrigger(handler).timeBased();
}


/** A única função que fala com o Metabase. Chamada pelo refreshSnapshot e pelos diagnósticos. */
function fetchHubDataUncached() {
    const r = hubRequest();

    if (r.exception) {
        return { error: `Network failure calling the Gateway: ${r.exception}` };
    }
    // 401/403 tem UMA causa só: o token que foi ao hub é de uma conta que o hub não
    // libera. Pela URL do web app isso não acontece — lá o script roda como o dono da
    // implantação (executeAs USER_DEPLOYING) e é o token DELE que vai. Pelo menu da
    // planilha o script roda sempre como o operador, e aí a conta dele precisaria de
    // acesso próprio ao hub. A mensagem aponta o caminho certo em vez de despejar a
    // página de erro do Google na tela.
    if (r.code === 401 || r.code === 403) {
        return {
            error: 'The Gateway denied access for ' + (operatorEmail() || 'this account') +
                ' (HTTP ' + r.code + '). Open the portal from the web app URL: there it runs as the ' +
                'deployment owner, who already has access to the hub. From the spreadsheet menu the ' +
                'script runs as your own account, which would need to be allowed in the Gateway Hub.'
        };
    }
    if (r.code < 200 || r.code >= 300) {
        // Corpo HTML é página de erro do Google: não jogar o markup na tela.
        const detail = looksLikeHtml(r.body) ? '(returned an HTML page)' : String(r.body).substring(0, 180);
        return { error: `The Gateway answered HTTP ${r.code}. ${detail}` };
    }
    if (looksLikeHtml(r.body)) {
        return { error: 'The Gateway returned an HTML login page instead of JSON: the account that opened this spreadsheet has no access to the hub deployment. Use "🔌 Test Gateway connection" in the menu to see the raw response.' };
    }

    let data;
    try {
        data = JSON.parse(r.body);
    } catch (e) {
        return { error: `The Gateway returned a non-JSON body: ${String(r.body).substring(0, 180)}` };
    }
    if (!data) return { error: 'The Gateway returned an empty body.' };
    if (data.error) return { error: `Gateway: ${data.error}` };
    return { data: data };
}


/**
 * Que chave da linha alimenta cada campo, resolvido UMA vez para o card inteiro.
 *
 * Antes isso era feito por linha e por campo, com um for-in em todas as chaves da linha e
 * um toLowerCase por comparação — O(linhas × campos × chaves). Como as chaves são as
 * mesmas em todas as linhas, era trabalho jogado fora em toda carga de tela.
 *
 * A amostra junta as 5 primeiras linhas: se a primeira vier sem uma coluna, o campo
 * inteiro sumiria de TODAS as linhas — silencioso, e num pipeline de documento legal.
 */
function resolveRowKeys(rows, fields) {
    const sample = {};
    for (let i = 0; i < rows.length && i < 5; i++) Object.assign(sample, rows[i]);
    const rowKeys = Object.keys(sample);

    const out = {};
    for (const field in fields) {
        const wanted = fields[field];
        out[field] = '';
        for (let t = 0; t < wanted.length && !out[field]; t++) {
            if (rowKeys.indexOf(wanted[t]) !== -1) { out[field] = wanted[t]; break; }
            const lower = wanted[t].toLowerCase();
            for (let i = 0; i < rowKeys.length; i++) {
                if (rowKeys[i].toLowerCase().indexOf(lower) !== -1) { out[field] = rowKeys[i]; break; }
            }
        }
    }
    return out;
}


/** Campos do portal e os nomes de coluna que os alimentam, em ordem de preferência. */
var ROW_FIELDS = {
    bikeId: ['bikeId', 'bike_id', 'id'],
    email: ['email'],
    brand: ['brand', 'make'],
    model: ['model'],
    mileageKm: ['mileageKm', 'mileage'],
    year: ['year'],
    quote: ['quote', 'estimatedPrice', 'price'],
    dropOffStartDate: ['dropOffStartDate', 'dropOffDate', 'logisticsId__dropOffStartDate'],
    dropOffWarehouse: ['dropOffWarehouse', 'warehouse', 'logisticsId__dropOffWarehouse'],
    firstName: ['firstName', 'pickupAddressId__firstName'],
    lastName: ['lastName', 'pickupAddressId__lastName']
};


/**
 * O card cru do hub virado em linhas com os nomes que o portal usa. null se o
 * formato nao for reconhecido.
 *
 * Duas formas chegam aqui: array de objetos (o export json do card) e o envelope
 * { data: { cols, rows } } do Metabase. As duas produzem a MESMA linha — e por isso
 * que o resto do codigo nunca precisa saber qual veio.
 */
function normalizeCardRows(dataObj) {
    if (!dataObj) return null;

    if (Array.isArray(dataObj)) {
        const keyOf = resolveRowKeys(dataObj, ROW_FIELDS);
        const get = (r, field) => {
            const k = keyOf[field];
            if (!k) return '';
            const v = r[k];
            return v === undefined || v === null ? '' : v;
        };

        return dataObj.map(r => ({
            bikeId: String(get(r, 'bikeId')).trim().toUpperCase(),
            email: String(get(r, 'email')).trim(),
            brand: String(get(r, 'brand')).trim(),
            model: String(get(r, 'model')).trim(),
            mileageKm: get(r, 'mileageKm'),
            year: String(get(r, 'year')).trim(),
            quote: get(r, 'quote'),
            dropOffStartDate: get(r, 'dropOffStartDate'),
            dropOffWarehouse: String(get(r, 'dropOffWarehouse')).trim().toLowerCase(),
            firstName: String(get(r, 'firstName')).trim(),
            lastName: String(get(r, 'lastName')).trim()
        }));
    }

    if (dataObj.data && dataObj.data.cols && dataObj.data.rows) {
        const rawCols = dataObj.data.cols.map(c => c.name);

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

        const idx = {};
        for (const field in ROW_FIELDS) idx[field] = findCol(ROW_FIELDS[field]);
        const at = (r, field) => (idx[field] !== -1 && r[idx[field]] !== undefined && r[idx[field]] !== null ? r[idx[field]] : '');

        return dataObj.data.rows.map(r => ({
            bikeId: String(at(r, 'bikeId')).trim().toUpperCase(),
            email: String(at(r, 'email')).trim(),
            brand: String(at(r, 'brand')).trim(),
            model: String(at(r, 'model')).trim(),
            mileageKm: at(r, 'mileageKm'),
            year: String(at(r, 'year')).trim(),
            quote: at(r, 'quote'),
            dropOffStartDate: at(r, 'dropOffStartDate'),
            dropOffWarehouse: String(at(r, 'dropOffWarehouse')).trim().toLowerCase(),
            firstName: String(at(r, 'firstName')).trim(),
            lastName: String(at(r, 'lastName')).trim()
        }));
    }

    return null;
}


/**
 * A linha normalizada como a FILA a mostra: nomes juntos, cotacao formatada, data ISO.
 *
 * Uma funcao so para os dois caminhos (getScheduleSnapshot e getMetabaseData). Com
 * duas copias, a fila do portal e a dos diagnosticos podiam divergir sem ninguem ver.
 */
function scheduleRow(row, bikeId, isProcessed) {
    const brand = row.brand || '';
    const model = row.model || '';
    const firstName = row.firstName || '';
    const lastName = row.lastName || '';

    // O card devolve número puro (1661). O handoff mostra "€ 1.890": separador
    // alemão e sem centavos — cotação é em euro inteiro.
    let quote = row.quote;
    if (quote !== '' && quote !== null && quote !== undefined && !isNaN(quote)) {
        quote = '€ ' + Math.round(parseFloat(quote)).toLocaleString('de-DE');
    } else {
        quote = quote ? '€ ' + quote : '€ --';
    }

    return {
        // Preenchido sob demanda pelo Reopen (getSavedSnapshot), nunca no payload da fila.
        saved: null,
        bikeId: bikeId,
        bikeName: (brand || model) ? (brand + ' ' + model).trim() : 'N/A',
        brand: brand,
        model: model,
        year: row.year || '',
        customerName: (firstName || lastName) ? (firstName + ' ' + lastName).trim() : 'Cliente',
        firstName: firstName,
        lastName: lastName,
        quote: quote,
        email: row.email || '',
        mileage: row.mileageKm !== undefined && row.mileageKm !== null ? String(row.mileageKm).trim() : '',
        dropOffDate: rowDateIso(row),
        warehouse: String(row.dropOffWarehouse || '').trim().toLowerCase(),
        isProcessed: isProcessed
    };
}


/**
 * A fila JA FILTRADA por armazem e periodo, montada no servidor.
 *
 * O portal nao usa mais este caminho — ele pega tudo de uma vez em
 * getScheduleSnapshot() e filtra no cliente. Continua aqui porque e o que os
 * diagnosticos do menu imprimem e o que o pipeline.test.mjs verifica: e a definicao
 * executavel de "quais linhas pertencem a esta fila".
 */
function getMetabaseData(params) {
    params = params || {};
    const config = getAppConfig();

    const selectedWarehouse = (params.warehouse || config.warehouse || CONFIG.DEFAULT_WAREHOUSE).toLowerCase();
    const dateFilter = params.dateFilter || 'today';
    const customStart = params.customStart;
    const customEnd = params.customEnd;

    // Gravar a preferência custa 5 idas ao PropertiesService (1 set + 4 deletes de
    // migração). Isso rodava em TODA carga de tela e TODA troca de armazém, para
    // reescrever o mesmo valor. Agora só quando o armazém realmente muda.
    if (selectedWarehouse !== config.warehouse) saveAppConfig(selectedWarehouse);

    const snap = loadSnapshot();
    if (snap.error) return { error: snap.error };
    const normalizedRows = snap.rows;

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

    const processed = readProcessedIds();

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

        // Reabrir um Beleg precisa carregar o que foi salvo, não os defaults do booking.
        // `saved` é preenchido depois do filtro, por attachSavedSnapshots: só as linhas
        // que a fila mostra precisam do snapshot, e ler os JSONs é a parte cara.
        filteredList.push(scheduleRow(row, bikeId, processed.has(bikeId)));
    }

    attachSavedSnapshots(filteredList);

    return {
        success: true,
        warehouse: selectedWarehouse,
        dateFilter: dateFilter,
        total: filteredList.length,
        rows: filteredList,
        summary: summary
    };
}
