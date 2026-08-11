/**
 * ============================================================================
 * UPWAY DROP-OFF PORTAL — DIAGNOSTICS
 *
 * Diagnosticos rodaveis, do menu ou do editor.
 *
 * Existem porque as falhas que mais custaram tempo neste projeto eram silenciosas:
 * gateway devolvendo pagina de login, fila vazia por filtro, e HTML servido
 * diferente do arquivo em disco.
 * ============================================================================
 */


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
