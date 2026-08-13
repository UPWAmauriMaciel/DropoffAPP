/**
 * ============================================================================
 * UPWAY DROP-OFF PORTAL — BELEG
 *
 * Geracao do Einlieferungsbeleg e arquivamento no Drive.
 *
 * O HTML daqui vai para um conversor HTML->PDF que COLAPSA elemento vazio: todo
 * filete e caixa leva um &nbsp; com font-size zero. Ver o comentario no CSS.
 * ============================================================================
 */


/**
 * Generates 1:1 Einlieferungsbeleg PDF matched 100% to Upway Drop-off Portal v2 design handoff
 */
function processDropoffDocument(formData) {
    if (!formData || !formData.bikeId) {
        return { error: 'Invalid data or missing Bike ID.' };
    }

    const config = getAppConfig();
    const warehouse = (formData.warehouse || config.warehouse || 'berlin').toLowerCase();
    const bikeId = String(formData.bikeId).trim().toUpperCase();
    const seller = String(formData.seller || '').trim();
    const brand = String(formData.brand || '').trim();
    const model = String(formData.model || '').trim();
    const mileage = String(formData.mileage || '').trim();
    const email = String(formData.email || '').trim();
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
        email: email,
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

    // Nome definido UMA vez: o mesmo valor batiza o blob e procura a versão anterior
    // para descartar. Duas cópias da string divergiriam e o Drive acumularia duplicata.
    const fileName = belegFileName(bikeId, brand);

    const pdfBlob = Utilities.newBlob(htmlContent, 'text/html', `${bikeId}.html`)
        .getAs('application/pdf')
        .setName(fileName);

    const rootFolder = getDriveFolder(config.driveFolderId);
    const now = new Date();
    const yearFolder = getOrCreateSubFolder(rootFolder, String(now.getFullYear()));
    const dayFolder = dayFolderName(now);
    const targetFolder = getOrCreateSubFolder(yearFolder, dayFolder);

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
        datum: datum,
        // Snapshot em uma coluna só: o "Reopen" restaura exatamente o que foi arquivado,
        // sem precisar de uma coluna nova por campo a cada mudança de formulário.
        snapshot: {
            bikeId: bikeId, seller: seller, brand: brand, model: model,
            mileage: mileage, email: email, frame: frame, year: year, battery: battery,
            notes: damage, datum: datum, uhrzeit: uhrzeit, warehouse: warehouse,
            acc: { akku: akku, lade: lade, schl: schl, disp: disp }
        }
    });

    return {
        success: true,
        bikeId: bikeId,
        fileName: fileName,
        pdfUrl: fileUrl,
        folderPath: `${now.getFullYear()} > ${dayFolder}`
    };
}


/**
 * Generates 1:1 Einlieferungsbeleg HTML matched 100% to Upway Drop-off Portal v2 design handoff
 */
function generateEinlieferungsbelegHTML(d) {
    d = d || {};
    const whKey = normStr(d.warehouse || 'berlin');
    
    let wh = WAREHOUSE_MAP[whKey];
    if (!wh) {
        for (let k in WAREHOUSE_MAP) {
            if (normStr(WAREHOUSE_MAP[k].name) === whKey) {
                wh = WAREHOUSE_MAP[k];
                break;
            }
        }
    }
    if (!wh) wh = WAREHOUSE_MAP['berlin'];

    const whUpper = wh.name.toUpperCase();
    const whCity = wh.city;
    const whName = wh.name;
    const whReviewUrl = reviewUrlFor(wh);
    const isBerlin = (whKey === 'berlin' || normStr(wh.name) === 'berlin');

    const bikeId = escapeHtml(String(d.bikeId || '—').trim().toUpperCase());
    const seller = escapeHtml(String(d.seller || '—').trim());
    const brand = String(d.brand || '').trim();
    const model = String(d.model || '').trim();
    const bikeName = escapeHtml((brand + ' ' + model).trim() || '—');
    
    let mileageFormatted = '—';
    if (d.mileage) {
        const cleanM = String(d.mileage).replace(/[^0-9]/g, '');
        if (cleanM) {
            mileageFormatted = Number(cleanM).toLocaleString('de-DE') + ' km';
        }
    }

    const email = escapeHtml(String(d.email || '—').trim());
    const frame = escapeHtml(String(d.frame || '—').trim().toUpperCase());
    const year = escapeHtml(String(d.year || '—').trim());
    const battery = escapeHtml(String(d.battery || '—').trim());
    const damage = escapeHtml(String(d.damage || d.notes || '—').trim());
    const datum = escapeHtml(d.datum || formatDateGerman(new Date()));
    const uhrzeit = escapeHtml(d.uhrzeit || formatTimeGerman(new Date()));

    const akku = !!d.akku;
    const lade = !!d.lade;
    const schl = !!d.schl;
    const disp = !!d.disp;

    const LOGO_SVG = upwayLogoSvg(20);

    /**
     * Checkbox do Zubehör.
     *
     * Antes eram <span> vazios (um com SVG dentro, um sem nada) e o conversor não
     * desenhava nenhum dos dois: o Beleg saía com "Akku Ladegerät Schlüssel Display"
     * e nenhuma caixa — impossível saber o que o cliente entregou.
     *
     * Agora: `display: block` com tamanho fixo e `flex: 0 0 15px` (item de flex sem
     * conteúdo colapsa), e o estado vem da COR DE FUNDO, não de um glifo. Se o "✓" não
     * existir na fonte do conversor, ainda sobra quadrado azul cheio vs. contorno
     * vazio — a informação sobrevive.
     */
    function renderCheckbox(label, checked) {
        const box = checked
            ? '<span style="flex: 0 0 15px; display: block; width: 15px; height: 15px; border-radius: 4px; box-sizing: border-box; background: #4733FF; border: 1px solid #4733FF; color: #FFFFFF; font-size: 11px; line-height: 13px; font-weight: 700; text-align: center;">&#10003;</span>'
            : '<span style="flex: 0 0 15px; display: block; width: 15px; height: 15px; border-radius: 4px; box-sizing: border-box; background: #FFFFFF; border: 1px solid #9E9EAF; font-size: 0; line-height: 0;">&nbsp;</span>';

        return `
              <div style="display: flex; align-items: center; gap: 8px;">
                ${box}
                <span style="font-size: 13.5px; color: #0E0E14;">${label}</span>
              </div>
            `;
    }

    const qrApiUrl = qrImageSrc(whReviewUrl);

    return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <title>Einlieferungsbeleg ${bikeId}</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    body { background: #FFFFFF; color: #0E0E14; -webkit-font-smoothing: antialiased; }
    
    /* Em mm, não em px: este PDF é o que vai para a impressora, e o conversor
       HTML→PDF não garante o mesmo dpi de viewport que o navegador. 210x297mm é a
       folha; a margem lateral do texto vem do padding (= 60/64/52px do design). */
    .a4-page {
      width: 210mm;
      /* 296mm: folha do mesmo tamanho do box da pagina transborda por arredondamento
         e gera uma folha em branco depois de cada pagina. 1mm de folga e invisivel. */
      height: 296mm;
      box-sizing: border-box;
      background: #FFFFFF;
      position: relative;
      padding: 15.9mm 16.9mm 13.8mm;
      margin: 0 auto;
      overflow: hidden;
    }
    
    .page-break {
      page-break-after: always;
      break-after: page;
    }

    /* ⚠️ O conversor HTML→PDF do Apps Script COLAPSA elemento vazio, mesmo com width e
       height explícitos — foi por isso que os checkboxes do Zubehör e as réguas das
       seções saíam invisíveis no Beleg (o box de NOTIZEN aparecia porque tem texto).
       Padrão usado em todo filete e caixa daqui: um &nbsp; dentro, com font-size e
       line-height zerados, para o elemento ter conteúdo sem ganhar altura de texto.
       Se for criar outro filete ou caixa neste HTML, siga o mesmo padrão. */
    .top-blue-bar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 5px;
      background: #4733FF;
      font-size: 0;
      line-height: 0;
    }
    .hairline { font-size: 0; line-height: 0; }

    .a4-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
    }

    .a4-wh-info {
      text-align: right;
      font-size: 11px;
      line-height: 1.5;
      color: #717182;
    }

    .a4-wh-title {
      font-weight: 700;
      letter-spacing: 0.06em;
      color: #0E0E14;
      text-transform: uppercase;
    }

    .sec-rule-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 34px;
    }
    .sec-num { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: #4733FF; }
    .sec-title { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; color: #0E0E14; }
    .sec-line { flex: 1 1 auto; height: 1px; background: #EAEAEF; font-size: 0; line-height: 0; }

    .field-pair { padding-bottom: 10px; border-bottom: 1px solid #EAEAEF; }
    .field-lbl { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: #717182; text-transform: uppercase; }
    .field-val { margin-top: 7px; font-size: 16px; color: #0E0E14; word-break: break-word; }
    .field-val.blue-highlight { font-weight: 700; letter-spacing: 0.03em; color: #3725E5; }

    .a4-footer {
      position: absolute;
      left: 16.9mm;
      right: 16.9mm;
      bottom: 9.5mm;
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: #717182;
    }
  </style>
</head>
<body>

  <!-- PAGE 1 -->
  <div class="a4-page page-break">
    <div class="top-blue-bar">&nbsp;</div>
    <div class="a4-header">
      ${LOGO_SVG}
      <div class="a4-wh-info">
        <div class="a4-wh-title">UPCENTER ${whUpper}</div>
        <div>${whCity}</div>
      </div>
    </div>

    <h1 style="margin: 40px 0 0; font-size: 28px; line-height: 1.12; letter-spacing: -0.02em; font-weight: 700;">Einlieferungsbeleg</h1>
    <p style="margin: 8px 0 0; font-size: 13px; color: #4A4A5A;">Nachweis über die physische Abgabe eines E-Bikes zum Ankauf</p>

    <!-- Section 01 -->
    <div class="sec-rule-header" style="margin-top: 38px;">
      <span class="sec-num">01</span>
      <span class="sec-title">VERKÄUFER*IN</span>
      <span class="sec-line">&nbsp;</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 18px;">
      <div class="field-pair">
        <div class="field-lbl">BIKE-ID</div>
        <div class="field-val blue-highlight">${bikeId}</div>
      </div>
      <div class="field-pair">
        <div class="field-lbl">NAME VERKÄUFER*IN</div>
        <div class="field-val">${seller}</div>
      </div>
    </div>

    <!-- Section 02 -->
    <div class="sec-rule-header">
      <span class="sec-num">02</span>
      <span class="sec-title">FAHRZEUGDATEN</span>
      <span class="sec-line">&nbsp;</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 18px 28px; margin-top: 18px;">
      <div class="field-pair">
        <div class="field-lbl">MARKE &amp; MODELL</div>
        <div class="field-val">${bikeName}</div>
      </div>
      <div class="field-pair">
        <div class="field-lbl">KILOMETERSTAND</div>
        <div class="field-val">${mileageFormatted}</div>
      </div>
      <div class="field-pair">
        <div class="field-lbl">RAHMENNUMMER</div>
        <div class="field-val">${frame}</div>
      </div>
      <!-- Ocupa a coluna que ficava vazia ao lado da Rahmennummer -->
      <div class="field-pair">
        <div class="field-lbl">E-MAIL</div>
        <div class="field-val">${email}</div>
      </div>
      ${!isBerlin ? `
      <div class="field-pair">
        <div class="field-lbl">JAHR</div>
        <div class="field-val">${year}</div>
      </div>
      <div class="field-pair">
        <div class="field-lbl">BATTERIEKAPAZITÄT</div>
        <div class="field-val">${battery}</div>
      </div>
      ` : ''}
    </div>

    <!-- Section 03 -->
    <div class="sec-rule-header">
      <span class="sec-num">03</span>
      <span class="sec-title">ÜBERGABE-CHECKLISTE</span>
      <span class="sec-line">&nbsp;</span>
    </div>
    <div style="margin-top: 18px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: #717182;">ZUBEHÖR</div>
    <div style="display: flex; gap: 30px; margin-top: 12px;">
      ${renderCheckbox('Akku', akku)}
      ${renderCheckbox('Ladegerät', lade)}
      ${renderCheckbox('Schlüssel', schl)}
      ${renderCheckbox('Display', disp)}
    </div>

    <div style="margin-top: 24px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; color: #717182;">NOTIZEN</div>
    <div style="margin-top: 9px; min-height: 120px; padding: 14px 16px; box-sizing: border-box; border: 1px solid #D4D4DE; border-radius: 8px; font-size: 13.5px; line-height: 1.55; color: #0E0E14; white-space: pre-wrap;">${damage}</div>

    <div class="a4-footer">
      <span>Upway · Einlieferungsbeleg ${bikeId}</span>
      <span>Seite 1 / 2</span>
    </div>
  </div>

  <!-- PAGE 2 -->
  <div class="a4-page">
    <div class="top-blue-bar">&nbsp;</div>
    <div class="a4-header">
      ${LOGO_SVG}
      <div class="a4-wh-info">
        <div class="a4-wh-title">UPCENTER ${whUpper}</div>
        <div>${whCity}</div>
      </div>
    </div>

    <!-- Section 04 -->
    <div class="sec-rule-header" style="margin-top: 40px;">
      <span class="sec-num">04</span>
      <span class="sec-title">RECHTLICHE HINWEISE</span>
      <span class="sec-line">&nbsp;</span>
    </div>
    <p style="margin: 18px 0 0; font-size: 13px; line-height: 1.6; color: #0E0E14;">Mit der Abgabe im UpCenter ${whName} erkennt der/die Verkäufer*in folgende Bedingungen an:</p>

    <div style="margin-top: 16px; display: flex; flex-direction: column; gap: 14px;">
      <div style="display: grid; grid-template-columns: 20px 1fr; gap: 10px;">
        <span style="font-size: 13px; font-weight: 700; color: #4733FF;">1.</span>
        <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #0E0E14;"><strong style="font-weight: 700;">Technische Tiefenprüfung:</strong> Dieser Beleg bestätigt nur den Erhalt der Hardware. Die finale technische Prüfung und Bestätigung des Ankaufspreises erfolgen zeitversetzt durch unsere Experten (§ III AGB).</p>
      </div>
      <div style="display: grid; grid-template-columns: 20px 1fr; gap: 10px;">
        <span style="font-size: 13px; font-weight: 700; color: #4733FF;">2.</span>
        <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #0E0E14;"><strong style="font-weight: 700;">Eigentumsvorbehalt (§ VIII):</strong> Das E-Bike bleibt bis zur vollständigen Auszahlung des Kaufpreises durch Upway im Eigentum des/der Verkäufer*in.</p>
      </div>
      <div style="display: grid; grid-template-columns: 20px 1fr; gap: 10px;">
        <span style="font-size: 13px; font-weight: 700; color: #4733FF;">3.</span>
        <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #0E0E14;"><strong style="font-weight: 700;">Akku-Sicherheit (§ IX):</strong> Der/die Verkäufer*in versichert, dass weder der Akku noch der Motor beschädigt oder technisch manipuliert wurden.</p>
      </div>
    </div>

    <!-- Section 05 -->
    <div class="sec-rule-header" style="margin-top: 40px;">
      <span class="sec-num">05</span>
      <span class="sec-title">BESTÄTIGUNG DER EINLIEFERUNG</span>
      <span class="sec-line">&nbsp;</span>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 18px;">
      <div class="field-pair">
        <div class="field-lbl">DATUM</div>
        <div class="field-val">${datum}</div>
      </div>
      <div class="field-pair">
        <div class="field-lbl">UHRZEIT</div>
        <div class="field-val">${uhrzeit}</div>
      </div>
    </div>

    <!-- Signature -->
    <div style="margin-top: 52px; width: 300px;">
      <div class="hairline" style="height: 1px; background: #2E2E38;">&nbsp;</div>
      <div style="margin-top: 9px; font-size: 10.5px; color: #717182;">Unterschrift Upway (Annahme)</div>
    </div>

    <div class="hairline" style="margin-top: 52px; height: 1px; background: #EAEAEF;">&nbsp;</div>

    <!-- Thank you & Google review badge -->
    <div style="display: flex; align-items: center; gap: 28px; margin-top: 28px;">
      <div style="flex: 1;">
        <div style="font-size: 17px; font-weight: 700; letter-spacing: -0.01em;">Danke für Ihr Vertrauen!</div>
        <p style="margin: 9px 0 0; max-width: 320px; font-size: 13px; line-height: 1.6; color: #4A4A5A;">Wir möchten uns stetig verbessern. Hat heute alles geklappt? Dann freuen wir uns über Ihre Bewertung.</p>
      </div>

      <!-- Selo oficial do Beleg legado + QR do UpCenter que emitiu (não fixo em Berlim). -->
      <div style="display: flex; align-items: center; gap: 16px;">
        <img src="${reviewBadgeSrc()}" alt="Review us on Google" style="width: 120px; height: 72px; object-fit: contain;">
        <div style="width: 88px; height: 88px; border: 1px solid #D4D4DE; border-radius: 8px; padding: 4px; background: #FFFFFF; display: flex; align-items: center; justify-content: center;">
          <img src="${qrApiUrl}" alt="QR Google-Bewertung" style="width: 100%; height: 100%; object-fit: contain;">
        </div>
      </div>
    </div>

    <div class="a4-footer">
      <span>Upway · Einlieferungsbeleg ${bikeId}</span>
      <span>Seite 2 / 2</span>
    </div>
  </div>

</body>
</html>`;
}


// Helper Utilities
/**
 * Sem fallback silencioso para a raiz do Drive: se o ID estiver errado ou sem acesso,
 * é melhor falhar visível do que arquivar Belege numa pasta que ninguém procura.
 */
function getDriveFolder(folderId) {
    try {
        return DriveApp.getFolderById(folderId);
    } catch (e) {
        throw new Error(`Could not open Drive folder ${folderId}. Check CONFIG.SHARED_DRIVE_FOLDER_ID and your account's access to the Shared Drive. (${e.message || e})`);
    }
}


/**
 * QR como data URI. Duas razões para não usar <img src="api..."> direto:
 * o conversor HTML→PDF do Apps Script não é confiável com imagem externa, e um Beleg
 * é documento de cliente — não pode depender de um serviço de terceiro estar de pé na
 * hora da impressão. Por isso o resultado fica em cache por URL: cada armazém depende
 * da rede uma única vez na vida.
 */
function qrImageSrc(url) {
    const cacheKey = 'QR_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(
        Utilities.DigestAlgorithm.MD5, url));
    const props = PropertiesService.getScriptProperties();

    const cached = props.getProperty(cacheKey);
    if (cached) return cached;

    const api = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=M&margin=8&data=${encodeURIComponent(url)}`;
    try {
        const resp = UrlFetchApp.fetch(api, { muteHttpExceptions: true });
        if (resp.getResponseCode() === 200) {
            const uri = 'data:image/png;base64,' + Utilities.base64Encode(resp.getBlob().getBytes());
            // Limite de 9 KB por propriedade; um QR 200x200 fica bem abaixo disso.
            if (uri.length < 9000) props.setProperty(cacheKey, uri);
            return uri;
        }
    } catch (e) {
        // Cai para a URL direta abaixo — degrada visível, não silencioso.
    }
    return api;
}


function getOrCreateSubFolder(parent, name) {
    const iter = parent.getFoldersByName(name);
    return iter.hasNext() ? iter.next() : parent.createFolder(name);
}
