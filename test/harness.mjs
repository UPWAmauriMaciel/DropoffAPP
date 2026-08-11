// Monta o harness a partir do CheckinPortal.html REAL.
// Sem substituicao de template: o servidor agora entrega o arquivo do disco byte a byte
// (createHtmlOutputFromFile), entao o que este teste carrega e o que o operador recebe.
import fs from 'fs';
import path from 'path';
import { srcPath } from './apps-script.mjs';

const src = fs.readFileSync(srcPath('CheckinPortal.html'), 'utf8');

// Guard permanente: um scriptlet no arquivo significa que o HTML servido != arquivo
// testado. Foi exatamente isso que causou o "Unexpected end of input" no navegador.
const at = src.indexOf('<' + '?');
if (at !== -1) {
  throw new Error('scriptlet de template no HTML (o servido deixa de ser o testado): ' + src.slice(at, at + 70));
}

const stub = `
<script>
window.google = { script: { run: (function(){
  const rows = [
    { bikeId:"RK2EP9", bikeName:"Stromer ST3", brand:"Stromer", model:"ST3", year:"2022", mileage:"1240", customerName:"Lena Hoffmann", email:"lena.hoffmann@gmx.de", quote:"\\u20ac 1.890", isProcessed:true,
      saved:{ seller:"Lena Hoffmann", email:"lena.arquivada@gmx.de", brand:"Stromer", model:"ST3", mileage:"1240", frame:"WBK1234567", year:"2022", battery:"983 Wh", notes:"Kratzer am Rahmen", datum:"09.08.2026", uhrzeit:"11:20", acc:{akku:true,lade:true,schl:true,disp:false} } },
    { bikeId:"RK2FP1", bikeName:"Riese & M\\u00fcller Charger3 <GT>", brand:"Riese & M\\u00fcller", model:"Charger3 <GT>", year:"2021", mileage:"3480", customerName:"Tobias O'Brien & Sohn", email:"tobias@web.de", quote:"\\u20ac 2.240", isProcessed:false, saved:null },
    { bikeId:"RK2GU8", bikeName:"Cube Reaction", brand:"Cube", model:"Reaction Hybrid Pro", year:"2023", mileage:"620", customerName:"Miriam Sanders", quote:"\\u20ac 1.150", isProcessed:false, saved:null }
  ];
  const full = { totalRows:rows.length, byWarehouse:{berlin:3}, selectedWarehouse:{today:3,next10days:0,past10days:0,otherDates:0} };
  const empty = { totalRows:19, byWarehouse:{berlin:3, dusseldorf:12, amsterdam:4}, selectedWarehouse:{today:0,next10days:2,past10days:1,otherDates:0} };
  let handler=null, fail=null;
  const api = {
    withSuccessHandler(h){ handler=h; return api; },
    withFailureHandler(f){ fail=f; return api; },
    getMetabaseData(p){ console.log('[stub] getMetabaseData', JSON.stringify(p));
      if (window.__emptyNext) { window.__emptyNext=false;
        setTimeout(()=>handler({success:true, total:0, rows:[], summary:empty}),80); return; }
      setTimeout(()=>handler({success:true, warehouse:p.warehouse, dateFilter:p.dateFilter, total:rows.length, rows:rows, summary:full}),80); },
    getDocAssets(wh){ console.log('[stub] getDocAssets', wh);
      setTimeout(()=>handler({ badge:'data:image/png;base64,BADGE'+wh, qr:'data:image/png;base64,QR'+wh }),40); },
    processDropoffDocument(p){ console.log('[stub] processDropoffDocument', p.bikeId, p.frame);
      setTimeout(()=>handler({success:true, bikeId:p.bikeId, folderPath:'2026 > 08-11'}),80); }
  };
  return api;
})() } };
<\/script>
`;

const out = src.replace('</body>', stub + '</body>');
fs.writeFileSync(path.join(import.meta.dirname,'portal_harness.html'), out);
console.log('ok — arquivo servido == arquivo testado (+ stub), bytes=', out.length);
