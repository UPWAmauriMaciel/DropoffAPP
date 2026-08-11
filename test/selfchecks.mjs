/**
 * Roda runSelfChecks() do Code.gs fora do Apps Script.
 *
 * Os helpers puros (formatacao alema, casamento de armazem, nome de arquivo, markup do
 * Beleg) sao testaveis sem rede e sem planilha — basta stubar as globais do Apps Script.
 * runSelfChecks() tambem existe no editor: rode a funcao por lá para validar no ambiente
 * real, com as APIs de verdade.
 */
import fs from 'fs';
import path from 'path';

const repoPath = (f) => path.join(import.meta.dirname, '..', f);

// ---- stubs minimos do Apps Script ----
globalThis.Logger = { log: (m) => console.log(m) };
globalThis.Session = { getActiveUser: () => ({ getEmail: () => 'operador@upway.shop' }) };
globalThis.ScriptApp = { getOAuthToken: () => 'stub-token' };
globalThis.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getSheetByName: () => null }) };
globalThis.HtmlService = {
  createHtmlOutputFromFile: () => ({ getContent: () => 'data:image/png;base64,AAA' })
};
globalThis.PropertiesService = {
  getScriptProperties: () => ({ getProperty: () => null, setProperty: () => {}, deleteProperty: () => {} }),
  getUserProperties: () => ({ getProperty: () => null, deleteProperty: () => {} })
};
globalThis.Utilities = {
  base64Encode: () => 'AAAA',
  base64EncodeWebSafe: () => 'KEY',
  computeDigest: () => [1],
  DigestAlgorithm: { MD5: 'MD5' }
};
// Sem rede no teste: qrImageSrc cai no fallback, que e o comportamento esperado.
globalThis.UrlFetchApp = { fetch: () => { throw new Error('sem rede no self-check'); } };

const code = fs.readFileSync(repoPath('Code.gs'), 'utf8');
new Function(code + '\n;runSelfChecks();')();
