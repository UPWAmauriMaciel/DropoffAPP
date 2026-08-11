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
