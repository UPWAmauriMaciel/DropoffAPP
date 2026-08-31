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
  const iso = (n) => { const d = new Date(Date.now() + n*86400000);
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };

  // O servidor manda o card INTEIRO, sem os snapshots. warehouse e dropOffDate vem em
  // toda linha porque o filtro agora e do cliente.
  const rows = [
    { bikeId:"RK2EP9", bikeName:"Stromer ST3", brand:"Stromer", model:"ST3", year:"2022", mileage:"1240", customerName:"Lena Hoffmann", email:"lena.hoffmann@gmx.de", quote:"€ 1.890", warehouse:"berlin", dropOffDate:iso(0), isProcessed:true },
    { bikeId:"RK2FP1", bikeName:"Riese & Müller Charger3 <GT>", brand:"Riese & Müller", model:"Charger3 <GT>", year:"2021", mileage:"3480", customerName:"Tobias O'Brien & Sohn", email:"tobias@web.de", quote:"€ 2.240", warehouse:"berlin", dropOffDate:iso(0), isProcessed:false },
    { bikeId:"RK2GU8", bikeName:"Cube Reaction", brand:"Cube", model:"Reaction Hybrid Pro", year:"2023", mileage:"620", customerName:"Miriam Sanders", quote:"€ 1.150", warehouse:"berlin", dropOffDate:iso(0), isProcessed:false }
  ];

  // Os snapshots vivem FORA da fila: so chegam por getSavedSnapshot, um por vez.
  const saved = {
    RK2EP9: { seller:"Lena Hoffmann", email:"lena.arquivada@gmx.de", brand:"Stromer", model:"ST3", mileage:"1240", frame:"WBK1234567", year:"2022", battery:"983 Wh", notes:"Kratzer am Rahmen", datum:"09.08.2026", uhrzeit:"11:20", acc:{akku:true,lade:true,schl:true,disp:false} }
  };

  // Feed sem NADA em Berlin hoje: 12 em Düsseldorf, 2 em Berlin nos proximos dias,
  // 1 em Berlin nos ultimos. E o cenario do estado vazio por FILTRO.
  const mk = (id, wh, d) => ({ bikeId:id, bikeName:"Bike", brand:"B", model:"M", year:"2022", mileage:"100", customerName:"C", quote:"€ 1.000", warehouse:wh, dropOffDate:d, isProcessed:false });
  const emptyRows = [];
  for (let i=0;i<12;i++) emptyRows.push(mk('DUS'+i, 'dusseldorf', iso(0)));
  emptyRows.push(mk('BERN1','berlin',iso(3)), mk('BERN2','berlin',iso(5)), mk('BERP1','berlin',iso(-2)));

  let handler=null, fail=null;
  const snapshot = () => {
    const r = window.__emptyNext ? (window.__emptyNext=false, emptyRows) : rows;
    return { success:true, refreshedAt:new Date().toISOString(), total:r.length, rows:r };
  };
  const api = {
    withSuccessHandler(h){ handler=h; return api; },
    withFailureHandler(f){ fail=f; return api; },
    getScheduleSnapshot(){ console.log('[stub] getScheduleSnapshot');
      setTimeout(()=>handler(snapshot()),80); },
    refreshScheduleSnapshot(){ console.log('[stub] refreshScheduleSnapshot');
      setTimeout(()=>handler(snapshot()),80); },
    getSavedSnapshot(id){ console.log('[stub] getSavedSnapshot', id);
      setTimeout(()=>handler(saved[id] || null),40); },
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
