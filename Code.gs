/**
 * ============================================================================
 * UPWAY DROP-OFF PORTAL & EINLIEFERUNGSBELEG GENERATOR
 * Google Sheets + Google Apps Script + Gateway Metabase Integration (Card 10495)
 * ============================================================================
 */

var CONFIG = {
    DEFAULT_WAREHOUSE: "berlin",
    SHARED_DRIVE_FOLDER_ID: "0ANYmDZGm4zE9Uk9PVA",
    HUB_URL: "https://script.google.com/a/macros/upway.shop/s/AKfycbzhXONZmHG7eueCCWoYCJbrdvkGGkk0hEcAHRrtSsKyYXH6f6FI-h5BhuW-H6bPq72Q/exec",
    CARD_ID: 10495
};

var WAREHOUSES = [
    "berlin", "amsterdam", "antwerp", "dusseldorf",
    "gennevilliers", "losangeles", "newyork", "paris", "stuttgart"
];

/**
 * Standalone Web App Entry Point
 */
function doGet(e) {
    return HtmlService.createHtmlOutputFromFile('CheckinPortal')
        .setTitle('🏷️ Upway Drop-off Portal')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Creates custom menu in Google Sheets UI
 */
function onOpen() {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu('🏷️ Upway Drop-off')
        .addItem('🚀 Abrir Portal Check-in', 'showCheckinPortal')
        .addSeparator()
        .addItem('🧹 Resetar Formatação da Aba', 'resetSheetFormatting')
        .addToUi();
}

/**
 * Displays the main HTML Portal Modal Dialog scaled to user screen
 */
function showCheckinPortal() {
    const html = HtmlService.createHtmlOutputFromFile('CheckinPortal')
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
        driveFolderId: props.getProperty('DRIVE_FOLDER') || userProps.getProperty('DRIVE_FOLDER') || CONFIG.SHARED_DRIVE_FOLDER_ID
    };
}

/**
 * Saves application configuration
 */
function saveAppConfig(warehouse, driveFolder) {
    const props = PropertiesService.getScriptProperties();
    if (warehouse) props.setProperty('WAREHOUSE', warehouse.toLowerCase());
    if (driveFolder) props.setProperty('DRIVE_FOLDER', driveFolder);
    return true;
}

/**
 * Fetches drop-off bike records from Metabase via Gateway Hub (No password needed!)
 * Uses universal parser supporting flat JSON arrays, Metabase data.rows, and CSV.
 */
function getMetabaseData(params) {
    params = params || {};
    const config = getAppConfig();
    
    const selectedWarehouse = (params.warehouse || config.warehouse || 'berlin').toLowerCase();
    const dateFilter = params.dateFilter || 'today';
    const customStart = params.customStart;
    const customEnd = params.customEnd;

    try {
        saveAppConfig(selectedWarehouse, config.driveFolderId);

        // Fetch Metabase Card 10495 data via Gateway Hub
        const hubResp = UrlFetchApp.fetch(CONFIG.HUB_URL, {
            method: 'post',
            contentType: 'application/json',
            payload: JSON.stringify({
                service: 'metabase',
                card_id: CONFIG.CARD_ID,
                export_format: 'json'
            }),
            muteHttpExceptions: true
        });

        const code = hubResp.getResponseCode();
        const responseText = hubResp.getContentText();

        if (code < 200 || code >= 300) {
            return { error: `Erro no Gateway Hub (HTTP ${code}): ${responseText}` };
        }

        let dataObj;
        try {
            dataObj = JSON.parse(responseText);
        } catch (e) {
            return { error: `Resposta inválida do Gateway Hub: ${responseText.substring(0, 300)}` };
        }

        if (dataObj.error) {
            return { error: `Erro retornado pelo Gateway: ${dataObj.error}` };
        }

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
            return { error: "Formato de dados não reconhecido do Metabase." };
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

        const processedSet = getProcessedBikeIdsFromSheet();

        const filteredList = [];
        for (let i = 0; i < normalizedRows.length; i++) {
            const row = normalizedRows[i];
            const whVal = row.dropOffWarehouse || '';

            if (whVal && whVal !== selectedWarehouse) {
                continue;
            }

            let dateValStr = '';
            if (row.dropOffStartDate) {
                dateValStr = formatDateISO(new Date(row.dropOffStartDate));
                if (dateValStr === '2000-01-01') continue;
                if (dateFilter !== 'all') {
                    if (dateValStr < startDateStr || dateValStr > endDateStr) {
                        continue;
                    }
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

            let quoteVal = row.quote || '';
            if (quoteVal && !isNaN(quoteVal)) {
                quoteVal = `€ ${parseFloat(quoteVal).toFixed(2)}`;
            } else {
                quoteVal = quoteVal ? `€ ${quoteVal}` : '€ --';
            }

            const emailVal = row.email || '';
            const mileageVal = row.mileageKm !== undefined && row.mileageKm !== null ? String(row.mileageKm).trim() : '';

            const isProcessed = processedSet.has(bikeId);

            filteredList.push({
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
            rows: filteredList
        };

    } catch (err) {
        return { error: `Exceção ao comunicar com o Gateway: ${err.message || err}` };
    }
}

/**
 * Reads bike IDs already logged in active Google Sheet
 */
function getProcessedBikeIdsFromSheet() {
    const set = new Set();
    try {
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        const sheet = ss.getSheetByName('Drop-offs') || ss.getActiveSheet();
        const data = sheet.getDataRange().getValues();
        if (data.length <= 1) return set;

        const headers = data[0].map(h => String(h).toLowerCase().trim());
        let bikeColIdx = headers.indexOf('bike id');
        if (bikeColIdx === -1) bikeColIdx = headers.indexOf('id');
        if (bikeColIdx === -1) bikeColIdx = 1;

        for (let i = 1; i < data.length; i++) {
            const val = String(data[i][bikeColIdx] || '').trim().toUpperCase();
            if (val) set.add(val);
        }
    } catch (e) {
        // Ignore read errors
    }
    return set;
}

/**
 * Generates 1:1 Einlieferungsbeleg PDF matched 100% to upway_einlieferungsbeleg_berlin design
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

    const pdfBlob = Utilities.newBlob(htmlContent, 'text/html', `${bikeId}.html`)
        .getAs('application/pdf')
        .setName(`${bikeId} UPWAY ${warehouse.toUpperCase()} - EINLIEFERUNGSBELEG (DROP-OFF).pdf`);

    const rootFolder = getDriveFolder(config.driveFolderId);
    const now = new Date();
    const yearFolder = getOrCreateSubFolder(rootFolder, String(now.getFullYear()));
    const dayFolderName = `${padZero(now.getDate())}.${padZero(now.getMonth() + 1)}`;
    const targetFolder = getOrCreateSubFolder(yearFolder, dayFolderName);

    const fileName = `${bikeId} UPWAY ${warehouse.toUpperCase()} - EINLIEFERUNGSBELEG (DROP-OFF).pdf`;
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
        datum: datum
    });

    return {
        success: true,
        bikeId: bikeId,
        fileName: fileName,
        pdfUrl: fileUrl,
        folderPath: `${now.getFullYear()} > ${dayFolderName}`
    };
}

/**
 * Logs or updates drop-off record in 'Drop-offs' sheet tab
 */
function logDropoffToSheet(data) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName('Drop-offs');
    
    if (!sheet) {
        sheet = ss.insertSheet('Drop-offs');
        sheet.appendRow([
            'Data', 'Bike ID', 'Vendedor / Cliente', 'Modelo da Bike', 
            'Quilometragem', 'Zubehör (Acessórios)', 'Notizen / Danos', 
            'PDF Document (Google Drive)', 'Processado Em'
        ]);
        sheet.getRange(1, 1, 1, 9).setFontWeight('bold').setBackground('#f3f4f6');
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
        nowStr
    ];

    if (targetRowIndex > 0) {
        sheet.getRange(targetRowIndex, 1, 1, 9).setValues([rowValues]);
    } else {
        sheet.appendRow(rowValues);
    }
}

/**
 * Generates 1:1 Einlieferungsbeleg HTML matched 100% to upway_einlieferungsbeleg_berlin design
 */
function generateEinlieferungsbelegHTML(d) {
    const warehouseUpper = (d.warehouse || 'BERLIN').toUpperCase();
    
    const LOGO_BASE64 = "data:image/png;base64,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TF657LMONf7VnXcAs6J78sSc1ff+5xqMi4iIiIiIiIiIiGTcsoXelsDncV2yOQWjO6usufe/oMG4iIiIiIiIiIiISEadtdCPTku8zZ2XAKXonlwyLhu4wu6897+kwbiIiIiIiIiIiIhIxixb5AuSKq+uGs/HtTZlWpxV9/+XNBgXERERERERERERyYAzT/FDZ42yHOOfPOV0LLqoQTgX3P9f0mBcREREREREREREJED3cd7ic2n1hNMMzvIqT3TTzHYmmTHYW7Fr7/+v679kERERERERERGRGutc4g/wYY6J7pD6K5WYk1Y5wIy57hzsxjE4xxgcmxonA80AHtzZqFLn2+P96xqMi4iIiIiIiIiI1JgP023G16I7pP7SFLDdg29jbDuKVqTUizelrBzv30jqXSIiIiIiIiIiIiIiUnPGz1dtshvH+7c0GBcRERERERERERGRRvT5vf0bGoyLiIiIiIiIiIiISKO5s9m5YG//pgbjIiIiIiIiIiIiItJovnxhxXbs7d/UYFxEREREREREREREGorb3teogAbjIiIiIiIiIiIiItJADH7SP2i/nOiv0WBcRERERERERERERBqH8759/SVN9egQEREREREREREREak1h6v7hujf11+nE+MiIiIiIiIiIiIi0hAS531gvs+/rh4xIiIiIiIiIiIiIiI1dsOtxrcn8xdqlYqIiIiIiIiIiIiI5J/zrsqQ7ZrMX6oT4yIiIiIiIiIiIiKSd78dnsdXJ/sXazAuIiIiIiIiIiIiIrnmztsHBmx0sn+9BuMiIiIiIiIiIiIikmdXnTbEyv35GzQYFxEREREREREREZHcSuHNK7B0f/4eDcZFREREREREREREJJ+M762pWP/+/m0ajIuIiIiIiIiIiIhIHu30hDdN5W/UYFxERERERERERERE8uj9/Rvsd1P5GzUYFxEREREREREREZG8ua4Z/meqf7MG4yIiIiIiIiIiIiKSJ07Cyy+s2I6pvoAG4yIiIiIiIiIiIiKSG2Z8rm+jrZ3Oa2gwLiIiIiIiIiIiIiJ58afSMG+Z7otoMC4iIiIiIiIiIiIieeBuvOSiq+2O6b6QBuMiIiIiIiIiIiIikn3GR/sHbfVMvJQG4yIiIiIiIiIiIiKSdb8cnsNbZ+rFNBgXERERERERERERkSzbUXWeOTBgO2fqBTUYFxEREREREREREZHsMl6xdsh+NZMvqcG4iIiIiIiIiIiIiGSSwcf7Bu0rM/26TTP9giIiIiIiIiIiIiIi0+ZcNneYN9XipXViXEREREREREREREQyxeGPpRJPX7nZRmrx+hqMi4iIiIiIiIiIiEiWbC8Zy1dttFtq9QANxkVEREREREREREQkK6pmnLd60DbV8iEajIuIiIiIiIiIiIhIJhi8pnfQflTr52gwLiIiIiIiIiIiIiJZ8K7ein2yHg9qqsdDRERERERERERERET2xuFj/RV7R72ep8G4iIiIiIiIiIiIiMRxvtA/xOvq+UitUhERERERERERERGRGM5Xlwzxz2Bez8dqMC4iIiIiIiIiIiIidWfw5XnH8qIVWFrvZ2swLiIiIiIiIiIiIiJ15fDJUyu8eOVKq0Y8XzvGRURERERERERERKSe3ttfsbf0BwZoMC4iIiIiIiIiIiIi9ZC68ab+QftwdIgG4yIiIiIiIiIiIiJSazvdeFH/oH0rOgQ0GBcRERERERERERGR2rrFEs7t22gbo0PuocG4iIiIiIiIiIiIiNTKlVU4d+1Guyk65N6S6AARERERERERERERaTwGX/ddnL62kq2hOOjEuIiIiIiIiIiIiIjMrGHg/N6KfTQ6ZG80GBcRERERERERERGRmXIDxrP6Bm1DdMhEtEpFRERERERERERERGbCyqYRWrM+FAedGBcRkf/fvr2rRqGFYRj+1oy4QYjeg3gPXtFGEBtLb0CwU2xUsFJQnFIwGVEIuEWMZjxtd6OIaBEjjudDjGaW3cZCxMTDmkyep17FW3/8CwAAAODnvCo1e2YG5WTrkB9lGAcAAAAAYK36tZO/+9fK49Yhq2EYBwAAAABgtZ7Xmn3nB+VY65C1MIwDAAAAALAavc3J7rOD8qx1yFoZxgEAAAAA+BHzqdnbH5RLrUN+Vqd1AAAAAAAAY22h1uzauj07J2EUT1yMAwAAAADwbW9qcmh5KQdm75a3GbTO+XUM4wAAAAAAfO1dTY6vbMr+i1fLYuuY38EwDgAAAABAkrxLcrR+yoHzt8vT1jG/k2EcAAAAAGBjWywlRz51cvjiXBm2jvkTDOMAAAAAABvTzZoc3LaUU727Zbl1zJ9kGAcAAAAA2Dhel5LTqTkxM1/+aR3TimEcAAAAAGCyraRkttac+Cvpnb1e3rcOas0wDgAAAAAweUYluVKTXpIz/etloXXQODGMAwAAAABMhudJLqRmptvN9Llr5UnroHFlGAcAAAAAWJ/elmQuJZeykv7Ujsz1emWlddR6YBgHAAAAABh/n5PcqzW3OiVXRjWXl7fm1uxs+fz/ixvt4tYbwzgAAAAAwPgYJnmYmoe1kwcl+beT3MnL/Dd9v3xsHTcpDOPAqkxNpeZN5lt3jJvRlvimBAAAwPcspOZC6wgaKXmRJKlZKp18qDUfkgxLMhzVDDs1z0bdLHa7eTR9tbxuG7sxfAHc5LQFopO1TgAAAABJRU5ErkJggg==";
    const QR_BASE64 = "data:image/png;base64,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";
    const GREVIEW_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAARgAAACoCAIAAAC0UWYaAACQiUlEQVR4nOx9d5yWxfH4zO7zvO36HXdHO3pTEEGkiQUVFTUq9q9dQzBGsRtjLJEYjSVqFGNijMbYY1eEoEExiIIIIr33dnD97u3Pszvz+2Pf9+G9ApyIiv6YD57vu+/2ndmZnZmdRWaGxsDMiAjNoMV0U9z8hIhebfX19Zs3b47H44FAoLS0tLi42MsDAF49u6qz9Ymt72crEr2xmM+ZPyEzIwhA0+Ie+59ZJwMIZkBAwEbV7m2vROtaN01DqvVvMc/fKPM3TWyS/h015H3eC9xrTWareZlvDAwA4LrusmXLotHokiVLlixZUl5ezszxeHzVqlXMbNv24MGDzz333FNPPVUIsavu/tDQBH0zkZ4BOEUG3Czv7qoyuQkAAGWq+DcbepOqTG3imxT5xk3+JOE7xbq9JyRmNoS+ZMmSdevWffrppytWrFi5cmVhYSERde7cuWvXrrm5uYWFhTNmzNi4cSMA/Pvf/z7iiCOuv/76M844Q4jdo8IPDpjx99vX802hMadlTFMgZ9BG61vfT6nou0NrIkLERCKxfPnyxYsXh0Khfv36bd68uWfPnqFQqLi42GRrkSXuHSDvlWhHRNXV1YsWLVq6dOn06dM//fTT+vr6Tp063XrrrXV1dbm5uZWVlWvXrkXE+fPnA8D69etd1y0oKAgEAtu3bz/xxBOffvrptm3bQkuzuRd8PHMU+0g2aMp3vrXE+I1GChmkgsDIDIgASJkdM2iw2zpTmb/lnHyjzK1MNAeB70KKI6IFCxZMnjy5vr6eiYlJoPh4+scrVqwIBoNFRUXBYPCcc84ZN25caWmpEEIIsXt5rzUd+GaEZDJv27Zt/vz54XB4zpw5zz//fF5e3ujRo0844YSamprFixfn5OQcfvjhhx12WMeOHaWUpjbXdTds2LBs2bLp06fPmDFjxYoVnTt3nj9/flZWVpNT095N5XdASC0M/zs6JLSUuPMbAABgxhHLS2dmQJTfQ5e8dK01InrSxP5ASN7SG/z83yf/W7xkcSwWW7lyZUVFRW5u7vr165csWTJkyJCBAwcWFhZGIpG5c+fOnDnT7/ffeeedN910k23ZgOAh0l4SEhE1L7Yr0Fr/5z//qaysbGhouPvuu13XvfTSSy+//PJHH31UKTV+/PiRI0eanLuS3LTWUsq77777j3/84/3333/jjTdm7gd7DS1qHX4SQOmDGQJgmkOmD2ypQX9PQvKqVauWLl16xhlnSJmi3m8z7ftQrjPdaGho+OMf/3j00UcbFC0sLHzhhRcKCgpuv/32yy+/PBgMCiGIyGD/xMcn3vLrWyzL+vkVP5/4xEQp5bfsz+44UpNtft26dRs2bFi1atXtt98ejUbPO++8U045ZdasWT6fb+zPxx508EEAkKlIaK6NAQAiEkIopcaNGzdp0qQlS5a0bdu2iZx6gCNlJFI6ERBFhlhH6URoQkjfRZcaGhp+85vfPP/888lkcvjw4a+99lqHDh32olqzTB567CtdHDPPmTPn008/jcfj06dPb9eu3bx586LR6DXXXDN+/Pjc3FxmNiKch4REdMMNNzz11FOIeN111z344IO2be+qoVb1ipuBoVoDSimtteu68Xh8ypQp5513XnZ29qBBg373u99dcMEFTz75ZEN9g9baK0Jp2H21RPTnP/8ZAI444ohwONwk/x6L7z7R9KcJfMvEb1/Dt0hURLqlnC0m7vsuua574oknGsHBwL333muyfdNqtdZNsOXbLDQRKaWSyeS77747YcKEMWPGtG/fvmfPnrZtjxs3bsuWLVrrFoubLimlTjnlFCmllHL+/Plet5s31Jpe7U5rR0RCiGXLltXX10+dOvWJJ54AgPPPP7+2tjaRSPz1r3/NyclpUqQ5f9gVhMNhAPjiiy8eeeSRO+6449vz1iZ9MMCNOVVmNmbelSLey7mrLu2m2u9AE2UYTvMpxZYS9wB7HFrzzC+99NLHH3/sFczPz7/gggu+abse7Kv5Mf1xXfeRRx5BxHfeecd13R07dhQWFr744otnn312EzGneR8Q8f4/3v/BBx8w8x133PH+++9/m77tkpCUUgCwedPm1atXv/baa2+//Xb//v2HDx9eVVU1YcKEvn37fptWiWjbtm3eh32uCs88OLZI1cy8atWqyy677K233urYsWOm0mbf9mR/A84QrloDDfUNd9xxh9l0Tanrr7++c+fOe7f6Lcr8ewEeO3r11Vfbtm37xz/+cdOmTcx86qmnPvPMM/n5+a3ZlxGx3yH92rdvv3Xr1g8//PDLL78cNmzYXnepKQZzWoisrKxcuHDhu++9e9FFF73++uudOnVaunTpwAEDX3zxxSZUtBvS3w3897//NR9s2/4OdnGAjGVrDq7j/uIXv/j666+ff/75JkUyoXltLWZrUuQ7Gs6+gqeffnrChAmrVq1qTeaJT0zcsWMHp/1XevfufcMNN3gDbHGku0ncO1TJBEPSAFBfX//EE0+sW7fu9ddf37BhAxH98pe/fP311wsLCz1dyB4BEYcMGWKqfeqpp+ibKN5a7pkHWmvHcdatW/fqq68ec8wxhlcg4mWXXbZu3TrXdZvIkXsn5r788sseF7r55psz5ea9rrOViUZSv/POOy3LQsTbbrutuQDdvPi37MC3PKXsk0QD//jHP8xuXVxcXFtbu/vi0Wi0ffv2ZpksyxJCvPzyy945x8C+nag9JhKR67rJZPKRRx759a9/fe6555pDzn333ec4jlKqxV7tps57/3CvIe/8/PxYLNZiztZ0FTJTiUgpNW/evL/97W+9e/c2m0cgEHjqqae01kopx3GaTOI3mgsDsVisV69e2dnZZgAPPvggtQKV91Wi1nrBggWhUEgIIaV84403SP9/QUhKqcrKyqKiIjNwKeVzzz23q+Jaaa31888/b6gOEYUQJ5xwguM4TfLv24naYyIRKaVefPHFe+6555RTTrEsy7Ksf/zjH67rKqUMIbW+TiJ6/vnnPWli9arVLeZsTVctbnxu1lovXLjw7rvvrq6uBoBQKPTWW2+deOKJmdILaUKB3vGDd3EI2RUD/Nvf/rZhw4YzzzzzjTfeEEIMGDCgef7W1/lNExHxj3/8YzKZBIBgMHjCCScAtqr177RX30MiADzxxBM1NTXMLIQIBAIDBgzYVXFNGhGff/55gyUmffz48c2lpu95UMxcUVGxZMmSVatWffDBB1LKk0466fLLL8fGZuJW1klEHTp0KCsr27x5c7t27XJyc3aVc8/VZpJXfX39DTfcEAqFDKEXFRX997//9ah806ZN11577X333VdbW+sJY990U1m9anVhYWFJSUlRUREijhw5Mh6Pf2+iHRGtXr3a7/cbq8L48eONfn+PrX/LDuyeezQRlr4jjlRTU1NSUuLthr///e89Qah5cdd158+fn3lkP+KII4xgv8eRfkfL53Xv7rvvHj58ePfu3RExEAgsXry4yahbX6fW+tVXXy0sLDR0+OWXXzYfILUOz1MKENd1161bN2LECI+Vt2vXbu7cuV7nGhoaevXqhYhSyr59+5aXl+9G797i/LquW1NTM2DAAGP5AoAOHTqsWbOmeT3eV621VntJsc0TzcR5vhR+v7+6urr5EFos3iTd+7zHDuwRv43Q5dHzbnLudaJp4s477zSLK4To2bNnJBLZFSFprWOx2FlnnWWoyJSaPHlyc8HJWxrTRGYHvs1KtZhIREqpqqqq3r17jx492vTthhtuMMai1q9IZqLW+rE/P2bmRAgxe/bszJyu63oLZDqwm2pT3HDF8hXHH3+8qQgAunTpMn369MMOO8zjWg8++KDR8zDz8uXL33777RbZ3254XywWu/DCC9u2bZuXlwcAiPjYY4+VlZVl5vQyM3NVZVVdXR1/c1PJ7qGurs58OOKII/Lz8/eoR+IMhh6PxysrK6ORqDd9374/iFhTUzNnzhwP/759nc2hvLx84sSJnHZ2fuSRRwKBQPOBc1r6nTFjxsqVK83XgoKCQYMGGfF+V0MAgI0bN7733nubN2/+joZgGnryyScdx5k3b54Qoqio6Ne//vW30ZQi4vIVy4PBoJmZTK9wZhYoHrj/gV69en322WcezeyyLtd1V69e3aF9B7PxSCn79eu3du1azthNFy1a5Pf7PalASrlixQpqHaMgItd1y8vLhw4devLJJ0+dOrWwsHDYsGHnn3++R+Vmb3AcJx6PP/XUUyeddJJRYgoh2rVr98EHH3zTQ+SuEonIcZz333/fWB6UUnvsvNZ6/fr1N998c//+/Q0vFUKMHDmyprqmxa23eQ275x6u695+++2BQKB///6vvvpqIpHI5E57LN6aRNd1f3bqzzwF7Jlnnmnms8VWHMdZuXLlpEmTDN/Ozc1FxIcfftjzEvDAKCS01rNnzz7jjDOMWs+yrJEjR/7zn/9MxBPUEg//NsuXTCbLyspycnIMD3n22Wc9FNq7OrXW559/vtkj8vLyKisrvXnQWk+aNMmodhHx17/+tbfcSqkvv/zyhBNO+MMf/lBbW2skXlBKHXfccUaNk0KRmhoPw0zJUaNGeadMROzcuXOTDLvpt1nI888//6KLLvrwww9Hjx598cUXl5WVVVZWZubUWs+bO69Pnz6eK4qUMhAIlJWVtWvXrqKionlDzSexxdYzc1JaCPGkqV0VN38dx3nkkUeys7M9oUgI0aVLF5/PN3bs2N13ILPp3SC967qu63700Ud+v9+yrMsvv3zfEpLW+oMPPvA8g23bXrlyZXNC8vTj8Xj8008/vf76681gTzzxRNu2N27c2HxWlVJr16695JJLDAl582PI6aabbtq33kBENGXKFA89+vfv76kQ965OrXU4HC4tLb3kkkuEEP379/f2a6VUJBLp1q2b19xJJ53kTdeiRYtOO+20nJwcy7Ly8vKefvpprTX873//89QdXbt23bFjRxO0++ijj7xDp6l0woQJrZ8go0W98847586de+aZZ1511VUdOnRYvHix4zipJpRWSk2ZMiU3NzdzPdq0aTNlypRx48YholHUepXPnz//P//5T21t7R5Ziuu6xjV269atsVislbp7M/BkMnnllVf6fD5vBxFCHHPMMeXl5cFg0OfzJZPJJiOdN2/eL3/5y4qKivXr15u+tRLptdZXX321UUy//vrrSrlEKv1vb7zavM9KqXPOOcfMp5TyvPPO83QbmadTInJd13Gcl156yZiPevTo0aVLl2HDhp166qlNVDLGw+3ee+8NhULeoToThBAdOnTItDp+e0LSWl9xxRWeCPfoo4+a8/NeExIRTZs2zbbt8847TwjhkYr56a9//as3Fsuy/vSnP5ldr66u7v7777/qqquGDh1qOtO9e3elFNx5550ekUyYMKHJXuU4zjXXXGPbtmWlnImklLNnz25xCVuEaDR6yy23LF++/Lrrrrv++uuHDBny0UcfZR5ztdZLly7Ny8vzjitSyu7duy9btsx1XXPk/de//uXldxynuLhYCHHQQQdt27ZtNz1RSt17772XXXaZz+ezLOujjz5qfbdd17333nsztb2GXcRisaqqKkS0bbuJUUVrfeihhxrG3rlz53g87qXvEZRSU6dOFUIMHz68T58+Srlae//UnsvvGqqqqgKBQCgUMtfD3njjjSa9ypyujz/+uGJHxezZs4UQo0aNOuOMM9q3b//C8y80zzl27Fho5qlgvlqW1b179wceeMAjpH0Dmnr16mUaEkKsWbPGm5i9rE/r3//+9yeffLLRsRl7pgHXdQcNGuSNq1u3bslkUimlXPXIw4/85z//ueWWW8xCG0rbtm0b3HfffZ70fO211yp3595DRMYIW1ZWZlAKEQsKCoxFfPe0Tumlmjx5cjgcfv3118eMGXPhhRc+9NBDXnc5rXM/5JBDPB4qhBg2bJjZ0aPRaNu2bYUQ3mmPiMwym9k86aSTmh+fzPaptf7Tn/508803Z2VlSSlHjRr1zjvvKFdlbq676rxSatq0aX6/38OPYDD4wAMPJBIJrfWbb74phOjVq5c3CgPRaNSb+sLCQo/lerPR4lqmPii9evVqIcTjjz9uHIWJNJEmUkQuUQvC3h7rNAOZOHGilPJXv/qViUJjfO2b5DT93L59++eff66Uuueee4wwM27cOMuyFi1alImvsVjssssu8zZWjwt16dLl0UcfXbRoUTyWsmfofSraJZNJc0ZtImjR3nIkrfWJJ544Z86c7OzsrKysBQsWeLV99dVXmQzWuL9orT///PM333zzxhtvLC0t7d69u3e7dsaMGbBt6zbjxO2JiZl4prWePn06pq1diHjXXXftERfNvG/evPmBBx6IxWLvv//+bbfddtJJJ/32t7/1fCM4LU5cdNFF3sYmhDj33HNjsZgxVP/tb38TQhQWFiYSCa/I4sWLvREGAoFoNNqkD2aDnzhx4k033XT88cdnZWW98soryWQymUxOmzZt+fLl3umoeefNkDdu3FhcXOzhis/ne/311xOJhHFCGTFihBDiV7/6VWYNWuvXX3/dE5J79OjhNdEqQtI6EolIKV988UUp5YwZMzxaSBPSLm0+u0lMJpM9evTo0aPHmWeeKYSYMGFCi0VMP6dMmWI2r+7duxcXFx999NGXX3553759Xcf1CKm2tva4447z+XweIxJCZGdn33vvveFw2Kyal3nv8HtXia7rhkIh0+6TTz7ZnIRaX6cpW11dXVZW9tprrxlBva6uzqvz5z//uSey2ra9ZMkS5ara2to///nPr7zyykknndS9e/dnn33WGCQB4L333gPXdd944w2fz5eVlTVlyhSjO6eMjeRXv/qVOfobQnrvvfd2Q0gGiauqqqZMmfLYY4/V1dU9+eSTv//97y+99NJ//etfnmLelHJd97777svc1Xr37h2JREwlDQ0Nnco6CSFuvfVWj+0Q0ZIlS7z8wWDQSFBNZnzKlCm33Xbb73//+2AwOHXqVCP9m+OWlPKee+7Z1S5gkG/UqFGekCmlNHuHwZL33nvPCM0LFyzMXEut9WmnneaN5fLLL/cIyRR0HMd8cF3HO/80QvpEUko57b/ThBAzZ8706GK395FUxlGqKSEZ2pZSmqNFMBjcvn1783q01lrpWbNmhcNhJ+mceuqptm2PGTPm3HPP7dq16913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wgu7du0qpfzZz37WfCWMnuf2229funRpNBq94oorLr/88p49e7744ou7stC7rnv88cdnXi9v166dcY155513AoGAlDIUCi1cuLB5DX//+99vv/12jwJ/97vfeTg3adKkq666asaMGZZl9e/fPx6Pm+L19fWef5MQ4oorrmiOUkS0dOlSn8/n9UoIccMNNyQSiVgsdskll0gpLcsaNWqUET4pww7jJJ0LL7zQo8AuXbp4lX/22WezZs1au3at3++fOnVqSUlJSUlJc7MQEW3YsOGss876ev7XlmVt27atcR61FzYlo2a44447hBCHH364p/dvVK9Sjz/++JYtW4wE4SSdE088UUp5ySWXPPPMMz6fb+bMmV7mZDJ5+umnG18Hx3FMR3aFPN8VaFq6dKnf7w8EAuvWrWvSAdd1X3/99fvvvz8YDJaVlXl2vKZ1aB0Oh3/5y19u2bKltLR0zJgx3sxsWL/hxhtvHD58uMGBu+66a82aNUcdddSFF17o8/ls2169erXJrJQaPHjw2LFjO3fufMghhxDRTtGuKY9mmDRp0umnn/7RRx9t2bIFEa+++mrOuPFPRADw5Zdf3n///ddcc01hYeH48eOzsrKi0eh777134QUXNpcYDSxcuHD69OmcEbXrmmuu2bRp0+WXX37uuee6rtu5c+f33nvv4IMPbiIwfP3113379o1EIl6KF8rLoE7//v2vv/76QCBg9JCm+MKFC41JxxQ599xzPe4EGeLZfffdZ3wRTGIgELjmmms++OCDwYMHv/TSS0KIiy666JVXXvF8bby+vfHmGyY2lanz7LPPNhXGYrHXXnttwIABd9xxR0lJyfHHH29ZVmlpqYlF6HXA7JG33XbbiBEjXnv9tdGjR5s8kCE1IYr0N0bk5tJ4JnA6Ykl+fr7WGhHPOeecJjlNu1999VW3bt1KSkqef/75//u//4vGojNmzOjTp09eXl55efmgQYMGDRrkFZFSXnPNNVLKjz/++IQTTpj6wVStNTeTr1pc8UyeAOm7pLvq/64SAYCBe/fu/bvf/c513VtvvdUQktfEO++8s2TJkrlz5waDwdtuu83TMzfpUl1d3dSpU7t3737NNddUVVVdcsklXv0ffPjBCSecsGnTJpN/5MiRL730Ujgcfuutt5RSl156adeuXb3aqqqqRo8eXVFRUVBQwJk3ZJuwUSfplJWV/eMf/zA9yMnJ+fLLL42oZtjohg0bnnzyyU9nfJpMJt95551u3bodcsght956azwWb2LSzmSvRHTTTTc1mfTBgwcbyadDhw5/+ctfwuFwE15k+N7WrVsnTJhwyCGHeCv01ltvmb3kgQceePjhhydMmGBZ1jPPPJMpgt5zzz1ec8XFxcYkRRmiHRF98sknxvzqdam4uLh3796GER078lhjqWyyBcbj8UQ8MXv27NLSUm/JjUNGMpl86623XnjhhX//+9+jR49++OGHjRlk9OjRnmOL4eiu627ZsuWII46orq7u3r37Rx99ZAQ0TwvnZc1QKjS6sNAEXNddtWqVZVk333xzjx49gsHgggULPNbnzefGjRuN4WjTpk1XX32167pGs3/nnXeeeuqpY8aMufrqq5t0wHAwc0IwPofXXXfdRx99lLJqNL7wksIix5kzZ84TTzxx9dVXP/DAAy+++OLkyZNnzJgRjUb3Tt4jIuWqm266SUp53HHHrV+/3ugMV6xYcdZZZ1122WUXXXSRkZ4yHbgyP7z00kuPPvro7Nmzs7Oz+/TpY+R8Mz+PPvroddddd9RRRyFiu3btysvLe/bsaZbVRGz15tBxnEAg8MUXXyDiaT87TWvdcvgeRJw7b25OTs7q1avNrhOJRI488shFixZt3brVdd3nnnvuww8/PPfcc13lnnnmmRdffPHQoUNN8FTbZwvRiNE1qXzatGneZynlpZdeqrU+9dRTn3vuuVWrVv3qV7/y7G7ePL722murVq16+eWX8/Ly+vfv73WypKSEmdevX//mm28eeuihDz300JgxY37+85979MDMM2fO9Jr72ak/M5zK65XWOhaL/f3vf3ccx0vs1KnTyJEjs7KyrrzyypkzZ3708UeeY5W3/9XU1Dz//PMLFy186qmnjDYWEQcMGNCrVy8hxPLly4096u677/7LX/4ycODAhoaGRCJhDuip7TX97Mp99903atSoDz/8UAhxzDFHMxDzzo02tZEDpPUKmdqFltfu2WeftW27T58+69atO+644/r168eN1UJE9Oijjx522GHM/Jvf/MZIgDNmzGDmrKyso4466pNPPjn22GObVIuI11577Zw5c84880wp5caNG5944okTTzyxS5cu48eP/+jjj4wOkJmjkei77757xx13jBs37vHHH1dKdenSZdu2ba+++uq4ceNGjRr12Wef7WYIuwcU+PCfHp4wYcLMmTMHDx78lyf/snbt2n/+859aa5/Pt3DhwiOPPPI///nPW2+91aQgM9fV1bmuG4vFXn755Vgslql22rx5c25u7vTp0+fNmwcAp5122kMPPbR+/XqDRY8//nhmtKnKysrs7GzXdQGgZ6+ejZaqCfXfdtttt912W8+ePSG9Txv5ePny5Q8//PCaNWuqqqquuOKKo48+Ojc396KLLvKsPZlcqHm169ev984hiHjRRRfpjJttupkWXmv91ltvPfPMMw8//PDdd9/tOM4JJ5xgigsh1q1bV11dfeyxx06aNMnYTIyd1Gs0kUh4GjBEfO2116jxudNxnMcff9zzljcjff755z1R2GNEmb2KRCK/+c1vJk2adMMNNxx++OEAIKU8+OCD77zzTq11PB6/7rrrduzYcfHFF0+aNEkpNW/evLVr1wLAbbfdpndqCFyt3U8//bRt27br160fMGDAn//8Z+W6SjlptXgjP710qSZsqik4SadLly6nnnrqVb+8qmPHjs8++2zjGkgp9Ze//OXee+9VSj3zj2eMO6bWeujQof379x8zZsz48ePbtWsXjzW1dGfO29dffz1u3DgTAQLTWpaioqLzzz//jDPOKCsru/baa3/zm98MGjTokEMO6dSpU+/evbt27Xr66affdtttTzzxxPbt2/fIfHaTaBjv559/3rdvX9u2bdtu3759x44dA4HAXXfdNXDgQCHEBRdc0IQjkaa//e1v//rXvz744IM2bdr069dv+/bt3kw+8MADr7zyigklIqX85z//aZReBu2Nucyb5K1btw4aNOi+++5DRGOzbkpIlLZ+HHvssc8++2wmbxFCHHnkkZMnT163bt1zzz138sknX3PNNaeddtq0adMyxJU9ENIzzzzjkbUQYtGiRZnokokfBo9ffPHFv//97++9994FF1xgmGHfvn1NceNf/Otf//rUU0997LHHhBDXXnutbmzTWLFihXeqEUKY9eMMLVBVVZXn6GGGmZ+fbwwFTTrmdS8ej48bN+5///vfU0899dvf/tYEeevWrds555yzaNEipdStt976hz/84cMPPzziiCOMMLxo0aKvv/4aUzFKjYZNKe0o5ZxzzjkXX3zx1KlTg6FgRcUOpXZJSE1maVeE9N///hcRn3nmmd69excWFpqb/B4opebOnfuzn/3McZxZs2Ydeuih4YawUmrH9h22bY8dO/bggw++5JJLzBF8V4SUQhKlk8nkzJkz//CHPxi/T8/3zBDVSSedNHHixAULFhhO1UTb8S0JSWvtum44HB41alRmux66tmnTJlPfoLWurKx88cUX77jjjltuuSU3N/f999/3JtB13euvv378+PEGkbp3724USFJK27YXLlyYieFa65UrV55yyinm/sULL7ywS9Hu7bffnjdv3syZM3Nycjgjwsn8+fOfe+65U0455b777gsGg2eddda77757/PHHC7k7WS4T1q1b533u27dv34P7AkCLBZn5k08+qays7NWr16effnrzzTeXlJQAwIYNG0yGtm3brlixYuLEid27d7/55pvLysruvvtu0TjW5PLly83UG8Jr06aN95WZHcc59ZRTDcZ4Rc4777xAIOAxsSYdI6K77777sssuSyQSixYtOvzwwzdt2iSEOP3007ds2XLQQQe98sorgwcPHj9+/DXXXPPkk0+apTWLysy2bXsSHWn+4os577zzzlVXXXXbbbdddtmlhYUFXsS43czh7uEf//hHUVERM5eWlg4ZMsTzHTEDr62tvfnmm59++uklS5acccYZF198cTAURMQv536ptQ4EApFI5PPPPz/66KNxF7E1zbRIKYUUtm2PGDHipBNP6tChg3HizMvL69ixo3HAKygo6NOnz0EHHeRtxJmb8l4PMLMPfr+/S5cuRtSEtDBvwMjezKk71og4adKk3NzckpKSJ5544uKLLz755JO9E8SsWbMOPvjg8vLyf//73wDQu3fvN99801Dstdde27dvX8xAcACYPn163759Z82aBQA9evQAANGE9E2TZu9/4YUXGhoavN0aABKJxDvvvLN27dpTTjnlhRdeOOaYYzykbFJJ803FJG7dutVbHhPBZ1fFq6qqXnnllWHDhi1YsCAvL2/AgAFCiKqqqng8born5eXdeuutubm58+fPJ6Lf/e53+fn5TVo3LMh03nhqeRmI6JJLLpn/9XzK0PwAgBePt3mviOill14aMGCA8SG87rrrXn75ZVOn4zjHHntsIpG4++67u3Xr9uijjx555JHGqx0AfD5fNBo1OxwzMAMR19TUXHzxJT179vxo2keLFy+++aabDf2kV9f0h5vHJd7NPCeTyUmTJo0aNWrKlCkbN2704i6YaonopptuMoa4cePGhUIho4nltL9zSUnJYYcdtnHjxqFDh+6xLcMl/vKXv4w+efS7775bXl5+zz33bNmyZcP6DbNnz27fvv20adPGjx+/ePHi5mSwRzzZfaJXz+rVq//zn/+MGDFi4MCBRx111PHHH9+5c+eOHTt27959xIgR3bt3Z05RUkVFRZcuXRYuXFhZWek4zhlnnOHVg4gffvhhSUmJ3++fM2cOM8+bN08pZcSTO+64o8mJ3WCClNI4WBTkFwCA1SIDWbdu3QUXXPDyyy/n5OSYIAdm4gDAsqwJEybceuutmXd1mjOT5tWaxMrKSi/lmKOP8bQCTXLW19dff/31Z5999vz589966y3jgYaImzZt8vD+iy++cF23Q4cOc+bMKSkpMQ7O2PiNg8rKSkTs0KHD9u3bBw4cyMwGs4noT3/609tvv212R6/O4uLiI444okW+6rruzJkzv/jii+HDhr/33nsjRozIz8//4IMPiKhPnz7RaPScc86ZOHGicfr8xz/+8dlnn5kpYmZzh1kI0a5dOy/gzA033Lhp06aePXs+9vhj5557bteu3QAA0YQjB8h8aKzVL4XNnTvXcZyjjjrqzjvvrKurGzhwoJeBic2lvd69e0+YMGH9+vWTJ0/2TGfLli3r3r37V199NWTIkOnTp5sYaZnzkNmW1hoAVqxYMX78eBO+ZuzYsbfffruxSgPAwIED//e//73++ut33XXXxRdfPHv2bHPfbI/9b2Wih9BPPPFEQUHBAw884PP5nn/++aOOOirzyRlvrYloxowZeXl5vXr1evnll7t27XrMMccYrzdOPwnzxRdfGF2iQRtmtizrF7/4RWFhIWdYfUxPsrKyzCIiYnZONuzqaZ2VK1fatq2UqqursyzL6CtMRVrrhx9+eP78+ZkE3WIlLUJtba1XasSRI5rPFxPPnz//7LPPHjJkyKJFi5566qlnn3024E9F6sgMtGukfxNt46GHHjIxVZpAXV2dsUgSkWcEIKLPP//cqMW11ieesDNq35FHHmkUD03qSSaTDz/88JNPPhkMBletXlVVVXXjjTe++eabiUQCAM4444x58+b5fL6HHnro8ssvP+OMM2666abOnTt7xYPBYCgUysnJWbZsGQIS0S233PLaa68BwJo1a3w+34MPPtgiAplZyWRKzXflTDAKWXMpoEePHocddphX9O133r766quHDRs2derURx555J///OeQIUM8EUspdfLJJ8+cOXPDhg1HHnmkJ9w2XyCDPS+++OLQoUM/++yzdu3azZgxY+LEie3atfOyCRTGQ2L+/PkNDQ1PP/10i7V9GyCi7du3v/jii0uXLq2qqmrTpo3x4YA0/WfqtD766KOePXtOmzZtzZo1U6dONVrNzEFZlvXmm282NDR4iYiYl5dnTDXNN3rHcRKJhGkodQupSf+YeceOHdu3b8/Ozjb6rocffvjTTz/t0qWL6Rwz19bWnn766eb48U3H793cbt++fVFRETQ+hxDR35/++6WXXnrwwQe/9dZbEydOvP/++7t37+4dGTZs2NDkxEJEgwYNOu/c86ilwM2JRIKZg8EgIhqPd2besmXLBRdc0KFDB0Ts0qXLAw8+4AkPXnzZzAmpra09++yzzUWmmTNnvv3223//+9+FEEuWLAEAKWVZWdnhhx8+bty4cePGPfTQQ717977+uuszo1x06tRp3rx5iURi8uTJiWTioosuevLJJzmt83jggQfM1cmMphFAZLxD0YKA1yIsWrSoT58+7777LiIef/zxiAgIpOmxxx679NJLg8Hgli1bJkyYcNVVV5122mneoUVrPXfuXCFEIBCYPn26UXy3SNXmqH377bePGzcuNzf3sccemzFjRv/+/b3rol73Tc3xeLy6uto71u5DYOY77rjDXKZERHNdvElMBLPjLF26dOLEiS+//HL37t0feuihoUOHHnPMMU1GV11dPXDgwLlz50IG57n66qvNaTMzp/lVKbVu3TopZTAYzM7OTnUoE4jowQcfHDdunPFxLC4urqioMFJNIBAw8YoMRZWVlS1ftvybKl7G/WKc6VDfvn09TDKQSCSuv/76jh07mptztm1PmDChSZDkm2++OVPoN3+nT5/uqbOatP6rX/1KCHHhhRdKKT/77DOtdX19/eGHHy7S8MYbbyQSCfMCpxDiT3/6k1eJQZrVq1f3799/2LBhbdq0sSwrJydn8eLFylXl5eXmunX79u3Hjx9/2GGHmTnJy8szJJfZDeOMPHXq1FAoFAwGPaYnhLjjjjvMGBvr5bx/TS/2tahI9OD000//xS9+0bFjRwB47rnntNbxePyXv/ylp1KzbfuUU06JRqOZV7zWrVtXVlZ2ww03nH766Xl5eW+++aZXYebyaa1dx73yyiullMcff/z27dtb9ALzwHGcK6+8Ugjx+OOPf1M82X0iEW3cuNG7wmzb9pYtW5qvPhHV1dUNHz78gQceuOmmmw466KC8vDzj9+SNjoi00mPGjBk+fHgmQ8vKyjIDbFItESml/vSnPx1xxBG2bZeVlZnamhJSPB7v16/fc/98zuziQ4YM8SZr9uzZHTp0GDBggNEXSynbtGnz/L+eb6Jx3v1cvPrqq2brOvTQQ73lcRxnx44dJ510khmDWfUTTjjBC2LIaczOdOgwH44//ngvzEjz1sePH4+IJjjRmjVrYtHY6NGjvZ34oYceMlZ5o8DBdNwpM1mu63744YeeF5IQwu/3e2GmP/zww1NOOUUIcc0113Tr1s2j6kceeSRznbwuGeyfPHnyoYce6vP5cnJyTjvttE8++US5qrkjXJqEvnHwkxtvvPHqq6/Oy8uTUn766afLly8fNmyY1zcp5VFHHeUFyvUmdsqUKQcddNDll19+9tlnG4+y5iuolDLRYCzLuuCCCzwLQfOFNgsai8XMlVAhxNKlS/c5If3ud7/zeP5xxx3XZPXN6OLx+JgxY2644YaTTz75+uuvtyzrxBNPNBd+M3MqpXp075HJcyzLGjt2bOYAMz9orZ955hkTMa5t27amraZB9L/66iufz/f3v/89KyvL5/N54bxM+QULFpSVlRUVFWVnZ3fu3Nl40Jxzzjk1NTVNVrTJsL3ESCRSVlZmjt0GiROJxBtvvNGlSxdPNpBSnnnmmYaKdMaja0Q0ZswYb8Bm//jDH/6gGscSymz9mWeeMTQvhPjvf/+bGcT84osv9jyJ3n77bdP6b37zGzPe8vLy3/zmN56JCQBCodBLL73kOI656/rXv/7VOLCPGzfOM2L069fPxHVoPgOZ9GnsvE7SMb5ULRqLGt9+bWQ+2g0hLVy40DyWapiGz+fLjIJ/5JFHVlZWZrIR07cnnnjioosuGjZsWK9evYx1rjkqa61N+If/+7//M5OQudCZXdJaz5s3b+jQoWbDvuSSS5rH1Wg9zbSYSESG10E6amQm/RhwXfeSSy4ZO3bsueee+7e//S03Nzc7O9s4cHmZvaW5/vrrMzdoRPzqq6+o8VaY+XnGjBmlpaWWZQUCgaYcydR45513jhgx4pprrrEsy7btuXPnNrk6sWrVqn79+lmWNWLEiKFDhxoc7dat21tvveUkHd3SZpy5cq7rvvTSS6ZUx44dDznkkLy8vEybqc/nu+f39xjf7eZLddZZZ3nTJ4QYN26c8UTe1Zij0WjPnj3NDQjbtj0Jp0+fPuFw2BOQtNInn3yy8Trv3bt3r169vFebTEO9e/deuHCh50OotZ4wYYKHo5C+4Ttr1iyz4e2KkFokm+bkkZH+jWM2zJo1q1+/fpl9AwDLsi699NL6+vomq2n6dt11140dO7akpGTYsGFXXHFFi3i/YcOGvLy8c845x/N/z1wdrbVhWW+++eZNN9103333devW7bLLLnv66ac3b97cBCW+Ec20mEhExr0dEdu2bWu2tszZM28cn3POOSeddNKUKVM6duzo8/nMVZ3MgXtLs2nTJu9hJUQ0rgy7QipmNt5eBp2qqqqIqNE1Cq31cccdd9dddw0bNkxKOWDAgEyRw+QxIRmMdqtz584XXHCB3+83rOmUU04xEVibgOu6ixct/vDDD810u457/vnnt3iWFUI8/fTTlI5z0BxRTARQM9r8/HyjDW/uV+GBUmrVqlV5eXmWZXkHYhOVqgk2b9iwwXN4adK39u3br1+/3tzDNzhkXlk86aSTPM89IcTEiRO9007znuyC7eyCGe2c9m98gSKRSKxaterQQw/1eO9RRx01b948E1CqyWqajp1//vm//OUve/To0a5duyeffLIJsRkwcYjMPDQfo1Lq448+vvbaa6dNm/bAAw+MHDnygw8+ePHFFzdv3qy19kJT7SvQWi9YsMA4Oo8aNUornUlIsVhszJgxI0eOPOWUU+64446DDjpICDF+/Hhzc7Z5T8yEP/bYY97Sv/DCC7s//imlzHVdIcS0adNmzpzZ6IyklMrLy5s2bZpR144fP94Ua06UkUjkxhtv9Pl8gUAgU+/p9/svvvji119/ffXq1Qbt6urq7r333ry8vMzXeGpqam666abS0tJMwbS4uPi5557zHMyb70lE5LruM/94xkiVEydONEJIk/zUbPd66aWX2rdvb4YdDAYnTpxILV3s++KLL0455RRzODTkatv2EUccsXLlysx58KC8vPwXv/iFEf/OOuusTL1I8843wd1mBLPTISjT7dCsGpHKCM/QCANaRDIiSiaT69atW7lyZU1NTZNsTSaKiEaNGjV27Fiz0cyeNbvFIZx33nmjR4/2XBAN7pqvGzZsmDFjxuTJk1955ZUnn3zy7bfffu2118wFBL2L2B4trlTrE4koGo2aM8Jpp51mNhnHcUygqCOPPHLEiBHnnXfeqaeeesYZZ0gpx44da2xEu6qTiKqqqoyoJaWcPn168xabfK2vrzf2A+NStNMNhJnLy8t79er1wgsvmGvrv//9780tOk8h6G3VRAQACxYsePrpp1955RXzsrInX5rMhszMNdv777/f3BM2SkkiQkSl1OrVq5ctW7Zhw4auXbuOGjXKc9Fv7kLCjc3b69at69q1q5czk4dwM4OMTvuYmecw2rVrZ5AmMycza60BwHGchQsXLl68OBwODx8+/PDDDzcq++bVmoFUVFQopcxuYvrTYs4mbTXvKmZ4XXjiosllKkh/3en93bwhL5GbWTCbKGkyc/bv33/kyJF/+ctfTLiIrKys5vP/8ssv33bbbddff32bNm3y8vLatGmDiG2K2vTs1VMpNW3atI4dO65ZsyYUChHRsccem3mZcvdd3YtEM/OvvfbaJZdcUlpaessttxDRhg0bpkyZUlVVdeKJJ0aj0R7deyxZumTWrFm//e1v77rrLtnsVdkmK6KUqq6uvu+++6SUd999d2bE0hZ7xczhcPjyyy83N0obEdLKlSvPOOOM0aNHmwfMn3/++YsvvhhaIiTOUK7X1dW98sor77zzzqxZs4yB0mTw+/39+/c//fTTr7vuuswgB9AYsZpMkPmw+6lsjoi7JyTTHGSYFyCNuE3qxMYOZruvtsk8eBXua0Lychpr0s6bFK1HxExoTkg+n+/iiy9+6aWXunbtunz5ctnSG6wmmvFzzz03YMCAgoKCAQMGdOjQoV+/frNmzdqxY4exDRx11FGenbDJKPY5IZkPt99++4MPPmjcgrKzsz///PNgMDh8+HAp5f/+9794PP7QQw9dc/U1xq61mzqbrMjud6LMRK31J598MmjQoEZ4s3LlyrPPPtvcYgeAJUuWeK7Wu6kLAAyH0VqvWrVq/br1Qor27dv36dMn88jOaZeNfTKV33Pit6xhXxMSGFvt3nWpOSGZYENTp07t16+fiZzcvLjpWzwef/fdd1euXNmvX794PD5w4MD8vPwOHTsIFAyMgCha6820TxKZ+fHHH7/tttuMa1y/fv1KSkoWLVpUW1t78skn33///UbVBHvamnefuJvM3t9GHMm8JlZfX+84Tk5OTnV1dSZDbM2W3Dxni9v/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";

    const bikeId = escapeHtml(d.bikeId || '---');
    const seller = escapeHtml(d.seller || '---');
    const brand = escapeHtml(d.brand || '');
    const model = escapeHtml(d.model || '');
    const brandModel = escapeHtml((brand + ' ' + model).trim() || '---');
    const mileage = d.mileage ? escapeHtml(String(d.mileage).replace(/\s*km$/i, '')) + ' km' : '---';
    const year = escapeHtml(d.year || '---');
    const battery = escapeHtml(d.battery || '---');
    const damage = escapeHtml(d.damage || 'Keine besonderen Notizen angegeben.');
    const datum = escapeHtml(d.datum || '');
    const uhrzeit = escapeHtml(d.uhrzeit || '');

    const akkuChecked = d.akku ? 'checked' : '';
    const ladeChecked = d.lade ? 'checked' : '';
    const schlChecked = d.schl ? 'checked' : '';
    const dispChecked = d.disp ? 'checked' : '';

    const akkuMark = d.akku ? '✓' : '';
    const ladeMark = d.lade ? '✓' : '';
    const schlMark = d.schl ? '✓' : '';
    const dispMark = d.disp ? '✓' : '';

    return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>Upway ${warehouseUpper} – Einlieferungsbeleg</title>
<style>
  @media print {
    @page {
      size: A4 portrait;
      margin: 0 !important;
    }
    html, body {
      width: 210mm !important;
      height: 297mm !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    .no-print {
      display: none !important;
    }
    .page {
      margin: 0 !important;
      box-shadow: none !important;
      page-break-after: always !important;
      break-after: page !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }
  }

  * {
    box-sizing: border-box !important;
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    color-adjust: exact !important;
  }

  body {
    background: #ffffff;
    color: #1c1c29;
    font-size: 13px;
    line-height: 1.4;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
  
  .page {
    width: 210mm;
    height: 297mm;
    max-height: 297mm;
    padding: 16mm 18mm 16mm 18mm;
    margin: 0 auto;
    background: #ffffff !important;
    position: relative;
    box-sizing: border-box;
    overflow: hidden;
    page-break-after: always;
    break-after: page;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .page-2 {
    page-break-before: always;
    break-before: page;
  }

  /* Top accent bar */
  .top-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 5px;
    background: #4b3cf0 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .header-logo {
    height: 28px;
    width: auto;
    margin-top: 4px;
    margin-bottom: 20px;
    display: block;
  }

  .brand-tag {
    font-size: 9.5px;
    font-weight: 800;
    color: #4b3cf0 !important;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .doc-title {
    font-size: 22px;
    font-weight: 800;
    color: #1c1c29 !important;
    margin-bottom: 4px;
  }

  .doc-sub {
    font-size: 10.5px;
    color: #6f6f80 !important;
    margin-bottom: 20px;
  }

  /* Section headers */
  .sec-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 16px;
    margin-bottom: 6px;
  }

  .sec-badge {
    width: 18px;
    height: 18px;
    background: #4b3cf0 !important;
    color: #ffffff !important;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 10.5px;
    font-weight: 800;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .sec-title {
    font-size: 11px;
    font-weight: 800;
    color: #1c1c29 !important;
    letter-spacing: 0.6px;
    text-transform: uppercase;
  }

  .sec-divider {
    border-bottom: 1px solid #e3e3ea !important;
    margin-bottom: 12px;
  }

  /* Card boxes */
  .card-box {
    background: #f6f5ff !important;
    border: 1px solid #e3e3ea !important;
    border-radius: 8px;
    padding: 14px 16px;
    margin-bottom: 14px;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .row {
    display: flex;
    gap: 20px;
    margin-bottom: 8px;
  }
  .row:last-child {
    margin-bottom: 0;
  }
  .row > div {
    flex: 1;
  }

  .field-label {
    font-size: 8px;
    font-weight: 800;
    color: #6f6f80 !important;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-bottom: 4px;
  }

  .field-val {
    font-size: 12.5px;
    font-weight: 600;
    color: #1c1c29 !important;
    padding-bottom: 4px;
    border-bottom: 0.8px solid #e3e3ea !important;
    min-height: 22px;
    display: flex;
    align-items: center;
  }

  .field-val.highlight {
    font-size: 16px;
    font-weight: 900;
    color: #4b3cf0 !important;
    letter-spacing: 0.5px;
  }

  /* Checkboxes */
  .checks-row {
    display: flex;
    flex-wrap: wrap;
    gap: 22px;
    margin-top: 6px;
    margin-bottom: 14px;
  }

  .check-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11.5px;
    font-weight: 600;
    color: #1c1c29 !important;
  }

  .check-box {
    width: 14px;
    height: 14px;
    border: 1px solid #d1d1de !important;
    border-radius: 3px;
    background: #ffffff !important;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  .check-box.checked {
    background: #4b3cf0 !important;
    border-color: #4b3cf0 !important;
    color: #ffffff !important;
    font-size: 10px;
    font-weight: bold;
  }

  /* Notes box */
  .notes-box {
    border: 1px solid #d1d1de !important;
    border-radius: 8px;
    padding: 12px 14px;
    min-height: 85px;
    background: #ffffff !important;
    font-size: 10.5px;
    color: #1c1c29 !important;
    line-height: 1.45;
    white-space: pre-wrap;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* Legal list */
  .legal-intro {
    font-size: 10.5px;
    color: #1c1c29 !important;
    margin-bottom: 12px;
  }

  .legal-item {
    display: flex;
    gap: 8px;
    font-size: 10px;
    color: #1c1c29 !important;
    line-height: 1.45;
    margin-bottom: 10px;
  }

  .legal-num {
    font-weight: 800;
    color: #4b3cf0 !important;
    min-width: 14px;
  }

  .legal-title {
    font-weight: 800;
    color: #1c1c29 !important;
  }

  /* Signature */
  .sig-container {
    margin-top: 26px;
    margin-bottom: 20px;
  }

  .sig-line {
    border-top: 1px solid #4d4d5a !important;
    width: 220px;
    margin-top: 36px;
    padding-top: 6px;
    font-size: 8.5px;
    color: #6f6f80 !important;
  }

  /* Thanks & feedback */
  .thanks-sec {
    border-top: 1px solid #e4e4eb !important;
    padding-top: 18px;
    margin-top: 18px;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }

  .thanks-title {
    font-size: 13px;
    font-weight: 800;
    color: #1c1c29 !important;
    margin-bottom: 4px;
  }

  .thanks-desc {
    font-size: 10px;
    color: #6f6f80 !important;
    max-width: 260px;
    line-height: 1.4;
  }

  .badges-row {
    display: flex;
    gap: 16px;
    align-items: center;
  }

  .badge-greview {
    height: 52px;
    width: auto;
  }

  .badge-qr {
    height: 70px;
    width: 70px;
  }

  /* Footers */
  .footer-bar {
    position: absolute;
    bottom: 12mm;
    left: 18mm;
    right: 18mm;
    display: flex;
    justify-content: space-between;
    font-size: 8px;
    color: #6f6f80 !important;
  }
</style>
</head>
<body>

<!-- PAGE 1 -->
<div class="page">
  <div class="top-bar"></div>
  <img class="header-logo" src="${LOGO_BASE64}" alt="Upway Logo">
  
  <div class="brand-tag">UPWAY ${warehouseUpper}</div>
  <div class="doc-title">Einlieferungsbeleg (Drop-off)</div>
  <div class="doc-sub">Nachweis über die physische Abgabe eines E-Bikes zum Ankauf</div>

  <!-- Section 1 -->
  <div class="sec-header">
    <div class="sec-badge">1</div>
    <div class="sec-title">VERKÄUFER*IN</div>
  </div>
  <div class="sec-divider"></div>
  
  <div class="card-box">
    <div class="row">
      <div>
        <div class="field-label">BIKE-ID</div>
        <div class="field-val highlight">${bikeId}</div>
      </div>
      <div>
        <div class="field-label">NAME VERKÄUFER*IN</div>
        <div class="field-val">${seller}</div>
      </div>
    </div>
  </div>

  <!-- Section 2 -->
  <div class="sec-header">
    <div class="sec-badge">2</div>
    <div class="sec-title">FAHRZEUGDATEN (IDENTIFIKATION)</div>
  </div>
  <div class="sec-divider"></div>

  <div class="card-box">
    <div class="row">
      <div>
        <div class="field-label">MARKE & MODELL</div>
        <div class="field-val">${brandModel}</div>
      </div>
      <div>
        <div class="field-label">KILOMETERSTAND</div>
        <div class="field-val">${mileage}</div>
      </div>
    </div>
    <div class="row">
      <div>
        <div class="field-label">JAHR</div>
        <div class="field-val">${year}</div>
      </div>
      <div>
        <div class="field-label">BATTERIEKAPAZITÄT</div>
        <div class="field-val">${battery}</div>
      </div>
    </div>
  </div>

  <!-- Section 3 -->
  <div class="sec-header">
    <div class="sec-badge">3</div>
    <div class="sec-title">ÜBERGABE-CHECKLISTE (ZUBEHÖR & ZUSTAND)</div>
  </div>
  <div class="sec-divider"></div>

  <div class="field-label" style="margin-bottom:6px;">ZUBEHÖR</div>
  <div class="checks-row">
    <div class="check-item"><div class="check-box ${akkuChecked}">${akkuMark}</div> Akku</div>
    <div class="check-item"><div class="check-box ${ladeChecked}">${ladeMark}</div> Ladegerät</div>
    <div class="check-item"><div class="check-box ${schlChecked}">${schlMark}</div> Schlüssel</div>
    <div class="check-item"><div class="check-box ${dispChecked}">${dispMark}</div> Display</div>
  </div>

  <div class="field-label" style="margin-bottom:6px;">NOTIZEN</div>
  <div class="notes-box">${damage}</div>

  <div class="footer-bar">
    <div>Upway &nbsp;·&nbsp; Alexander-Meißner-Straße 77D &nbsp;·&nbsp; 12526 Berlin</div>
    <div>Seite 1 / 2</div>
  </div>
</div>

<!-- PAGE 2 -->
<div class="page page-2">
  <div class="top-bar"></div>
  <img class="header-logo" src="${LOGO_BASE64}" alt="Upway Logo">

  <!-- Section 4 -->
  <div class="sec-header" style="margin-top: 10px;">
    <div class="sec-badge">4</div>
    <div class="sec-title">RECHTLICHE HINWEISE (DROP-OFF BESTIMMUNGEN)</div>
  </div>
  <div class="sec-divider"></div>

  <div class="legal-intro">Mit der Abgabe im Upcenter ${warehouseUpper} erkennt der/die Verkäufer*in folgende Bedingungen an:</div>

  <div class="legal-item">
    <div class="legal-num">1.</div>
    <div><span class="legal-title">Technische Tiefenprüfung:</span> Dieser Beleg bestätigt nur den Erhalt der Hardware. Die finale technische Prüfung und Bestätigung des Ankaufspreises erfolgen zeitversetzt durch unsere Experten (§ III AGB).</div>
  </div>

  <div class="legal-item">
    <div class="legal-num">2.</div>
    <div><span class="legal-title">Eigentumsvorbehalt (§ VIII):</span> Das E-Bike bleibt bis zur vollständigen Auszahlung des Kaufpreises durch Upway im Eigentum des/der Verkäufer*in.</div>
  </div>

  <div class="legal-item">
    <div class="legal-num">3.</div>
    <div><span class="legal-title">Akku-Sicherheit (§ IX):</span> Der/die Verkäufer*in versichert, dass weder der Akku noch der Motor beschädigt oder technisch manipuliert wurden.</div>
  </div>

  <!-- Section 5 -->
  <div class="sec-header" style="margin-top: 24px;">
    <div class="sec-badge">5</div>
    <div class="sec-title">BESTÄTIGUNG DER EINLIEFERUNG</div>
  </div>
  <div class="sec-divider"></div>

  <div class="card-box">
    <div class="row">
      <div>
        <div class="field-label">DATUM</div>
        <div class="field-val">${datum}</div>
      </div>
      <div>
        <div class="field-label">UHRZEIT</div>
        <div class="field-val">${uhrzeit}</div>
      </div>
    </div>
  </div>

  <div class="sig-container">
    <div class="sig-line">Unterschrift Upway (Annahme)</div>
  </div>

  <div class="thanks-sec">
    <div>
      <div class="thanks-title">Danke für Ihr Vertrauen!</div>
      <div class="thanks-desc">Wir möchten uns stetig verbessern. Hat heute alles geklappt? Dann freuen wir uns über Ihre Bewertung.</div>
    </div>
    <div class="badges-row">
      <img class="badge-greview" src="${GREVIEW_BASE64}" alt="Google Review">
      <img class="badge-qr" src="${QR_BASE64}" alt="QR Code">
    </div>
  </div>

  <div class="footer-bar">
    <div>Upway &nbsp;·&nbsp; Alexander-Meißner-Straße 77D &nbsp;·&nbsp; 12526 Berlin</div>
    <div>Seite 2 / 2</div>
  </div>
</div>

</body>
</html>`;
}

// Helper Utilities
function getDriveFolder(folderId) {
    try {
        return folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();
    } catch(e) {
        return DriveApp.getRootFolder();
    }
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
