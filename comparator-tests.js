#!/usr/bin/env node
/**
 * comparator-tests.js — complete, self-contained test harness for Comparator.
 *
 *   node comparator-tests.js [path-to-build.html]
 *
 * Defaults to ./comparator_offline53.html, then ../comparator_offline53.html.
 * Node only: no install, no network, no other files. 60 tests.
 *
 * WHY ONE FILE: Comparator ships as a single self-contained HTML, and this
 * harness follows suit so it can live in a Project alongside it. An earlier
 * split-file version was lost between sessions, taking 72 tests with it.
 *
 * HOW IT WORKS: the build's testable functions are lifted out of the HTML by
 * marker, then evaluated in a per-suite sandbox that stubs the browser globals
 * they touch (document, state, COL, XLSX...). Each suite gets its own sandbox
 * because the modules expect different COL shapes.
 *
 * IF EXTRACTION FAILS: the error names the marker that moved. The build was
 * refactored; update the marker below. Failing loudly is deliberate — an empty
 * module would let every suite pass while testing nothing.
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const CANDIDATES = [
  process.argv[2], process.env.COMPARATOR_BUILD,
  path.join(__dirname, 'comparator_offline53.html'),
  path.join(__dirname, '..', 'comparator_offline53.html'),
].filter(Boolean);
const BUILD = CANDIDATES.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
if (!BUILD) {
  console.error('Build HTML not found. Tried:\n  ' + CANDIDATES.join('\n  ') +
                '\nPass one: node comparator-tests.js path/to/comparator_offline53.html');
  process.exit(1);
}
const SRC = fs.readFileSync(BUILD, 'utf8');
console.log('Build under test: ' + BUILD + '\n');

// ── extraction ─────────────────────────────────────────────────────────────
function at(marker, from) {
  const i = typeof marker === 'string'
    ? SRC.indexOf(marker, from || 0)
    : (function () { const m = SRC.slice(from || 0).match(marker); return m ? m.index + (from || 0) : -1; })();
  if (i < 0) throw new Error('BUILD MARKER MOVED: ' + marker);
  return i;
}
function grabFn(name) {
  const i = at('function ' + name + '(');
  let d = 0, k = SRC.indexOf('{', i);
  for (;; k++) { if (SRC[k] === '{') d++; else if (SRC[k] === '}') { d--; if (!d) break; } }
  return SRC.slice(i, k + 1);
}
const MOD = {};
{ // proc code table + behaviour panel
  const a = at('const PROC_CODE_BASELINE = {');
  const g = at('function getProcBehavior');
  const b = SRC.indexOf('}', SRC.indexOf('return PROC_CODE_EXCEPTIONS', g)) + 1;
  const m1 = at(/\/\/ ═+\n\/\/ v\d+ — PROC CODE BEHAVIOR PANEL/);
  const m2 = at('// ── EBOM manual column mapping (proof of concept)', m1);
  MOD.proc = SRC.slice(a, b) + '\n' + SRC.slice(m1, m2) + `
globalThis.P = { abomProcCodeInventory, _procRowHtml, _procHeaderRow, PROC_JOB_SAMPLES,
  get PROC_CODE_EXCEPTIONS(){return PROC_CODE_EXCEPTIONS;},
  get PROC_CODE_BASELINE(){return PROC_CODE_BASELINE;},
  get dirty(){return _procDirtySinceRun;}, set dirty(v){_procDirtySinceRun=v;},
  setProcCodeMap, setProcCodeBehavior, getProcBehavior, isProcMapCustom,
  _procProfileLabel, _procCodesWithBehavior, _procCodeListText,
  toggleProcCodePanel, renderProcCodePanel };`;
}
MOD.engine = grabFn('normPN') + '\n' + grabFn('buildAbomMap') +
  '\nglobalThis.E = { normPN, buildAbomMap };';
{ // ECN footprints
  let a = at(/\/\/ v\d+ — ECN FOOTPRINT \(B1 \/ B2 \/ B4\)/);
  a = SRC.lastIndexOf('// ═══', a);
  MOD.ecn = SRC.slice(a, at('function exportChangeCommitmentClosures()')) + '\n' +
    SRC.slice(at('function _ecnStatusLooksClosed('), at('function exportPrematureEcnClosures(')) +
    '\nglobalThis.B = { buildEcnFootprints, _chpEcnItemIndex, _ecnOpenDispositions, _ecnStatusLooksClosed };';
}
{ // untraced NCR dispositions
  const a = at('function computeUntracedNcrs()');
  const b = at(/\/\/ ── v\d+ — NCR DISPOSITIONS WITHOUT EBOM TRACE \(EXPORT\)/, a);
  const c = at('function exportUntracedNcrDispositions()');
  MOD.ncr = SRC.slice(a, b) + '\n' + SRC.slice(c, at('// ── ACN KPI HELPER', c)) +
    '\nglobalThis.N = { computeUntracedNcrs, exportUntracedNcrDispositions };';
}

// ── sandbox ────────────────────────────────────────────────────────────────
function el() { return { textContent:'', innerHTML:'', value:'',
  classList:{ c:new Set(), toggle(n,v){v?this.c.add(n):this.c.delete(n);}, add(n){this.c.add(n);}, remove(n){this.c.delete(n);} } }; }
function sandbox(extra, mods) {
  const els = {};
  const ctx = Object.assign({
    console, JSON, Math, Date, Set, Map, Array, Object, String, Number, Boolean,
    RegExp, Error, isNaN, parseFloat, parseInt, Buffer, prompt: () => 'Test',
    document: { getElementById: id => (els[id] = els[id] || el()), querySelectorAll: () => [] },
    toast: () => {}, showError: () => {}, applySheetFont: () => {},
    tsFilename: (b, e) => b + '.' + e, downloadFile: () => {}, FileReader: class { readAsText(f){ this.onload({target:{result:f._text}}); } },
    _STATUS_ADJUDICATED_LEAF: new Set(['adj_ok']),
    buildEbomIndentureMap: function (d, i, p, n) {
      const ki = {};
      d.forEach(r => { const k = ctx.normPN(r[p]) + '||' + ctx.normPN(r[n]);
        if (!ki[k]) ki[k] = { pn: ctx.normPN(r[p]), nh: ctx.normPN(r[n]), childKeys: new Set() }; });
      Object.keys(ki).forEach(k => Object.keys(ki).forEach(c => { if (c !== k && ki[c].nh === ki[k].pn) ki[k].childKeys.add(c); }));
      return { keyInfo: ki };
    },
    __els: els,
  }, extra);
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  (mods || []).forEach(m => vm.runInContext(MOD[m], ctx, { filename: m + '.js' }));
  return ctx;
}

// ── runner ─────────────────────────────────────────────────────────────────
let TP = 0, TF = 0; const FAILED = [];
function suite(name, fn) {
  console.log('── ' + name + ' ' + '─'.repeat(Math.max(0, 56 - name.length)));
  let pass = 0, fail = 0;
  const t = (n, f) => { try { f(); console.log('  PASS  ' + n); pass++; }
                        catch (e) { console.log('  FAIL  ' + n + '\n        ' + e.message); fail++; } };
  const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b))
    throw new Error((m || '') + ' expected ' + JSON.stringify(b) + ' got ' + JSON.stringify(a)); };
  try { fn(t, eq); } catch (e) { console.log('  FAIL  suite crashed: ' + e.message); fail++; }
  console.log('  ' + pass + ' passed, ' + fail + ' failed\n');
  TP += pass; TF += fail; if (fail) FAILED.push(name);
}


suite('Engine — tagging changes reconciliation output', (t, eq) => {
  const ctx = sandbox({ COL:{abom:{procCode:12,desc:10,jobNo:5}},
    state:{boms:{abom:null},results:[],isLocked:false,procOverrides:null,procProfileName:null} },
    ['proc','engine']);
  const P = ctx.P, buildAbomMap = ctx.E.buildAbomMap;
  // usedOn=8 pn=9 procCode=12 qty=13 woNo=35 woStatus=36
  const arow=(pn,nh,proc,qty,wo)=>{const r=new Array(40).fill('');
    r[8]=nh;r[9]=pn;r[12]=proc;r[13]=qty;r[35]=wo||'WO1';r[36]='CLOSED';return r;};
  const build = rows => buildAbomMap(rows, 9, 8, 13, 35, 36, 12);
  const K='P100||A1';

  console.log('\n== A new program\'s removal code, before and after tagging ==');
  t('untagged XR behaves as an install', ()=>{
    P.setProcCodeMap(null);
    const m=build([arow('P100','A1','XR',2)]);
    eq(m[K].allProcsAreRemovalOrSwap,false); eq(m[K].qty,2);
  });
  t('tagging XR as remove flips the same rows to proc-removed', ()=>{
    P.setProcCodeMap(null); P.setProcCodeBehavior('XR','remove');
    const m=build([arow('P100','A1','XR',2)]);
    eq(m[K].allProcsAreRemovalOrSwap,true,'flagged:'); eq(m[K].qty,-2,'net qty:');
  });
  t('an install row alongside the removal nets out', ()=>{
    const m=build([arow('P100','A1','AI',3),arow('P100','A1','XR',1)]);
    eq(m[K].allProcsAreRemovalOrSwap,false); eq(m[K].qty,2);
  });

  console.log('\n== Swap semantics on a user-tagged code ==');
  t('swap-only key is treated as present, not removed', ()=>{
    P.setProcCodeMap(null); P.setProcCodeBehavior('TSW','swap');
    const m=build([arow('P100','A1','TSW',4)]);
    eq(m[K].allProcsAreRemovalOrSwap,false,'swap-only must not read as removed:');
    eq(m[K].qty,4);
  });
  t('swap alongside an install is net-zero', ()=>{
    const m=build([arow('P100','A1','AI',5),arow('P100','A1','TSW',5)]);
    eq(m[K].qty,5); eq(m[K].allProcsAreRemovalOrSwap,false);
  });

  console.log('\n== The founding program is unaffected ==');
  t('baseline codes produce identical maps', ()=>{
    P.setProcCodeMap(null);
    const m=build([arow('P1','A','BR',2),arow('P1','A','AI',5),arow('P2','A','DR',3),
                   arow('P3','A','MR',1),arow('P4','A','OTHER',7)]);
    eq(m['P1||A'].qty,3,'5 installed - 2 removed:');
    eq(m['P2||A'].allProcsAreRemovalOrSwap,false,'swap-only present:');
    eq(m['P3||A'].allProcsAreRemovalOrSwap,true,'removal-only:');
    eq(m['P4||A'].qty,7,'unknown code installs:');
  });
  t('untagging one default changes that code and nothing else', ()=>{
    P.setProcCodeMap(null); P.setProcCodeBehavior('BR','add');
    const m=build([arow('P1','A','BR',2),arow('P2','A','MR',2)]);
    eq(m['P1||A'].qty,2); eq(m['P2||A'].allProcsAreRemovalOrSwap,true,'MR still removes:');
  });

  console.log('\n== Dedup reaches the engine ==');
  t('mixed-case spellings of a tagged code are all classified', ()=>{
    P.setProcCodeMap(null); P.setProcCodeBehavior('XR','remove');
    const m=build([arow('P100','A1','xr',1),arow('P100','A1',' XR ',1)]);
    eq(m[K].allProcsAreRemovalOrSwap,true); eq(m[K].qty,-2);
  });

  console.log('\n== Worker stays in lockstep ==');
  t('the serialized worker table is the ACTIVE table', ()=>{
    P.setProcCodeMap(null); P.setProcCodeBehavior('XR','remove');
    const decl='const PROC_CODE_EXCEPTIONS = '+JSON.stringify(P.PROC_CODE_EXCEPTIONS)+';';
    if(!decl.includes('"XR":"remove"')) throw new Error('worker would not see XR');
    const box={}; new Function('o', decl+' o.map = PROC_CODE_EXCEPTIONS;')(box);
    eq(box.map['XR'],'remove'); eq(box.map['BR'],'remove','defaults carried:');
  });
});

suite('Proc code panel — job number samples', (t, eq) => {
  const ctx = sandbox({ COL:{abom:{procCode:12,desc:10,jobNo:5}},
    state:{boms:{abom:null},results:[],isLocked:false,procOverrides:null,procProfileName:null} }, ['proc']);
  const T = ctx.P, state = ctx.state, els = ctx.__els;
  // Mapping 1 row: job at 5, desc at 10, proc at 12
  const row=(proc,job,desc)=>{const r=new Array(40).fill('');r[12]=proc;r[5]=job||'';r[10]=desc||'';return r;};
  const load=rows=>{state.boms.abom={data:rows};};
  const jobsOf=c=>[...(T.abomProcCodeInventory().codes.find(x=>x.code===c)||{jobs:new Set()}).jobs];

  console.log('\n== Job numbers collected and deduplicated ==');
  t('distinct job numbers only', ()=>{
    load([row('XR','J100'),row('XR','J100'),row('XR','J200'),row('XR','J100')]);
    eq(jobsOf('XR'),['J100','J200']);
  });
  t('job numbers are kept verbatim (no normalising)', ()=>{
    load([row('XR',' J-100/A ')]);
    eq(jobsOf('XR'),['J-100/A'],'trimmed but not uppercased:');
  });
  t('blank job numbers are skipped, not stored as empty', ()=>{
    load([row('XR',''),row('XR','   '),row('XR','J1')]);
    eq(jobsOf('XR'),['J1']);
  });
  t('each proc code keeps its own job set', ()=>{
    load([row('XR','J1'),row('TSW','J2'),row('XR','J3')]);
    eq(jobsOf('XR'),['J1','J3']); eq(jobsOf('TSW'),['J2']);
  });

  console.log('\n== Panel renders at most 3, one per line ==');
  function cell(html){const m=html.match(/<span class="pcm-jobs">([\s\S]*?)<\/span><span class="pcm-seg">/);return m?m[1]:'';}
  t('exactly 3 shown when more exist, with overflow count', ()=>{
    load([1,2,3,4,5,6,7].map(i=>row('XR','J'+i)));
    const c=cell(T._procRowHtml(T.abomProcCodeInventory().codes[0]));
    const shown=(c.match(/class="pcm-job"/g)||[]).length;
    eq(shown,3,'job lines rendered:');
    if(!c.includes('+4 more')) throw new Error('overflow missing: '+c);
  });
  t('fewer than 3 renders only what exists, no overflow', ()=>{
    load([row('XR','J1'),row('XR','J2')]);
    const c=cell(T._procRowHtml(T.abomProcCodeInventory().codes[0]));
    eq((c.match(/class="pcm-job"/g)||[]).length,2);
    if(c.includes('more')) throw new Error('false overflow');
  });
  t('exactly 3 shows no overflow', ()=>{
    load([row('XR','J1'),row('XR','J2'),row('XR','J3')]);
    const c=cell(T._procRowHtml(T.abomProcCodeInventory().codes[0]));
    eq((c.match(/class="pcm-job"/g)||[]).length,3);
    if(c.includes('more')) throw new Error('false overflow at exactly 3');
  });
  t('each job is its own element (stacks as a row)', ()=>{
    load([row('XR','J1'),row('XR','J2')]);
    const c=cell(T._procRowHtml(T.abomProcCodeInventory().codes[0]));
    eq(c.match(/<span class="pcm-job">/g).length,2,'separate elements:');
  });
  t('no job numbers on the rows says so', ()=>{
    load([row('XR','')]);
    const c=cell(T._procRowHtml(T.abomProcCodeInventory().codes[0]));
    if(!c.includes('No job number')) throw new Error(c);
  });
  t('a code absent from the file says so', ()=>{
    load([row('XR','J1')]);
    const c=cell(T._procRowHtml({code:'BR',rows:0,jobs:new Set(),variants:new Set()}));
    if(!c.includes('Not present in this ABOM')) throw new Error(c);
  });
  t('job numbers are HTML-escaped', ()=>{
    load([row('XR','<script>x</script>')]);
    const c=cell(T._procRowHtml(T.abomProcCodeInventory().codes[0]));
    if(c.includes('<script>')) throw new Error('unescaped');
    if(!c.includes('&lt;script&gt;')) throw new Error('not escaped: '+c);
  });

  console.log('\n== The removed hint is gone ==');
  t('no removal hint anywhere in the rendered row', ()=>{
    load([row('XR','J1','PANEL, REMOVABLE, LH'),row('XR','J2','COVER, REMOVABLE')]);
    const h=T._procRowHtml(T.abomProcCodeInventory().codes[0]);
    if(/desc says removal|removalish/i.test(h)) throw new Error('hint still present');
  });
  t('description is not rendered at all', ()=>{
    load([row('XR','J1','BRACKET, SUPPORT, LH')]);
    const h=T._procRowHtml(T.abomProcCodeInventory().codes[0]);
    if(h.includes('BRACKET')) throw new Error('description still shown');
  });
  t('spellings-merged note survives (moved onto the code cell)', ()=>{
    load([row('XR','J1'),row('xr','J2')]);
    const h=T._procRowHtml(T.abomProcCodeInventory().codes[0]);
    if(!h.includes('2 spellings merged')) throw new Error('lost the variant note');
  });

  console.log('\n== Mapping 2: description is blank, job numbers are not ==');
  t('panel still informative under Mapping 2 (desc always empty)', ()=>{
    // Mapping 2 sets COL.abom.desc = '' but populates jobNo from source col A.
    load([row('XR','J900',''),row('XR','J901','')]);
    const c=cell(T._procRowHtml(T.abomProcCodeInventory().codes[0]));
    eq((c.match(/class="pcm-job"/g)||[]).length,2,'jobs present where desc never was:');
  });

  console.log('\n== Header aligns to the grid ==');
  t('header has the same 4 cells as a row', ()=>{
    const hd=T._procHeaderRow();
    eq((hd.match(/<span/g)||[]).length,4);
    if(!hd.includes('Job Numbers (samples)')) throw new Error('title wrong: '+hd);
  });
});

suite('NCR dispositions without EBOM trace — one row per disposition', (t, eq) => {
  let SHEET = null;
  const ctx = sandbox({
    XLSX:{utils:{book_new:()=>({}),aoa_to_sheet:a=>{SHEET=a;return{};},book_append_sheet:()=>{}},writeFile:()=>{}},
    COL:{ncr:{ncrNum:60,ncrStatus:61,originatingWo:62,discrepantPart:63,discNum:64,discStatus:65,
      discSummary:66,defectQty:67,causeCode:68,causeCodeDesc:69,defectCode:74,defectCodeDesc:75,
      discrepancyText:70,dispNo:71,dispStatus:72,dispType:76,dispCode:77,dispText:82}},
    state:{results:[],boms:{ncr:null}} }, ['ncr']);
  const M = ctx.N, COL = ctx.COL, state = ctx.state;
  function nrow(o){const r=new Array(90).fill('');const N=COL.ncr;
   r[N.ncrNum]=o.ncr;r[N.dispNo]=o.disp;r[N.ncrStatus]=o.ncrStatus||'OPEN';
   r[N.dispStatus]=o.dispStatus||'WORKING';r[N.discrepantPart]=o.part||'';
   r[N.originatingWo]=o.wo||'';r[N.dispText]=o.text||'';return r;}
  function run(ncrRows,results){state.boms.ncr={data:ncrRows};
   state.results=(results&&results.length)?results:[{ncrEntriesPool1:[],ncrEntriesPool2:[]}];
   SHEET=null;M.exportUntracedNcrDispositions();
   const hi=SHEET.findIndex(r=>r[0]==='NCR Number');
   return {hdr:SHEET[hi],rows:SHEET.slice(hi+1),meta:Object.fromEntries(SHEET.filter(r=>r.length===2).map(r=>[r[0],r[1]]))};}

  console.log('\n== Grain: one row per disposition number ==');
  t('4 file rows for 1 disposition collapse to 1 export row', ()=>{
    const r=run([nrow({ncr:'N1',disp:'D1',part:'P1'}),nrow({ncr:'N1',disp:'D1',part:'P1'}),
                 nrow({ncr:'N1',disp:'D1',part:'P1'}),nrow({ncr:'N1',disp:'D1',part:'P1'})]);
    eq(r.rows.length,1,'export rows:');
    eq(r.meta['Dispositions without EBOM trace'],1);
    eq(r.meta['Source NCR file rows'],4,'source count still reported:');
    eq(r.rows[0][18],4,'Source Rows Merged:');
  });
  t('distinct dispositions under one NCR stay separate', ()=>{
    const r=run([nrow({ncr:'N1',disp:'D1'}),nrow({ncr:'N1',disp:'D2'}),nrow({ncr:'N1',disp:'D3'})]);
    eq(r.rows.length,3);
    eq(r.rows.map(x=>x[1]),['D1','D2','D3']);
  });
  t('same disposition number under different NCRs stays separate', ()=>{
    const r=run([nrow({ncr:'N1',disp:'D1'}),nrow({ncr:'N2',disp:'D1'})]);
    eq(r.rows.length,2,'must not collapse across NCRs:');
  });
  t('differing values are joined, not dropped', ()=>{
    const r=run([nrow({ncr:'N1',disp:'D1',part:'P1'}),nrow({ncr:'N1',disp:'D1',part:'P2'})]);
    eq(r.rows.length,1);
    eq(r.rows[0][8],'P1 | P2','discrepant parts merged:');
    eq(r.rows[0][18],2);
  });
  t('identical values do not duplicate in the join', ()=>{
    const r=run([nrow({ncr:'N1',disp:'D1',part:'P1'}),nrow({ncr:'N1',disp:'D1',part:'P1'})]);
    eq(r.rows[0][8],'P1');
  });
  t('Source Rows Merged is 1 when nothing collapsed', ()=>{
    eq(run([nrow({ncr:'N1',disp:'D1'})]).rows[0][18],1);
  });

  console.log('\n== Predicate matches the on-screen helper ==');
  t('a traced disposition is excluded', ()=>{
    const res=[{ncrEntriesPool1:[{ncrNum:'N1',dispNo:'D1'}],ncrEntriesPool2:[]}];
    eq(run([nrow({ncr:'N1',disp:'D1'}),nrow({ncr:'N2',disp:'D9'})],res).rows.length,1);
  });
  t('Pool 2 traces also exclude', ()=>{
    const res=[{ncrEntriesPool1:[],ncrEntriesPool2:[{ncrNum:'N1',dispNo:'D1'}]}];
    eq(run([nrow({ncr:'N1',disp:'D1'})],res).rows.length,0);
  });
  t('CANCELLED NCRs are excluded', ()=>{
    eq(run([nrow({ncr:'N1',disp:'D1',ncrStatus:'CANCELLED'}),nrow({ncr:'N2',disp:'D2'})]).rows.length,1);
  });
  t('export count equals the helper count', ()=>{
    const rows=[nrow({ncr:'N1',disp:'D1'}),nrow({ncr:'N1',disp:'D1'}),nrow({ncr:'N2',disp:'D2'})];
    state.boms.ncr={data:rows};state.results=[{ncrEntriesPool1:[],ncrEntriesPool2:[]}];
    const helper=M.computeUntracedNcrs().length;
    const r=run(rows);
    eq(helper,3,'helper is per file row:');
    eq(r.rows.length,2,'export is per disposition:');
    eq(r.meta['Source NCR file rows'],helper,'and reconciles to the helper:');
  });
  t('sorted by NCR then disposition, numerically', ()=>{
    const r=run([nrow({ncr:'N10',disp:'D2'}),nrow({ncr:'N2',disp:'D10'}),nrow({ncr:'N2',disp:'D2'})]);
    eq(r.rows.map(x=>x[0]+'/'+x[1]),['N2/D2','N2/D10','N10/D2']);
  });
  t('empty result set produces headers and a zero count', ()=>{
    const res=[{ncrEntriesPool1:[{ncrNum:'N1',dispNo:'D1'}],ncrEntriesPool2:[]}];
    const r=run([nrow({ncr:'N1',disp:'D1'})],res);
    eq(r.rows.length,0); eq(r.meta['Dispositions without EBOM trace'],0);
  });
});

suite('ECN footprint completeness', (t, eq) => {
  const ctx = sandbox({ COL:{ebom:{indenture:0,pn:1,nh:3},chp:{pn:3,nh:5,ecn:18,docNo:10,docRev:11}},
    state:{results:[],boms:{ebom:null,chp:null}} }, ['proc','engine','ecn']);
  const B = ctx.B, state = ctx.state, normPN = ctx.E.normPN;
  function R(pn,nh,o){o=o||{};return{key:normPN(pn)+'||'+normPN(nh),pn,nh,overall:'ok',as:'ok',
   woStatus:o.wo===undefined?'closed':o.wo,woValues:['W1'],
   trace:o.ecn?{dcn:new Map(),ecn:new Map(o.ecn),ecr:new Map()}:null,
   ncrEntriesPool1:o.ncr||[],ncrEntriesPool2:[]};}
  const chpRow=(pn,nh,ecn)=>{const r=new Array(25).fill('');r[3]=pn;r[5]=nh;r[18]=ecn;return r;};

  console.log('\n== The completeness hole is now closed ==');
  t('CHP lists 12, only 9 joined: ECN NO LONGER recommended', ()=>{
    const rows=[];for(let i=1;i<=9;i++)rows.push(R('P'+i,'A',{ecn:[['E1','']]}));
    state.results=rows;state.boms.ebom=null;
    state.boms.chp={data:Array.from({length:12},(_,i)=>chpRow('P'+(i+1),'A','E1'))};
    const e=B.buildEcnFootprints().ecnMap.get('E1');
    eq(e.allAccepted,true,'joined items all fine:');
    eq(e.complete,false,'but footprint incomplete:');
    eq(e.chpItemCount,12); eq(e.items.length,9);
    eq(e.unjoined,['P10','P11','P12'],'unmatched parts named:');
  });
  t('all 12 join: ECN qualifies', ()=>{
    const rows=[];for(let i=1;i<=12;i++)rows.push(R('P'+i,'A',{ecn:[['E1','']]}));
    state.results=rows;
    state.boms.chp={data:Array.from({length:12},(_,i)=>chpRow('P'+(i+1),'A','E1'))};
    const e=B.buildEcnFootprints().ecnMap.get('E1');
    eq([e.allAccepted,e.complete],[true,true]);
  });
  t('the two failure reasons stay distinguishable', ()=>{
    state.results=[R('P1','A',{ecn:[['E1','']],wo:'open'})];
    state.boms.chp={data:[chpRow('P1','A','E1'),chpRow('P9','A','E1')]};
    const e=B.buildEcnFootprints().ecnMap.get('E1');
    eq(e.allAccepted,false,'unembodied item:'); eq(e.complete,false,'AND missing item:');
  });
  t('PN-only matching: different NH still counts as joined', ()=>{
    state.results=[R('P1','ASSY-X',{ecn:[['E1','']]})];
    state.boms.chp={data:[chpRow('P1','ASSY-Y','E1')]};
    eq(B.buildEcnFootprints().ecnMap.get('E1').complete,true,'NH mismatch must not false-alarm:');
  });
  t('no CHP loaded: degrades without false alarms', ()=>{
    state.results=[R('P1','A',{ecn:[['E1','']]})]; state.boms.chp=null;
    const e=B.buildEcnFootprints().ecnMap.get('E1');
    eq([e.complete,e.chpItemCount],[true,0]);
  });
  t('inherited COTS children count toward coverage', ()=>{
    state.results=[R('P1','A',{ecn:[['E1','']]}),R('C1','P1',{})];
    state.boms.ebom={data:[[0,'P1',0,'A'],[0,'C1',0,'P1']].map(r=>{const x=new Array(30).fill('');x[1]=r[1];x[3]=r[3];return x;})};
    state.boms.chp={data:[chpRow('P1','A','E1'),chpRow('C1','P1','E1')]};
    const e=B.buildEcnFootprints().ecnMap.get('E1');
    eq(e.complete,true,'child joined via inheritance:'); eq(e.items.length,2);
  });
  t('incompleteEcns is counted for the report footer', ()=>{
    state.results=[R('P1','A',{ecn:[['E1','']]})]; state.boms.ebom=null;
    state.boms.chp={data:[chpRow('P1','A','E1'),chpRow('P2','A','E1')]};
    eq(B.buildEcnFootprints().incompleteEcns,1);
  });
});

suite('Many EBOM line items to one ECN', (t, eq) => {
  const ctx = sandbox({ COL:{ebom:{indenture:0,pn:1,nh:3},chp:{pn:3,nh:5,ecn:18,docNo:10,docRev:11}},
    state:{results:[],boms:{ebom:null,chp:null}} }, ['proc','engine','ecn']);
  const B = ctx.B, state = ctx.state, normPN = ctx.E.normPN;
  function R(pn,nh,o){o=o||{};return{key:normPN(pn)+'||'+normPN(nh),pn,nh,overall:'ok',as:'ok',
   woStatus:o.wo===undefined?'closed':o.wo,woValues:['W1'],
   trace:o.ecn?{dcn:new Map(),ecn:new Map(o.ecn),ecr:new Map()}:null,
   ncrEntriesPool1:o.ncr||[],ncrEntriesPool2:[]};}

  console.log('\n== Many EBOM line items -> one ECN ==');
  t('12 items all embodied: ECN qualifies', ()=>{
    const rows=[];for(let i=1;i<=12;i++)rows.push(R('P'+i,'A',{ecn:[['E1','OPEN']]}));
    state.results=rows;state.boms.ebom=null;
    const e=B.buildEcnFootprints().ecnMap.get('E1');
    eq(e.items.length,12,'footprint size:');eq(e.allAccepted,true);
  });
  t('12 items, ONE open WO: ECN excluded', ()=>{
    const rows=[];for(let i=1;i<=12;i++)rows.push(R('P'+i,'A',{ecn:[['E1','OPEN']],wo:i===7?'open':'closed'}));
    state.results=rows;
    const e=B.buildEcnFootprints().ecnMap.get('E1');
    eq(e.items.length,12);eq(e.allAccepted,false,'one bad item must exclude:');
    eq(e.items.filter(x=>!x.accepted).length,1);
  });
  t('12 items, ONE open disposition: ECN excluded', ()=>{
    const rows=[];for(let i=1;i<=12;i++)rows.push(R('P'+i,'A',{ecn:[['E1','']],
      ncr:i===3?[{ncrNum:'N1',dispNo:'D1',dispStatus:'WORKING'}]:[]}));
    state.results=rows;
    eq(B.buildEcnFootprints().ecnMap.get('E1').allAccepted,false);
  });
  t('order independent: bad item first still excludes', ()=>{
    const rows=[R('P1','A',{ecn:[['E1','']],wo:'open'})];
    for(let i=2;i<=12;i++)rows.push(R('P'+i,'A',{ecn:[['E1','']]}));
    state.results=rows;
    eq(B.buildEcnFootprints().ecnMap.get('E1').allAccepted,false);
  });
  t('an item on TWO ECNs blocks both', ()=>{
    state.results=[R('P1','A',{ecn:[['E1',''],['E2','']],wo:'open'}),R('P2','A',{ecn:[['E1','']]})];
    const m=B.buildEcnFootprints().ecnMap;
    eq(m.get('E1').allAccepted,false);eq(m.get('E2').allAccepted,false);
  });

  console.log('\n== COMPLETENESS: can a CHP-listed item be missing from the footprint? ==');
  t('CHP lists 12 items for E1 but only 9 are EBOM result rows', ()=>{
    // Simulates: CHP file rows for P1..P12 under E1, but P10-P12 have no EBOM
    // result row (no key match). Those three never enter the footprint.
    const rows=[];for(let i=1;i<=9;i++)rows.push(R('P'+i,'A',{ecn:[['E1','']]}));
    state.results=rows;
    const e=B.buildEcnFootprints().ecnMap.get('E1');
    eq(e.items.length,9,'footprint sees only the joined rows:');
    eq(e.allAccepted,true,'and therefore RECOMMENDS closure:');
    console.log('        >> CHP says 12 items, footprint counted 9, ECN recommended anyway');
  });
});

suite('Stylesheet and chrome integrity', (t, eq) => {
  const css = SRC.slice(SRC.indexOf('<style'), SRC.indexOf('</style>'));

  t('no orphaned keyframes remain', ()=>{
    const defs=[...new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m=>m[1]))];
    const orphans=defs.filter(k=>!new RegExp('animation:[^;]*\\b'+k+'\\b').test(SRC));
    if(orphans.length) throw new Error('orphans: '+orphans.join(', '));
  });
  t('--text-dim is fully retired', ()=>{
    if(SRC.includes('var(--text-dim)')) throw new Error('references remain');
    if(/^\s*--text-dim:/m.test(SRC)) throw new Error('definition remains');
  });
  t('no CSS var is referenced without a definition', ()=>{
    const defined=new Set([...css.matchAll(/^\s*(--[\w-]+):/gm)].map(m=>m[1]));
    const used=new Set([...SRC.matchAll(/var\((--[\w-]+)\)/g)].map(m=>m[1]));
    const missing=[...used].filter(v=>!defined.has(v));
    if(missing.length) throw new Error('undefined vars used: '+missing.join(', '));
  });
  t('export menu uses one convention', ()=>{
    const items=[...SRC.matchAll(/class="export-menu-item"[^>]*>\s*([^<]{1,60})/g)].map(m=>m[1].trim());
    if(items.length!==13) throw new Error('expected 13 items, got '+items.length);
    const arr=items.filter(i=>i.startsWith('\u2b07'));
    if(arr.length!==0 && arr.length!==items.length) throw new Error('mixed: '+arr.length+'/'+items.length);
  });
  t('CSS brace balance unchanged from baseline', ()=>{
    const strip=css.replace(/\/\*[\s\S]*?\*\//g,'');
    const d=(strip.match(/\{/g)||[]).length-(strip.match(/\}/g)||[]).length;
    if(d!==-2) throw new Error('delta '+d+', baseline -2');
  });
  t('every export menu item still routes to a button', ()=>{
    const ids=[...SRC.matchAll(/id="(export-menu-[\w-]+)"[^>]*onclick="invokeExport\('([^']+)'\)/g)];
    if(ids.length<13) throw new Error('only '+ids.length+' wired');
    ids.forEach(([,menuId,btnId])=>{ if(!SRC.includes('id="'+btnId+'"')) throw new Error(btnId+' missing'); });
  });
});

suite('Version single-source', (t, eq) => {
  t('exactly one hardcoded version string in the file', ()=>{
    const m = SRC.match(/const APP_VERSION = '(v\d+)'/);
    if(!m) throw new Error('APP_VERSION not found');
    // no other vNNN literal in visible markup
    const body = SRC.slice(SRC.indexOf('<div class="header"'), SRC.indexOf('<script', SRC.indexOf('<div class="header"')));
    const stripped = body.replace(/<!--[\s\S]*?-->/g,'');
    // Dev/Logic tooltip blocks legitimately cite the release a behaviour landed
    // in ("v66 pre-filters the ABOM"). Those are provenance prose, not a claim
    // about which version is running. Exclude them; anything else is a drift risk.
    const noDev = stripped.replace(/<div class="metric-tooltip-dev"[\s\S]*?<\/div>\s*<\/div>/g,'');
    const vis = noDev.replace(/<[^>]+>/g,' ');
    const hits = vis.match(/\bv\d{2,3}\b/g) || [];
    if(hits.length) throw new Error('version literals still in chrome: '+hits.join(', '));
  });
  t('the pill has an id and no literal', ()=>{
    if(!SRC.includes('id="app-version-pill"')) throw new Error('no id');
    if(/<span class="pill">v\d+<\/span>/.test(SRC)) throw new Error('literal pill remains');
  });
  t('renderVersionPill is called at boot', ()=>{
    if(!/renderVersionPill\(\);/.test(SRC)) throw new Error('never called');
  });
  t('APP_VERSION matches the build', ()=>{
    const m=SRC.match(/const APP_VERSION = '(v\d+)'/);
    if(m[1]!=='v153') throw new Error('says '+m[1]);
  });
});


// ── summary ────────────────────────────────────────────────────────────────
console.log('═'.repeat(60));
console.log('TOTAL: ' + TP + ' passed, ' + TF + ' failed');
if (FAILED.length) { console.log('Failing suites: ' + FAILED.join(', ')); process.exit(1); }
console.log('All suites green.');
