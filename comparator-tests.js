#!/usr/bin/env node
/**
 * comparator-tests.js — complete, self-contained test harness for Comparator.
 *
 *   node comparator-tests.js [path-to-build.html]
 *
 * Finds the highest-numbered ./comparator_offline*.html, then ../ .
 * Node only: no install, no network, no other files. 94 tests.
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

// Explicit argument or env var wins. Otherwise find the HIGHEST-numbered
// comparator_offline*.html in ./ or ../ — so a version bump does not require
// editing this harness, and a stale older build sitting beside a new one is
// not silently picked up. The version-pin test still catches a wrong build.
function discover(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => /^comparator_offline\d+\.html$/.test(f))
      .sort((a, b) => parseInt(b.match(/\d+/)[0], 10) - parseInt(a.match(/\d+/)[0], 10))
      .map(f => path.join(dir, f));
  } catch (e) { return []; }
}
const CANDIDATES = [process.argv[2], process.env.COMPARATOR_BUILD].filter(Boolean)
  .concat(discover(__dirname), discover(path.join(__dirname, '..')));
const BUILD = CANDIDATES.find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
if (!BUILD) {
  console.error('Build HTML not found. Looked for comparator_offline*.html in:\n  ' +
                __dirname + '\n  ' + path.join(__dirname, '..') +
                '\nPass one: node comparator-tests.js path/to/comparator_offline54.html');
  process.exit(1);
}
const SRC = fs.readFileSync(BUILD, 'utf8');

// The delta tool is a SECOND shipped file that carries its own copy of
// PROC_CODE_BASELINE. Nothing checked the two for drift until v154.
function discoverDelta(dir) {
  try {
    return fs.readdirSync(dir)
      .filter(f => /^comparator_delta_v[\d_]+\.html$/.test(f))
      .sort((a, b) => (b.match(/[\d_]+/)[0].replace(/_/g, '.') * 1) -
                      (a.match(/[\d_]+/)[0].replace(/_/g, '.') * 1))
      .map(f => path.join(dir, f));
  } catch (e) { return []; }
}
const DELTA = [process.env.COMPARATOR_DELTA].filter(Boolean)
  .concat(discoverDelta(path.dirname(BUILD)), discoverDelta(__dirname),
          discoverDelta(path.join(__dirname, '..')))
  .find(p => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } });
if (!DELTA) {
  console.error('Delta tool not found. Looked for comparator_delta_v*.html beside the build.\n' +
                'Set COMPARATOR_DELTA=path to point at it.');
  process.exit(1);
}
console.log('Delta tool under test: ' + DELTA);
const DSRC = fs.readFileSync(DELTA, 'utf8');
console.log('Build under test: ' + BUILD + '\n');

// ── extraction ─────────────────────────────────────────────────────────────
// EVERY boundary goes through at() / lastAt() / span(). A raw SRC.indexOf that
// misses returns -1, and -1 silently becomes a zero-length or inverted slice —
// which is the empty module this harness exists to prevent. v154 closed four
// such holes; the 'Tier 2 — extraction integrity' suite keeps them closed.
function at(marker, from) {
  const i = typeof marker === 'string'
    ? SRC.indexOf(marker, from || 0)
    : (function () { const m = SRC.slice(from || 0).match(marker); return m ? m.index + (from || 0) : -1; })();
  if (i < 0) throw new Error('BUILD MARKER MOVED: ' + marker);
  return i;
}
function lastAt(marker, before, label) {
  const i = SRC.lastIndexOf(marker, before);
  if (i < 0) throw new Error('BUILD MARKER MOVED (searching backwards from ' +
                             (label || before) + '): ' + marker);
  return i;
}
// A named slice that refuses a degenerate result. `label` is what gets printed,
// so a failure says which module lost its boundary rather than surfacing later
// as "P is not defined" inside an unrelated suite.
const MIN_SPAN = 200;
function span(a, b, label) {
  if (b <= a) throw new Error('BUILD MARKERS CROSSED for ' + label + ': end (' + b +
    ') is not after start (' + a + '). The build was reordered — fix the markers.');
  const s = SRC.slice(a, b);
  if (s.length < MIN_SPAN) throw new Error('MODULE SLICE TOO SMALL for ' + label +
    ': ' + s.length + ' chars, expected at least ' + MIN_SPAN + '.');
  return s;
}
function grabFrom(src, name, label) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('BUILD MARKER MOVED in ' + (label || 'build') +
                             ': function ' + name);
  let d = 0, k = src.indexOf('{', i);
  if (k < 0) throw new Error('NO BODY FOUND for function ' + name);
  for (;; k++) {
    if (k >= src.length) throw new Error('UNBALANCED BRACES while reading function ' + name);
    if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) break; }
  }
  return src.slice(i, k + 1);
}
function grabFn(name) { return grabFrom(SRC, name, 'main build'); }
function grabDelta(name) { return grabFrom(DSRC, name, 'delta tool'); }
const MOD = {};
try {
{ // proc code table + behaviour panel
  const a = at('const PROC_CODE_BASELINE = {');
  const g = at('function getProcBehavior');
  const b = at('}', at('return PROC_CODE_EXCEPTIONS', g)) + 1;
  const m1 = at(/\/\/ ═+\n\/\/ v\d+ — PROC CODE BEHAVIOR PANEL/);
  const m2 = at('// ── EBOM manual column mapping (proof of concept)', m1);
  MOD.proc = span(a, b, 'proc:table') + '\n' + span(m1, m2, 'proc:panel') + `
globalThis.P = { abomProcCodeInventory, _procRowHtml, _procHeaderRow, PROC_JOB_SAMPLES,
  get PROC_CODE_EXCEPTIONS(){return PROC_CODE_EXCEPTIONS;},
  get PROC_CODE_BASELINE(){return PROC_CODE_BASELINE;},
  get dirty(){return _procDirtySinceRun;}, set dirty(v){_procDirtySinceRun=v;},
  setProcCodeMap, setProcCodeBehavior, getProcBehavior, isProcMapCustom,
  _procProfileLabel, _procCodesWithBehavior, _procCodeListText,
  exportProcProfile, importProcProfile, resetProcCodesToBaseline, _procMapEqualsBaseline,
  toggleProcCodePanel, renderProcCodePanel };`;
}
// v154 — buildEbomIndentureMap is now lifted from the build. It used to be a
// six-line stand-in written into the sandbox, and the ECN inheritance suites
// were certifying that stand-in rather than the shipping function. The two
// diverge on a self-referencing row (PN === NH), which is a real extract defect.
// v159 — the reconciliation ENGINE, plus every builder needed to feed it. The
// engine is pure (one params object in, results out, no globals, no DOM) and
// was completely untested until now: 543 lines deciding whether a part is
// reconciled, with every existing suite testing only the code AROUND it.
MOD.engine = (function () {
  // The status sets the rollup consults, lifted with the functions that use them.
  const sets = ['_STATUS_DIRECT_OK', '_STATUS_COVERED', '_STATUS_ADJUDICATED_LEAF']
    .map(n => { const a = at('const ' + n + ' = new Set([');
                return SRC.slice(a, at(']);', a) + 3); }).join('\n');
  // v159 — the engine's priority ladder, isolated so it can be compared with the
  // copy in computeEffectiveResults. Bounded at the Pass 3 fallback, which is
  // NOT part of the ladder: it depends on pool membership, not on leg statuses.
  const eng = grabFn('runReconciliationCore');
  const la = eng.indexOf('var legs = [];');
  const lb = eng.indexOf('// Pass 3 fallback', la);
  if (la < 0 || lb < la) throw new Error('BUILD MARKER MOVED: the engine rollup ladder');
  const ladder = 'function engineLadder(ms, as_, msUsedOn, asUsedOn) { var overall;' +
                 eng.slice(la, lb) + '\nreturn overall; }';
  return sets + '\n' +
    ['normPN', 'normIndenture', 'buildQtyMap', 'buildAbomMap', 'buildEbomIndentureMap',
     'buildAbomUsedOnMap', 'buildMbomUsedOnMap', 'getProcBehavior',
     'runReconciliationCore', 'computeEffectiveResults'].map(grabFn).join('\n') +
    '\n' + ladder +
    '\nglobalThis.E = { normPN, normIndenture, buildQtyMap, buildAbomMap, buildEbomIndentureMap,' +
    ' buildAbomUsedOnMap, buildMbomUsedOnMap, runReconciliationCore,' +
    ' computeEffectiveResults, engineLadder,' +
    ' get _STATUS_DIRECT_OK(){return _STATUS_DIRECT_OK;} };';
})();
// The delta tool's pure comparison layer. Its own file, its own baseline copy.
MOD.delta = (function () {
  // `var` here, `const` in the main build — hence the tolerant marker.
  const m = DSRC.match(/(?:var|const|let)\s+PROC_CODE_BASELINE\s*=\s*\{/);
  if (!m) throw new Error('BUILD MARKER MOVED in delta tool: PROC_CODE_BASELINE');
  const i = m.index;
  const j = DSRC.indexOf('}', i) + 1;
  // Status/column constants the report layer depends on.
  function constBlock(name) {
    const m = DSRC.match(new RegExp('(?:var|const|let)\\s+' + name + '\\s*=\\s*\\{'));
    if (!m) throw new Error('BUILD MARKER MOVED in delta tool: ' + name);
    const end = DSRC.indexOf('}', m.index);
    if (end < 0) throw new Error('unterminated ' + name + ' in delta tool');
    return DSRC.slice(m.index, end + 1) + ';';
  }
  const FNS = ['dNorm', 'normPN', 'pct', 'procTableOf', 'procProfileLabel', 'procTableDiff',
               'claimSig', 'claimRow', 'claimsDelta',
               'fscope', 'modeHasMbom', 'modeHasAbom', 'computeKpis', 'countByType',
               'ebomChanges', 'chpBom', 'ncrDispositionDelta',
               'collectorLevelsOf', 'collectorScopeLabel', 'indentureScopeDiff',
               'indentureContext'];
  return DSRC.slice(i, j) + ';\n' +
    ['DIRECT_OK', 'COVERED_OK', 'SCOPE_EXCLUDED', 'NCR_COL'].map(constBlock).join('\n') + '\n' +
    FNS.map(grabDelta).join('\n') +
    '\nglobalThis.D = { ' + FNS.join(', ') + ',' +
    ' get PROC_CODE_BASELINE(){return PROC_CODE_BASELINE;},' +
    ' get NCR_COL(){return NCR_COL;} };';
})();

// v159 — session restore. importSessionJson is async and DOM-heavy, but the
// STATE RESTORE — the part that reconstitutes an audit artefact — is the first
// 96 lines and runs unmodified against a stub document. Extracted as a function
// so the real code is exercised rather than a paraphrase of it.
// v162 — ME adjudication import. Pure planning layer: rows + results in, a plan
// out. Extracted with the overlay so a plan can be driven all the way through
// computeEffectiveResults in one sandbox.
MOD.adjimport = (function () {
  const a = at('// ── v162 — ME ADJUDICATION IMPORT');
  const b = at('// ── v162 — ME ADJUDICATION IMPORT: UI');
  const colA = at('const COL = {');
  const colB = at('};', colA) + 2;
  const sets = ['_STATUS_DIRECT_OK', '_STATUS_COVERED', '_STATUS_ADJUDICATED_LEAF']
    .map(n => { const i = at('const ' + n + ' = new Set(['); return SRC.slice(i, at(']);', i) + 3); }).join('\n');
  return SRC.slice(colA, colB) + '\n' + sets + '\n' + grabFn('normPN') + '\n' +
    SRC.slice(a, b) + '\n' + grabFn('computeEffectiveResults') +
    '\nglobalThis.IMP = { COL, scanNarrative, resolveImportedAdjRow, buildImportedClaims,' +
    ' replaceImportedClaims, partitionClaims, isImportedClaim, indexResultsByPn,' +
    ' planAdjImport, finalizeAdjImport, computeEffectiveResults };';
})();

MOD.session = (function () {
  const imp = grabFn('importSessionJson');
  const a = imp.indexOf('state.mode = payload.mode');
  const b = imp.indexOf('clearNearMatchCache()');
  if (a < 0 || b < a) throw new Error('BUILD MARKER MOVED: the session restore block');
  return grabFn('_cloneResultRow') + '\n' +
    'function restoreSession(payload) {' + imp.slice(a, b) + '}\n' +
    'globalThis.SS = { restoreSession };';
})();

// CHP release-state badge. Pure, and it drives a user-visible warning plus the
// release date printed on the freeze certificate.
MOD.chp = grabFn('_chpParseReleaseDate') + '\n' + grabFn('formatDcnDate') + '\n' +
  grabFn('chpReleaseState') + '\n' + grabFn('chpStateClass') + '\n' +
  '\nglobalThis.C = { _chpParseReleaseDate, formatDcnDate, chpReleaseState, chpStateClass };';
{ // ECN footprints
  const hit = at(/\/\/ v\d+ — ECN FOOTPRINT \(B1 \/ B2 \/ B4\)/);
  const a = lastAt('// ═══', hit, 'ECN FOOTPRINT header');
  MOD.ecn = span(a, at('function exportChangeCommitmentClosures()'), 'ecn:footprints') + '\n' +
    span(at('function _ecnStatusLooksClosed('), at('function exportPrematureEcnClosures('), 'ecn:status') +
    '\nglobalThis.B = { buildEcnFootprints, _chpEcnItemIndex, _ecnOpenDispositions, _ecnStatusLooksClosed };';
}
{ // untraced NCR dispositions
  const a = at('function computeUntracedNcrs()');
  const b = at(/\/\/ ── v\d+ — NCR DISPOSITIONS WITHOUT EBOM TRACE \(EXPORT\)/, a);
  const c = at('function exportUntracedNcrDispositions()');
  MOD.ncr = span(a, b, 'ncr:helper') + '\n' + span(c, at('// ── ACN KPI HELPER', c), 'ncr:export') +
    '\nglobalThis.N = { computeUntracedNcrs, exportUntracedNcrDispositions };';
}
} catch (e) {
  // Fail loudly, in words, and stop. A partial extraction is worse than no run:
  // in v153 a moved marker produced "21 passed, 5 failed" while 33 tests never
  // executed at all — a plausible-looking summary hiding a third of the suite.
  console.error('═'.repeat(60));
  console.error('EXTRACTION FAILED — NO TESTS WERE RUN.');
  console.error('');
  console.error('  ' + e.message);
  console.error('');
  console.error('The build was refactored and a marker in this harness needs');
  console.error('updating. This is not a fault in the build. Fix the marker in');
  console.error('the extraction block near the top of comparator-tests.js.');
  console.error('═'.repeat(60));
  process.exit(1);
}

// v154 — REAL stylesheet blocks. The old code used SRC.indexOf('<style'),
// which matches `<style:master-page` — an OpenDocument XML tag inside the
// vendored SheetJS library on line 28. The "stylesheet" every CSS test scanned
// was therefore ~58KB of minified JavaScript with the real CSS appended. That
// is where the mysterious -2 brace baseline came from: JS object literals, not
// CSS. Requiring `>` or whitespace after the tag name excludes the XML tags.
const STYLE_BLOCKS = (function () {
  const out = [];
  const re = /<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g;
  let m;
  while ((m = re.exec(SRC))) out.push({ css: m[1], at: m.index,
                                        line: SRC.slice(0, m.index).split('\n').length });
  if (!out.length) throw new Error('NO STYLE BLOCK FOUND — the build has no <style> tag?');
  return out;
})();

// Comment- and string-aware brace scan. Returns the LINE NUMBERS of unmatched
// braces rather than a net delta, so a failure says where to look. A net delta
// can also be zero when one stray `{` and one stray `}` cancel out.
// ── Palettes ────────────────────────────────────────────────────────────────
// v173. The build ships three: :root (dark, the source of truth) plus a
// [data-theme=...] block per alternative. Every colour test below reads from
// here rather than scanning the stylesheet flat, because a flat scan silently
// takes the LAST definition of each token — with three palettes in the file
// that is whichever theme happens to be written last, and every assertion
// about "the palette" would then be an assertion about the mono greys.
const PALETTES = (function () {
  const css = STYLE_BLOCKS.map(b => b.css).join('\n');
  const read = (sel, label) => {
    const k = css.indexOf(sel);
    if (k < 0) throw new Error('PALETTE MISSING: ' + label + ' (' + sel + ')');
    let d = 0, s = css.indexOf('{', k);
    if (s < 0) throw new Error('PALETTE HAS NO BODY: ' + label);
    for (let i = s; i < css.length; i++) {
      if (css[i] === '{') d++;
      else if (css[i] === '}' && --d === 0) {
        const body = css.slice(s, i);
        const t = {};
        for (const m of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g))
          t[m[1]] = m[2].toLowerCase();
        if (Object.keys(t).length < 20)
          throw new Error('PALETTE TOO SMALL: ' + label + ' defines only ' +
                          Object.keys(t).length + ' colour tokens');
        return t;
      }
    }
    throw new Error('UNBALANCED PALETTE BLOCK: ' + label);
  };
  return { dark: read(':root', 'dark'),
           light: read('[data-theme="light"]', 'light'),
           mono: read('[data-theme="mono"]', 'mono') };
})();
// Reads the exported-palette list out of the build rather than restating it
// here, so the two cannot disagree without the parity test noticing.
function PALETTE_TOKENS_IN_BUILD() {
  const m = SRC.match(/const PALETTE_TOKENS = \[([\s\S]*?)\];/);
  if (!m) throw new Error('BUILD MARKER MOVED: const PALETTE_TOKENS');
  return [...m[1].matchAll(/'(--[\w-]+)'/g)].map(x => x[1]);
}
const LUM = h => 0.2126 * parseInt(h.slice(1, 3), 16) +
                 0.7152 * parseInt(h.slice(3, 5), 16) +
                 0.0722 * parseInt(h.slice(5, 7), 16);

function scanCss(text) {
  let i = 0, line = 1; const open = [], close = [];
  while (i < text.length) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && text[i + 1] === '*') {                       // comment
      const e = text.indexOf('*/', i + 2);
      line += (text.slice(i, e < 0 ? text.length : e).match(/\n/g) || []).length;
      i = e < 0 ? text.length : e + 2; continue;
    }
    if (c === '"' || c === "'") {                                 // quoted string
      const q = c; i++;
      while (i < text.length && text[i] !== q) {
        if (text[i] === '\\') i++;
        if (text[i] === '\n') line++;
        i++;
      }
      i++; continue;
    }
    if (c === '{') { open.push(line); i++; continue; }
    if (c === '}') { open.length ? open.pop() : close.push(line); i++; continue; }
    i++;
  }
  return { unmatchedOpen: open, unmatchedClose: close,
           balanced: !open.length && !close.length };
}

// What each module must contain and must define once evaluated. Checked by the
// 'Tier 2 — extraction integrity' suite, so a module that extracts to something
// plausible-but-wrong is caught before its suite quietly passes.
const MODULE_CONTRACT = {
  proc:   { min: 6000, global: 'P',
            needs: ['PROC_CODE_BASELINE', 'function setProcCodeMap', 'function exportProcProfile'],
            exports: ['setProcCodeMap', 'exportProcProfile', '_procProfileLabel', 'getProcBehavior'] },
  engine: { min: 12000, global: 'E',
            needs: ['function normPN', 'function buildAbomMap', 'function buildEbomIndentureMap',
                    'function runReconciliationCore'],
            exports: ['normPN', 'buildAbomMap', 'buildEbomIndentureMap',
                      'buildQtyMap', 'runReconciliationCore',
                      'computeEffectiveResults', 'engineLadder'] },
  ecn:    { min: 2000, global: 'B',
            needs: ['function buildEcnFootprints', 'function _ecnStatusLooksClosed'],
            exports: ['buildEcnFootprints', '_ecnStatusLooksClosed'] },
  ncr:    { min: 2000, global: 'N',
            needs: ['function computeUntracedNcrs', 'function exportUntracedNcrDispositions'],
            exports: ['computeUntracedNcrs', 'exportUntracedNcrDispositions'] },
  delta:  { min: 1500, global: 'D',
            needs: ['PROC_CODE_BASELINE', 'function claimSig', 'function procTableDiff'],
            exports: ['procTableOf', 'procTableDiff', 'claimSig', 'claimsDelta', 'dNorm',
                      'ebomChanges', 'computeKpis', 'ncrDispositionDelta', 'chpBom'] },
  adjimport:{ min: 3000, global: 'IMP',
            needs: ['function planAdjImport', 'function scanNarrative', 'function buildImportedClaims'],
            exports: ['planAdjImport', 'finalizeAdjImport', 'scanNarrative',
                      'resolveImportedAdjRow', 'buildImportedClaims', 'replaceImportedClaims'] },
  session:{ min: 2000, global: 'SS',
            needs: ['function restoreSession', 'payload.procOverrides'],
            exports: ['restoreSession'] },
  chp:    { min: 1500, global: 'C',
            needs: ['function chpReleaseState', 'function formatDcnDate'],
            exports: ['chpReleaseState', 'formatDcnDate', '_chpParseReleaseDate', 'chpStateClass'] },
};

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
    // Captures what a download would have contained, so a test can read the
    // exported payload rather than merely confirm a call happened.
    Blob: class { constructor(parts, opts) {
      this.parts = parts || []; this.type = (opts || {}).type || '';
      this.text = this.parts.join(''); } },
    tsFilename: (b, e) => b + '.' + e, downloadFile: () => {}, FileReader: class { readAsText(f){ this.onload({target:{result:f._text}}); } },
    _STATUS_ADJUDICATED_LEAF: new Set(['adj_ok']),
    // NOTE: buildEbomIndentureMap used to be stubbed here. It is now extracted
    // from the build in MOD.engine, so any suite needing it must load 'engine'.
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
  try { fn(t, eq); }
  catch (e) { console.log('  FAIL  SUITE CRASHED — its remaining tests did NOT run\n        ' + e.message); fail++; }
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

// ── TIER 1 ─────────────────────────────────────────────────────────────────
// Regression guards for two defects found in v153 and fixed in v154.
//
//   A. exportProcProfile()'s Cancel guard was dead code. `(prompt(...) || '')
//      .trim()` turned a null return into '' BEFORE the `=== null` check ran,
//      so pressing Cancel still downloaded a file and still overwrote
//      state.procProfileName with 'Unnamed profile'.
//
//   B. setProcCodeMap(map, profileName) ignored profileName on the `!map`
//      path and hard-set state.procProfileName = null. The session importer
//      calls exactly that path, so a profile NAME did not survive an export →
//      import round-trip even though the proc code BEHAVIOUR did. A re-opened
//      session reported 'Program baseline' where the original said the
//      program's name.
//
// The name is provenance; the overrides are the deviation. These tests pin
// that separation, because both defects were failures of exactly that
// distinction.
suite('Tier 1 — proc code profile name is provenance', (t, eq) => {
  // The two lines the session exporter writes and the one line the importer
  // reads. Lifted verbatim so that REWIRING the session — not just breaking
  // setProcCodeMap — also fails this suite.
  const SESSION_WRITE = ['procOverrides:   state.procOverrides   || null',
                         'procProfileName: state.procProfileName || null'];
  const SESSION_READ  = 'setProcCodeMap(payload.procOverrides || null, ' +
                        'payload.procProfileName || null)';

  let DL = [], PROMPT = null;
  const ctx = sandbox({
    COL: { abom: { procCode: 12, desc: 10, jobNo: 5 } },
    state: { boms:{abom:null}, results:[], isLocked:false,
             procOverrides:null, procProfileName:null },
    prompt: () => PROMPT,
    downloadFile: (n, b) => DL.push({ name: n, text: b && b.text }),
  }, ['proc']);
  const P = ctx.P, state = ctx.state;

  const reset = () => { DL = []; PROMPT = null; P.setProcCodeMap(null); };
  const payloadOf = () => JSON.parse(DL[0].text);
  // Push state through JSON exactly as a session file does, then restore it
  // the way the importer does, in a context that has been wiped first.
  function roundTrip() {
    ctx.__j = JSON.stringify({ procOverrides:   state.procOverrides   || null,
                               procProfileName: state.procProfileName || null });
    P.setProcCodeMap(null);                       // a fresh browser
    ctx.__run(`var payload = JSON.parse(__j); ${SESSION_READ};`);
  }
  ctx.__run = src => require('vm').runInContext(src, ctx, { filename: 'session.js' });

  console.log('\n== Defect A: Cancel must export nothing and change nothing ==');
  t('Cancel downloads no file', () => {
    reset(); P.setProcCodeBehavior('XR', 'remove');
    PROMPT = null;                                 // user pressed Cancel
    P.exportProcProfile();
    eq(DL.length, 0, 'files written on Cancel:');
  });
  t('Cancel leaves the existing profile name untouched', () => {
    reset(); P.setProcCodeMap({ XR:'remove' }, 'Program Falcon');
    PROMPT = null;
    P.exportProcProfile();
    eq(state.procProfileName, 'Program Falcon', 'name after Cancel:');
  });
  t('confirming an EMPTY name still exports, as Unnamed profile', () => {
    reset(); P.setProcCodeBehavior('XR', 'remove');
    PROMPT = '';                                   // user pressed OK on a blank box
    P.exportProcProfile();
    eq(DL.length, 1, 'blank-but-confirmed must still export:');
    eq(payloadOf().profileName, 'Unnamed profile');
  });
  t('a real name reaches the payload and the state', () => {
    reset(); P.setProcCodeBehavior('XR', 'remove');
    PROMPT = '  Program Falcon  ';                 // and is trimmed
    P.exportProcProfile();
    eq(payloadOf().profileName, 'Program Falcon');
    eq(state.procProfileName, 'Program Falcon');
    eq(payloadOf().basedOn, 'custom', 'a tagged table is a deviation:');
  });

  console.log('\n== Defect B: the name survives a session round-trip ==');
  t('the session still carries both proc fields', () => {
    SESSION_WRITE.forEach(s => {
      if (!SRC.includes(s)) throw new Error('exporter no longer writes: ' + s); });
    if (!SRC.includes(SESSION_READ)) throw new Error('importer no longer reads it');
  });
  t('a CUSTOM profile keeps its name through export and import', () => {
    reset(); P.setProcCodeMap({ XR:'remove', TSW:'swap' }, 'Program Falcon');
    roundTrip();
    eq(state.procProfileName, 'Program Falcon', 'name after round-trip:');
    eq(P.PROC_CODE_EXCEPTIONS.XR, 'remove', 'and the behaviour came with it:');
    eq(P.isProcMapCustom(), true);
  });
  t('a BASELINE-EQUAL profile keeps its name through export and import', () => {
    // importProcProfile drops the custom flag but keeps the name when the
    // shared file happens to match the baseline. That is the exact shape that
    // hit the null path in setProcCodeMap and lost the name.
    reset();
    P.importProcProfile({ _text: JSON.stringify({
      schema: 'bom-comparator-proc-profile', profileName: 'Program Falcon',
      procCodes: P.PROC_CODE_BASELINE }) });
    eq(P.isProcMapCustom(), false, 'baseline-equal is not a deviation:');
    eq(state.procProfileName, 'Program Falcon', 'but the name is kept:');
    roundTrip();
    eq(state.procProfileName, 'Program Falcon', 'and survives the session:');
    eq(P.isProcMapCustom(), false, 'still not a deviation:');
  });
  t('a session with no proc fields at all restores as clean baseline', () => {
    reset(); P.setProcCodeMap({ XR:'remove' }, 'Program Falcon');
    ctx.__j = '{}';                                // a pre-v153 session file
    P.setProcCodeMap(null);
    ctx.__run(`var payload = JSON.parse(__j); ${SESSION_READ};`);
    eq([state.procProfileName, state.procOverrides], [null, null]);
    eq(P.PROC_CODE_EXCEPTIONS.BR, 'remove', 'baseline is live:');
  });

  console.log('\n== The name/override split, stated directly ==');
  t('setProcCodeMap(null, name) keeps the name; setProcCodeMap(null) clears it', () => {
    reset(); P.setProcCodeMap({ XR:'remove' }, 'Program Falcon');
    P.setProcCodeMap(null, 'Program Falcon');
    eq([state.procProfileName, state.procOverrides], ['Program Falcon', null],
       'named null-path:');
    P.setProcCodeMap(null);
    eq(state.procProfileName, null, 'bare null-path still clears:');
  });
  t('untagging back to baseline keeps the name, but Reset clears it', () => {
    // Two different acts. Editing your way back is not the same as declaring
    // you are done with the profile, and only the second should erase it.
    reset();
    P.setProcCodeMap(P.PROC_CODE_BASELINE, 'Program Falcon');
    P.setProcCodeBehavior('XR', 'remove');
    eq(P.isProcMapCustom(), true, 'tagging forks the table:');
    P.setProcCodeBehavior('XR', 'add');            // untag it again
    eq(P.isProcMapCustom(), false, 'back to baseline, flag dropped:');
    eq(state.procProfileName, 'Program Falcon', 'name held:');
    P.resetProcCodesToBaseline();
    eq(state.procProfileName, null, 'explicit Reset clears it:');
  });
  t('the freeze certificate label is identical before and after a round-trip', () => {
    reset(); P.setProcCodeMap({ XR:'remove' }, 'Program Falcon');
    const before = P._procProfileLabel();
    roundTrip();
    eq(P._procProfileLabel(), before, 'label drift:');
    eq(before, 'Program Falcon');
  });
  t('an unnamed custom table reads as Custom, not as the baseline', () => {
    reset(); P.setProcCodeBehavior('XR', 'remove');
    eq(P._procProfileLabel(), 'Custom');
    roundTrip();
    eq(P._procProfileLabel(), 'Custom', 'and stays Custom after a round-trip:');
  });
  t('a rejected profile file changes nothing', () => {
    reset(); P.setProcCodeMap({ XR:'remove' }, 'Program Falcon');
    P.importProcProfile({ _text: JSON.stringify({ schema: 'something-else',
      profileName: 'Hostile', procCodes: { BR:'swap' } }) });
    eq(state.procProfileName, 'Program Falcon', 'name untouched:');
    eq(P.PROC_CODE_EXCEPTIONS.XR, 'remove', 'table untouched:');
  });
});

// ── TIER 2 ─────────────────────────────────────────────────────────────────
// Until v154 the sandbox defined its own six-line buildEbomIndentureMap and the
// ECN inheritance suites tested THAT. The real function is ~60 lines and returns
// three structures, not one. They agree on clean data and diverge on a
// self-referencing row. These tests exercise the shipping function.
suite('Tier 2 — EBOM indenture map (the real one)', (t, eq) => {
  const ctx = sandbox({}, ['engine']);
  const build = ctx.E.buildEbomIndentureMap;
  // indenture=0, pn=1, nh=3 — the shape COL.ebom uses elsewhere in this file.
  const row = (ind, pn, nh) => { const r = new Array(10).fill('');
    r[0] = ind; r[1] = pn; r[3] = nh; return r; };
  const map  = rows => build(rows, 0, 1, 3);
  const kids = (m, k) => (m.keyInfo[k] ? [...m.keyInfo[k].childKeys].sort() : '(no such key)');

  console.log('\n== Structure the build actually consumes ==');
  t('returns all three structures, not just keyInfo', () => {
    const m = map([row('A', 'TOP', '')]);
    eq(Object.keys(m).sort(), ['keyInfo', 'pnToIndenture', 'pnToNh']);
  });
  t('a clean three-level tree links each level to the next, not transitively', () => {
    const m = map([row('A','TOP',''), row('B','MID','TOP'), row('C','LEAF','MID')]);
    eq(kids(m, 'TOP||'),     ['MID||TOP'], 'top:');
    eq(kids(m, 'MID||TOP'),  ['LEAF||MID'], 'middle:');
    eq(kids(m, 'LEAF||MID'), [], 'leaf:');
  });
  t('a deep chain stays one link per level', () => {
    const rows = [row('A','L0','')];
    for (let i = 1; i <= 8; i++) rows.push(row('B','L'+i,'L'+(i-1)));
    const m = map(rows);
    for (let i = 0; i < 8; i++)
      eq(kids(m, 'L'+i+'||'+(i ? 'L'+(i-1) : '')), ['L'+(i+1)+'||L'+i], 'level '+i+':');
  });
  t('a PN under two different NHs makes the child a child of BOTH keys', () => {
    const m = map([row('A','TOP',''), row('B','P1','TOP'), row('B','P1','OTHER'), row('C','KID','P1')]);
    eq(kids(m, 'P1||TOP'),   ['KID||P1'], 'first parent key:');
    eq(kids(m, 'P1||OTHER'), ['KID||P1'], 'second parent key:');
  });

  console.log('\n== Where the old stand-in was wrong ==');
  t('a self-referencing row (PN === NH) becomes its own child', () => {
    // A part listed as its own next-higher assembly — a real extract defect.
    // The shipping function creates a self-loop here. The old stand-in excluded
    // self and reported ["Y||X"], so this behaviour was invisible to the harness.
    const m = map([row('A','X','X'), row('B','Y','X')]);
    eq(kids(m, 'X||X'), ['X||X', 'Y||X'], 'self-loop is real:');
  });
  t('the ECN inheritance walk terminates on that self-loop and still inherits', () => {
    const c = sandbox({ COL:{ebom:{indenture:0,pn:1,nh:3}, chp:{pn:3,nh:5,ecn:18,docNo:10,docRev:11}},
      state:{results:[], boms:{ebom:null, chp:null}} }, ['proc','engine','ecn']);
    const R = (pn, nh, ecn) => ({ key: pn+'||'+nh, pn, nh, overall:'ok', as:'ok',
      woStatus:'closed', woValues:['W1'],
      trace: ecn ? { dcn:new Map(), ecn:new Map(ecn), ecr:new Map() } : null,
      ncrEntriesPool1:[], ncrEntriesPool2:[] });
    c.state.results = [R('X','X',[['E1','']]), R('Y','X',null)];
    c.state.boms.ebom = { data:[row('A','X','X'), row('B','Y','X')] };
    const e = c.B.buildEcnFootprints().ecnMap.get('E1');   // must return, not hang
    eq(e.items.length, 2, 'child inherited across the self-loop:');
    eq(e.items.map(x => x.r.key).sort(), ['X||X', 'Y||X']);
    // Y holds no ECN of its own — it must be marked as inherited from X.
    const y = e.items.find(x => x.r.key === 'Y||X');
    eq(y.inheritedVia, 'X||X', 'inheritance provenance:');
    eq(e.items.find(x => x.r.key === 'X||X').inheritedVia, '', 'the anchor is direct:');
  });

  console.log('\n== Indexing rules ==');
  t('a row with a blank NH is indexed but never linked as a child', () => {
    const m = map([row('A','TOP',''), row('B','ORPHAN','')]);
    eq(kids(m, 'TOP||'), [], 'a blank NH must not read as "child of everything":');
    if (!m.keyInfo['ORPHAN||']) throw new Error('the orphan row was dropped from keyInfo');
  });
  t('a row with a blank PN is skipped entirely', () => {
    const m = map([row('A','TOP',''), row('B','','TOP')]);
    eq(Object.keys(m.keyInfo).sort(), ['TOP||']);
  });
  t('pnToIndenture keeps the FIRST occurrence and does not overwrite', () => {
    const m = map([row('B','P1','TOP'), row('E','P1','OTHER')]);
    eq(m.pnToIndenture['P1'], 'B', 'later rows must not win:');
  });
  t('pnToNh keeps the FIRST occurrence and does not overwrite', () => {
    const m = map([row('B','P1','TOP'), row('B','P1','OTHER')]);
    eq(m.pnToNh['P1'], 'TOP');
  });
  t('case and whitespace variants collapse to one key', () => {
    const m = map([row('a',' top ',''), row('b','MID','TOP'), row('b','mid','top')]);
    eq(Object.keys(m.keyInfo).sort(), ['MID||TOP', 'TOP||'], 'normalised:');
    eq(kids(m, 'TOP||'), ['MID||TOP']);
  });
});

// The harness's own safety net. HARNESS.md promises that a moved marker "fails
// loudly and names it" — before v154 that was true only for markers routed
// through at(). Four boundaries used raw indexOf, where a miss returns -1 and
// produces a silently EMPTY module: every suite green, nothing tested.
suite('Tier 2 — extraction integrity', (t, eq) => {
  const DEPS = { proc:['proc'], engine:['engine'],
                 ecn:['proc','engine','ecn'], ncr:['ncr'], chp:['chp'], delta:['delta'], session:['session'], adjimport:['adjimport'] };

  t('every module is substantial and contains what it claims', () => {
    Object.keys(MODULE_CONTRACT).forEach(name => {
      const c = MODULE_CONTRACT[name], src = MOD[name];
      if (!src || src.length < c.min)
        throw new Error(name + ': ' + (src ? src.length : 0) + ' chars, expected >= ' + c.min);
      c.needs.forEach(n => { if (!src.includes(n))
        throw new Error(name + ' is missing ' + JSON.stringify(n) + ' — wrong slice'); });
    });
  });
  t('every module defines its global once evaluated', () => {
    Object.keys(MODULE_CONTRACT).forEach(name => {
      const c = MODULE_CONTRACT[name];
      const ctx = sandbox({ COL:{ebom:{indenture:0,pn:1,nh:3}, abom:{procCode:12,desc:10,jobNo:5},
        chp:{pn:3,nh:5,ecn:18}, ncr:{ncrNum:60,dispNo:71}},
        state:{results:[], boms:{}, isLocked:false, procOverrides:null, procProfileName:null} },
        DEPS[name]);
      if (!ctx[c.global]) throw new Error(name + ' did not define globalThis.' + c.global);
      c.exports.forEach(fn => { if (typeof ctx[c.global][fn] !== 'function')
        throw new Error(name + '.' + c.global + '.' + fn + ' is not a function'); });
    });
  });
  t('no global exists without its module — an empty run cannot pass', () => {
    const c = sandbox({}, []);
    ['P','E','B','N'].forEach(g => { if (c[g])
      throw new Error(g + ' exists with no module loaded'); });
  });

  console.log('\n== The guards themselves ==');
  const throws = (fn, want, label) => {
    let msg = null;
    try { fn(); } catch (e) { msg = e.message; }
    if (msg === null) throw new Error(label + ' did not throw');
    if (msg.indexOf(want) < 0) throw new Error(label + ' threw the wrong thing: ' + msg);
  };
  t('a missing marker throws and names itself', () => {
    throws(() => at('NO SUCH MARKER IN THIS BUILD'), 'BUILD MARKER MOVED', 'at()');
    throws(() => at('NO SUCH MARKER IN THIS BUILD'), 'NO SUCH MARKER', 'at() naming');
  });
  t('a backwards marker search is guarded too', () => {
    throws(() => lastAt('NO SUCH MARKER IN THIS BUILD', 5000, 'probe'),
           'BUILD MARKER MOVED', 'lastAt()');
  });
  t('crossed boundaries are refused, not silently emptied', () => {
    // This is the exact shape a raw indexOf miss produced: end before start.
    throws(() => span(1124358, 400, 'probe'), 'BUILD MARKERS CROSSED', 'span()');
  });
  t('a suspiciously small slice is refused', () => {
    throws(() => span(0, 50, 'probe'), 'MODULE SLICE TOO SMALL', 'span()');
  });
  t('grabFn refuses a function that is not there', () => {
    throws(() => grabFn('thisFunctionDoesNotExistAnywhere'), 'BUILD MARKER MOVED', 'grabFn()');
  });

  console.log('\n== The worker bundle must be self-contained ==');
  t('every function the worker bundle calls is also IN the bundle', () => {
    // The worker is built by serialising a hand-listed set of functions with
    // .toString(). A function that calls another top-level function which is
    // NOT on that list throws inside the worker and kills every comparison run.
    // This has now happened twice: buildEbomLineNoMap in v145, and
    // normIndenture in v160 — which shipped broken through v163 because every
    // suite here loads functions directly and never exercises the worker path.
    const i = at('const fns = [');
    const listSrc = SRC.slice(i + 13, at('].map(fn => fn.toString())', i));
    const bundled = new Set([...listSrc.replace(/\/\/[^\n]*/g, '')
      .matchAll(/\b([a-zA-Z_$][\w$]*)\b/g)].map(m => m[1]));
    if (bundled.size < 15) throw new Error('only found ' + bundled.size + ' bundled functions');
    const topLevel = new Set([...SRC.matchAll(/^function (\w+)\s*\(/gm)].map(m => m[1]));
    const missing = [];
    bundled.forEach(fn => {
      let src;
      try { src = grabFn(fn); } catch (e) { return; }
      // Bare calls only: a preceding '.' makes it a method, not a global.
      [...src.matchAll(/(^|[^.\w$])([a-zA-Z_$][\w$]*)\s*\(/g)].forEach(m => {
        const c = m[2];
        if (c === fn || !topLevel.has(c) || bundled.has(c)) return;
        missing.push(fn + '() calls ' + c + '()');
      });
    });
    if (missing.length)
      throw new Error('the worker would throw on:\n        ' +
                      [...new Set(missing)].join('\n        '));
  });
  t('normIndenture specifically is in the bundle', () => {
    // Named because it is the one that shipped broken, and because the failure
    // is invisible to every other test in this file.
    const i = at('const fns = [');
    const listSrc = SRC.slice(i + 13, at('].map(fn => fn.toString())', i))
      .replace(/\/\/[^\n]*/g, '');
    if (!/\bnormIndenture\b/.test(listSrc))
      throw new Error('normIndenture is missing from the worker bundle again');
  });

  console.log('\n== The build is still what it claims to be ==');
  t('no external script or stylesheet — the file is genuinely offline', () => {
    const ext = [...SRC.matchAll(/<script[^>]*\ssrc\s*=/gi)].length +
                [...SRC.matchAll(/<link[^>]*rel=["']stylesheet["']/gi)].length;
    if (ext) throw new Error(ext + ' external reference(s) — the build is no longer self-contained');
  });
  t('HARNESS.md reports the same test count as the harness', () => {
    // v163 — the header count had been stale since 262 tests: every update
    // since was rewriting a phrase that no longer matched, and silently doing
    // nothing. Documentation that quietly stops tracking is worse than none.
    const fs2 = require('fs'), pth = require('path');
    const candidates = [pth.join(__dirname, 'HARNESS.md'),
                        pth.join(__dirname, '..', 'HARNESS.md')];
    const f = candidates.find(p => { try { return fs2.statSync(p).isFile(); } catch (e) { return false; } });
    if (!f) return;                       // not shipped alongside: nothing to check
    const md = fs2.readFileSync(f, 'utf8');
    const m = md.match(/(\d+)\s+tests\./);
    if (!m) throw new Error('HARNESS.md no longer states a test count');
    // EXPECTED_TESTS is declared at the foot of this file, after every suite has
    // run, so it cannot be referenced here. Read the literal from source.
    const self = fs2.readFileSync(__filename, 'utf8');
    const want = parseInt(self.match(/EXPECTED_TESTS = (\d+)/)[1], 10);
    if (parseInt(m[1], 10) !== want)
      throw new Error('HARNESS.md says ' + m[1] + ' tests, the harness expects ' + want);
  });
  t('the file read is the file reported', () => {
    eq(fs.readFileSync(BUILD, 'utf8').length, SRC.length);
    if (!/^<!DOCTYPE html/i.test(SRC.trim())) throw new Error('not an HTML document');
  });
});

// ── TIER 3 ─────────────────────────────────────────────────────────────────
// The CHP release badge. Pure logic, user-visible warning, and the release date
// it produces is printed on the freeze certificate — an audit artefact.
suite('Tier 3 — CHP release state', (t, eq) => {
  const C = sandbox({}, ['chp']).C;
  const trace = (dcn, ecn, ecr) => ({
    dcn: new Map(dcn || []), ecn: new Map(ecn || []), ecr: new Map(ecr || []) });
  const st = (...a) => C.chpReleaseState(trace(...a));

  console.log('\n== No history, and history without a DCN ==');
  t('a null trace reads as NO HISTORY, not as a warning', () => {
    const s = C.chpReleaseState(null);
    eq([s.state, s.label, s.warn, s.dcnCount], ['none', 'NO HISTORY', false, 0]);
  });
  t('a trace with three empty maps also reads as NO HISTORY', () => {
    eq(st([], [], []).state, 'none');
  });
  t('an ECN with no DCN reads as NO DCN and is NOT a warning', () => {
    // Expected for COTS parts: release is held by the parent that owns the DCN.
    const s = st([], [['E1', 'Open']], []);
    eq([s.state, s.label, s.warn], ['no_dcn', 'NO DCN', false]);
  });
  t('an ECR alone also reads as NO DCN', () => {
    eq(st([], [], [['R1', '']]).state, 'no_dcn');
  });

  console.log('\n== Released ==');
  t('one dated DCN reads as RELEASED with no count suffix', () => {
    const s = st([['D1', '2024-03-15']]);
    eq([s.state, s.warn, s.dcnCount], ['released', false, 1]);
    eq(s.label, 'RELEASED MARCH 15, 2024');
  });
  t('several dated DCNs report the LATEST date and the count', () => {
    const s = st([['D1', '2024-01-05'], ['D2', '2024-06-30'], ['D3', '2024-03-15']]);
    eq(s.date, 'JUNE 30, 2024', 'latest wins:');
    eq(s.label, 'RELEASED JUNE 30, 2024 \u00b7 3 DCNs');
    eq(s.dcnCount, 3);
  });
  t('order of arrival does not change which date wins', () => {
    const a = st([['D1', '2024-06-30'], ['D2', '2024-01-05']]).date;
    const b = st([['D1', '2024-01-05'], ['D2', '2024-06-30']]).date;
    eq(a, b);
  });

  console.log('\n== Unreleased: the warning that matters ==');
  t('an undated DCN raises the warning and names the offender', () => {
    const s = st([['D1', 'Unknown']]);
    eq([s.state, s.warn, s.label], ['unreleased', true, '\u26a0 DCN NOT RELEASED']);
    eq(s.undated, ['D1']);
    if (!s.note.includes('D1')) throw new Error('the note must name the DCN');
  });
  t('ONE undated DCN outweighs any number of dated ones', () => {
    // The safe direction: a partially-scoped extract must not read as released.
    const s = st([['D1', '2024-03-15'], ['D2', ''], ['D3', '2024-06-30']]);
    eq([s.state, s.warn], ['unreleased', true]);
    eq(s.undated, ['D2']);
  });
  t('every undated DCN is listed, not just the first', () => {
    eq(st([['D1', ''], ['D2', 'TBD'], ['D3', '2024-03-15']]).undated, ['D1', 'D2']);
  });
  t('unparseable text counts as undated, not as a date', () => {
    ['Unknown', 'TBD', 'N/A', 'RELEASED', '   ', ''].forEach(v => {
      eq(C.chpReleaseState(trace([['D1', v]])).state, 'unreleased', JSON.stringify(v) + ':');
    });
  });

  console.log('\n== Date shapes the extract actually produces ==');
  t('a Date object from cellDates:true is accepted', () => {
    eq(st([['D1', new Date(2024, 2, 15)]]).date, 'MARCH 15, 2024');
  });
  t('a stringified Date is accepted — this is the real path', () => {
    // buildChpTraceMap does String(row[...]) before storing, so the Date object
    // branch is mostly bypassed in practice.
    eq(st([['D1', String(new Date(2024, 2, 15))]]).date, 'MARCH 15, 2024');
  });
  t('ISO, slash and DD-MON forms all give the same calendar date', () => {
    ['2024-03-15', '2024-03-15T08:30:00Z', '2024-03-15 08:30:00',
     '3/15/2024', '15-MAR-2024'].forEach(v => {
      eq(C.formatDcnDate(v), 'MARCH 15, 2024', JSON.stringify(v) + ':');
    });
  });
  t('an invalid Date object is treated as undated', () => {
    eq(st([['D1', new Date('nonsense')]]).state, 'unreleased');
  });

  console.log('\n== Defect C: the same day everywhere on earth ==');
  t('the displayed date does not depend on the reader\'s timezone', () => {
    // v153 read UTC components off a date built at LOCAL midnight, so a DCN
    // released 15 March showed as MARCH 14 in Tokyo, Sydney and Kolkata.
    // Node reads process.env.TZ at first Date use, so this runs a child.
    const cp = require('child_process');
    const probe = 'const v=process.argv[1];' + MOD.chp +
      ';console.log(formatDcnDate(v==="obj"?new Date(2024,2,15):v));';
    ['2024-03-15', '3/15/2024', '15-MAR-2024', 'obj'].forEach(shape => {
      ['UTC', 'America/New_York', 'Asia/Tokyo', 'Australia/Sydney', 'Asia/Kolkata',
       'Pacific/Kiritimati'].forEach(tz => {
        const got = cp.execFileSync(process.execPath, ['-e', probe, shape],
                     { env: Object.assign({}, process.env, { TZ: tz }) }).toString().trim();
        if (got !== 'MARCH 15, 2024')
          throw new Error(shape + ' in ' + tz + ' -> ' + got);
      });
    });
  });
  t('no UTC component read survives in the date formatter', () => {
    if (/getUTC(Month|Date|FullYear)/.test(MOD.chp))
      throw new Error('formatDcnDate is reading UTC components again');
  });

  console.log('\n== Badge styling ==');
  t('only the unreleased state is styled as a warning', () => {
    // v156 — 'none' used to return '', so NO HISTORY rendered as bare text
    // beside four real badges in the same column. It now gets the neutral badge.
    // Every state is a badge; only 'unreleased' is a WARNING badge.
    eq(C.chpStateClass('unreleased'), 'badge badge-chp-warn');
    eq(C.chpStateClass('none'), 'badge badge-neutral', 'no history must still be a badge:');
    eq(C.chpStateClass('released'), 'badge badge-history');
    eq(C.chpStateClass('no_dcn'), 'badge badge-history', 'NO DCN is not a warning:');
  });
  t('every state chpReleaseState can return has a class', () => {
    ['none', 'no_dcn', 'released', 'unreleased'].forEach(s => {
      if (typeof C.chpStateClass(s) !== 'string')
        throw new Error('no class for state ' + s);
    });
  });
});

// The proc code table under adversarial conditions: a frozen report, a
// hand-edited profile file, and a session carrying someone else's provenance.
suite('Tier 3 — proc table under lock, bad input, and session reuse', (t, eq) => {
  const SESSION_READ = 'setProcCodeMap(payload.procOverrides || null, ' +
                       'payload.procProfileName || null)';
  const ctx = sandbox({
    COL: { abom: { procCode: 12, desc: 10, jobNo: 5 } },
    state: { boms:{abom:null}, results:[], isLocked:false,
             procOverrides:null, procProfileName:null },
  }, ['proc']);
  const P = ctx.P, state = ctx.state;
  ctx.__run = src => require('vm').runInContext(src, ctx, { filename: 'session.js' });
  const reset = () => { state.isLocked = false; state.results = []; P.dirty = false;
                        P.setProcCodeMap(null); };
  const profile = o => ({ _text: JSON.stringify(Object.assign(
    { schema: 'bom-comparator-proc-profile' }, o)) });

  console.log('\n== A frozen report must not move ==');
  t('tagging a code is refused while the report is locked', () => {
    reset(); state.isLocked = true;
    P.setProcCodeBehavior('XR', 'remove');
    eq([P.isProcMapCustom(), state.procOverrides], [false, null], 'table changed under lock:');
  });
  t('reset to baseline is refused while the report is locked', () => {
    reset(); P.setProcCodeMap({ XR:'remove' }, 'Program Falcon');
    state.isLocked = true;
    P.resetProcCodesToBaseline();
    eq([P.isProcMapCustom(), state.procProfileName], [true, 'Program Falcon'], 'reset ran anyway:');
  });
  t('unlocking restores both operations', () => {
    reset(); P.setProcCodeBehavior('XR', 'remove');
    eq(P.getProcBehavior('XR'), 'remove');
    P.resetProcCodesToBaseline();
    eq(P.isProcMapCustom(), false);
  });

  console.log('\n== A hand-edited profile file ==');
  t('a wrong schema is rejected and changes nothing', () => {
    reset(); P.setProcCodeMap({ XR:'remove' }, 'Program Falcon');
    P.importProcProfile(profile({ schema:'something-else', procCodes:{ BR:'swap' } }));
    eq([P.PROC_CODE_EXCEPTIONS.XR, state.procProfileName], ['remove', 'Program Falcon']);
  });
  t('an invalid behaviour value is dropped, not installed', () => {
    reset();
    P.importProcProfile(profile({ profileName:'Bad', procCodes:{ XR:'remove', TSW:'delete' } }));
    eq(P.getProcBehavior('XR'), 'remove', 'the valid entry survives:');
    eq(P.getProcBehavior('TSW'), 'add', '"delete" is not a behaviour:');
  });
  t('an empty procCodes map installs a table with no removal codes', () => {
    // A deliberate act — every code untagged — not the same as the baseline.
    reset();
    P.importProcProfile(profile({ profileName:'Nothing', procCodes:{} }));
    eq(P.isProcMapCustom(), true, 'still a deviation:');
    eq(P.getProcBehavior('BR'), 'add', 'baseline BR no longer removes:');
  });
  t('a profile identical to the baseline keeps its name but drops the flag', () => {
    reset();
    P.importProcProfile(profile({ profileName:'Program Falcon',
                                  procCodes: P.PROC_CODE_BASELINE }));
    eq([P.isProcMapCustom(), state.procProfileName], [false, 'Program Falcon']);
  });

  console.log('\n== Defect D: provenance must not leak between loads ==');
  t('an unnamed custom session does NOT inherit the previous profile name', () => {
    // v153: setProcCodeMap fell back to `|| state.procProfileName`, so loading
    // "Program Falcon" and then importing an unnamed session left the freeze
    // certificate still claiming Falcon.
    reset(); P.setProcCodeMap({ XR:'remove' }, 'Program Falcon');
    ctx.__j = JSON.stringify({ procOverrides:{ TSW:'swap' }, procProfileName:null });
    ctx.__run(`var payload = JSON.parse(__j); ${SESSION_READ};`);
    eq(state.procProfileName, null, 'stale name survived:');
    eq(P._procProfileLabel(), 'Custom');
  });
  t('a named session overwrites the previous name rather than merging', () => {
    reset(); P.setProcCodeMap({ XR:'remove' }, 'Program Falcon');
    ctx.__j = JSON.stringify({ procOverrides:{ TSW:'swap' }, procProfileName:'Program Kestrel' });
    ctx.__run(`var payload = JSON.parse(__j); ${SESSION_READ};`);
    eq(state.procProfileName, 'Program Kestrel');
  });
  t('a baseline session clears a previously loaded profile entirely', () => {
    reset(); P.setProcCodeMap({ XR:'remove' }, 'Program Falcon');
    ctx.__j = '{}';
    ctx.__run(`var payload = JSON.parse(__j); ${SESSION_READ};`);
    eq([state.procProfileName, state.procOverrides], [null, null]);
    eq(P.getProcBehavior('BR'), 'remove', 'baseline is live again:');
  });

  console.log('\n== The stale-results flag ==');
  t('tagging with no results on screen does not raise the dirty flag', () => {
    reset(); P.setProcCodeBehavior('XR', 'remove');
    eq(P.dirty, false, 'nothing to invalidate yet:');
  });
  t('tagging AFTER a run marks the results stale', () => {
    reset(); state.results = [{}];
    P.setProcCodeBehavior('XR', 'remove');
    eq(P.dirty, true);
  });
  t('resetting after a run also marks the results stale', () => {
    reset(); P.setProcCodeMap({ XR:'remove' }, null); state.results = [{}];
    P.resetProcCodesToBaseline();
    eq(P.dirty, true);
  });
  t('a locked report cannot be made dirty', () => {
    reset(); state.results = [{}]; state.isLocked = true;
    P.setProcCodeBehavior('XR', 'remove');
    P.resetProcCodesToBaseline();
    eq(P.dirty, false);
  });
});

// ── TIER 4 ─────────────────────────────────────────────────────────────────
// The delta tool: a second shipped file with no coverage at all until v154.
// Its whole job is to tell two sessions apart, so a field it fails to compare
// is a wrong answer, not a missing feature.
suite('Tier 4 — delta tool', (t, eq) => {
  const D = sandbox({}, ['delta']).D;
  const P = sandbox({ COL:{abom:{procCode:12,desc:10,jobNo:5}},
    state:{boms:{abom:null},results:[],isLocked:false,
           procOverrides:null,procProfileName:null} }, ['proc']).P;

  console.log('\n== The duplicated baseline ==');
  t('the delta tool\'s PROC_CODE_BASELINE matches the main build\'s, key for key', () => {
    // The delta tool ships its own copy. Its own comment says it "mirrors the
    // main build's shipped proc code table" — nothing enforced that. If the
    // main build gains a code and this copy does not, the delta tool reports
    // two sessions as agreeing on proc codes when they do not.
    const a = P.PROC_CODE_BASELINE, b = D.PROC_CODE_BASELINE;
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    const onlyMain = ka.filter(k => !(k in b)), onlyDelta = kb.filter(k => !(k in a));
    if (onlyMain.length || onlyDelta.length)
      throw new Error('BASELINES HAVE DRIFTED — only in main build: [' + onlyMain +
                      ']; only in delta tool: [' + onlyDelta + ']');
    const differ = ka.filter(k => a[k] !== b[k]).map(k => k + ' (' + a[k] + ' vs ' + b[k] + ')');
    if (differ.length) throw new Error('BEHAVIOURS HAVE DRIFTED: ' + differ.join(', '));
  });
  t('both copies still classify every code as remove or swap', () => {
    Object.keys(D.PROC_CODE_BASELINE).forEach(k => {
      const v = D.PROC_CODE_BASELINE[k];
      if (v !== 'remove' && v !== 'swap') throw new Error(k + ' is "' + v + '"');
    });
  });

  console.log('\n== procTableOf and procTableDiff ==');
  t('a session with no overrides runs under the baseline', () => {
    eq(D.procTableOf({ procOverrides: null }), D.PROC_CODE_BASELINE);
    eq(D.procTableOf(null), D.PROC_CODE_BASELINE, 'a missing session too:');
  });
  t('overrides replace the baseline outright, they do not merge into it', () => {
    const tbl = D.procTableOf({ procOverrides: { XR: 'remove' } });
    eq(Object.keys(tbl), ['XR']);
    eq(tbl.BR, undefined, 'baseline BR must not leak through:');
  });
  t('codes are normalised and invalid behaviours dropped', () => {
    const tbl = D.procTableOf({ procOverrides: { ' xr ': 'REMOVE', TSW: 'delete', '': 'swap' } });
    eq(tbl, { XR: 'remove' });
  });
  t('two identical sessions report no proc difference', () => {
    eq(D.procTableDiff({ procOverrides: null }, { procOverrides: null }).same, true);
  });
  t('absent means install, so a code added on one side is a difference', () => {
    const d = D.procTableDiff({ procOverrides: { XR:'remove' } },
                              { procOverrides: { XR:'remove', TSW:'swap' } });
    eq(d.same, false);
    eq(d.codes, [{ code:'TSW', a:'install', b:'swap' }]);
  });
  t('a code reclassified from remove to swap is reported with both sides', () => {
    const d = D.procTableDiff({ procOverrides:{ XR:'remove' } }, { procOverrides:{ XR:'swap' } });
    eq(d.codes, [{ code:'XR', a:'remove', b:'swap' }]);
  });
  t('differences are sorted so the sheet is stable between runs', () => {
    const d = D.procTableDiff({ procOverrides:{} },
                              { procOverrides:{ ZZ:'swap', AA:'remove', MM:'swap' } });
    eq(d.codes.map(c => c.code), ['AA', 'MM', 'ZZ']);
  });
  t('a baseline session versus a custom one is a difference, not a match', () => {
    eq(D.procTableDiff({ procOverrides:null }, { procOverrides:{ XR:'remove' } }).same, false);
  });

  console.log('\n== procProfileLabel agrees with the main build ==');
  t('the two tools label the same session identically', () => {
    [[null, null], [{ XR:'remove' }, null], [{ XR:'remove' }, 'Program Falcon'],
     [null, 'Program Falcon']].forEach(([ov, nm]) => {
      P.setProcCodeMap(ov, nm);
      const main = P._procProfileLabel();
      const delta = D.procProfileLabel({ procOverrides: ov, procProfileName: nm });
      if (main !== delta)
        throw new Error('label drift for ' + JSON.stringify([ov, nm]) +
                        ': main says ' + JSON.stringify(main) +
                        ', delta says ' + JSON.stringify(delta));
    });
  });

  console.log('\n== Defect E: displayed but not compared ==');
  const claim = o => Object.assign({ id:'adj_1', type:'ebom_ncr_trace', mode:'embodiment',
    leg:'A', rowKey:'P1||TOP', reason:'ebom_ncr_trace', sme:'J.Doe',
    rationale:'traced', applied:false }, o);
  t('a changed NCR disposition number is reported as a modification', () => {
    // v3.1 compared c.dispNo only. On ebom_ncr_trace claims — the ones the
    // main build actually creates — the field is ncrDispNo, so this change
    // was invisible and the claim was omitted from the Claims sheet.
    const rows = D.claimsDelta({ adjudications:[claim({ ncrDispNo:'DISP-100' })] },
                               { adjudications:[claim({ ncrDispNo:'DISP-999' })] });
    eq(rows.length, 1, 'modification missed:');
    eq(rows[0].Change, 'Modified');
    eq(rows[0]['NCR Disp No'], 'DISP-999');
  });
  t('a claim moving from pending to applied is reported', () => {
    const rows = D.claimsDelta({ adjudications:[claim({ applied:false })] },
                               { adjudications:[claim({ applied:true })] });
    eq(rows.length, 1);
    eq(rows[0].Applied, 'yes');
  });
  t('every field the Claims sheet prints is a field the signature compares', () => {
    // The rule the defect broke. Vary one field at a time and require the
    // signature to move. Timestamp is excluded deliberately — see HARNESS.md.
    const base = claim({ ncrDispNo:'D1', woNo:'W1', claimedQty:2, ciKey:'C1',
                         smeRole:'Lead', rowKeys:['a','b'] });
    const vary = { type:'other', leg:'B', rowKey:'X||Y', ciKey:'C2', ncrDispNo:'D2',
                   woNo:'W2', claimedQty:5, sme:'A.Nother', smeRole:'Peer',
                   rationale:'different', applied:true };
    Object.keys(vary).forEach(f => {
      const changed = Object.assign({}, base); changed[f] = vary[f];
      if (D.claimSig(base) === D.claimSig(changed))
        throw new Error('claimSig ignores "' + f + '", which claimRow displays');
    });
  });
  t('an unchanged claim produces no row at all', () => {
    eq(D.claimsDelta({ adjudications:[claim({ ncrDispNo:'D1' })] },
                     { adjudications:[claim({ ncrDispNo:'D1' })] }).length, 0);
  });

  console.log('\n== claimsDelta bookkeeping ==');
  t('added, removed and modified claims are each labelled', () => {
    const A = { adjudications:[claim({ id:'a1' }), claim({ id:'a2', rationale:'old' })] };
    const B = { adjudications:[claim({ id:'a2', rationale:'new' }), claim({ id:'a3' })] };
    const rows = D.claimsDelta(A, B);
    eq(rows.map(r => r.Change + ':' + r['Claim ID']).sort(),
       ['Added in B:a3', 'Modified:a2', 'Removed in B:a1']);
  });
  t('claims with no id are ignored rather than crashing', () => {
    eq(D.claimsDelta({ adjudications:[{ rationale:'orphan' }] },
                     { adjudications:[] }).length, 0);
  });
  t('a session with no adjudications key is treated as empty', () => {
    eq(D.claimsDelta({}, {}).length, 0);
    eq(D.claimsDelta({}, { adjudications:[claim({ id:'z' })] }).length, 1);
  });

  console.log('\n== v3.3: the indenture scope must be surfaced, not silently diffed ==');
  t('a session without the field is read as the pre-v160 A/B rule', () => {
    // Sessions written before the setting existed ran under the fixed A/B rule.
    // Defaulting to an empty list would claim every level reconciled.
    eq(D.collectorLevelsOf({}), ['A', 'B']);
    eq(D.collectorLevelsOf(null), ['A', 'B']);
    eq(D.collectorLevelsOf({ collectorLevels: 'nonsense' }), ['A', 'B'], 'and junk too:');
  });
  t('the scope label reads the way the main build words it', () => {
    eq(D.collectorScopeLabel({ collectorLevels: ['A','B'] }), 'A + B excluded');
    eq(D.collectorScopeLabel({ collectorLevels: [] }), 'All levels reconcile');
    eq(D.collectorScopeLabel({ collectorLevels: ['A'] }), 'A excluded');
  });
  t('two sessions on the same scope report no difference', () => {
    eq(D.indentureScopeDiff({ collectorLevels:['A','B'] },
                            { collectorLevels:['A','B'] }).same, true);
    eq(D.indentureScopeDiff({}, { collectorLevels:['A','B'] }).same, true,
       'an old session matches an explicit default:');
  });
  t('order does not fake a difference', () => {
    eq(D.indentureScopeDiff({ collectorLevels:['B','A'] },
                            { collectorLevels:['A','B'] }).same, true);
  });
  t('a genuine scope difference is reported and explained', () => {
    const ctx = D.indentureContext({ collectorLevels:['A','B'] }, { collectorLevels:[] });
    eq(ctx.diff.same, false);
    if (!ctx.warning) throw new Error('a scope mismatch must produce a warning');
    ['A + B excluded', 'All levels reconcile'].forEach(x => {
      if (ctx.warning.indexOf(x) < 0) throw new Error('the warning must name both scopes');
    });
    if (ctx.warning.indexOf('build') < 0)
      throw new Error('the warning must say the change may not be a build change');
  });
  t('matching scopes produce no warning', () => {
    eq(D.indentureContext({ collectorLevels:['A','B'] }, {}).warning, '');
  });
  t('the scope appears as a provenance row and a load-time warning', () => {
    if (!/line\('EBOM indenture scope'/.test(DSRC))
      throw new Error('the summary does not report the scope');
    if (!/indentureContext\(state\.A, state\.B\)/.test(DSRC))
      throw new Error('the load-time guard does not check the scope');
    // It must not be gated on a leg being present — the scope governs the EBOM
    // side, which every comparison mode has.
    const seg = DSRC.slice(DSRC.indexOf("line('EBOM indenture scope'") - 400,
                           DSRC.indexOf("line('EBOM indenture scope'"));
    if (/if \(!procCtx \|\| procCtx\.relevant\)/.test(seg))
      throw new Error('the scope row is gated behind the ABOM-leg check');
  });
  t('scope exclusion is still driven by status, not by indenture level', () => {
    // The delta tool excludes on the 'collector' STATUS, so it inherits the
    // main build's setting automatically. If it ever started reading indenture
    // letters itself, that would be a second copy of the rule to keep in sync.
    if (/indenture\s*===?\s*'[A-Z]'/.test(DSRC))
      throw new Error('the delta tool now derives the collector rule itself');
    eq(D.fscope([{ overall:'collector' }, { overall:'ok' }]).length, 1);
  });

  console.log('\n== Small helpers ==');
  t('dNorm and normPN normalise identically to the main build', () => {
    ['  p1 ', 'p1', 'P1', '', null, undefined, 0, 123].forEach(v => {
      eq(D.dNorm(v), D.normPN(v), JSON.stringify(v) + ':');
    });
    eq(D.dNorm('  abc '), 'ABC');
  });
  t('pct guards against divide-by-zero', () => {
    eq(D.pct(1, 0), '\u2014', 'zero denominator:');
    eq(D.pct(1, 4), '25.0%');
    eq(D.pct(0, 4), '0.0%');
  });
  t('the delta tool reports a version consistent with its filename', () => {
    const m = DSRC.match(/<title>([^<]*)<\/title>/);
    const fileV = DELTA.match(/v([\d_]+)\.html$/)[1].replace(/_/g, '.');
    if (m[1].indexOf(fileV) < 0)
      throw new Error('title says ' + JSON.stringify(m[1]) +
                      ' but the file is v' + fileV);
  });
});

// ── TIER 6 ─────────────────────────────────────────────────────────────────
// The delta tool's report assembly: the two-pass EBOM matcher, the KPI counters
// and the NCR disposition diff. Tier 4 covered the comparison layer; this is
// what actually fills the sheets.
suite('Tier 6 — delta tool report assembly', (t, eq) => {
  const D = sandbox({}, ['delta']).D;
  const row = (pn, nh, o) => Object.assign({ key: pn + '||' + nh, pn, nh, eq: 1 }, o);
  const sess = (rows, o) => Object.assign({ results: rows }, o);
  const changes = (a, b) => D.ebomChanges(sess(a), sess(b));
  const typesOf = rows => rows.map(r => r['Change Type'] + ':' + r['Part Number']);

  console.log('\n== The four EBOM change types ==');
  t('an unchanged BOM produces no rows at all', () => {
    const r = [row('P1','TOP'), row('P2','TOP')];
    eq(changes(r, r).length, 0);
  });
  t('a quantity change is reported with both old and new values', () => {
    const out = changes([row('P1','TOP',{eq:2})], [row('P1','TOP',{eq:5})]);
    eq(out.length, 1);
    eq([out[0]['Change Type'], out[0]['Old Qty'], out[0]['New Qty']], ['Qty Changed','2','5']);
  });
  t('eqText wins over eq, so display text drives the comparison', () => {
    // A row carrying '2 EA' as text must not read as quantity 2.
    const out = changes([row('P1','TOP',{eq:2, eqText:'2 EA'})],
                        [row('P1','TOP',{eq:2, eqText:'3 EA'})]);
    eq([out.length, out[0]['Old Qty'], out[0]['New Qty']], [1, '2 EA', '3 EA']);
  });
  t('a part only in B is Added, a part only in A is Removed', () => {
    const out = changes([row('GONE','TOP')], [row('NEW','TOP')]);
    eq(typesOf(out), ['Removed:GONE', 'Added:NEW']);
  });
  t('the same PN under a new parent is ONE Re-parented row, not add plus remove', () => {
    const out = changes([row('P1','OLD')], [row('P1','NEW')]);
    eq(out.length, 1, 'must not double-report:');
    eq([out[0]['Change Type'], out[0]['Old Next Higher'], out[0]['New Next Higher']],
       ['Re-parented', 'OLD', 'NEW']);
  });
  t('re-parenting carries the quantity change across with it', () => {
    const out = changes([row('P1','OLD',{eq:2})], [row('P1','NEW',{eq:7})]);
    eq([out[0]['Old Qty'], out[0]['New Qty']], ['2', '7']);
  });
  t('rows are ordered Removed, Re-parented, Qty Changed, Added', () => {
    const out = changes(
      [row('AGONE','T'), row('BMOVE','OLD'), row('CQTY','T',{eq:1})],
      [row('BMOVE','NEW'), row('CQTY','T',{eq:9}), row('DNEW','T')]);
    eq(out.map(r => r['Change Type']),
       ['Removed', 'Re-parented', 'Qty Changed', 'Added']);
  });

  console.log('\n== The greedy matcher\'s edges ==');
  t('two removals and one addition of the same PN leave one Removed row', () => {
    const out = changes([row('P1','A'), row('P1','B')], [row('P1','C')]);
    eq(typesOf(out).sort(), ['Re-parented:P1', 'Removed:P1']);
  });
  t('one removal and two additions of the same PN leave one Added row', () => {
    const out = changes([row('P1','A')], [row('P1','B'), row('P1','C')]);
    eq(typesOf(out).sort(), ['Added:P1', 'Re-parented:P1']);
  });
  t('a PN whose case or padding differs still matches as re-parented', () => {
    const out = changes([row(' p1 ','OLD')], [row('P1','NEW')]);
    eq(out[0]['Change Type'], 'Re-parented', 'normPN must drive the pairing:');
  });
  t('duplicate keys keep the FIRST row, matching the main build convention', () => {
    const out = changes([row('P1','TOP',{eq:1}), row('P1','TOP',{eq:99})],
                        [row('P1','TOP',{eq:1})]);
    eq(out.length, 0, 'the second duplicate must be ignored:');
  });
  t('EBOM line numbers are joined for the sheet', () => {
    const out = changes([row('P1','T',{eq:1})],
                        [row('P1','T',{eq:2, ebomLineNos:[10,20]})]);
    eq(out[0]['EBOM Line No(s)'], '10; 20');
    const bare = changes([row('P2','T',{eq:1})], [row('P2','T',{eq:2})]);
    eq(bare[0]['EBOM Line No(s)'], '', 'absent line numbers give an empty cell:');
  });

  console.log('\n== KPI counters ==');
  const kpiRow = (o) => Object.assign({ overall:'ok', ms:'ok', as:'ok' }, o);
  t('structural rows are excluded from the KPI scope', () => {
    const k = D.computeKpis(sess([kpiRow({}), kpiRow({overall:'pt_collector'}),
      kpiRow({overall:'pt_reference'}), kpiRow({overall:'pt_bulk'}),
      kpiRow({overall:'pt_removal'}), kpiRow({overall:'collector'})],
      { mode:'ebom_mbom_abom' }));
    eq(k.scopeTotal, 1, 'only the real line item counts:');
  });
  t('direct, covered and used-on all count toward "any", but only direct counts as direct', () => {
    const k = D.computeKpis(sess([
      kpiRow({ ms:'ok' }), kpiRow({ ms:'covered' }),
      kpiRow({ ms:'missing', msUsedOn:'pn_as_usedon' }), kpiRow({ ms:'missing' })],
      { mode:'ebom_mbom' }));
    eq([k.mbomDirect, k.mbomAny, k.mbomMissing], [1, 3, 2]);
  });
  t('adjudicated statuses count as satisfied', () => {
    const k = D.computeKpis(sess([kpiRow({ms:'direct_adjudicated'}),
      kpiRow({ms:'qty_mismatch_accepted'}), kpiRow({ms:'flex_ok'}),
      kpiRow({ms:'covered_adjudicated'})], { mode:'ebom_mbom' }));
    eq([k.mbomDirect, k.mbomAny], [3, 4]);
  });
  t('ABOM-only counters are reported separately', () => {
    const k = D.computeKpis(sess([kpiRow({as:'wo_open'}), kpiRow({as:'proc_removed'}),
      kpiRow({as:'qty_mismatch'})], { mode:'ebom_abom' }));
    eq([k.abomOpen, k.abomProcRemoved, k.abomQty], [1, 1, 1]);
    eq(k.mbomDirect, undefined, 'MBOM counters must be absent in an ABOM-only session:');
  });
  t('claims are counted and their applied state reported', () => {
    eq(D.computeKpis(sess([], { mode:'ebom_mbom' })).claims, 0);
    const k = D.computeKpis(sess([], { mode:'ebom_mbom',
      adjudications:[{id:'a'},{id:'b'}], adjudicationsApplied:true }));
    eq([k.claims, k.claimsApplied], [2, 'applied']);
  });

  console.log('\n== Mode vocabulary must not drift between the two files ==');
  t('the delta tool agrees with the main build about every mode it knows', () => {
    // Same class of risk as the duplicated PROC_CODE_BASELINE: the main build
    // owns the mode vocabulary in getModeRequired's table, and the delta tool
    // re-states it as two negative tests. Add a fifth mode to the main build
    // and the delta tool would silently report both MBOM and ABOM KPIs for it.
    const start = at('const modeZones = {');
    const block = SRC.slice(start, at('};', start));
    const modes = [...block.matchAll(/'([a-z_]+)':\s*\[([^\]]*)\]/g)]
      .map(m => ({ mode: m[1], zones: m[2].split(',').map(z => z.trim().replace(/'/g, '')) }));
    if (modes.length < 4) throw new Error('only found ' + modes.length + ' modes — table moved?');
    modes.forEach(({ mode, zones }) => {
      eq(D.modeHasMbom(mode), zones.indexOf('mbom') >= 0, mode + ' MBOM:');
      eq(D.modeHasAbom(mode), zones.indexOf('abom') >= 0, mode + ' ABOM:');
    });
  });
  t('a session with no mode recorded reports both sides rather than neither', () => {
    // Fail-open. Documented, not necessarily desirable: an old session missing
    // `mode` shows a full set of zeroed MBOM KPIs as though everything failed.
    eq([D.modeHasMbom(undefined), D.modeHasAbom(undefined)], [true, true]);
  });

  console.log('\n== Pre-rename sessions and missing files ==');
  t('the CHP zone is read under both its old and new key', () => {
    // v3.1 renamed 'cp' -> 'chp'. Sessions exported before that carry the old one.
    eq(D.chpBom({ boms:{ chp:{ data:[1] } } }).data, [1], 'new key:');
    eq(D.chpBom({ boms:{ cp:{ data:[2] } } }).data, [2], 'old key:');
    eq(D.chpBom({ boms:{} }), null, 'neither:');
    eq(D.chpBom(null), null, 'no session:');
  });
  t('a new-key CHP wins over a stale old-key one', () => {
    eq(D.chpBom({ boms:{ chp:{ data:['new'] }, cp:{ data:['old'] } } }).data, ['new']);
  });
  t('a missing NCR file returns a note naming which session lacked it', () => {
    const only = D.ncrDispositionDelta({ boms:{} }, { boms:{ ncr:{ data:[] } } });
    if (!only.note || only.note.indexOf('Session A') < 0)
      throw new Error('must name Session A: ' + JSON.stringify(only.note));
    const both = D.ncrDispositionDelta({ boms:{} }, { boms:{} });
    if (both.note.indexOf('Session A or Session B') < 0)
      throw new Error('must name both: ' + JSON.stringify(both.note));
  });
  t('NCR rows without a number are skipped rather than counted', () => {
    const N = D.NCR_COL;
    const mk = (num, disp) => { const r = []; r[N.ncrNum] = num; r[N.dispNo] = disp; return r; };
    // `results` is mandatory throughout the delta tool — inScopeSet, fscope and
    // computeKpis all read it unguarded, so a session without it is malformed.
    const s = b => ({ results: [], boms:{ ncr:{ data:b } } });
    const out = D.ncrDispositionDelta(s([mk('', 'D1'), mk('N1', 'D1')]),
                                      s([mk('N1', 'D1')]));
    if (out.note) throw new Error('unexpected note: ' + out.note);
    eq(out.rows.length, 0, 'the blank-numbered row must not appear as a change:');
  });
  t('a disposition status change is reported with both statuses', () => {
    const N = D.NCR_COL;
    const mk = st => { const r = []; r[N.ncrNum] = 'N1'; r[N.dispNo] = 'D1';
                       r[N.dispStatus] = st; return r; };
    const s = b => ({ results: [], boms:{ ncr:{ data:b } } });
    const out = D.ncrDispositionDelta(s([mk('OPEN')]), s([mk('CLOSED')])).rows;
    eq(out.length, 1);
    eq([out[0]['Change Type'], out[0]['Old Disposition Status'],
        out[0]['New Disposition Status']],
       ['Disposition status changed', 'OPEN', 'CLOSED']);
  });
  t('a brand new NCR is distinguished from a new disposition on an existing one', () => {
    const N = D.NCR_COL;
    const mk = (num, disp) => { const r = []; r[N.ncrNum] = num; r[N.dispNo] = disp; return r; };
    const s = b => ({ results: [], boms:{ ncr:{ data:b } } });
    const out = D.ncrDispositionDelta(s([mk('N1','D1')]),
                                      s([mk('N1','D1'), mk('N1','D2'), mk('N2','D9')])).rows;
    const byType = {}; out.forEach(r => { byType[r['Change Type']] = r['NCR Number']; });
    eq(byType['New disposition on existing NCR'], 'N1');
    eq(byType['New NCR'], 'N2');
  });
  t('a disposition present in A but not B is flagged for investigation', () => {
    const N = D.NCR_COL;
    const mk = (num, disp) => { const r = []; r[N.ncrNum] = num; r[N.dispNo] = disp; return r; };
    const s = b => ({ results: [], boms:{ ncr:{ data:b } } });
    const out = D.ncrDispositionDelta(s([mk('N1','D1'), mk('N1','D2')]), s([mk('N1','D1')])).rows;
    eq(out.length, 1);
    eq([out[0]['Change Type'], out[0]['Disposition No']],
       ['Dropped from B — investigate', 'D2']);
  });
});

// ── TIER 7 ─────────────────────────────────────────────────────────────────
// Detailed View markers and raw-BOM badges. These are rendering rules, so the
// tests lift the real expressions out of the build and evaluate them rather
// than restating the logic — a restatement would drift the way the v149
// explanation modal drifted from the code it described.
suite('Tier 7 — Detailed View markers and raw-BOM badges', (t, eq) => {
  const _STATUS_COVERED = new Set(['covered', 'covered_adjudicated']);
  const lift = re => { const m = SRC.match(re);
    if (!m) throw new Error('BUILD MARKER MOVED: ' + re);
    return m[0].trim().replace(/^const /, 'var '); };

  const mbomCell = new Function('r', '_STATUS_COVERED',
    'var mDirActive = r.inMbomDirectPool;' +
    lift(/const mIsParentMark\s*=[\s\S]{0,160}?;/) +
    lift(/const mDirCls\s*=[\s\S]{0,260}?;/) +
    lift(/const mDirQty\s*=[\s\S]{0,160}?;/) +
    'return { cls: mDirCls, qty: mDirQty };');
  const abomCell = new Function('r', '_STATUS_COVERED',
    'var aDirActive = r.inAbomDirectPool || (r.as === "wo_open" && r.aq !== null);' +
    lift(/const aIsParentMark\s*=[\s\S]{0,160}?;/) +
    lift(/const aDirCls\s*=[\s\S]{0,200}?;/) +
    lift(/const aDirQty\s*=[\s\S]{0,160}?;/) +
    'return { cls: aDirCls, qty: aDirQty };');
  const M = (ms, o) => mbomCell(Object.assign({ ms, mq:null, inMbomDirectPool:false }, o), _STATUS_COVERED);
  const A = (as, o) => abomCell(Object.assign({ as, aq:null, inAbomDirectPool:false }, o), _STATUS_COVERED);
  const MARK = '\u2191 parent';

  console.log('\n== The marker carries exactly ONE style ==');
  t('every MBOM row showing the marker uses the same class', () => {
    const styles = new Set();
    ['covered', 'covered_adjudicated', 'collector'].forEach(ms => {
      [false, true].forEach(nh => {
        const c = M(ms, { nhMismatchMbom: nh });
        if (c.qty === MARK) styles.add(c.cls);
      });
    });
    eq([...styles], ['td-parent-mark'], 'distinct MBOM marker styles:');
  });
  t('every ABOM row showing the marker uses the same class', () => {
    const styles = new Set();
    ['covered', 'covered_adjudicated', 'collector'].forEach(as => {
      const c = A(as, { nhMismatchAbom: true });
      if (c.qty === MARK) styles.add(c.cls);
    });
    eq([...styles], ['td-parent-mark'], 'distinct ABOM marker styles:');
  });
  t('an NH mismatch no longer overrides the marker style', () => {
    // The v149 defect: nhMismatchMbom was tested first, so a covered row with
    // an NH mismatch rendered hl-parentage — a grey block, a third look.
    eq(M('covered', { nhMismatchMbom: true }).cls, 'td-parent-mark');
    eq(M('collector', { nhMismatchMbom: true }).cls, 'td-parent-mark');
  });
  t('the NH-mismatch highlight still applies to rows that show a real value', () => {
    // The flag must keep working where it is not competing with the marker.
    eq(M('ok', { nhMismatchMbom: true }).cls, 'hl-parentage');
    eq(M('missing', { nhMismatchMbom: true }).cls, 'hl-missing', 'missing still wins:');
  });
  t('a row with a real direct quantity shows the number, never the marker', () => {
    const c = M('covered', { mq: 4, inMbomDirectPool: true });
    eq([c.qty, c.cls], [4, ''], 'a real qty must not be styled as a marker:');
    eq(A('covered', { aq: 7, inAbomDirectPool: true }).qty, 7);
  });
  t('rows with no coverage show an em dash, not the marker', () => {
    ['missing', 'qty_mismatch', 'ok'].forEach(s => eq(M(s).qty, '\u2014', s + ':'));
  });
  t('the retired two-style classes are gone from the stylesheet and the code', () => {
    const live = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    ['td-covered', 'td-collector'].forEach(c => {
      if (live.includes(c)) throw new Error(c + ' still referenced outside comments');
    });
  });

  console.log('\n== The explanation modal must match the code ==');
  t('the modal no longer claims two styles', () => {
    if (/carries exactly two styles/.test(SRC))
      throw new Error('the erroneous v149 explanation is still shipping');
  });
  t('the modal points the reader at the badge rather than a colour', () => {
    const p = SRC.match(/<p><strong>The "\u2191 parent" marker<\/strong>[\s\S]{0,900}?<\/p>/);
    if (!p) throw new Error('the marker explanation paragraph is gone');
    ['one style', 'PARENT IND. EMBODIED', 'COLLECTOR (A/B)'].forEach(s => {
      if (p[0].indexOf(s) < 0) throw new Error('explanation no longer mentions ' + JSON.stringify(s));
    });
    if (/green italic/.test(p[0])) throw new Error('still describes a green style');
  });

  console.log('\n== Raw-BOM view badges ==');
  const badgeFor = new Function('overall', '_STATUS_COVERED', `
    var result = { overall: overall };
    var issueKeys = new Set(['X']);
    var hasIssue = !(overall === 'pt_collector' || overall === 'pt_reference' ||
                     overall === 'pt_bulk' || overall === 'pt_removal') &&
                   overall !== 'ok' && overall !== 'covered' && overall !== 'collector' &&
                   overall !== 'flex_ok' && overall !== 'pn_as_usedon';
    ` + lift(/const isPtExclResult\s*=[\s\S]{0,260}?;/) + `
    var coveredLike = result && (_STATUS_COVERED.has(result.overall) ||
                       result.overall === 'collector' || result.overall === 'pn_as_usedon');
    if (isPtExclResult) return 'PT-BADGE';
    if (coveredLike) return 'COVERED-BADGE';
    if (!hasIssue) return 'OK';
    return 'CATCH-ALL';`);
  t('removal-scope rows no longer render a green tick', () => {
    // v154 and earlier: pt_removal was absent from isPtExclResult, so it fell
    // to the "no issue" branch and showed ✓ OK — a pass mark on a line that is
    // out of scope rather than one that passed.
    eq(badgeFor('pt_removal', _STATUS_COVERED), 'PT-BADGE');
  });
  t('the other part-type exclusions are unchanged', () => {
    ['pt_collector', 'pt_reference', 'pt_bulk'].forEach(s =>
      eq(badgeFor(s, _STATUS_COVERED), 'PT-BADGE', s + ':'));
  });
  t('genuinely clean rows still show OK', () => {
    ['ok', 'flex_ok'].forEach(s => eq(badgeFor(s, _STATUS_COVERED), 'OK', s + ':'));
  });
  t('every status reaching the catch-all is an unresolved outcome', () => {
    const caught = ['missing', 'qty_mismatch', 'flex_missing', 'wo_open', 'proc_removed']
      .filter(s => badgeFor(s, _STATUS_COVERED) === 'CATCH-ALL');
    eq(caught.length, 5, 'all five still route to the catch-all:');
  });
  t('the catch-all badge is neutral, not a warning', () => {
    // Two of the five statuses it covers are BY DESIGN — SUB/AR absence and
    // proc-code removal — so a ⚠ treatment flags correct rows as defects.
    const live = SRC.replace(/^\s*\/\/.*$/gm, '');
    if (live.includes('CHECK EBOM'))
      throw new Error('the old CHECK EBOM badge is still shipping');
    // Anchor on the final `} else {` of the chain — matching the first
    // statusBadge assignment would test the ✓ OK branch instead.
    // v158 — the assignment became a template literal when the tooltip went in;
    // accept either quoting so the test tracks the requirement, not the syntax.
    const m = SRC.match(/\}\s*else\s*\{\s*(?:\/\/[^\n]*\n\s*)*statusBadge = [`']<span class="badge ([\w-]+)"[^>]*>([^<$]+)<\/span>[`'];/);
    if (!m) throw new Error('the catch-all badge assignment moved');
    eq([m[1], m[2]], ['badge-neutral', 'SEE SUMMARY']);
    if (/\u26a0/.test(m[2])) throw new Error('the warning glyph is back');
  });
  t('badge-neutral is defined in the stylesheet', () => {
    if (!/\.badge-neutral\s*\{/.test(STYLE_BLOCKS.map(b => b.css).join('\n')))
      throw new Error('badge-neutral has no rule');
  });
});

// ── TIER 8 ─────────────────────────────────────────────────────────────────
// CI Traceability Report columns. Removing a column from a sheet means editing
// the header AND every row builder; miss one and XLSX writes the rows anyway,
// silently shifting every value after it into the wrong column. Nothing in the
// export path validates that, so the harness does.
suite('Tier 8 — CI Traceability Report columns', (t, eq) => {
  const FN = (() => {
    const a = at('function exportCIReport()');
    return SRC.slice(a, at('// ── ACN KPI HELPER', a) > a ? at('// ── ACN KPI HELPER', a) : a + 130000);
  })();
  // Split an array literal into its top-level elements, respecting strings,
  // parentheses and nested brackets. A naive split on ',' breaks any header
  // containing a comma — 'Part Qty (ABOM, per WO)' became two columns — which
  // silently miscounts and produces confusing failures.
  function splitTop(body) {
    // v158 — strip comments FIRST. A `// A  CI ID` note is harmless, but
    // `// If the discrepant part is this CI's own part number` contains an
    // apostrophe that opens a phantom string and swallows the rest of the
    // array, and any comma in a comment splits a column in two. Both produce a
    // wrong count that looks like a real header/row mismatch.
    body = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const out = []; let d = 0, q = null, cur = '';
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (q) { cur += c; if (c === '\\') { cur += body[++i]; continue; } if (c === q) q = null; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue; }
      if (c === '(' || c === '[' || c === '{') d++;
      else if (c === ')' || c === ']' || c === '}') d--;
      if (c === ',' && d === 0) { out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function items(body) { return splitTop(body).length; }
  function bracket(src, from) {
    const a = src.indexOf('[', from);
    if (a < 0) throw new Error('no array literal after offset ' + from);
    let d = 0, i = a;
    for (;; i++) {
      if (i >= src.length) throw new Error('unbalanced array literal');
      if (src[i] === '[') d++; else if (src[i] === ']') { d--; if (!d) break; }
    }
    return src.slice(a + 1, i);
  }
  function headerList(name) {
    const m = FN.match(new RegExp('const ' + name + '\\s*=\\s*\\['));
    if (!m) throw new Error('BUILD MARKER MOVED: ' + name);
    return splitTop(bracket(FN, m.index))
      .map(x => x.replace(/^\s*['"]|['"]\s*$/g, ''));
  }

  console.log('\n== The parser this suite depends on ==');
  t('header parsing survives commas inside a column name', () => {
    // 'Part Qty (ABOM, per WO)' is a real header. A naive comma split turned it
    // into two columns, which would miscount every sheet that still uses it.
    eq(splitTop("'A', 'Part Qty (ABOM, per WO)', 'B'").length, 3);
    eq(splitTop("'CI as \"Used On\" Number', 'B'").length, 2, 'embedded quotes:');
    eq(splitTop("'A', ['x','y'], 'B'").length, 3, 'nested arrays:');
    eq(splitTop("'A', f(1, 2), 'B'").length, 3, 'calls:');
    eq(splitTop("'A', 'B',").length, 2, 'trailing comma:');
  });
  t('a header containing a comma is still counted as one column', () => {
    // Sheet 6 carried 'Part Qty (ABOM, per WO)' until v155 and other sheets
    // still do, so this is live behaviour, not a hypothetical.
    const withComma = headerList('embHigherHdr').filter(c => c.indexOf(',') >= 0);
    withComma.forEach(c => { if (!/^[^,]*\(.*,.*\)[^,]*$/.test(c))
      throw new Error('suspicious split: ' + JSON.stringify(c)); });
  });

  console.log('\n== No sheet may write more values than it has headers ==');
  t('every header width matches every one of its row builders', () => {
    const hdrs = [...FN.matchAll(/const (\w+Hdr)\s*=\s*\[/g)];
    if (hdrs.length < 10) throw new Error('only found ' + hdrs.length + ' sheets — report restructured?');
    const bad = [];
    hdrs.forEach(m => {
      const want = items(bracket(FN, m.index));
      const rowsVar = m[1].replace(/Hdr$/, 'Rows');
      [...FN.matchAll(new RegExp(rowsVar + '\\.push\\(', 'g'))].forEach(p => {
        const got = items(bracket(FN, p.index + p[0].length - 1));
        if (got !== want) bad.push(m[1] + ': header ' + want + ' vs row ' + got);
      });
    });
    if (bad.length) throw new Error('COLUMN COUNT MISMATCH — data will be shifted:\n        ' +
                                    bad.join('\n        '));
  });

  console.log('\n== #13 / #14: the Part Qty Text column is gone ==');
  t('CI EBOM Drawings + Change Ped no longer carries Part Qty Text', () => {
    const h = headerList('ciChpHdr');
    if (h.indexOf('Part Qty Text') >= 0) throw new Error('still present');
    eq(h.slice(0, 3), ['CI ID', 'Part Number', 'Next Higher Part Number'], 'columns A–C:');
  });
  t('CI Next-Higher Change Pedigree no longer carries Part Qty Text', () => {
    const h = headerList('nhChpHdr');
    if (h.indexOf('Part Qty Text') >= 0) throw new Error('still present');
    eq(h.slice(0, 3), ['CI ID', 'Next Higher Part Number', 'Drawing Number'], 'columns A–C:');
  });
  t('neither sheet still reads partQtyText into a row', () => {
    ['ciChpRows', 'nhChpRows'].forEach(v => {
      [...FN.matchAll(new RegExp(v + '\\.push\\(', 'g'))].forEach(p => {
        if (bracket(FN, p.index + p[0].length - 1).includes('partQtyText'))
          throw new Error(v + ' still pushes partQtyText');
      });
    });
  });

  console.log('\n== #15: column B says what it actually holds ==');
  t('the Next-Higher sheet labels column B as Next Higher Part Number', () => {
    // It has always pushed t.nh; the label said 'Part Number'.
    eq(headerList('nhChpHdr')[1], 'Next Higher Part Number');
    const p = FN.match(/nhChpRows\.push\(\[\s*t\.ciId\|\|'—',\s*t\.nh\|\|'—'/);
    if (!p) throw new Error('column B no longer pushes t.nh — the label may now be wrong again');
  });

  console.log('\n== #16 / #17 / #18: work-order columns named for what they are ==');
  t('CIs Embodied as Used On Parts — columns C to G', () => {
    eq(headerList('embUsedOnHdr').slice(2, 7),
       ['CI as "Used On" Number', 'Work Order Part Number', 'Work Order Part Qty',
        'Work Order Number', 'Work Order Status']);
  });
  t('CIs Embodied via Higher Parts — columns D, F, H, I', () => {
    const h = headerList('embHigherHdr');
    eq([h[3], h[5], h[7], h[8]],
       ['Work Order Part Number', 'Work Order Part Qty',
        'Work Order Number', 'Work Order Status']);
  });
  t('CIs Embodied via Higher Parts — C, E, G deliberately unchanged', () => {
    // These are EBOM-side or used-on values, not work-order values.
    const h = headerList('embHigherHdr');
    eq([h[2], h[4], h[6]],
       ['CI EBOM Part Indenture', 'Part Indenture (EBOM)', 'Used On Number (ABOM)']);
  });
  t('CIs Embodied as WO Parts — columns C to G', () => {
    eq(headerList('embWoHdr').slice(2, 7),
       ['Work Order Part Number', '"Used On" Number', 'Work Order Part Qty',
        'Work Order Number', 'Work Order Status']);
  });
  t('no renamed sheet still carries an (ABOM) suffix on a work-order column', () => {
    ['embUsedOnHdr', 'embHigherHdr', 'embWoHdr', 'abomClaimsHdr'].forEach(n => {
      const stale = headerList(n).filter(c => /^(Part Number|Part Qty|Work Order Number|Work Order Status) \(ABOM/.test(c));
      if (stale.length) throw new Error(n + ' still has: ' + stale.join(', '));
    });
  });

  console.log('\n== NCR disposition sheets: the reader-facing column order ==');
  t('CI Discrep Part w Used On Match leads with the reader-facing columns', () => {
    eq(headerList('ncrDispHdr').slice(0, 12),
       ['CI ID', 'CI Part Number', 'Originating Work Order', 'Discrepant Part Qty',
        'NCR Number', 'NCR Status', 'Defect Code Description', 'Disposition Number',
        'Disp. Status', 'Disp. Type', 'Disp. Code',
        'RFV Linked to NCR Disp# (RFV File)']);
  });
  t('CIs as Used On NCRs leads with the same columns plus the discrepant PN', () => {
    eq(headerList('cisUsedOnHdr').slice(0, 13),
       ['CI ID', 'CI Part Number', 'Originating Work Order', 'Discrepant Part Number',
        'Discrepant Part Qty', 'NCR Number', 'NCR Status', 'Defect Code Description',
        'Disposition Number', 'Disp. Status', 'Disp. Type', 'Disp. Code',
        'RFV Linked to NCR Disp# (RFV File)']);
  });
  t('the shortened disposition names replaced the NCR-prefixed ones', () => {
    // Every column on these two sheets is an NCR column, so the prefix carried
    // no information. The prefix survives where it still distinguishes —
    // 'NCR Cause Code' sits beside a defect code, for instance.
    ['ncrDispHdr', 'cisUsedOnHdr'].forEach(n => {
      const stale = headerList(n).filter(c =>
        /^NCR Disp(#| Status| Type| Code)$/.test(c) || c === 'NCR Defect Code Desc');
      if (stale.length) throw new Error(n + ' still has: ' + stale.join(', '));
    });
  });
  t('no other sheet was renamed by accident', () => {
    // Seven header arrays carried disposition columns; only two were in scope.
    // These five keep whatever they had — note noAbomNcrHdr spells them out in
    // full ('NCR Disposition #'), which is a third convention nobody asked to
    // change. Worth knowing it exists; not worth changing unasked.
    // FOUR conventions are in use across the report — worth knowing, not worth
    // changing unasked: 'NCR Disp#' (detail, csa, claims), 'NCR Disposition #'
    // (noAbomNcr), 'Disposition #' (adj), and the two sheets v158 moved to
    // 'Disposition Number'. Pinned so a future rename is a decision, not a drift.
    const expect = { detailHdr: 'NCR Disp#', csaHdr: 'NCR Disp#',
                     noAbomNcrHdr: 'NCR Disposition #',
                     adjHdr: 'Disposition #', claimsHdr: 'NCR Disp#' };
    Object.keys(expect).forEach(n => {
      if (headerList(n).indexOf(expect[n]) < 0)
        throw new Error(n + ' lost its ' + JSON.stringify(expect[n]) +
                        ' column — that sheet was not in scope');
    });
  });

  console.log('\n== Paired sheets must label identical data identically ==');
  t('CI ABOM Claims Processed matches CIs Embodied as WO Parts, columns A to G', () => {
    // These are the SME-adjudicated and auto-detected halves of one idea. The
    // As-Built Records Guide states the pairing outright, so renaming one and
    // not the other would leave the same workbook disagreeing with itself.
    eq(headerList('abomClaimsHdr').slice(0, 7), headerList('embWoHdr').slice(0, 7));
  });
  t('the As-Built Records Guide still names both sheets it aligns to', () => {
    // The guide's alignment notes reference report sheets by NAME and describe
    // their semantics, not their column letters — so v155's column edits left
    // them accurate. This test fails if a sheet is ever renamed, which WOULD
    // break them.
    const guide = SRC.slice(at('function exportCIAsBuiltGuide()'),
                            at('XLSX.utils.book_append_sheet(wb, ws, \'CI As-Built Records Guide\')'));
    ['CIs Embodied as WO Parts', 'CIs Embodied as Used On Parts',
     'CIs Embodied via Higher Parts', 'CI ABOM Claims Processed',
     'NCR CI Claims Processed'].forEach(name => {
      if (guide.indexOf(name) < 0)
        throw new Error('the guide no longer references the sheet ' + JSON.stringify(name));
      if (SRC.indexOf("book_append_sheet(wb, ") < 0 || SRC.indexOf("'" + name + "'") < 0)
        throw new Error('the guide references a sheet that no longer exists: ' + name);
    });
  });
});

// ── TIER 9 ─────────────────────────────────────────────────────────────────
// The MBOM column trio appears on FOUR surfaces — the on-screen Detailed View,
// the context export, the CSV export and the XLSX export — each with its own
// header list and its own row builder. Move a header without its row builder
// and every column after it shifts silently. These tests pin header and data
// order together, on every surface.
suite('Tier 9 — MBOM column order across every surface', (t, eq) => {
  const HDR_NEW = /'MBOM Traceability'\s*,\s*'MBOM Reconciliation Notes'\s*,\s*'MBOM Job Number'/g;
  const HDR_OLD = /'MBOM Traceability'\s*,\s*'MBOM Job Number'/g;
  const ROW_NEW = /mbomTraceabilityText\(r\),\s*mbomNotesText\(r\),\s*\(_mJobs/g;
  const ROW_OLD = /mbomTraceabilityText\(r\),\s*\(_mJobs/g;

  console.log('\n== #3: Job Number sits right of Reconciliation Notes ==');
  t('no surface still carries the old order', () => {
    eq((SRC.match(HDR_OLD) || []).length, 0, 'headers in old order:');
    eq((SRC.match(ROW_OLD) || []).length, 0, 'row builders in old order:');
  });
  t('all four header lists and the banner grouping use the new order', () => {
    // 4 header pushes (screen, context, CSV, XLSX) + the mbomCols silo list.
    eq((SRC.match(HDR_NEW) || []).length, 5);
  });
  t('all three export row builders use the new order', () => {
    // The fourth surface is the on-screen table, which emits <td> directly.
    eq((SRC.match(ROW_NEW) || []).length, 3);
  });
  t('every surface with a Job Number header also builds a Job Number cell', () => {
    // The failure this guards: a header list moved, its row builder forgotten.
    // Count ONLY pushes that carry the Job Number — the HTML report pushes the
    // Traceability/Notes PAIR and has never had a Job Number column, so it is
    // correctly excluded rather than counted and subtracted.
    const withJob = (SRC.match(/(?:hdr|cols)\.push\('MBOM Traceability'[^;]*'MBOM Job Number'/g) || []).length;
    const rows    = (SRC.match(ROW_NEW) || []).length;
    eq(withJob, 4, 'header lists carrying Job Number (screen + 3 exports):');
    eq(withJob - rows, 1, 'the unmatched one must be the on-screen table:');
  });
  t('the HTML report still carries the pair and no Job Number column', () => {
    const m = SRC.match(/thdr\.push\('MBOM Traceability'[^;]*;/);
    if (!m) throw new Error('the HTML report header moved');
    if (m[0].indexOf('MBOM Job Number') >= 0)
      throw new Error('the HTML report gained a Job Number column without a row builder');
    if (m[0].indexOf('MBOM Reconciliation Notes') < 0)
      throw new Error('the HTML report lost Reconciliation Notes');
  });
  t('the on-screen cells are emitted in the same order as the header', () => {
    const td = SRC.match(/html \+= `<td class="td-gutter-l">\$\{buildMbomTraceability\(r\)\}<\/td>[\s\S]{0,260}?`;/);
    if (!td) throw new Error('the MBOM cell block moved');
    const order = ['buildMbomTraceability', 'buildMbomNotes', 'mJobHtml']
      .map(k => td[0].indexOf(k));
    if (order.some(i => i < 0)) throw new Error('a cell is missing: ' + td[0]);
    eq(order.slice().sort((a, b) => a - b), order,
       'screen order must be Traceability, Notes, Job:');
  });
  t('the gutter still falls on the first MBOM column', () => {
    // The left border marks where the MBOM silo begins. Traceability stayed
    // first, so it must still be the gutter column.
    const m = SRC.match(/const gutterCols = \[([\s\S]{0,600}?)\]/);
    if (!m) throw new Error('gutterCols moved');
    if (m[1].indexOf("'MBOM Traceability'") < 0)
      throw new Error('MBOM Traceability is no longer the gutter column');
    if (m[1].indexOf("'MBOM Job Number'") >= 0)
      throw new Error('the gutter moved onto the Job Number column');
  });

  console.log('\n== The prose describing the order ==');
  t('no comment or modal still says Job Number sits between the pair', () => {
    if (/Traceability\s*→\s*HERE\s*→\s*Reconciliation Notes/.test(SRC))
      throw new Error('the v149 design note still describes the old position');
    const modal = SRC.match(/<strong>MBOM Job Number<\/strong>[\s\S]{0,400}?\./);
    if (!modal) throw new Error('the Job Number modal paragraph is gone');
    if (modal[0].indexOf('right of MBOM Reconciliation Notes') < 0)
      throw new Error('the modal does not state the new position');
  });
});

// ── TIER 10 ────────────────────────────────────────────────────────────────
// The badge guide against the badge maps. A guide that drifts from the code is
// worse than no guide: it teaches the reader a vocabulary the tool no longer
// speaks. This suite derives the expected entries FROM the maps, so adding a
// badge without documenting it fails the build.
suite('Tier 10 — badge guide completeness', (t, eq) => {
  const GUIDE = (() => {
    const a = at('function showBadgeGuide()');
    return SRC.slice(a, at('_setReportHtml(html)', a));
  })();
  // Every [class, label] pair in the three status→badge maps.
  function mapLabels(fn) {
    const a = at('function ' + fn + '(');
    const blk = SRC.slice(a, SRC.indexOf('\n}', a));
    return [...blk.matchAll(/\[\s*'([\w\- ]+)'\s*,\s*'([^']+)'\s*\]/g)].map(m => m[2]);
  }
  const ALL = [...new Set([].concat(mapLabels('badgeBom'), mapLabels('badgeAbom'),
                                    mapLabels('badgeOverall')))];
  // Guide entries, glyphs stripped — the guide writes some labels without them.
  const bare = x => x.replace(/^[^A-Za-z0-9]+/, '').trim();
  const documented = new Set([...GUIDE.matchAll(/row\('([^']+)'/g)].map(m => bare(m[1])));

  console.log('\n== Every badge the maps can emit is documented ==');
  t('the three badge maps are all reachable', () => {
    eq(mapLabels('badgeBom').length > 15, true, 'badgeBom entries:');
    eq(ALL.length > 15, true, 'distinct labels across all three maps:');
  });
  t('no status-map badge is missing from the guide', () => {
    const missing = ALL.filter(l => !documented.has(bare(l)));
    if (missing.length)
      throw new Error('undocumented badge(s): ' + missing.join(', '));
  });

  console.log('\n== The guide shows the same badge the code renders ==');
  t('every guide entry uses the class the code actually emits', () => {
    // v157 — #3/#4/#5. v156 moved the used-on badges to --success-2 but left the
    // guide on badge-ok, so three entries showed the wrong green. The old test
    // compared LABELS with glyphs stripped, so a wrong class — or a wrong glyph —
    // passed silently. This compares class and exact label.
    const code = {};
    ['badgeBom', 'badgeAbom', 'badgeOverall'].forEach(fn => {
      const a = at('function ' + fn + '(');
      [...SRC.slice(a, SRC.indexOf('\n}', a)).matchAll(/\[\s*'([\w\- ]+)'\s*,\s*'([^']+)'\s*\]/g)]
        .forEach(m => { code[m[2]] = m[1]; });
    });
    [...SRC.matchAll(/dge\('(badge-[\w\-]+)',\s*'([^']+)'/g)].forEach(m => { code[m[2]] = m[1]; });
    const bad = [];
    [...GUIDE.matchAll(/row\('([^']+)',\s*'([\w\- ]+)'/g)].forEach(m => {
      const [, lbl, cls] = m;
      if (code[lbl] && code[lbl] !== cls)
        bad.push(lbl + ': guide says ' + cls + ', code emits ' + code[lbl]);
    });
    if (bad.length) throw new Error('guide/code class drift:\n        ' + bad.join('\n        '));
  });
  t('every badge the code emits appears in the guide with its exact label', () => {
    // Glyph-insensitive matching is what let the guide drift. Exact only.
    const labels = new Set();
    ['badgeBom', 'badgeAbom', 'badgeOverall'].forEach(fn => {
      const a = at('function ' + fn + '(');
      [...SRC.slice(a, SRC.indexOf('\n}', a)).matchAll(/\[\s*'[\w\- ]+'\s*,\s*'([^']+)'\s*\]/g)]
        .forEach(m => labels.add(m[1]));
    });
    const documented = new Set([...GUIDE.matchAll(/row\('([^']+)'/g)].map(m => m[1]));
    const missing = [...labels].filter(l => !documented.has(l));
    if (missing.length)
      throw new Error('label(s) not documented verbatim: ' + missing.join(' | '));
  });
  t('green badges carry no glyph; attention states keep theirs', () => {
    // v157 — #6. Green already says "fine"; a tick adds nothing. Glyphs are
    // reserved for states that need a second look.
    const GREEN = ['badge-ok', 'badge-usedon', 'badge-covered'];
    const bad = [];
    [...SRC.matchAll(/\[\s*'([\w\- ]+)'\s*,\s*'([^']+)'\s*\]/g)].forEach(m => {
      if (GREEN.indexOf(m[1]) >= 0 && /^[^A-Z0-9]/.test(m[2])) bad.push(m[1] + ' -> ' + m[2]);
    });
    if (bad.length) throw new Error('green badge(s) still glyphed: ' + bad.join(', '));
    // And the attention states must NOT have been stripped along with them.
    ['⚠ QTY MISMATCH', '✗ MISSING', '⊘ REMOVAL ITEM'].forEach(l => {
      if (SRC.indexOf("'" + l + "'") < 0)
        throw new Error('an attention badge lost its glyph: ' + l);
    });
  });

  console.log('\n== #6/#7/#8: the views that had no entries at all ==');
  t('the guide covers the whole Detailed View, not just the summary', () => {
    // badgeBom / badgeAbom are used ONLY by renderFullBom, so their vocabulary
    // never reached a guide scoped to the Comparison Summary. That is why
    // CHECK EBOM and NO MATCH had no explanation anywhere.
    if (!/Detailed View — Badge Guide/.test(SRC))
      throw new Error('the guide is still titled for the Comparison Summary only');
    ['EBOM / MBOM / ABOM Full View', 'Change Pedigree View'].forEach(s => {
      if (GUIDE.indexOf(s) < 0) throw new Error('no section for ' + s);
    });
  });
  t('the raw BOM badges are documented', () => {
    ['SEE SUMMARY', 'OK', 'ADJ DIRECT', 'REMOVAL ITEM'].forEach(l => {
      if (!documented.has(bare(l))) throw new Error(l + ' is not documented');
    });
  });
  t('every CHP release state is documented', () => {
    // Sourced from chpReleaseState, so a new state fails this test.
    const chp = sandbox({}, ['chp']).C;
    const trace = (d, e) => ({ dcn: new Map(d || []), ecn: new Map(e || []), ecr: new Map() });
    const states = [
      chp.chpReleaseState(null).label,
      chp.chpReleaseState(trace([], [['E1', '']])).label,
      chp.chpReleaseState(trace([['D1', '2024-03-15']])).label.split(' ')[0],
      chp.chpReleaseState(trace([['D1', 'Unknown']])).label,
    ];
    // A documented entry may be a MORE informative form of the emitted label —
    // the badge renders 'RELEASED MARCH 15, 2024' and the guide writes
    // 'RELEASED ⟨date⟩'. Prefix matching accepts that; it still fails if a
    // state is absent entirely.
    const docs = [...documented];
    states.concat(['NO MATCH']).forEach(l => {
      const b = bare(l);
      if (!docs.some(d => d === b || d.indexOf(b + ' ') === 0))
        throw new Error(l + ' is not documented');
    });
  });
  t('NO MATCH and NO HISTORY are distinguished, not conflated', () => {
    // v158 — the text moved into BADGE_HELP, which now feeds both the guide and
    // the hover tooltip. The requirement is unchanged: the two must be told
    // apart wherever a reader meets them.
    const help = SRC.slice(at('const BADGE_HELP = {'), at('function _badgeHelp'));
    const m = help.match(/'✗ NO MATCH':\s*'([^']*)'/);
    if (!m) throw new Error('✗ NO MATCH has no BADGE_HELP entry');
    if (m[1].indexOf('NO HISTORY') < 0)
      throw new Error('the NO MATCH explanation must contrast itself with NO HISTORY');
    if (!/'NO HISTORY':\s*'[^']+'/.test(help))
      throw new Error('NO HISTORY has no explanation of its own');
  });

  console.log('\n== One source for the guide and the tooltips ==');
  t('every badge the code renders carries a hover explanation', () => {
    // v158 — #7. The tooltip and the guide read the same BADGE_HELP strings, so
    // a badge cannot be explained in one place and silent in the other.
    const help = SRC.slice(at('const BADGE_HELP = {'), at('function _badgeHelp'));
    const keys = new Set([...help.matchAll(/'((?:[^'\\]|\\.)+)':\s*'/g)].map(m => m[1]));
    const missing = ALL.filter(l => !keys.has(l.replace(/'/g, "\\'")));
    if (missing.length)
      throw new Error('badge(s) with no hover explanation: ' + missing.join(' | '));
  });
  t('every badge span with a documented label carries a tooltip', () => {
    // v158 — this test used to name four helpers I had found by hand, so it
    // passed while tracBadge — the helper the Traceability and Reconciliation
    // Notes columns actually use — rendered every badge with no tooltip at all.
    // The rule is now DERIVED: scan every badge span in the build, and if its
    // label is one BADGE_HELP explains, it must carry a title. A hand-written
    // list of call sites can only ever be as complete as the person writing it.
    const help = SRC.slice(at('const BADGE_HELP = {'), at('function _badgeHelp'));
    const known = new Set([...help.matchAll(/'((?:[^'\\]|\\.)+)':\s*'/g)]
      .map(m => m[1].replace(/\\'/g, "'")));
    // The badge guide renders a SAMPLE of each badge with its description in the
    // next cell. A tooltip repeating that text would be noise, so the guide's own
    // preview is exempt — by position, not by a blanket rule.
    const guideFrom = at('function showBadgeGuide()'), guideTo = at('_setReportHtml(html)', guideFrom);
    const bad = [];
    [...SRC.matchAll(/<span class="badge[^"]*"([^>]{0,180}?)>([^<]{0,60})<\/span>/g)].forEach(m => {
      const attrs = m[1], label = m[2].trim();
      if (m.index >= guideFrom && m.index < guideTo) return;
      if (attrs.indexOf('title=') >= 0) return;
      // Dynamic labels resolve at runtime; the helper is what must be present.
      if (label.indexOf('${') >= 0) {
        if (attrs.indexOf('_badgeHelp') < 0)
          bad.push('dynamic label at offset ' + m.index + ' has no _badgeHelp');
        return;
      }
      if (known.has(label))
        bad.push(JSON.stringify(label) + ' is documented but renders with no tooltip');
    });
    if (bad.length) throw new Error(bad.length + ' untooltipped badge(s):\n        ' + bad.join('\n        '));
  });
  t('every helper that builds a badge span consults BADGE_HELP', () => {
    // Catches a NEW helper being added without tooltips, before it ships a label.
    const helpers = [...SRC.matchAll(/function (\w+)\s*\(([^)]*)\)\s*\{/g)]
      .filter(m => /\blabel\b|\blbl\b/.test(m[2]));
    const bad = helpers.filter(m => {
      const body = SRC.slice(m.index, SRC.indexOf('\n}', m.index));
      return /<span class="badge/.test(body) && body.indexOf('_badgeHelp(') < 0;
    }).map(m => m[1]);
    if (bad.length) throw new Error('badge helper(s) with no tooltip: ' + bad.join(', '));
  });
  t('the trace badge keeps its row-specific detail below the explanation', () => {
    // Those badges already carried adjudication metadata in their title. The
    // explanation is prepended, not substituted for it.
    const a = at('function adjTracBadge');
    const body = SRC.slice(a, SRC.indexOf('\n}', a));
    if (!/lines\.unshift\(_help/.test(body))
      throw new Error('the explanation must be prepended to the existing detail');
    if (body.indexOf("lines.join('\\n')") < 0)
      throw new Error('the multi-line title was lost');
  });
  t('the guide no longer carries its own copy of the text', () => {
    const rows = [...GUIDE.matchAll(/row\('(?:[^'\\]|\\.)*',\s*'[\w\- ]+',/g)];
    if (rows.length)
      throw new Error(rows.length + ' guide row(s) still pass their own description');
    if (GUIDE.indexOf('BADGE_HELP[badge]') < 0)
      throw new Error('the guide does not read BADGE_HELP');
  });

  console.log('\n== The guide describes only badges that exist ==');
  t('no guide entry names a label absent from the build', () => {
    const outside = SRC.slice(0, at('function showBadgeGuide()')) +
                    SRC.slice(at('_setReportHtml(html)', at('function showBadgeGuide()')));
    const stale = [...documented].filter(l => l && l !== 'RELEASED ⟨date⟩' &&
                                               l !== 'UNKNOWN' && outside.indexOf(l) < 0);
    if (stale.length) throw new Error('guide documents nonexistent badge(s): ' + stale.join(', '));
  });
  t('the unknown-status fallback is documented', () => {
    // badgeOverall renders '? ' + status for any label it does not know.
    if (!/'\? ' \+ String\(status/.test(SRC))
      throw new Error('the fallback changed shape');
    if (!documented.has('UNKNOWN'))
      throw new Error('the ? UNKNOWN fallback is not documented');
  });
});

// ── TIER 11 ────────────────────────────────────────────────────────────────
// Chart legibility. Every other suite reads the build; this one RUNS it. While
// making the v155 fix I introduced a ReferenceError into drawNcrCauseCodeChart
// — a string replacement landed in the wrong function — and all 228 existing
// tests stayed green, because nothing here had ever executed a renderer. These
// tests drive both charts through a recording 2D context.
suite('Tier 11 — chart rendering and label crispness', (t, eq) => {
  const vm = require('vm');
  function chartCtx(rectW, rectH, dpr) {
    const drawn = [];
    const c2d = { font:'', fillStyle:'', strokeStyle:'', lineWidth:1,
      textAlign:'', textBaseline:'', globalAlpha:1,
      clearRect(){}, fillRect(){}, strokeRect(){}, beginPath(){}, closePath(){},
      moveTo(){}, lineTo(){}, arc(){}, stroke(){}, fill(){}, save(){}, restore(){},
      scale(){}, setTransform(){}, translate(){}, measureText(){ return { width: 40 }; },
      fillText(txt, x, y){ drawn.push({ txt:String(txt), x, y }); } };
    const canvas = { width:0, height:0, style:{},
      getAttribute: k => (k === 'width' ? '960' : '220'),
      getBoundingClientRect: () => ({ width: rectW, height: rectH }),
      getContext: () => c2d };
    const ctx = sandbox({
      window: { devicePixelRatio: dpr },
      document: { getElementById: () => canvas, querySelectorAll: () => [] },
      state: { boms:{ abom:{ data:ABOM } }, results:[], woRollup: null },
      COL: { abom: { woNo:0, woStatus:1 } },
      getRfvCoveredWoSet: () => new Set(),
      getRowRfvLinks: () => [],
      // v173 — the renderers no longer hold literal hex; they call tok(), which
      // reads the live palette. Give the sandbox the REAL dark palette and the
      // real tok(), so this suite still proves what reaches fillStyle is a
      // resolved colour and not an unparseable var() the context would ignore.
      _tokCache: Object.create(null),
      getComputedStyle: () => ({
        getPropertyValue: k => PALETTES.dark[k] || '' }),
    }, []);
    vm.runInContext(
      grabFn('tok') + '\n' +
      grabFn('setupHiDpiCanvas') + '\n' + grabFn('_crisp') + '\n' +
      grabFn('colorForStatus') + '\n' + grabFn('buildWoRollup') + '\n' +
      grabFn('drawNcrCauseCodeChart') + '\n' +
      grabFn('drawWoStatusRollup'), ctx, { filename: 'charts.js' });
    // Build the rollup with the BUILD's own function rather than hand-stubbing
    // its shape — a stub guessed 'byStatus' where the real field is
    // 'statusCounts', which made the test fail for a reason the code did not have.
    vm.runInContext('state.woRollup = buildWoRollup(state.boms.abom.data, 0, 1);', ctx);
    return { ctx, canvas, drawn };
  }
  const FRACTIONAL = [703.328, 161.012];   // what a flex:1 container actually measures
  const ABOM = [['W1','CLOSED'],['W2','OPEN'],['W3','CLOSED'],['W4','IN WORK'],['W5','CANCELLED']];

  console.log('\n== The renderers actually run ==');
  t('drawNcrCauseCodeChart executes without throwing', () => {
    const { ctx, drawn } = chartCtx(FRACTIONAL[0], FRACTIONAL[1], 2);
    ctx.state.results = [
      { ncrEntriesPool1:[{ causeCode:'C1', causeCodeDesc:'Damaged' }], ncrEntriesPool2:[] },
      { ncrEntriesPool1:[{ causeCode:'C2', causeCodeDesc:'Wrong part' }], ncrEntriesPool2:[] }];
    vm.runInContext('drawNcrCauseCodeChart("ncr-cause-chart", state.results)', ctx);
    if (!drawn.length) throw new Error('no labels were drawn at all');
  });
  t('drawWoStatusRollup executes without throwing', () => {
    const { ctx, drawn } = chartCtx(FRACTIONAL[0], FRACTIONAL[1], 2);
    vm.runInContext('drawWoStatusRollup("wo-rollup-chart")', ctx);
    if (!drawn.length) throw new Error('no labels were drawn at all');
  });
  t('both renderers still draw when there is no data', () => {
    ['drawWoStatusRollup("x")', 'drawNcrCauseCodeChart("x", [])'].forEach(call => {
      const { ctx } = chartCtx(FRACTIONAL[0], FRACTIONAL[1], 2);
      ctx.state.woRollup = null;
      vm.runInContext(call, ctx);   // must render an empty-state caption, not throw
    });
  });

  console.log('\n== Cause A: the buffer must not be resampled ==');
  t('the backing buffer is exactly the CSS size in device pixels', () => {
    [[703.328, 161.012, 2], [703.328, 161.012, 1.25], [886.66, 200.5, 1.5],
     [560, 180, 1], [437.5, 140.25, 3]].forEach(([w, h, dpr]) => {
      const { ctx, canvas } = chartCtx(w, h, dpr);
      vm.runInContext('setupHiDpiCanvas(document.getElementById("x"))', ctx);
      const devW = parseFloat(canvas.style.width) * dpr;
      const devH = parseFloat(canvas.style.height) * dpr;
      if (Math.abs(devW - canvas.width) > 1e-9 || Math.abs(devH - canvas.height) > 1e-9)
        throw new Error('dpr ' + dpr + ': buffer ' + canvas.width + 'x' + canvas.height +
                        ' vs displayed ' + devW + 'x' + devH + ' — the canvas is resampled');
    });
  });
  t('the reported drawing size matches the CSS size', () => {
    const { ctx, canvas } = chartCtx(703.328, 161.012, 2);
    const r = vm.runInContext('setupHiDpiCanvas(document.getElementById("x"))', ctx);
    eq([r.w, r.h], [parseFloat(canvas.style.width), parseFloat(canvas.style.height)]);
  });
  t('a zero-size canvas falls back to its width/height attributes', () => {
    const { ctx, canvas } = chartCtx(0, 0, 2);
    vm.runInContext('setupHiDpiCanvas(document.getElementById("x"))', ctx);
    eq([canvas.width, canvas.height], [1920, 440], 'fallback 960x220 at dpr 2:');
  });

  console.log('\n== Cause C: the canvas must be able to reflow ==');
  t('the sizer clears its own inline size before measuring', () => {
    // v155 snapped the CSS size for crispness, but that inline width overrides
    // `.chart-card canvas { width: 100% }` FOREVER — the canvas froze at its
    // first-draw width and never reflowed. Clearing first lets CSS decide.
    const fn = grabFn('setupHiDpiCanvas');
    const clearAt = fn.indexOf("canvas.style.width  = ''");
    const measureAt = fn.indexOf('getBoundingClientRect');
    if (clearAt < 0) throw new Error('the sizer no longer clears its inline width');
    if (clearAt > measureAt)
      throw new Error('the inline size is cleared AFTER measuring — the measurement is stale');
  });
  t('a resized container gives the canvas a new buffer', () => {
    const first = chartCtx(703.328, 161.012, 2);
    vm.runInContext('setupHiDpiCanvas(document.getElementById("x"))', first.ctx);
    const wide = first.canvas.width;
    // Same canvas object, narrower container: the buffer must follow.
    first.canvas.getBoundingClientRect = () => ({ width: 421.5, height: 161.012 });
    vm.runInContext('setupHiDpiCanvas(document.getElementById("x"))', first.ctx);
    if (first.canvas.width >= wide)
      throw new Error('buffer stayed ' + first.canvas.width + ' after the container shrank');
    eq(first.canvas.width, Math.round(421.5 * 2), 'new buffer:');
  });
  t('charts are registered for redraw when their container changes', () => {
    if (!/function registerChartRedraw/.test(SRC))
      throw new Error('no chart redraw helper');
    ['wo-rollup-chart', 'ncr-cause-chart'].forEach(id => {
      if (!new RegExp("registerChartRedraw\\('" + id + "'").test(SRC))
        throw new Error(id + ' is never registered for redraw');
    });
    const h = SRC.slice(at('function registerChartRedraw'), at('function _crisp'));
    if (h.indexOf('ResizeObserver') < 0) throw new Error('the helper does not observe anything');
    if (h.indexOf('_chartRedraw.has') < 0)
      throw new Error('repeated renders would stack observers');
  });
  t('chart text is no smaller than the table cell size', () => {
    // 9px mono on a dark panel was the smallest text in the product.
    const seg = SRC.slice(at('function drawNcrCauseCodeChart'),
                          at('function drawWoStatusRollup') + 9000);
    const sizes = [...seg.matchAll(/ctx\.font = '(?:bold )?(\d+)px/g)].map(m => +m[1]);
    if (!sizes.length) throw new Error('no chart fonts found');
    const small = sizes.filter(v => v < 11);
    if (small.length) throw new Error('chart text at ' + [...new Set(small)].join(', ') + 'px');
  });

  console.log('\n== Cause B: no label on a fractional device pixel ==');
  const fractional = drawn => drawn.filter(d =>
    Math.abs(Math.round(d.x * 2) - d.x * 2) > 1e-9 ||
    Math.abs(Math.round(d.y * 2) - d.y * 2) > 1e-9);
  t('every WO roll-up label lands on a whole device pixel', () => {
    const { ctx, drawn } = chartCtx(FRACTIONAL[0], FRACTIONAL[1], 2);
    vm.runInContext('drawWoStatusRollup("wo-rollup-chart")', ctx);
    const bad = fractional(drawn);
    if (bad.length) throw new Error(bad.length + ' fuzzy label(s), e.g. ' + JSON.stringify(bad[0]));
  });
  t('every NCR cause-code label lands on a whole device pixel', () => {
    const { ctx, drawn } = chartCtx(FRACTIONAL[0], FRACTIONAL[1], 2);
    ctx.state.results = [1,2,3,4,5].map(n => ({
      ncrEntriesPool1:[{ causeCode:'C'+n, causeCodeDesc:'Cause number '+n }], ncrEntriesPool2:[] }));
    vm.runInContext('drawNcrCauseCodeChart("ncr-cause-chart", state.results)', ctx);
    const bad = fractional(drawn);
    if (bad.length) throw new Error(bad.length + ' fuzzy label(s), e.g. ' + JSON.stringify(bad[0]));
  });
  t('labels stay crisp across bar counts that make barH odd', () => {
    // barH = max(14, floor((h - pad) / bars) - 3). Odd values put a centred
    // baseline on a half pixel, which is what made the labels fuzzy.
    [1,2,3,4,5,6].forEach(n => {
      const { ctx, drawn } = chartCtx(FRACTIONAL[0], FRACTIONAL[1], 2);
      ctx.state.results = Array.from({ length: n }, (_, k) => ({
        ncrEntriesPool1:[{ causeCode:'C'+k, causeCodeDesc:'d' }], ncrEntriesPool2:[] }));
      vm.runInContext('drawNcrCauseCodeChart("x", state.results)', ctx);
      const bad = fractional(drawn);
      if (bad.length) throw new Error(n + ' bars: ' + JSON.stringify(bad[0]));
    });
  });
  t('_crisp snaps to the device pixel grid, not the CSS grid', () => {
    const { ctx } = chartCtx(100, 100, 2);
    eq(vm.runInContext('_crisp(10.4)', ctx), 10.5, 'dpr 2 keeps half CSS pixels:');
    eq(vm.runInContext('_crisp(10.3)', ctx), 10.5);
    const one = chartCtx(100, 100, 1);
    eq(vm.runInContext('_crisp(10.4)', one.ctx), 10, 'dpr 1 snaps to whole pixels:');
  });
});

// ── TIER 12 ────────────────────────────────────────────────────────────────
// Colour discipline. The build has a good token system; the problem was that
// 99 inline declarations bypassed it, including a SECOND muted grey 15
// luminance from the real one and a SECOND teal for RFV while --rfv already
// existed. Individually invisible, collectively the "haphazard" impression.
suite('Tier 12 — colour tokens', (t, eq) => {
  const CSS = STYLE_BLOCKS.map(b => b.css).join('\n');
  const BODY = SRC.slice(at('</style>'));
  const TOKENS = {};
  [...CSS.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})/g)]
    .forEach(m => { TOKENS[m[1]] = m[2].toLowerCase(); });
  const byValue = {};
  Object.keys(TOKENS).forEach(k => { (byValue[TOKENS[k]] = byValue[TOKENS[k]] || []).push(k); });
  const lum = h => { const n = i => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
    return 0.2126 * n(0) + 0.7152 * n(1) + 0.0722 * n(2); };

  console.log('\n== Nothing bypasses the tokens ==');
  t('no inline style sets a raw hex text colour', () => {
    // One deliberate exception: the KPI render-error banner. It reports that
    // rendering has failed, so it must not depend on the stylesheet resolving —
    // tokenising it would risk an invisible error message. The exception is
    // narrow and asserted below, not a blanket allowance.
    const EXEMPT = /id="kpi-render-error-banner"[^>]*>/;
    const banner = BODY.match(EXEMPT);
    if (!banner) throw new Error('the render-error banner moved — re-check this exemption');
    const raw = [...BODY.replace(banner[0], '').matchAll(/color\s*:\s*(#[0-9a-fA-F]{3,8})/g)]
      .map(m => m[1]);
    if (raw.length)
      throw new Error(raw.length + ' raw colour(s) outside the token system: ' +
                      [...new Set(raw)].join(', '));
  });
  t('the render-error banner stays self-contained on purpose', () => {
    const banner = BODY.match(/id="kpi-render-error-banner"[^>]*>/)[0];
    if (banner.indexOf('var(--') >= 0)
      throw new Error('the emergency banner now depends on CSS variables resolving');
    if (!/background:#[0-9a-f]{6}/i.test(banner) || !/color:#[0-9a-f]{3,6}/i.test(banner))
      throw new Error('the emergency banner lost its literal colours');
  });
  t('the token palette is defined once and is not itself duplicated', () => {
    // Scoped to :root deliberately. The dark palette is the source of truth and
    // two names sharing a value there is drift — that is the v155 guard and it
    // still applies. It CANNOT apply to the other themes: in the mono palette
    // --bg and --on-accent are both #ffffff on purpose, because a white page
    // and a foreground sitting on a near-black accent fill really are the same
    // white. Structural parity across themes is asserted separately below.
    const byValue = {};
    Object.keys(PALETTES.dark).forEach(k => {
      (byValue[PALETTES.dark[k]] = byValue[PALETTES.dark[k]] || []).push(k); });
    const dupes = Object.keys(byValue).filter(v => byValue[v].length > 1)
      .map(v => v + ' = ' + byValue[v].join(' and '));
    if (dupes.length) throw new Error('two tokens share a value: ' + dupes.join('; '));
  });
  t('every theme defines every token the dark palette defines', () => {
    // The failure this catches is the one a half-written theme produces: a
    // white background with the dark theme's near-black status fills still on
    // it, because the theme covered the seven chrome tokens and left the
    // twenty-two semantic ones to fall through to :root.
    const want = Object.keys(PALETTES.dark).sort();
    ['light', 'mono'].forEach(name => {
      const got = Object.keys(PALETTES[name]).sort();
      const missing = want.filter(k => !PALETTES[name][k]);
      const extra = got.filter(k => !PALETTES.dark[k]);
      if (missing.length)
        throw new Error(name + ' does not define: ' + missing.join(', '));
      if (extra.length)
        throw new Error(name + ' defines tokens the dark palette does not: ' + extra.join(', '));
    });
  });
  t('no theme leaves a token pointing at another theme’s value', () => {
    // A token copied across unchanged is almost always an oversight rather
    // than a decision — a dark-theme fill surviving into the light palette.
    // Neutrals are exempt: pure black and pure white legitimately recur.
    const neutral = v => v === '#000000' || v === '#ffffff';
    ['light', 'mono'].forEach(name => {
      const shared = Object.keys(PALETTES.dark)
        .filter(k => PALETTES[name][k] === PALETTES.dark[k] && !neutral(PALETTES.dark[k]));
      if (shared.length)
        throw new Error(name + ' reuses the dark value for: ' + shared.join(', '));
    });
  });
  t('the mono palette is actually monochrome', () => {
    // What makes this mode useful on a photocopied audit packet. Asserted, so
    // a later token added to mono cannot quietly reintroduce a hue.
    const coloured = Object.keys(PALETTES.mono).filter(k => {
      const v = PALETTES.mono[k];
      return !(v.slice(1, 3) === v.slice(3, 5) && v.slice(3, 5) === v.slice(5, 7));
    });
    if (coloured.length)
      throw new Error('mono tokens carrying a hue: ' +
                      coloured.map(k => k + ' ' + PALETTES.mono[k]).join(', '));
  });
  t('the summary table uses two text tiers and only two', () => {
    // v156 — #8. White marks what a reader compares or acts on; dim is context.
    // --text-faint survives for chrome (chart captions, funnel footnotes) but
    // must not appear in a table cell, where a third tier re-creates the mush.
    const TABLE = SRC.slice(at('function renderSummaryTable'), at('function badgeBom('));
    if (/<td[^>]*var\(--text-faint\)/.test(TABLE))
      throw new Error('a table cell uses the chrome-only faint tier');
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    if (!/td\s*\{[^}]*color:\s*var\(--text-muted\)/.test(css))
      throw new Error('td no longer defaults to dim');
    if (!/td\.cell-key\s*\{[^}]*color:\s*var\(--text\)/.test(css))
      throw new Error('.cell-key no longer marks the white tier');
  });
  t('every column on the white list is marked, and no others', () => {
    const TABLE = SRC.slice(at('function renderSummaryTable'), at('function badgeBom('));
    const marked = (TABLE.match(/<td class="cell-key/g) || []).length;
    // Next Higher, EBOM Qty, Δ Qty, MBOM Direct Qty, ABOM Direct Qty, ABOM
    // Direct NH, ABOM Direct WO#, per-WO Qty, WO Status, Used-On WO#,
    // Used-On WO Status. Part Number is white via .pn-col; NCR disposition
    // numbers and statuses and RFV numbers carry their own semantic colour.
    eq(marked, 11, 'cells marked white:');
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    if (!/\.pn-col\s*\{[^}]*color:\s*var\(--text\)/.test(css))
      throw new Error('the Part Number column is no longer white');
  });
  t('the retired third tier is chrome-only', () => {
    // Before v155: --text, --text-muted, plus bare #7d8590, #484f58 and #c9d1d9
    // doing the same job at slightly different luminance.
    ['--text', '--text-muted', '--text-faint'].forEach(k => {
      if (!TOKENS[k]) throw new Error(k + ' is not defined');
    });
    // --text-faint may only appear in chart/chrome contexts, never a cell.
    const BODY2 = SRC.slice(at('</style>'));
    if (/<td[^>]{0,120}--text-faint/.test(BODY2))
      throw new Error('--text-faint leaked back into a table cell');
    // v173 — this compared raw luminance and required it to DESCEND, which
    // silently encoded a dark background: on a light theme the tiers ascend,
    // because text goes dark. What the rule always meant is CONTRAST — each
    // tier a step further from the page than the last — so measure that, and
    // measure it in every theme rather than only the one it was written for.
    ['dark', 'light', 'mono'].forEach(name => {
      const p = PALETTES[name];
      const d = ['--text', '--text-muted', '--text-faint']
        .map(k => Math.abs(LUM(p['--bg']) - LUM(p[k])));
      if (!(d[0] > d[1] && d[1] > d[2]))
        throw new Error(name + ' text tiers are not ordered by contrast: ' + d.map(Math.round));
      if (d[0] - d[1] < 40 || d[1] - d[2] < 40)
        throw new Error(name + ' text levels too close to read as deliberate: ' + d.map(Math.round));
    });
  });
  t('every theme keeps body text legible against its own background', () => {
    // A theme is free to choose its greys, but not to choose ones nobody can
    // read. The dark palette clears this by 219; the bar is set well below
    // that so it catches a mistake rather than a preference.
    ['dark', 'light', 'mono'].forEach(name => {
      const p = PALETTES[name];
      const d = Math.abs(LUM(p['--bg']) - LUM(p['--text']));
      if (d < 120)
        throw new Error(name + ' body text is only ' + Math.round(d) + ' from its background');
    });
  });

  console.log('\n== A standalone download carries its own palette ==');
  t('every var() in the exported report has a definition to resolve against', () => {
    // The live defect this fixes. The second style block belongs to a file the
    // user downloads and opens on its own; it referenced 52 tokens and shipped
    // no :root. An unresolvable var() on `color` computes to unset, which for
    // an inherited property means inherit, which bottoms out at black — so the
    // report rendered black text on a near-black background.
    //
    // Scanning only the export's <style> block is not enough: most of those 52
    // references are in inline styles on the rows and the certificate, in the
    // body of the template. Take the whole template, bounded at both ends —
    // an unbounded slice runs to EOF and reports the main application's tokens
    // as if the report used them.
    const tpl = span(at('const html = `<!DOCTYPE html>'),
                     at("downloadFile(tsFilename('bom_comparison_report'"),
                     'exported HTML report template');
    const used = [...new Set([...tpl.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1]))];
    if (used.length < 5) throw new Error('only ' + used.length + ' tokens found — the template moved');
    if (tpl.indexOf('exportPaletteCss()') < 0)
      throw new Error('the exported report no longer emits a :root block');
    const emitted = new Set(PALETTE_TOKENS_IN_BUILD());
    const missing = used.filter(k => !emitted.has(k));
    if (missing.length)
      throw new Error('the download references tokens it does not define: ' + missing.join(', '));
  });
  t('the exported palette list has not drifted from the stylesheet', () => {
    // The list is written by hand, so it is exactly the kind of thing that
    // rots. Derive the truth from :root and compare, rather than trusting it.
    const listed = PALETTE_TOKENS_IN_BUILD().slice().sort();
    const defined = Object.keys(PALETTES.dark).sort();
    const missing = defined.filter(k => listed.indexOf(k) < 0);
    const extra = listed.filter(k => defined.indexOf(k) < 0);
    if (missing.length) throw new Error('PALETTE_TOKENS omits: ' + missing.join(', '));
    if (extra.length) throw new Error('PALETTE_TOKENS names tokens :root does not define: ' + extra.join(', '));
  });
  t('the exported report holds no colour literal of its own', () => {
    // v137 tried to solve this by inlining hex, which is what left the report
    // frozen in the dark palette while the rest of the build gained themes.
    const exp = STYLE_BLOCKS[1].css;
    const hex = [...new Set(exp.match(/#[0-9a-fA-F]{3,8}/g) || [])]
      .filter(h => !/^#\{/.test(h));
    if (hex.length) throw new Error('literal colour(s) in the export stylesheet: ' + hex.join(', '));
  });

  console.log('\n== The palette is a view, not a record ==');
  t('the theme is not written into the session or the certificate', () => {
    // Two auditors opening the same frozen session must compute the same hash
    // whatever palette each is looking at. The theme is a viewing preference
    // and belongs in browser storage only.
    const exporter = grabFrom(SRC, 'exportSessionJson', 'session exporter');
    if (/theme/i.test(exporter))
      throw new Error('the session exporter mentions the theme');
    const setT = grabFrom(SRC, 'setTheme', 'theme switch');
    if (!/localStorage/.test(setT))
      throw new Error('setTheme does not persist to localStorage');
    if (/auditCert|state\.\w*[Hh]ash/.test(setT))
      throw new Error('setTheme touches the audit certificate');
  });
  t('dark is the absence of a theme attribute, not a fourth palette', () => {
    // :root is the default. If dark were also a [data-theme="dark"] block there
    // would be two definitions of the same palette to keep in step.
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    if (/\[data-theme="dark"\]/.test(css))
      throw new Error('a dark theme block exists alongside :root');
    const setT = grabFrom(SRC, 'setTheme', 'theme switch');
    if (setT.indexOf('removeAttribute') < 0)
      throw new Error('setTheme does not clear the attribute for the default palette');
  });
  t('every canvas colour equals a defined token value', () => {
    // A 2D context silently ignores an unresolvable fillStyle and keeps the
    // previous colour, so these must stay hex — but they must not DRIFT from
    // the palette. #39c5cf was an RFV teal while --rfv was #2dd4bf.
    const canvas = [...BODY.matchAll(/fillStyle\s*=\s*'(#[0-9a-fA-F]{6})/g)]
      .concat([...BODY.matchAll(/return\s*'(#[0-9a-fA-F]{6})'/g)])
      .map(m => m[1].toLowerCase());
    const orphan = [...new Set(canvas)].filter(v => !byValue[v]);
    if (orphan.length)
      throw new Error('canvas colour(s) with no matching token: ' + orphan.join(', '));
  });
  t('no canvas fillStyle tries to use a CSS variable', () => {
    if (/fillStyle\s*=\s*['"`]?\s*var\(/.test(BODY))
      throw new Error('canvas cannot resolve var() — the colour would silently not change');
  });
  t('RFV is one colour, not two', () => {
    // v173 — read from the dark palette explicitly. A flat scan of the
    // stylesheet now returns whichever theme is written last, so this used to
    // compare the RFV teal against the mono grey and fail for no reason.
    const rfv = PALETTES.dark['--rfv'];
    if (!rfv) throw new Error('--rfv is not defined');
    const teals = [...new Set([...BODY.matchAll(/#(3[0-9a-f]c[0-9a-f]{3}|2dd4bf)/gi)]
      .map(m => m[0].toLowerCase()))];
    if (teals.length)
      throw new Error('a second RFV teal is in use: ' + teals.join(', ') +
                      ' (--rfv is ' + rfv + ', and canvas colours go through tok())');
  });
  t('no chart renderer holds a colour literal', () => {
    // v173 — replaces the old "every canvas hex equals a token value". That
    // rule matched `fillStyle = '#hex'` and `return '#hex'`, so it never saw a
    // colour sitting in an OBJECT LITERAL. Three did: the WO status map (which
    // is how the second muted grey #7d8590 survived v155), the stacked-bar
    // segment list, and colorForStatus's fallback. Renderers now resolve every
    // colour through tok(), so the contract is simply that none of them
    // contains a hex at all — a rule with nowhere to hide.
    const RENDERERS = ['drawBarChart', 'drawNcrCauseCodeChart', 'drawNcrDispStatusChart',
                       'drawWoStatusRollup'];
    RENDERERS.forEach(name => {
      const src = grabFrom(SRC, name, 'chart renderers');
      const hex = [...new Set((src.match(/'#[0-9a-fA-F]{3,8}'/g) || []))];
      if (hex.length)
        throw new Error(name + ' holds colour literal(s): ' + hex.join(', '));
    });
  });
  t('tok() resolves through the live palette and cannot return empty', () => {
    // The whole reason canvas colours were literal: a 2D context given an
    // unresolvable fillStyle does not throw, it KEEPS THE PREVIOUS COLOUR. So
    // tok() returning '' would not fail loudly, it would silently draw the
    // last bar's colour over the next one.
    const src = grabFrom(SRC, 'tok', 'token reader');
    if (!/getComputedStyle/.test(src))
      throw new Error('tok() no longer reads the live document');
    if (!/\|\|\s*'#[0-9a-fA-F]{6}'/.test(src))
      throw new Error('tok() has no fallback — an unknown token would return empty');
    if (!/getPropertyValue/.test(src))
      throw new Error('tok() is not reading a custom property');
  });
  t('a palette change forces the charts to redraw', () => {
    // Canvas holds resolved hex, so a theme swap is invisible to it until it
    // redraws. Without this the charts keep the old theme's colours on the new
    // theme's background. The resize observer does not help: a palette change
    // alters no geometry, so nothing fires.
    const src = grabFrom(SRC, 'setTheme', 'theme switch');
    ['clearTokenCache', 'redrawAllCharts'].forEach(f => {
      if (src.indexOf(f + '(') < 0)
        throw new Error('setTheme does not call ' + f + '()');
    });
    const reg = grabFrom(SRC, 'registerChartRedraw', 'chart registry');
    if (!/drawFn/.test(reg) || !/_chartRedraw\.set\([^)]*drawFn/.test(reg))
      throw new Error('the registry does not keep the draw function, so nothing can replay it');
  });
});

// ── TIER 13 ────────────────────────────────────────────────────────────────
// The Comparison Summary type scale, plus a syntax check of the whole build.
// v155 stripped 26 inline font-size overrides out of renderSummaryTable with a
// regex; a regex loose enough to do that is loose enough to break a template
// literal, and nothing here would have noticed.
suite('Tier 13 — summary table type scale', (t, eq) => {
  const CSS = STYLE_BLOCKS.map(b => b.css).join('\n');
  const TABLE = SRC.slice(at('function renderSummaryTable'), at('function badgeBom('));
  const rule = sel => {
    const m = CSS.match(new RegExp('(?:^|\\})\\s*' + sel + '\\s*\\{([^}]*)\\}', 'm'));
    if (!m) throw new Error('rule not found: ' + sel);
    return m[1].split('\n').join(' ').replace(/\s+/g, ' ');
  };
  const px = decl => { const m = decl.match(/font-size:\s*(?:var\((--[\w-]+)\)|(\d+)px)/);
    return m ? (m[1] || m[2] + 'px') : null; };
  const token = n => { const m = CSS.match(new RegExp(n + '\\s*:\\s*(\\d+)px'));
    if (!m) throw new Error(n + ' is not defined'); return parseInt(m[1], 10); };

  console.log('\n== The build still parses ==');
  t('every inline script block is syntactically valid', () => {
    const cp = require('child_process'), fs2 = require('fs'), os = require('os'), pth = require('path');
    const blocks = [...SRC.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)]
      .map(m => m[1]).filter(b => b.length > 50);
    if (blocks.length < 2) throw new Error('expected at least 2 script blocks, found ' + blocks.length);
    blocks.forEach((b, i) => {
      const f = pth.join(os.tmpdir(), 'cmp-syntax-' + process.pid + '-' + i + '.js');
      fs2.writeFileSync(f, b);
      const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
      fs2.unlinkSync(f);
      if (r.status !== 0)
        throw new Error('script block ' + i + ' does not parse:\n        ' +
                        String(r.stderr).split('\n').slice(0, 4).join('\n        '));
    });
  });
  t('no style attribute was left malformed', () => {
    // Scoped to style attributes: `;;` is ordinary JavaScript — `for(;;)` and
    // SheetJS's own escaping account for 11 legitimate occurrences file-wide.
    const attrs = [...SRC.matchAll(/style="([^"]*)"/g)].map(m => m[1]);
    const bad = attrs.filter(a => /^\s*;/.test(a) || /;;/.test(a) || /^\s*$/.test(a));
    if (bad.length)
      throw new Error(bad.length + ' malformed style attribute(s), e.g. ' +
                      JSON.stringify(bad[0].slice(0, 60)));
  });

  console.log('\n== One size for every cell ==');
  t('the scale is declared as tokens, not repeated literals', () => {
    eq(px(rule('td')), '--fs-cell', 'td:');
    eq(px(rule('th')), '--fs-head', 'th:');
  });
  t('no cell in the summary table overrides the base size', () => {
    const over = TABLE.match(/font-size:\s*\d+px/g);
    if (over) throw new Error(over.length + ' inline override(s) remain: ' +
                              [...new Set(over)].join(', '));
  });
  t('no stylesheet rule re-sizes a table cell either', () => {
    const bad = [];
    ['td.td-indenture', 'td.ctx-rel', '.badge-ncr-none'].forEach(sel => {
      const p = px(rule(sel));
      if (p && p !== '--fs-cell') bad.push(sel + ' = ' + p);
    });
    if (bad.length) throw new Error(bad.join('; '));
  });

  console.log('\n== Weight is not an emphasis channel ==');
  t('no data cell in the summary table sets its own weight', () => {
    // v156 — #7. Weight belongs to the Part Number column and to badges. It was
    // also on NCR numbers, part-type codes, quantity deltas and adjudication
    // glyphs — emphasis with no shared rule. Colour already carries all of it.
    const TABLE = SRC.slice(at('function renderSummaryTable'), at('function badgeBom('));
    const bold = TABLE.match(/font-weight:\s*[67]00/g);
    if (bold) throw new Error(bold.length + ' inline bold declaration(s) remain in the table');
  });
  t('the two places weight IS allowed still have it', () => {
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    if (!/\.pn-col\s*\{[^}]*font-weight:\s*600/.test(css))
      throw new Error('the Part Number column lost its weight');
    if (!/\.badge\s*\{[^}]*font-weight:\s*700/.test(css))
      throw new Error('badges lost their weight');
  });

  console.log('\n== Row separation ==');
  t('rows are separated by a visible line', () => {
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    const m = css.match(/--row-line:\s*#([0-9a-fA-F]{8})/);
    if (!m) throw new Error('--row-line is not defined as an 8-digit hex');
    const alpha = parseInt(m[1].slice(6), 16);
    if (alpha < 0x18) throw new Error('row separator alpha is 0x' + m[1].slice(6) +
      ' — too faint to locate a row on a wide scrolled table');
    if (!/border-bottom:\s*1px solid var\(--row-line\)/.test(css))
      throw new Error('td no longer uses --row-line');
  });

  console.log('\n== Headers and badges ==');
  t('the header is smaller than the cell, not larger', () => {
    // A header is a label, not content. It is already distinguished by
    // uppercase, letter-spacing, a surface fill and muted colour, and it is
    // sticky — so enlarging it would cost permanent vertical space.
    const head = token('--fs-head'), cell = token('--fs-cell');
    if (head >= cell) throw new Error('head ' + head + 'px vs cell ' + cell + 'px');
    ['text-transform: uppercase', 'letter-spacing'].forEach(sig => {
      if (rule('th').indexOf(sig) < 0)
        throw new Error('the header lost a non-size signal: ' + sig);
    });
  });
  t('every badge is one size, set in one place', () => {
    // v155 matched badges to cell text. On review that made OVERALL badges
    // larger than the trace-column badges beside them in the same row, because
    // the trace columns carried an inline 9px override. v156 makes the smaller
    // size the rule and removes the overrides — one token, no exceptions.
    eq(px(rule('\\.badge')), '--fs-badge');
    const inline = SRC.match(/class="badge[^"]*"[^>]{0,80}font-size:\s*\d+px/g);
    if (inline) throw new Error(inline.length + ' badge(s) still override the size: ' +
                                inline[0].slice(0, 80));
    const cls = [...STYLE_BLOCKS.map(b => b.css).join('\n')
      .matchAll(/\.(badge-[\w-]+)\s*\{[^}]*font-size:\s*(\d+)px/g)].map(m => m[1]);
    if (cls.length) throw new Error('badge class(es) re-size themselves: ' + cls.join(', '));
  });
  t('badge tracking stays tight', () => {
    // Size and tracking compound. At 0.12em, matching cell size widened the two
    // stacked-badge columns by about a third in a table that already scrolls.
    const m = rule('\\.badge').match(/letter-spacing:\s*([\d.]+)em/);
    if (!m) throw new Error('badge letter-spacing is gone');
    if (parseFloat(m[1]) > 0.05)
      throw new Error('tracking is ' + m[1] + 'em — too wide at ' + token('--fs-cell') + 'px');
  });
  t('badges keep a non-size difference from the cell text', () => {
    // The user asked for same size, different style. Weight and case carry it.
    const b = rule('\\.badge');
    ['font-weight: 700', 'text-transform: uppercase'].forEach(sig => {
      if (b.indexOf(sig) < 0) throw new Error('badge lost ' + sig);
    });
  });
});

// ── TIER 14 ────────────────────────────────────────────────────────────────
// Detailed View table structure. .table-wrap is overflow-x/y auto with a
// max-height, so anything placed inside it scrolls away from the reader and
// slides under the sticky header row — and attachTopScrollbar inserts its
// mirror as the wrap's previous sibling, so a caption inside the wrap pushes
// the horizontal scrollbar above the caption instead of onto the table.
// Exactly two of the eight views did that, and they are the two that were
// reported as looking different.
suite('Tier 14 — Detailed View table structure', (t, eq) => {
  const VIEWS = ['renderSummaryTable', 'renderFullBom', 'renderChpTable', 'renderWo5Table',
                 'renderWo5DiscrepancyView', 'renderNcrTable', 'renderCITraceTable',
                 'renderRFVTable'];
  const body = fn => { const a = at('function ' + fn);
    const b = SRC.indexOf('\nfunction ', a + 10);
    return SRC.slice(a, b > 0 ? b : a + 26000); };

  console.log('\n== Every view is wired the same way ==');
  t('every Detailed View renderer targets a .table-wrap and attaches a top scrollbar', () => {
    VIEWS.forEach(fn => {
      const b = body(fn);
      const m = b.match(/getElementById\(([^)]+)\)\.innerHTML = html/);
      if (!m) throw new Error(fn + ' does not fill a wrapper');
      if (b.indexOf('attachTopScrollbar') < 0)
        throw new Error(fn + ' has no top scrollbar');
    });
  });
  t('every wrapper element carries the table-wrap class', () => {
    ['summary', 'ebom', 'chp', 'wo5', 'wo5disc', 'ncr', 'ci', 'rfv'].forEach(k => {
      const re = new RegExp('<div[^>]*id="' + k + '-table-wrap"[^>]*>');
      const m = SRC.match(re);
      if (!m) throw new Error(k + '-table-wrap is not declared');
      if (m[0].indexOf('table-wrap') < 0)
        throw new Error(k + ' wrapper lost its class: ' + m[0]);
    });
  });

  console.log('\n== #11 / #12: nothing but the table inside the scroller ==');
  t('no renderer puts a caption inside the scroll container', () => {
    const bad = VIEWS.filter(fn => {
      const b = body(fn);
      const i = b.indexOf('<table');
      return i > 0 && /html\s*\+?=\s*[`'"]<div/.test(b.slice(0, i));
    });
    if (bad.length)
      throw new Error('caption inside .table-wrap in: ' + bad.join(', ') +
                      ' — it will scroll sideways with the table and sit under the sticky header');
  });
  t('both captions are written to elements outside their wrapper', () => {
    [['wo5disc', 'renderWo5DiscrepancyView'], ['rfv', 'renderRFVTable']].forEach(([k, fn]) => {
      const cap = SRC.indexOf('id="' + k + '-table-caption"');
      const wrap = SRC.indexOf('id="' + k + '-table-wrap"');
      if (cap < 0) throw new Error(k + '-table-caption is not declared');
      if (cap > wrap) throw new Error(k + ' caption is declared after its wrapper');
      if (body(fn).indexOf("setTableCaption('" + k + "-table-caption'") < 0)
        throw new Error(fn + ' no longer writes its caption');
    });
  });
  t('the caption helper writes outside the wrapper, not into it', () => {
    const h = SRC.slice(at('function setTableCaption'), at('function attachTopScrollbar'));
    if (h.indexOf('table-wrap') >= 0)
      throw new Error('setTableCaption touches the scroll container');
    if (h.indexOf('innerHTML') < 0) throw new Error('setTableCaption stopped writing');
  });
  t('.table-caption is styled and collapses when empty', () => {
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    if (!/\.table-caption\s*\{/.test(css)) throw new Error('.table-caption has no rule');
    if (!/\.table-caption:empty\s*\{[^}]*display:\s*none/.test(css))
      throw new Error('an empty caption must not leave a gap above the table');
  });

  console.log('\n== Row selection survives re-render ==');
  t('every summary row carries its key and a click handler', () => {
    const T = SRC.slice(at('function renderSummaryTable'), at('function badgeBom('));
    if (!/data-rk="\$\{esc\(r\.key\)\}"/.test(T))
      throw new Error('rows no longer carry their key');
    if (!/onclick="selectSummaryRow\(this\)"/.test(T))
      throw new Error('rows are not clickable');
  });
  t('the selection lives in state, not only in the DOM', () => {
    // A DOM-only highlight would vanish on paging, filtering or any re-render —
    // exactly when a reader most needs to keep their place.
    if (!/summarySelectedKey:\s*null/.test(SRC))
      throw new Error('state has no summarySelectedKey');
    const T = SRC.slice(at('function renderSummaryTable'), at('function badgeBom('));
    if (!/state\.summarySelectedKey === r\.key/.test(T))
      throw new Error('render does not re-apply the stored selection');
  });
  t('clicking the selected row clears it, and only one row is ever selected', () => {
    const h = SRC.slice(at('function selectSummaryRow'), at('function renderSummaryTable'));
    if (!/state\.summarySelectedKey === key/.test(h))
      throw new Error('no toggle-off path');
    if (!/querySelectorAll\('tr\.row-selected'\)/.test(h))
      throw new Error('a previous selection is not cleared');
  });
  t('selection paints the cells, so an inline row background cannot hide it', () => {
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    if (!/tbody tr\.row-selected > td\s*\{[^}]*background[^}]*!important/.test(css))
      throw new Error('selection must paint td with !important — rows carry inline status backgrounds');
    if (!/tbody tr\.row-selected > td:first-child\s*\{[^}]*box-shadow/.test(css))
      throw new Error('the left marker is gone');
  });

  console.log('\n== Pagination is uniform ==');
  t('every paginated view uses the shared PAGE_SIZE and page-bar', () => {
    VIEWS.filter(fn => fn !== 'renderCITraceTable').forEach(fn => {
      const b = body(fn);
      if (b.indexOf('PAGE_SIZE') < 0) throw new Error(fn + ' does not use PAGE_SIZE');
      if (b.indexOf('class="page-bar"') < 0) throw new Error(fn + ' has no page-bar');
      ['← Prev', 'Next →'].forEach(lbl => {
        if (b.indexOf(lbl) < 0) throw new Error(fn + ' is missing the ' + lbl + ' control');
      });
    });
  });
  t('the CI Traceability view is the one deliberate exception', () => {
    // Documented rather than silently tolerated: it renders every row. If it
    // ever gains pagination, this test fails and the exception list shrinks.
    const b = body('renderCITraceTable');
    if (b.indexOf('class="page-bar"') >= 0)
      throw new Error('renderCITraceTable now paginates — move it into the rule above');
  });
});

// ── TIER 15 ────────────────────────────────────────────────────────────────
// The reconciliation engine. 543 lines that decide whether a part is
// reconciled, and until v159 not one test executed it — every other suite
// tested the code AROUND it: the proc table that feeds it, the badges that
// display its output, the exports that format it.
//
// Fixtures go through the REAL map builders, never hand-built. Building them by
// hand got the shapes wrong twice while this suite was being written: a Map
// where the engine wants a plain object, and an object where primaryQtyMap
// wants a bare number. Both times the engine ran without error and returned
// plausible-but-wrong results. A fixture that lies is worse than no test.
suite('Tier 15 — reconciliation engine', (t, eq) => {
  const E = sandbox({ PROC_CODE_EXCEPTIONS: { BR:'remove', 'BR-S':'remove', RS:'remove',
    CR:'remove', FR:'remove', MR:'remove', DR:'swap', 'DR-S':'swap', TRRI:'swap', PIP:'swap' } },
    ['engine']).E;

  // EBOM row: [indenture, pn, desc, nh, qty]. Indenture C = a real line item;
  // A and B are structural collector levels and are excluded from scope.
  const eb = (pn, nh, q, ind) => { const r = new Array(6).fill('');
    r[0] = ind || 'C'; r[1] = pn; r[3] = nh; r[4] = String(q); return r; };
  // ABOM row: [pn, usedOn, qty, woNo, woStatus, procCode]
  const ab = (pn, uo, q, wo, st, pc) => [pn, uo, String(q), wo, st || 'CLOSED', pc || ''];

  function run(ebom, mbom, abom, extra) {
    const closed = (abom || []).filter(r => String(r[4]).toUpperCase() === 'CLOSED');
    const open   = (abom || []).filter(r => String(r[4]).toUpperCase() !== 'CLOSED');
    return E.runReconciliationCore(Object.assign({
      mode: 'ebom_mbom_abom', required: ['ebom', 'mbom', 'abom'], serializeMaps: false,
      // v160 — the collector rule is now a parameter. The default matches the
      // shipped default; tests that vary it pass their own.
      collectorLevels: ['A', 'B'],
      primaryQtyMap: E.buildQtyMap(ebom, 1, 3, 4, true),
      mbomMap: mbom ? E.buildQtyMap(mbom, 1, 3, 4) : null,
      abomMap: abom ? E.buildAbomMap(closed, 0, 1, 2, 3, 4, 5) : null,
      openAbomMap: abom ? E.buildAbomMap(open, 0, 1, 2, 3, 4, 5) : null,
      mbomUsedOnMap: mbom ? E.buildMbomUsedOnMap(mbom, 1, 3, 4) : null,
      abomUsedOnMap: abom ? E.buildAbomUsedOnMap(closed, 0, 1, 2, 3, 4, 5) : null,
      openAbomUsedOnMap: abom ? E.buildAbomUsedOnMap(open, 0, 1, 2, 3, 4, 5) : null,
      abomWoToUsedOns: {}, ebomFlex: {}, ebomRef: {}, removalScope: {}, ptTypeMap: {},
      ebomLineNoMap: {}, ebomQtyTextMap: {},
      indentureInfo: E.buildEbomIndentureMap(ebom, 0, 1, 3),
      chpTrace: {}, chpPnTrace: {}, ncrByDiscPn: {}, ncrByOrigWo: {}, wo5Map: {},
    }, extra || {}));
  }
  const row = (res, key) => res.find(r => r.key === (key || 'P1||TOP'));
  const legs = (res, key) => { const r = row(res, key);
    if (!r) throw new Error('no row for ' + (key || 'P1||TOP'));
    return [r.ms, r.as, r.overall]; };

  console.log('\n== The fixture builders agree with the engine ==');
  t('buildQtyMap produces the bare-number shape the engine reads', () => {
    // `var eq = primaryMap[key]` — the value IS the quantity. Wrapping it in an
    // object makes every comparison silently false.
    const m = E.buildQtyMap([eb('P1', 'TOP', 2)], 1, 3, 4, true);
    eq(m['P1||TOP'], 2);
    if (typeof m['P1||TOP'] !== 'number') throw new Error('not a number');
  });
  t('buildAbomMap produces the fields the engine destructures', () => {
    const m = E.buildAbomMap([ab('P1', 'TOP', 2, 'W1')], 0, 1, 2, 3, 4, 5);
    ['qty', 'woValues', 'allProcsAreRemovalOrSwap'].forEach(k => {
      if (!(k in m['P1||TOP'])) throw new Error('buildAbomMap no longer emits ' + k);
    });
    eq(Array.isArray(m['P1||TOP'].woValues), true, 'woValues must be an array:');
  });

  console.log('\n== Pass 1 — direct match ==');
  t('a line present and equal on all three legs reconciles', () => {
    eq(legs(run([eb('P1','TOP',2)], [eb('P1','TOP',2)], [ab('P1','TOP',2,'W1')])),
       ['ok', 'ok', 'ok']);
  });
  t('a line absent from both target legs is missing', () => {
    eq(legs(run([eb('P1','TOP',2)], [], [])), ['missing', 'missing', 'missing']);
  });
  t('each leg is judged independently', () => {
    eq(legs(run([eb('P1','TOP',2)], [eb('P1','TOP',2)], [])),
       ['ok', 'missing', 'missing'], 'planned but not built:');
  });

  console.log('\n== Quantity: a shortfall, not any difference ==');
  t('less in the target than the EBOM is a mismatch', () => {
    eq(legs(run([eb('P1','TOP',3)], [eb('P1','TOP',3)], [ab('P1','TOP',1,'W1')]))[1],
       'qty_mismatch');
    eq(legs(run([eb('P1','TOP',3)], [eb('P1','TOP',1)], [ab('P1','TOP',3,'W1')]))[0],
       'qty_mismatch', 'MBOM side too:');
  });
  t('MORE in the target than the EBOM is NOT a mismatch', () => {
    // Deliberate: the rule is `aq < eq`. An overage is not a reconciliation
    // failure — the design quantity is satisfied.
    eq(legs(run([eb('P1','TOP',2)], [eb('P1','TOP',5)], [ab('P1','TOP',5,'W1')])),
       ['ok', 'ok', 'ok']);
  });
  t('exact equality is not a mismatch', () => {
    eq(legs(run([eb('P1','TOP',7)], [eb('P1','TOP',7)], [ab('P1','TOP',7,'W1')])),
       ['ok', 'ok', 'ok']);
  });

  console.log('\n== Work order status and proc codes ==');
  t('an open work order is wo_open, not ok and not missing', () => {
    eq(legs(run([eb('P1','TOP',2)], [eb('P1','TOP',2)], [ab('P1','TOP',2,'W1','OPEN')]))[1],
       'wo_open');
  });
  t('a REMOVE proc code on every record reads as proc_removed', () => {
    eq(legs(run([eb('P1','TOP',2)], [eb('P1','TOP',2)], [ab('P1','TOP',2,'W1','CLOSED','BR')]))[1],
       'proc_removed');
  });
  t('an install alongside a removal nets out rather than reading as removed', () => {
    const r = run([eb('P1','TOP',2)], [eb('P1','TOP',2)],
                  [ab('P1','TOP',2,'W1','CLOSED'), ab('P1','TOP',2,'W2','CLOSED','BR')]);
    if (row(r).as === 'proc_removed')
      throw new Error('a key with an effective install must not read as proc_removed');
  });
  t('a SWAP code is not a removal', () => {
    // DR is net-zero by design — removed then reinstalled before the WO closes.
    eq(legs(run([eb('P1','TOP',2)], [eb('P1','TOP',2)], [ab('P1','TOP',2,'W1','CLOSED','DR')]))[1],
       'ok');
  });

  console.log('\n== Scope exclusions ==');
  t('indenture A and B rows are structural collectors, not line items', () => {
    const r = run([eb('TOP','',1,'A'), eb('P1','TOP',2)], [eb('P1','TOP',2)],
                  [ab('P1','TOP',2,'W1')]);
    eq(legs(r, 'TOP||'), ['collector', 'collector', 'collector']);
    eq(legs(r), ['ok', 'ok', 'ok'], 'the real line item beneath it is unaffected:');
  });
  t('a REF line is excluded from the results entirely', () => {
    const r = run([eb('P1','TOP',2)], [], [], { ebomRef: { 'P1||TOP': true } });
    eq(r.length, 0, 'REF lines must not appear as rows at all:');
  });
  t('a removal-scope line is reported as pt_removal, not as missing', () => {
    eq(legs(run([eb('P1','TOP',2)], [], [], { removalScope: { 'P1||TOP': true } })),
       ['pt_removal', 'pt_removal', 'pt_removal']);
  });
  t('a SUB/AR flex line absent from the target is flex_missing, and overall ok', () => {
    // Any quantity satisfies a flex line, and absence is expected — so the leg
    // records flex_missing while the rollup stays clean.
    const l = legs(run([eb('P1','TOP',2)], [], [], { ebomFlex: { 'P1||TOP': true } }));
    eq([l[0], l[2]], ['flex_missing', 'ok']);
  });

  console.log('\n== The overall rollup takes the worst leg ==');
  t('missing beats qty_mismatch', () => {
    eq(legs(run([eb('P1','TOP',3)], [eb('P1','TOP',1)], []))[2], 'missing');
  });
  t('qty_mismatch beats wo_open', () => {
    const r = run([eb('P1','TOP',3)], [eb('P1','TOP',1)], [ab('P1','TOP',3,'W1','OPEN')]);
    eq(row(r).overall, 'qty_mismatch');
  });
  t('wo_open beats ok', () => {
    eq(legs(run([eb('P1','TOP',2)], [eb('P1','TOP',2)], [ab('P1','TOP',2,'W1','OPEN')]))[2],
       'wo_open');
  });
  t('overall is only ok when no leg is worse', () => {
    eq(legs(run([eb('P1','TOP',2)], [eb('P1','TOP',2)], [ab('P1','TOP',2,'W1')]))[2], 'ok');
  });

  console.log('\n== Keys, normalisation and multiple rows ==');
  t('the key is part number plus next higher, not part number alone', () => {
    const r = run([eb('P1','TOP',2), eb('P1','OTHER',3)],
                  [eb('P1','TOP',2)], [ab('P1','TOP',2,'W1')]);
    eq(r.length, 2, 'the same PN under two parents is two rows:');
    eq(legs(r, 'P1||TOP')[0], 'ok');
    eq(legs(r, 'P1||OTHER')[0], 'missing', 'the second parent is unplanned:');
  });
  t('case and padding differences still match', () => {
    eq(legs(run([eb(' p1 ', 'top', 2)], [eb('P1', 'TOP', 2)], [ab('P1', 'TOP', 2, 'W1')])),
       ['ok', 'ok', 'ok']);
  });
  t('every EBOM line in scope produces exactly one row', () => {
    const r = run([eb('P1','TOP',1), eb('P2','TOP',1), eb('P3','TOP',1)],
                  [eb('P1','TOP',1)], [ab('P2','TOP',1,'W1')]);
    eq(r.length, 3);
    // Each row is judged on its own evidence: P1 is planned only, P2 is built
    // only, P3 is in neither. All three roll up to missing, by different routes.
    eq([row(r,'P1||TOP').ms, row(r,'P1||TOP').as], ['ok', 'missing'], 'planned, not built:');
    eq([row(r,'P2||TOP').ms, row(r,'P2||TOP').as], ['missing', 'ok'], 'built, not planned:');
    eq([row(r,'P3||TOP').ms, row(r,'P3||TOP').as], ['missing', 'missing'], 'neither:');
  });
  t('an empty EBOM produces no rows and does not throw', () => {
    eq(run([], [], []).length, 0);
  });
});

// ── TIER 16 ────────────────────────────────────────────────────────────────
// computeEffectiveResults applies SME claims on top of raw engine output. Its
// own comments say Phase C "mirrors runReconciliationCore's priority rollup" —
// the same shape of risk as the duplicated PROC_CODE_BASELINE in the delta
// tool, which did drift. Nothing enforced the agreement until now.
suite('Tier 16 — effective results and the duplicated rollup', (t, eq) => {
  const E = sandbox({ state: { results: [], adjudications: [] },
                      PROC_CODE_EXCEPTIONS: {} }, ['engine']).E;
  const CE = (rows, claims) => E.computeEffectiveResults(rows, claims || []);
  const raw = o => Object.assign({ key:'P1||TOP', pn:'P1', nh:'TOP',
    ms:'ok', as:'ok', msUsedOn:'n/a', asUsedOn:'n/a', overall:'ok' }, o);

  console.log('\n== The two rollups must agree, exhaustively ==');
  t('both ladders return the same overall for every leg combination', () => {
    // 12 statuses across 4 legs = 20,736 combinations. Each row is fed the
    // overall the ENGINE produced, because that is the real precondition —
    // Phase C reads the existing overall to decide whether to skip a row.
    const V = ['ok','missing','qty_mismatch','wo_open','proc_removed','covered',
               'pn_as_usedon','n/a','flex_ok','flex_missing','collector','wo_cancelled'];
    // A claim MUST be supplied: computeEffectiveResults returns early when the
    // claim list is empty, so comparing with no claims would skip Phase C
    // entirely and pass without testing anything. The claim targets a row that
    // does not exist, so it changes no leg — it only gets us past the guard.
    const wake = [{ id: 'probe', rowKey: 'NOSUCH||ROW', leg: 'mbom',
                    reason: 'direct', applied: true }];
    const diff = [];
    V.forEach(ms => V.forEach(as => V.forEach(mu => V.forEach(au => {
      const engine = E.engineLadder(ms, as, mu, au);
      const eff = CE([raw({ ms, as, msUsedOn: mu, asUsedOn: au, overall: engine })], wake)[0].overall;
      if (engine !== eff) diff.push(ms + '/' + as + '/' + mu + '/' + au +
                                    ': engine=' + engine + ' effective=' + eff);
    }))));
    if (diff.length)
      throw new Error(diff.length + ' of 20736 combinations disagree, e.g.\n        ' +
                      diff.slice(0, 5).join('\n        '));
  });
  t('the worst-leg order is identical in both copies', () => {
    // Compare the ladders as code, not only as behaviour: a reordering that
    // happens to be behaviourally equivalent today is still drift.
    const rungs = src => (src.match(/'(missing|qty_mismatch|wo_open|proc_removed)'/g) || [])
      .map(x => x.replace(/'/g, '')).filter((v, i, a) => a.indexOf(v) === i);
    const engSrc = SRC.slice(at('var legs = [];'), at('// Pass 3 fallback'));
    const effA = at('// ── Phase C');
    const effSrc = SRC.slice(effA, SRC.indexOf('return effective', effA));
    eq(rungs(effSrc), rungs(engSrc), 'rung order:');
    eq(rungs(engSrc), ['missing', 'qty_mismatch', 'wo_open', 'proc_removed']);
  });

  console.log('\n== With no claims, nothing changes ==');
  t('an empty claim list is a pass-through', () => {
    const rows = [raw({}), raw({ key:'P2||TOP', pn:'P2', ms:'missing', overall:'missing' })];
    const out = CE(rows, []);
    eq(out.length, 2);
    eq(out.map(r => r.overall), ['ok', 'missing']);
  });
  t('the raw rows are not mutated', () => {
    // The audit trail depends on raw and effective staying separable — the
    // session exports both.
    const rows = [raw({ ms:'missing', overall:'missing' })];
    CE(rows, [{ id:'a1', rowKey:'P1||TOP', leg:'mbom', reason:'direct',
                type:'row', applied:true }]);
    eq(rows[0].ms, 'missing', 'the raw row must survive untouched:');
    eq(rows[0].overall, 'missing');
  });
  t('structural rows are never re-rolled', () => {
    ['pt_collector', 'pt_reference', 'pt_bulk', 'pt_removal', 'collector'].forEach(st => {
      const out = CE([raw({ ms:'missing', as:'missing', overall: st })]);
      eq(out[0].overall, st, st + ' must pass through untouched:');
    });
  });

  console.log('\n== Adjudicated statuses roll up as their plain equivalents ==');
  t('an adjudicated direct leg counts as a direct-OK leg', () => {
    eq(CE([raw({ ms:'direct_adjudicated', as:'ok', overall:'ok' })])[0].overall,
       E.engineLadder('ok', 'ok', 'n/a', 'n/a'));
  });
  t('an accepted quantity mismatch no longer rolls up as a mismatch', () => {
    const out = CE([raw({ ms:'qty_mismatch_accepted', as:'ok', overall:'ok' })])[0];
    if (out.overall === 'qty_mismatch')
      throw new Error('an accepted mismatch must not still read as a mismatch');
  });
  t('Phase C does not run at all when there are no claims', () => {
    // `if (!adjudications || !adjudications.length) return effective;` — an
    // early return before Phase C. So adjudicated leg statuses in the raw rows
    // are NOT re-rolled unless a claim exists. Correct (an adjudicated status
    // cannot appear without a claim) but easy to misread: every test of the
    // promotion branch must supply a claim or it silently tests nothing.
    const out = CE([raw({ ms:'covered_adjudicated', as:'covered_adjudicated',
                          overall:'covered' })], []);
    eq(out[0].overall, 'covered', 'unchanged, because Phase C was skipped:');
  });
  t('with a claim present, an adjudicated covered leg is surfaced at overall', () => {
    const out = CE([raw({ ms:'covered_adjudicated', as:'covered_adjudicated',
                          overall:'covered' })],
                   [{ id:'a1', rowKey:'OTHER||ROW', leg:'mbom', reason:'direct',
                      applied:true }]);
    eq(out[0].overall, 'covered_adjudicated');
  });
  t('a mix of covered and covered_adjudicated surfaces the adjudication', () => {
    const out = CE([raw({ ms:'covered', as:'covered_adjudicated', overall:'covered' })],
                   [{ id:'a1', rowKey:'OTHER||ROW', leg:'mbom', reason:'direct',
                      applied:true }]);
    eq(out[0].overall, 'covered_adjudicated');
  });
  t('plain covered legs stay plain', () => {
    eq(CE([raw({ ms:'covered', as:'covered', overall:'covered' })])[0].overall, 'covered');
  });

  console.log('\n== Malformed input must not corrupt the audit trail ==');
  t('a claim naming a row that does not exist is ignored', () => {
    const out = CE([raw({})], [{ id:'x', rowKey:'NOSUCH||ROW', leg:'mbom',
                                 reason:'direct', applied:true }]);
    eq([out.length, out[0].overall], [1, 'ok']);
  });
  t('a claim with no rowKey does not throw', () => {
    eq(CE([raw({})], [{ id:'x', leg:'mbom', reason:'direct', applied:true }]).length, 1);
  });
  t('an empty result set returns an empty array', () => {
    eq(CE([], [{ id:'x', rowKey:'K', leg:'mbom' }]).length, 0);
  });
});

// ── TIER 17 ────────────────────────────────────────────────────────────────
// Session restore. The session file IS the audit artefact — it is what gets
// re-opened months later to answer "what did we certify, and on what basis".
// A field that fails to restore is a silently wrong answer, not a crash.
suite('Tier 17 — session restore', (t, eq) => {
  const el = () => ({ style:{}, classList:{ add(){}, remove(){}, toggle(){} },
    textContent:'', value:'', innerHTML:'', disabled:false,
    querySelectorAll: () => [], appendChild(){} });
  const fresh = () => ({ mode:'ebom_mbom', boms:{}, results:[], resultsRaw:[],
                         adjudications:[] });
  function load(payload) {
    const ctx = sandbox({
      document: { getElementById: el, querySelector: el, querySelectorAll: () => [] },
      state: fresh(), COL: { ebom:{ pn:1, nh:3 } },
      deserializeResults: r => r,
      setProcCodeMap: function (m, n) { ctx.state.procOverrides = m || null;
                                        ctx.state.procProfileName = n || null; },
      buildEbomLineNoMap: () => ({}), setMode: () => {}, clearNearMatchCache: () => {},
    }, ['session']);
    ctx.SS.restoreSession(payload);
    return ctx.state;
  }

  console.log('\n== The exporter and the importer agree on every field ==');
  t('every key the importer reads is a key the exporter writes', () => {
    // The one exception is cpManualMap — a deliberate back-compat read for
    // sessions written before the cp → chp rename. Anything else appearing here
    // means a field that can never restore, however carefully it was saved.
    const exp = SRC.slice(at('const head = {'), at('downloadFile', at('const head = {')));
    const written = new Set(
      [...exp.matchAll(/parts\.push\('?,?"(\w+)"/g)].map(m => m[1])
      .concat([...exp.matchAll(/^\s{6}(\w+):/gm)].map(m => m[1])));
    const imp = grabFn('importSessionJson');
    const read = [...new Set([...imp.matchAll(/payload\.(\w+)/g)].map(m => m[1]))];
    const orphan = read.filter(k => !written.has(k) && k !== 'cpManualMap');
    if (orphan.length)
      throw new Error('read but never written: ' + orphan.join(', '));
  });
  t('a session with no schema is refused', () => {
    const imp = grabFn('importSessionJson');
    if (!/payload\.schema !== 'bom-comparator-session'/.test(imp))
      throw new Error('the schema gate is gone — any JSON would be accepted');
    if (imp.indexOf('showError') < 0) throw new Error('a refusal must tell the user');
  });

  console.log('\n== A complete session restores completely ==');
  t('every audit-relevant field comes back', () => {
    const st = load({ mode:'ebom_abom', boms:{ ebom:{ data:[] } }, isLocked:true,
      abomColumnMapping:2, ebomColumnMapping:2, adjudicationsApplied:true,
      adjudications:[{ id:'a1' }, { id:'a2' }],
      procOverrides:{ XR:'remove' }, procProfileName:'Program Falcon',
      auditCert:{ hash:'abc123' }, woRollup:{ total:5 } });
    eq(st.mode, 'ebom_abom', 'mode:');
    eq(st.isLocked, true, 'the frozen flag:');
    eq([st.abomColumnMapping, st.ebomColumnMapping], [2, 2], 'column mappings:');
    eq(st.adjudications.length, 2, 'claims:');
    eq(st.adjudicationsApplied, true, 'whether they were applied:');
    eq(st.procProfileName, 'Program Falcon', 'proc profile provenance:');
    eq(st.auditCert.hash, 'abc123', 'the certificate:');
  });
  t('the lock survives, so a frozen report reopens frozen', () => {
    eq(load({ isLocked:true }).isLocked, true);
    eq(load({ isLocked:false }).isLocked, false);
    eq(load({}).isLocked, false, 'absent means unlocked, not undefined:');
  });

  console.log('\n== Older and malformed sessions ==');
  t('a pre-v153 session using the old cp zone key is mapped forward', () => {
    const st = load({ boms:{ ebom:{ data:[] }, cp:{ data:[[1]] } },
                      cpManualMap:{ pn:3 } });
    eq(!!st.boms.chp, true, 'the Change Pedigree zone must survive the rename:');
    eq(st.boms.cp, undefined, 'the old key is removed, not left as a duplicate:');
    eq(st.chpManualMap, { pn:3 }, 'and its manual column map carries forward:');
  });
  t('a new-key session is not overwritten by the back-compat path', () => {
    const st = load({ boms:{ chp:{ data:[['new']] }, cp:{ data:[['old']] } } });
    eq(st.boms.chp.data, [['new']], 'the current key wins:');
  });
  t('an empty payload restores usable defaults rather than throwing', () => {
    const st = load({});
    eq(st.mode, 'ebom_mbom', 'the current mode is kept:');
    eq(st.adjudications, [], 'claims default to empty, not undefined:');
    eq(st.abomColumnMapping, 1, 'column mapping falls back to 1:');
    eq(Object.keys(st.boms).length, 9, 'all nine zones are present as null:');
  });
  t('a null boms object does not leave the app without zones', () => {
    eq(Object.keys(load({ boms:null }).boms).sort(),
       ['abom','acn','chp','ci','ebom','mbom','ncr','rfv','wo5']);
  });
  t('an out-of-range column mapping falls back to 1, not to itself', () => {
    // Only 2 is a valid alternative. A hand-edited or corrupted session must
    // not select a mapping that does not exist.
    [99, 'two', null, 0, -1].forEach(v => {
      eq(load({ abomColumnMapping:v }).abomColumnMapping, 1, JSON.stringify(v) + ':');
    });
    eq(load({ abomColumnMapping:2 }).abomColumnMapping, 2, 'but 2 is honoured:');
  });
  t('proc code behaviour and its name both restore', () => {
    const st = load({ procOverrides:{ XR:'remove' }, procProfileName:'Falcon' });
    eq([st.procOverrides, st.procProfileName], [{ XR:'remove' }, 'Falcon']);
    const base = load({});
    eq([base.procOverrides, base.procProfileName], [null, null], 'absent means baseline:');
  });
  t('a session with claims but no results does not throw', () => {
    eq(load({ adjudications:[{ id:'a1' }] }).adjudications.length, 1);
  });
});

// ── TIER 18 ────────────────────────────────────────────────────────────────
// v160 — two program-level conventions: which indenture levels are structural
// collectors, and whether the source file writes indenture as alpha or numeric.
// Both change what reconciles, so both must travel with the session and be
// named on the certificate.
suite('Tier 18 — indenture scope and normalisation', (t, eq) => {
  const E = sandbox({ PROC_CODE_EXCEPTIONS: {} }, ['engine']).E;
  const eb = (pn, nh, q, ind) => { const r = new Array(6).fill('');
    r[0] = ind == null ? 'C' : ind; r[1] = pn; r[3] = nh; r[4] = String(q); return r; };
  const ab = (pn, uo, q, wo) => [pn, uo, String(q), wo, 'CLOSED', ''];
  function run(ebom, mbom, abom, levels) {
    return E.runReconciliationCore({
      mode: 'ebom_mbom_abom', required: ['ebom', 'mbom', 'abom'], serializeMaps: false,
      collectorLevels: levels === undefined ? ['A', 'B'] : levels,
      primaryQtyMap: E.buildQtyMap(ebom, 1, 3, 4, true),
      mbomMap: E.buildQtyMap(mbom, 1, 3, 4),
      abomMap: E.buildAbomMap(abom, 0, 1, 2, 3, 4, 5), openAbomMap: {},
      mbomUsedOnMap: E.buildMbomUsedOnMap(mbom, 1, 3, 4),
      abomUsedOnMap: E.buildAbomUsedOnMap(abom, 0, 1, 2, 3, 4, 5), openAbomUsedOnMap: {},
      abomWoToUsedOns: {}, ebomFlex: {}, ebomRef: {}, removalScope: {}, ptTypeMap: {},
      ebomLineNoMap: {}, ebomQtyTextMap: {},
      indentureInfo: E.buildEbomIndentureMap(ebom, 0, 1, 3),
      chpTrace: {}, chpPnTrace: {}, ncrByDiscPn: {}, ncrByOrigWo: {}, wo5Map: {} });
  }
  const of = (res, key) => (res.find(r => r.key === key) || {}).overall;

  console.log('\n== Numeric indenture is read as alpha ==');
  t('1 through 26 map to A through Z', () => {
    eq([1,2,3,26].map(n => E.normIndenture(n)), ['A','B','C','Z']);
    eq(E.normIndenture('2'), 'B', 'strings too:');
    eq(E.normIndenture(' 2 '), 'B', 'and padded values:');
  });
  t('alpha values pass through untouched', () => {
    eq(['A','b','C'].map(v => E.normIndenture(v)), ['A','B','C']);
  });
  t('values outside 1-26 are left alone rather than remapped', () => {
    // 0 and 27 have no alpha equivalent. Silently turning 0 into '@' would be
    // worse than leaving a value the program can still recognise.
    eq(['0','27','99'].map(v => E.normIndenture(v)), ['0','27','99']);
  });
  t('blank and junk values do not become a level', () => {
    eq([null, undefined, '', '  '].map(v => E.normIndenture(v)), ['','','','']);
    eq(E.normIndenture('AA'), 'AA', 'multi-letter levels are a program\'s own:');
  });
  t('a numeric EBOM reconciles identically to the same alpha EBOM', () => {
    // The whole point: one rule, either convention.
    const alpha = run([eb('TOP','',1,'A'), eb('P1','TOP',2,'C')],
                      [eb('P1','TOP',2)], [ab('P1','TOP',2,'W1')]);
    const numeric = run([eb('TOP','',1,'1'), eb('P1','TOP',2,'3')],
                        [eb('P1','TOP',2)], [ab('P1','TOP',2,'W1')]);
    eq(of(numeric, 'TOP||'), of(alpha, 'TOP||'), 'the apex row:');
    eq(of(numeric, 'P1||TOP'), of(alpha, 'P1||TOP'), 'the line item:');
    eq(of(numeric, 'TOP||'), 'collector', 'and level 1 IS a collector:');
  });

  console.log('\n== The collector rule is a setting, not a constant ==');
  t('the default still excludes A and B', () => {
    const r = run([eb('TOP','',1,'A'), eb('MID','TOP',1,'B'), eb('P1','MID',2,'C')],
                  [eb('P1','MID',2)], [ab('P1','MID',2,'W1')]);
    eq([of(r,'TOP||'), of(r,'MID||TOP')], ['collector', 'collector']);
    eq(of(r,'P1||MID'), 'ok', 'and C still reconciles:');
  });
  t('an empty list makes every level reconcile', () => {
    const r = run([eb('TOP','',1,'A'), eb('P1','TOP',2,'C')],
                  [eb('P1','TOP',2)], [ab('P1','TOP',2,'W1')], []);
    if (of(r,'TOP||') === 'collector')
      throw new Error('level A should reconcile when no level is a collector');
    // It reads as pn_as_usedon: once in scope, the apex IS found — as the
    // used-on parent of the row beneath it. That is the engine judging it on
    // its own evidence, which is exactly what removing the exclusion means.
    eq(of(r,'TOP||'), 'pn_as_usedon', 'the apex is now judged on its own evidence:');
  });
  t('a program can exclude A only, leaving B as real parts', () => {
    // The case a boolean could not express, and the reason this is a list.
    const r = run([eb('TOP','',1,'A'), eb('MID','TOP',1,'B'), eb('P1','MID',2,'C')],
                  [eb('MID','TOP',1), eb('P1','MID',2)],
                  [ab('MID','TOP',1,'W1'), ab('P1','MID',2,'W1')], ['A']);
    eq(of(r,'TOP||'), 'collector', 'A is still structural:');
    if (of(r,'MID||TOP') === 'collector')
      throw new Error('B must reconcile when only A is excluded');
    eq(of(r,'MID||TOP'), 'pn_as_usedon', 'B is now reconciled on its own evidence:');
  });
  t('a level can be excluded that the default never touched', () => {
    const r = run([eb('P1','TOP',2,'C')], [eb('P1','TOP',2)], [ab('P1','TOP',2,'W1')], ['C']);
    eq(of(r,'P1||TOP'), 'collector');
  });
  t('the setting works on a numeric EBOM too', () => {
    const r = run([eb('TOP','',1,'1'), eb('P1','TOP',2,'3')],
                  [eb('P1','TOP',2)], [ab('P1','TOP',2,'W1')], ['C']);
    if (of(r,'TOP||') === 'collector')
      throw new Error('level 1 should reconcile when only C is excluded');
    eq(of(r,'P1||TOP'), 'collector', 'level 3 = C is excluded:');
  });

  console.log('\n== It travels with the session and the certificate ==');
  t('every engine call site passes the setting', () => {
    // Worker AND synchronous fallback. If only one carried it, a worker failure
    // would silently reconcile a different set of rows.
    const calls = [...SRC.matchAll(/runReconciliationCore\(\{/g)];
    eq(calls.length, 2, 'engine call sites:');
    calls.forEach(m => {
      const seg = SRC.slice(m.index, m.index + 900);
      if (seg.indexOf('collectorLevels') < 0)
        throw new Error('an engine call site does not pass collectorLevels');
    });
  });
  t('the worker is sent the setting, and reads it', () => {
    const post = SRC.slice(at('worker.postMessage({'), at('worker.postMessage({') + 900);
    if (post.indexOf('collectorLevels') < 0)
      throw new Error('postMessage does not carry collectorLevels');
    if (!/var collectorLevels = d\.collectorLevels/.test(SRC))
      throw new Error('the worker does not read it from the message');
  });
  t('the session writes it and reads it back', () => {
    const exp = SRC.slice(at('const head = {'), at('downloadFile', at('const head = {')));
    if (exp.indexOf('collectorLevels') < 0)
      throw new Error('the session export omits collectorLevels');
    const imp = grabFn('importSessionJson');
    if (!/state\.collectorLevels\s*=\s*Array\.isArray\(payload\.collectorLevels\)/.test(imp))
      throw new Error('the session import does not restore collectorLevels');
    if (imp.indexOf("['A', 'B']") < 0)
      throw new Error('a session without the field must fall back to A/B, not to an empty list');
  });
  t('the certificate names the scope', () => {
    if (!/indentureScope:\s*_collectorScopeLabel\(\)/.test(SRC))
      throw new Error('the certificate does not record the indenture scope');
    const rows = SRC.match(/\['EBOM Indenture Scope', c\.indentureScope/g) || [];
    if (rows.length < 2)
      throw new Error('the scope must appear on both the on-screen and exported certificate');
  });
  t('the panel refuses to change a frozen report', () => {
    ['setCollectorLevel', 'resetCollectorLevels'].forEach(fn => {
      const body = SRC.slice(at('function ' + fn), SRC.indexOf('\n}', at('function ' + fn)));
      if (body.indexOf('state.isLocked') < 0)
        throw new Error(fn + ' can change the scope while the report is frozen');
    });
  });
  t('changing the scope marks existing results stale', () => {
    const body = SRC.slice(at('function setCollectorLevel'),
                           SRC.indexOf('\n}', at('function setCollectorLevel')));
    if (body.indexOf('_procDirtySinceRun') < 0)
      throw new Error('results computed under the old rule must be marked stale');
  });
});

// ── TIER 19 ────────────────────────────────────────────────────────────────
// v162 — importing Manufacturing Engineering's adjudications. Their COTS export
// is keyed on part number only: no next higher, no quantity, no leg. All three
// are inferred at import, so every inference needs a test — an adjudication
// landing on the wrong position changes the reconciliation numbers.
suite('Tier 19 — ME adjudication import', (t, eq) => {
  const IMP = sandbox({}, ['adjimport']).IMP;
  const C = IMP.COL.adj;
  const R = (pn, nh, ms, as, eq_) => ({ key: pn + '||' + nh, pn, nh, eq: eq_ || 4,
    ms, as, msUsedOn: 'n/a', asUsedOn: 'n/a',
    overall: (ms === 'missing' || as === 'missing') ? 'missing' : (ms !== 'ok' ? ms : as) });
  // a source row in the canonical layout
  const src = o => { const r = new Array(20).fill('');
    r[C.pn] = o.pn || ''; r[C.claimNo] = o.claimNo || ''; r[C.claimStatus] = o.status || '';
    r[C.createDate] = o.date || ''; r[C.lastName] = o.last || ''; r[C.firstName] = o.first || '';
    r[C.description] = o.desc || ''; r[C.narrative] = o.narr || ''; return r; };

  console.log('\n== Resolving a bare part number to a position ==');
  t('a part at one failing position resolves automatically', () => {
    eq(IMP.resolveImportedAdjRow('P1', [R('P1','TOP','missing','ok')]).verdict, 'auto');
  });
  t('a part at several positions where only ONE fails still resolves automatically', () => {
    // The reason the picker stays small: a position that already reconciles is
    // never a candidate for adjudication.
    const v = IMP.resolveImportedAdjRow('P2',
      [R('P2','TOP','ok','ok'), R('P2','OTHER','missing','ok')]);
    eq(v.verdict, 'auto');
    eq(v.rows[0].key, 'P2||OTHER');
  });
  t('a part at several FAILING positions needs a human', () => {
    const v = IMP.resolveImportedAdjRow('P3',
      [R('P3','A','missing','ok'), R('P3','B','qty_mismatch','ok')]);
    eq([v.verdict, v.rows.length], ['picker', 2]);
  });
  t('a part that already reconciles everywhere is reported, not dropped', () => {
    const v = IMP.resolveImportedAdjRow('P4', [R('P4','A','ok','ok'), R('P4','B','ok','ok')]);
    eq(v.verdict, 'none');
    if (!v.reason) throw new Error('a no-action row must carry a reason');
  });
  t('a part not in this EBOM is rejected with a reason', () => {
    const v = IMP.resolveImportedAdjRow('P9', [R('P1','TOP','missing','ok')]);
    eq(v.verdict, 'reject');
  });
  t('rows reconciled by pass 2 or pass 3 are not adjudication candidates', () => {
    ['pn_as_usedon', 'covered', 'covered_adjudicated', 'flex_ok'].forEach(st => {
      eq(IMP.resolveImportedAdjRow('P5', [R('P5','A', st, 'ok')]).verdict, 'none', st + ':');
    });
  });

  console.log('\n== Claims are built only for legs that actually fail ==');
  t('a healthy leg produces no claim, so ME is not credited with it', () => {
    const c = IMP.buildImportedClaims({ claimNo:'AC-1', lastName:'Rodriguez', firstName:'J' },
                                      R('P1','TOP','missing','ok'));
    eq(c.length, 1);
    eq(c[0].leg, 'mbom');
  });
  t('both legs failing produces two claims', () => {
    eq(IMP.buildImportedClaims({ claimNo:'AC-1' }, R('P1','TOP','missing','missing')).length, 2);
  });
  t('a row needing nothing produces nothing', () => {
    eq(IMP.buildImportedClaims({ claimNo:'AC-1' }, R('P1','TOP','ok','ok')).length, 0);
  });
  t('the quantity always makes the line whole', () => {
    const c = IMP.buildImportedClaims({ claimNo:'AC-1' }, R('P1','TOP','missing','ok', 7));
    eq(c[0].claimedQty, 7, 'claimed qty must be the EBOM qty:');
  });
  t('the reason is derived from the row status, not from their spreadsheet', () => {
    eq(IMP.buildImportedClaims({claimNo:'A'}, R('P1','TOP','missing','ok'))[0].reason, 'mbom_missing');
    eq(IMP.buildImportedClaims({claimNo:'A'}, R('P1','TOP','qty_mismatch','ok'))[0].reason,
       'qty_mismatch_mbom');
    eq(IMP.buildImportedClaims({claimNo:'A'}, R('P1','TOP','ok','missing'))[0].reason, 'abom_missing');
  });
  t('imported claims arrive PENDING and carry their provenance', () => {
    const c = IMP.buildImportedClaims({ claimNo:'AC-1', lastName:'Rodriguez', firstName:'J',
      narrative:'Built per MPP.', date:'2026-08-01' }, R('P1','TOP','missing','ok'))[0];
    eq(c.applied, false, 'must not self-apply:');
    eq(c.createdFrom, 'external_import');
    eq(c.sme, 'Rodriguez, J');
    eq(c.extClaimNo, 'AC-1', 'the external claim number is retained:');
  });
  t('a row with no SME name is marked unattributed rather than blank', () => {
    eq(IMP.buildImportedClaims({claimNo:'A'}, R('P1','TOP','missing','ok'))[0].sme,
       'ME (unattributed)');
  });

  console.log('\n== The narrative scanner finds known values in prose ==');
  const NARR = 'Reviewed the package on 14 AUG. Confirmed it hangs under next higher ' +
               '88421-7 on this tail, not 88421-9 as originally routed. Work on DWO 4471102.';
  t('an identifier buried mid-sentence is found', () => {
    const h = IMP.scanNarrative(NARR, ['88421-7']);
    eq(h.length, 1);
    if (h[0].sentence.indexOf('hangs under') < 0)
      throw new Error('the containing sentence must be captured for the reader');
  });
  t('a longer identifier containing the candidate does NOT match', () => {
    eq(IMP.scanNarrative('see reference 588421-70 instead', ['88421-7']).length, 0);
    eq(IMP.scanNarrative('88421-70 applies', ['88421-7']).length, 0);
    eq(IMP.scanNarrative('88421-7A applies', ['88421-7']).length, 0);
  });
  t('punctuation and brackets are boundaries, but hyphens are not', () => {
    ['ends here 88421-7.', '(88421-7)', 'is 88421-7, yes'].forEach(txt =>
      eq(IMP.scanNarrative(txt, ['88421-7']).length, 1, JSON.stringify(txt) + ':'));
  });
  t('a run-together identifier does not match', () => {
    eq(IMP.scanNarrative('DWO4471102 done', ['4471102']).length, 0);
    eq(IMP.scanNarrative('DWO 4471102 done', ['4471102']).length, 1);
  });
  t('very short candidates are never searched for', () => {
    // Searching prose for 'A' or 'B' would match constantly.
    eq(IMP.scanNarrative('the A position applies', ['A']).length, 0);
  });

  console.log('\n== Suggest only when the prose is unambiguous ==');
  t('one candidate mentioned is suggested', () => {
    const plan = IMP.planAdjImport(
      [src({ pn:'P3', claimNo:'AC-3', narr:'It hangs under 88421-7 on this tail.' })],
      [R('P3','88421-7','missing','ok'), R('P3','77310-2','missing','ok')]);
    eq(plan.picker.length, 1);
    eq(plan.picker[0].suggestedKey, 'P3||88421-7');
  });
  t('several candidates mentioned suggests NOTHING', () => {
    // The narrative here explicitly rules one out in words. A matcher cannot
    // read negation, so suggesting either would be a coin flip dressed as an
    // answer. The sentences are shown instead.
    const plan = IMP.planAdjImport(
      [src({ pn:'P3', claimNo:'AC-3', narr:NARR })],
      [R('P3','88421-7','missing','ok'), R('P3','88421-9','missing','ok')]);
    eq(plan.picker[0].suggestedKey, null, 'must not guess:');
    if (plan.picker[0].mentions.length < 2)
      throw new Error('both mentions must still be shown to the reader');
  });
  t('an unresolved picker entry contributes no claims', () => {
    const plan = IMP.planAdjImport(
      [src({ pn:'P3', claimNo:'AC-3', narr:'no identifiers here' })],
      [R('P3','A1234','missing','ok'), R('P3','B5678','missing','ok')]);
    eq(IMP.finalizeAdjImport(plan).length, 0, 'nothing may be applied unchosen:');
    plan.picker[0].chosenKey = 'P3||B5678';
    eq(IMP.finalizeAdjImport(plan).length, 1, 'and one claim once chosen:');
  });

  console.log('\n== The plan sorts every row into a visible bucket ==');
  t('auto, picker, no-action and rejected are all accounted for', () => {
    const results = [R('P1','TOP','missing','ok'),
                     R('P3','A1234','missing','ok'), R('P3','B5678','missing','ok'),
                     R('P4','A','ok','ok')];
    const plan = IMP.planAdjImport([
      src({ pn:'P1', claimNo:'AC-1' }), src({ pn:'P3', claimNo:'AC-3' }),
      src({ pn:'P4', claimNo:'AC-4' }), src({ pn:'P9', claimNo:'AC-9' })], results);
    eq(plan.sourceRows, 4);
    eq([plan.claims.length, plan.picker.length, plan.noAction.length, plan.rejected.length],
       [1, 1, 1, 1]);
  });
  t('blank lines are ignored without inflating the count', () => {
    eq(IMP.planAdjImport([new Array(20).fill(''), src({ pn:'P1', claimNo:'AC-1' })],
                         [R('P1','TOP','missing','ok')]).sourceRows, 1);
  });

  console.log('\n== CM\u2019s CI-to-NCR claims are out of scope for an ME batch ==');
  t('a CI-to-NCR trace is never treated as an imported claim', () => {
    // Belt and braces: an imported batch could only carry createdFrom
    // 'external_import', but deleting another team's work would be silent and
    // serious, so the claim TYPE is checked as well as its provenance.
    eq(IMP.isImportedClaim({ id:'a', type:'ncr_ci_trace', createdFrom:'ncr_ci_helper' }), false);
    eq(IMP.isImportedClaim({ id:'x', type:'ncr_ci_trace', createdFrom:'external_import' }), false,
       'type must veto provenance:');
    eq(IMP.isImportedClaim({ id:'x', type:'ebom_ncr_trace', createdFrom:'external_import' }), false);
    eq(IMP.isImportedClaim({ id:'y', type:'row', createdFrom:'external_import' }), true);
  });
  t('a re-import cannot withdraw a CM trace', () => {
    const cm = { id:'adj_ci_9', type:'ncr_ci_trace', createdFrom:'ncr_ci_helper',
                 rowKey:'P1||TOP', leg:'abom', claimedQty:4, applied:true,
                 mode:'embodiment', ciKey:'CI-77||P1||TOP', reason:'ncr_ci_manual_trace' };
    const me = { id:'imp_1', type:'row', createdFrom:'external_import', rowKey:'P1||TOP',
                 leg:'mbom', claimedQty:4, applied:true, reason:'mbom_missing' };
    const rows = [{ key:'P1||TOP', pn:'P1', nh:'TOP', eq:4, ms:'missing', as:'missing',
                    msUsedOn:'n/a', asUsedOn:'n/a', overall:'missing' }];
    const after = IMP.replaceImportedClaims([cm, me], []);
    eq(after.map(c => c.id), ['adj_ci_9'], 'only the ME claim is withdrawn:');
    const r = IMP.computeEffectiveResults(rows, after)[0];
    eq(r.ms, 'missing', 'the ME claim is gone:');
    eq(r.as, 'direct_adjudicated', 'the CM trace still resolves the ABOM leg:');
  });
  t('the two organisations\u2019 work is reported separately', () => {
    const p = IMP.partitionClaims([
      { id:'a', type:'ncr_ci_trace', createdFrom:'ncr_ci_helper' },
      { id:'b', type:'row', createdFrom:'external_import' },
      { id:'c', type:'row', createdFrom:'qty_modal' }]);
    eq([p.imported.length, p.native.length, p.ciNcr.length], [1, 2, 1]);
  });

  console.log('\n== Staging has to drive the workbench, not just the array ==');
  t('every path that adds claims refreshes the workbench', () => {
    // v164 — the workbench is what applies claims, and it only re-reads
    // state.adjudications when told. stageAdjImport pushed claims and told
    // nobody, so Process Adjudications stayed greyed out and the staged claims
    // could not be applied at all. Every NATIVE claim path calls
    // _adjRefreshWorkbench; the import path must too.
    const paths = ['_adjSubmitClaim', '_adjSubmitNcrCiClaim', '_adjSubmitEbomNcrClaim',
                   'stageAdjImport'];
    const missing = paths.filter(fn => {
      let body;
      try { body = grabFn(fn).replace(/\/\/[^\n]*/g, ''); } catch (e) { return true; }
      return !/_adjRefreshWorkbench\s*\(/.test(body);
    });
    if (missing.length)
      throw new Error('claims can be added without refreshing the workbench: ' + missing.join(', '));
  });
  t('staging reveals the workbench even when the run produced no candidates', () => {
    // The section is hidden unless the reconciliation surfaced helper
    // candidates of its own. An import can be the only source of claims, so
    // staging must reveal it or the button is not merely disabled — it is
    // nowhere on the page.
    // Strip comments first: the body explains WHY it calls _adjShowWorkbench,
    // and matching that prose made this test pass against a build where the
    // call itself had been removed.
    const body = grabFn('stageAdjImport').replace(/\/\/[^\n]*/g, '');
    if (!/_adjShowWorkbench\s*\(/.test(body))
      throw new Error('staging does not reveal the workbench section');
  });
  t('the Process button enables on any pending claim, whatever its origin', () => {
    // The gate is origin-agnostic by design: pending count, not claim type.
    const wb = grabFn('_adjRefreshWorkbench');
    if (!/btnProc\.disabled = pending === 0/.test(wb))
      throw new Error('the Process gate is no longer a simple pending count');
    if (/createdFrom|external_import/.test(wb))
      throw new Error('the Process gate must not discriminate by claim origin');
  });

  console.log('\n== The review panel is built around the exceptions ==');
  t('every bucket is surfaced in the panel', () => {
    const ui = SRC.slice(at('function renderAdjImportPanel'), at('function _adjQueueHtml'));
    ['auto-resolved', 'need a decision', 'no action needed', 'not in this EBOM'].forEach(b => {
      if (ui.indexOf(b) < 0) throw new Error('the panel does not report: ' + b);
    });
  });
  t('the panel states that CM claims are untouched', () => {
    const ui = SRC.slice(at('function renderAdjImportPanel'), at('function _adjQueueHtml'));
    if (ui.indexOf('NCR trace claim') < 0)
      throw new Error('the panel must say CI-to-NCR traces survive the import');
  });
  t('staging refuses while the report is frozen, and uses the scoped replace', () => {
    const body = SRC.slice(at('function stageAdjImport'), at('function discardAdjImport'));
    if (body.indexOf('state.isLocked') < 0) throw new Error('staging can alter a frozen report');
    if (body.indexOf('replaceImportedClaims') < 0)
      throw new Error('staging must go through the scoped replace');
  });
  t('an ME file loaded before a run is refused with a reason', () => {
    const h = SRC.slice(at('function handleFile'), at('function handleFile') + 12000);
    const i = h.indexOf("if (type === 'adj')");
    if (i < 0) throw new Error('the adj hook is gone from handleFile');
    const seg = h.slice(i, i + 800);
    if (seg.indexOf('state.results') < 0 || seg.indexOf('showError') < 0)
      throw new Error('loading before a run must be refused, not silently planned');
  });
  t('the picker shows the matched sentence, full narrative on request', () => {
    const q = SRC.slice(at('function _adjQueueHtml'), at('function setAdjFilter'));
    if (q.indexOf('m.sentence') < 0) throw new Error('the matched sentence is not shown');
    if (q.indexOf('full narrative') < 0)
      throw new Error('the full narrative must stay available behind a disclosure');
    if (q.indexOf('adj-sug-tag') < 0) throw new Error('the suggestion is not marked');
  });

  console.log('\n== It has to survive a real file ==');
  t('a 3,000-row import against an 80k-line EBOM stays responsive', () => {
    // A real ME export runs to ~3,000 rows. Resolving each by scanning the full
    // result set is O(rows x results) — measured at 3.2s on an 80k EBOM, which
    // freezes the tab. planAdjImport indexes by part number first.
    const results = [];
    for (let i = 0; i < 80000; i++) {
      const fail = i % 12 === 0;
      results.push({ key: 'PN' + i + '||NH' + (i % 900), pn: 'PN' + i, nh: 'NH' + (i % 900),
        eq: 2, ms: fail ? 'missing' : 'ok', as: 'ok', msUsedOn: 'n/a', asUsedOn: 'n/a',
        overall: fail ? 'missing' : 'ok' });
    }
    const rows = [];
    for (let i = 0; i < 3000; i++) {
      const r = new Array(20).fill('');
      r[C.pn] = 'PN' + ((i * 12) % 80000); r[C.claimNo] = 'AC-' + i;
      r[C.narrative] = 'Reviewed the planning package. Installed on DWO ' + (4400000 + i) + '.';
      rows.push(r);
    }
    const t0 = Date.now();
    const plan = IMP.planAdjImport(rows, results);
    const ms = Date.now() - t0;
    eq(plan.claims.length, 3000, 'every row resolved:');
    if (ms > 1500) throw new Error('planAdjImport took ' + ms + 'ms — the tab would freeze');
  });
  t('the planner indexes by part number rather than rescanning', () => {
    // Structural, so the guarantee survives even on a fast machine where the
    // timing test above would pass anyway.
    if (!/function indexResultsByPn/.test(SRC))
      throw new Error('the part-number index is gone');
    const body = SRC.slice(at('function planAdjImport'), at('function finalizeAdjImport'));
    if (body.indexOf('indexResultsByPn(results)') < 0)
      throw new Error('planAdjImport no longer builds the index');
    // Building the index is not enough — it must be PASSED to the resolver.
    // The first version of this test checked only that it was built, and passed
    // while the planner rescanned per row and took 3s.
    if (!/resolveImportedAdjRow\([^)]*pnIndex\)/.test(body))
      throw new Error('the index is built but not passed to resolveImportedAdjRow');
  });

  console.log('\n== Re-import replaces the batch, never the native work ==');
  t('a second import drops the previous batch only', () => {
    const native = { id:'adj_ci_9', createdFrom:'ncr_ci_helper', rowKey:'P2||TOP', leg:'abom' };
    const first  = [{ id:'imp_1', createdFrom:'external_import' },
                    { id:'imp_2', createdFrom:'external_import' }, native];
    const out = IMP.replaceImportedClaims(first, [{ id:'imp_3', createdFrom:'external_import' }]);
    eq(out.map(c => c.id), ['adj_ci_9', 'imp_3']);
  });
  t('a withdrawn claim reverts its row', () => {
    const rows = [R('P1','TOP','missing','ok')];
    const c = IMP.buildImportedClaims({ claimNo:'AC-1' }, rows[0])
      .map(x => Object.assign({}, x, { applied: true }));
    eq(IMP.computeEffectiveResults(rows, c)[0].overall, 'direct_adjudicated');
    eq(IMP.computeEffectiveResults(rows, IMP.replaceImportedClaims(c, []))[0].overall, 'missing',
       'dropping the claim must restore the raw status:');
  });
  t('every native provenance value survives a replace', () => {
    const natives = ['missing_mbom','qty_modal','near_match','nh_mismatch_helper',
                     'ncr_ci_helper','ncr_tab','ebom_ncr_candidates_helper']
      .map((cf, i) => ({ id: 'n' + i, createdFrom: cf }));
    const out = IMP.replaceImportedClaims(
      natives.concat([{ id:'imp_1', createdFrom:'external_import' }]), []);
    eq(out.length, natives.length);
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
  const css = STYLE_BLOCKS.map(b => b.css).join('\n');   // ALL blocks, not just the first

  console.log('\n== The slice is CSS, not the vendored spreadsheet library ==');
  t('the naive "<style" search still lands inside vendored JavaScript', () => {
    // Documents the trap this suite fell into for its whole existence. If
    // SheetJS is ever removed and this starts failing, the guarded regex in
    // STYLE_BLOCKS can be simplified — but not before.
    const naive = SRC.indexOf('<style');
    if (naive === STYLE_BLOCKS[0].at)
      throw new Error('naive search is now safe — re-check whether the guard is still needed');
    if (!/^<style:/.test(SRC.slice(naive, naive + 8)))
      throw new Error('naive search hit something unexpected: ' + JSON.stringify(SRC.substr(naive, 40)));
  });
  t('every extracted block is a stylesheet, not markup', () => {
    STYLE_BLOCKS.forEach((b, i) => {
      if (b.css.includes('<style') || b.css.includes('<script'))
        throw new Error('block ' + (i + 1) + ' contains markup — the slice is wrong');
      if (!b.css.includes('{'))
        throw new Error('block ' + (i + 1) + ' has no rules at all');
    });
  });
  t('both style blocks are found and neither is trivial', () => {
    eq(STYLE_BLOCKS.length, 2, 'block count:');
    STYLE_BLOCKS.forEach((b, i) => { if (b.css.length < 500)
      throw new Error('block ' + (i + 1) + ' is only ' + b.css.length + ' chars'); });
  });

  console.log('\n== Brace balance: an assertion, not a baseline ==');
  t('every style block is brace-balanced', () => {
    // Replaces the old "delta must equal -2". That -2 was never a real
    // imbalance; it was minified JS being counted as CSS. Both real blocks
    // balance exactly, so the correct expectation is zero.
    STYLE_BLOCKS.forEach((b, i) => {
      const r = scanCss(b.css);
      if (r.balanced) return;
      const fileLine = l => l + b.line - 1;
      const parts = [];
      if (r.unmatchedOpen.length)  parts.push('unclosed rule opened at file line(s) ' +
        r.unmatchedOpen.map(fileLine).join(', '));
      if (r.unmatchedClose.length) parts.push('stray closing brace at file line(s) ' +
        r.unmatchedClose.map(fileLine).join(', '));
      throw new Error('block ' + (i + 1) + ': ' + parts.join('; '));
    });
  });
  t('the scanner ignores braces inside quoted strings', () => {
    eq(scanCss('a{content:"{"}').balanced, true, 'quoted open:');
    eq(scanCss("a{content:'}'}").balanced, true, 'quoted close:');
  });
  t('the scanner ignores braces inside comments', () => {
    eq(scanCss('a{color:red} /* } stray in a comment { */').balanced, true);
  });
  t('a stray closing brace is caught and located', () => {
    const r = scanCss('a{color:red}\nb{color:blue}\n}\n');
    eq([r.balanced, r.unmatchedClose], [false, [3]], 'line of the stray }:');
  });
  t('an unclosed rule is caught and located', () => {
    const r = scanCss('a{color:red}\n\nb{color:blue;\n');
    eq([r.balanced, r.unmatchedOpen], [false, [3]], 'line of the unclosed {:');
  });
  t('one stray open and one stray close do not cancel out', () => {
    // A net-delta counter reports 0 here and passes. This is why the check
    // tracks positions rather than a total.
    const r = scanCss('}\na{color:red\n');
    eq(r.balanced, false, 'a delta-based check would have said 0:');
  });

  console.log('\n== Variables and keyframes, across every block ==');
  t('no orphaned keyframes remain', () => {
    const defs = [...new Set([...css.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]))];
    const orphans = defs.filter(k => !new RegExp('animation:[^;]*\\b' + k + '\\b').test(SRC));
    if (orphans.length) throw new Error('orphans: ' + orphans.join(', '));
  });
  t('--text-dim is fully retired', () => {
    if (SRC.includes('var(--text-dim)')) throw new Error('references remain');
    if (/^\s*--text-dim:/m.test(SRC)) throw new Error('definition remains');
  });
  t('no CSS var is referenced without a definition', () => {
    const defined = new Set([...css.matchAll(/^\s*(--[\w-]+):/gm)].map(m => m[1]));
    const used = new Set([...SRC.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1]));
    const missing = [...used].filter(v => !defined.has(v));
    if (missing.length) throw new Error('undefined vars used: ' + missing.join(', '));
  });

  console.log('\n== The import zone lives where the workflow needs it ==');
  t('the ME ADJ zone sits inside the Adjudication Workbench, not the upload grid', () => {
    // v166 — an ME export is not reconciliation INPUT: it is a batch of claims
    // about a run that must already exist. In the upload grid it read as a
    // tenth BOM source and the ordering had to be enforced with an error.
    // Inside the workbench the ordering enforces itself.
    const secA = at('id="adjudication-workbench-section"');
    const secB = at('<!-- /adjudication-workbench-section -->');
    const zone = at('id="zone-adj"');
    if (zone < secA || zone > secB)
      throw new Error('the ME ADJ zone is outside the Adjudication Workbench section');
    const panel = at('id="adj-import-panel"');
    if (panel < secA || panel > secB)
      throw new Error('the import review panel is outside the workbench section');
  });
  t('it sits between the Candidates Helpers and the Claim Ledger', () => {
    const helpers = at('id="kpi-adjudication-zone"');
    const imp     = at('id="adj-import-zone-wrap"');
    const ledger  = at('id="adj-workbench"');
    if (!(helpers < imp && imp < ledger))
      throw new Error('the import block is not between discovery and execution');
  });
  t('the upload grid no longer carries a tenth zone', () => {
    const grid = SRC.slice(at('id="zone-ebom"'), at('id="adjudication-workbench-section"'));
    if (grid.indexOf('id="zone-adj"') >= 0)
      throw new Error('the ME ADJ zone is still in the pre-run upload grid');
  });
  t('the workbench section appears after ANY completed run', () => {
    // A run with no helper candidates is exactly when an SME may still want to
    // import ME's decisions. Gating on "something to adjudicate" would hide the
    // upload zone precisely then.
    const fn = SRC.slice(at('const unifiedSec = document.getElementById'),
                         at('const unifiedSec = document.getElementById') + 1400);
    if (!/hasRun/.test(fn))
      throw new Error('section visibility still ignores whether a run exists');
    if (!/state\.results && state\.results\.length/.test(fn))
      throw new Error('hasRun is not derived from the results');
  });

  console.log('\n== The three workbench blocks read as three blocks ==');
  t('Imported Claims is enclosed like the Claim Ledger', () => {
    // v167 — without a border it read as a continuation of the Candidates
    // Helpers above, which is a different activity: helpers find candidates in
    // THIS run; imports bring in decisions taken elsewhere.
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    const m = css.match(/#adj-import-zone-wrap\s*\{([^}]*)\}/);
    if (!m) throw new Error('the import block has no enclosure rule');
    ['border', 'padding', 'border-radius'].forEach(prop => {
      if (m[1].indexOf(prop) < 0) throw new Error('the enclosure is missing ' + prop);
    });
  });
  t('each block carries exactly ONE subhead', () => {
    // v169 — the Candidates Helpers zone already had a subhead INSIDE it, and
    // v167 added a second outside. Both rendered, giving the reader
    // "Candidates Helpers Candidates Helpers". Counting, not just presence.
    const sec = SRC.slice(at('id="adjudication-workbench-section"'),
                          at('<!-- /adjudication-workbench-section -->'));
    const found = [...sec.matchAll(/adj-section-subhead">([^<]+)</g)].map(m => m[1].trim());
    ['Candidates Helpers', 'Imported Claims'].forEach(h => {
      const n = found.filter(x => x === h).length;
      if (n === 0) throw new Error('no subhead for ' + h);
      if (n > 1) throw new Error(h + ' has ' + n + ' subheads — it will render twice');
    });
  });

  console.log('\n== Staging says what it did, and is repeatable ==');
  t('re-staging preserves claims that were already applied', () => {
    // Staging rebuilds the whole imported batch and replaceImportedClaims swaps
    // the old one out. Without carrying the applied flag forward by id, a
    // second stage would silently REVERT everything already applied.
    const body = grabFn('stageAdjImport').replace(/\/\/[^\n]*/g, '');
    if (body.indexOf('wasApplied') < 0)
      throw new Error('re-staging does not preserve applied state');
    if (!/c\.applied\s*=\s*true/.test(body))
      throw new Error('the applied flag is never carried forward');
    if (!/isImportedClaim\(c\)\s*&&\s*c\.applied/.test(body))
      throw new Error('applied state must be carried for IMPORTED claims only');
  });
  t('the import panel refreshes whenever claim state changes', () => {
    // v170 — the panel reports how many of ITS claims are applied vs pending,
    // so it goes stale the moment anything applies, reverts or removes a claim.
    // It said "none applied yet" for ever, because Process never told it.
    // Hung off _adjRefreshWorkbench, which EVERY state-changing path already
    // calls, so no path can forget it — patching each caller would have left
    // the next one to be written broken again.
    const wb = grabFn('_adjRefreshWorkbench').replace(/\/\/[^\n]*/g, '');
    if (!/renderAdjImportPanel\s*\(/.test(wb))
      throw new Error('the import panel is not refreshed from the shared refresh point');
    // and every state-changing path must go through that point
    ['_adjProcessClaims', '_adjRevertClaims', '_adjConfirmRemove', 'stageAdjImport'].forEach(fn => {
      const body = grabFn(fn).replace(/\/\/[^\n]*/g, '');
      if (!/_adjRefreshWorkbench\s*\(/.test(body))
        throw new Error(fn + ' changes claim state without refreshing');
    });
  });
  t('refreshing cannot recurse', () => {
    // renderAdjImportPanel must not call back into _adjRefreshWorkbench.
    const panel = SRC.slice(at('function renderAdjImportPanel'), at('function _adjQueueHtml'));
    if (/_adjRefreshWorkbench\s*\(/.test(panel))
      throw new Error('the panel calls the refresher that calls it');
  });
  t('the panel reports what is already in the ledger', () => {
    const ui = SRC.slice(at('function renderAdjImportPanel'), at('function _adjQueueHtml'));
    if (ui.indexOf('adj-staged-state') < 0)
      throw new Error('the panel gives no confirmation that staging happened');
    ['already applied', 'pending'].forEach(bit => {
      if (ui.indexOf(bit) < 0) throw new Error('the confirmation omits: ' + bit);
    });
  });
  t('the button changes once a batch is staged', () => {
    const ui = SRC.slice(at('function renderAdjImportPanel'), at('function _adjQueueHtml'));
    if (ui.indexOf('Re-stage') < 0)
      throw new Error('the action button never becomes a re-stage');
    if (!/newSinceStage/.test(ui))
      throw new Error('the button does not distinguish new decisions from none');
  });

  console.log('\n== The funnel legend matches the bars it describes ==');
  const FUNNEL = (() => {
    const a = at('<div id="funnel-info-overlay"');
    let d = 0, i = a;
    for (;;) {
      if (SRC.startsWith('<div', i)) d++;
      else if (SRC.startsWith('</div>', i)) { d--; if (!d) break; }
      i++;
      if (i > a + 40000) throw new Error('the funnel overlay never closes');
    }
    return SRC.slice(a, i + 6);
  })();
  const RESSEGS = (() => {
    const a = at('const resSegs = [');
    const seg = SRC.slice(a, at('].filter', a));
    const out = {};
    [...seg.matchAll(/color:\s*([^,]+),\s*w:[^,]+,\s*stage:[^,]+,\s*count:[^,]+,\s*lbl:\s*'([^']+)'/g)]
      .forEach(m => { out[m[2].trim()] = m[1].trim(); });
    return out;
  })();

  t('the legend draws no emoji swatches', () => {
    // v167 — #11. The legend used 🟥 🟧 🟪 🟨 ⬛ ▒, none of which were tied to the
    // colours the bars use. THREE of them stood for the same token (--warn),
    // teaching a distinction the chart does not draw.
    const emoji = FUNNEL.match(/[\u{1F7E0}-\u{1F7EB}\u2B1B\u2592]/gu);
    if (emoji) throw new Error('emoji swatches are back: ' + [...new Set(emoji)].join(' '));
    if (!/class="fn-sw"/.test(FUNNEL))
      throw new Error('the legend has no token-driven swatches');
  });
  t('every colour the residual bar uses appears in the legend', () => {
    const tokens = new Set(Object.values(RESSEGS)
      .map(v => v.replace(/^'|'$/g, ''))
      .map(v => v === 'C.missing' ? 'var(--danger)'
              : v === 'C.qty'     ? 'var(--warn)'
              : v === 'C.other'   ? 'var(--text-muted)' : v));
    const shown = new Set([...FUNNEL.matchAll(/class="fn-sw" style="background:([^"]+)"/g)].map(m => m[1]));
    const missing = [...tokens].filter(t2 => !shown.has(t2));
    if (missing.length)
      throw new Error('residual colours with no legend swatch: ' + missing.join(', '));
  });
  t('WO Not Closed is shown as the two colours it actually draws', () => {
    // The segment is SPLIT: teal for RFV-authorised open WOs, amber for bare.
    // One swatch cannot represent it.
    const m = FUNNEL.match(/(?:<span class="fn-sw"[^>]*><\/span>\s*){1,3}<strong>WO Not Closed<\/strong>/);
    if (!m) throw new Error('the WO Not Closed legend entry moved');
    const n = (m[0].match(/fn-sw/g) || []).length;
    if (n !== 2) throw new Error('WO Not Closed shows ' + n + ' swatch(es); the bar draws two colours');
    // v173 — the bare half moved from --warn to --wo-open. The token existed
    // and was named for exactly this, but the WO NOT CLOSED badge used --warn,
    // so open WO / proc removed / qty mismatch all drew one amber.
    ['var(--rfv)', 'var(--wo-open)'].forEach(t2 => {
      if (m[0].indexOf(t2) < 0) throw new Error('the split entry is missing ' + t2);
    });
  });
  t('reference bars are described as uncoloured, because they are', () => {
    // Every reference bar renders in one neutral fill: they are context, not
    // findings. Giving them category colours in the legend was the worst of the
    // errors — colour where the tool draws none.
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    const fill = css.match(/\.funnel-bar-fill-ref\s*\{[^}]*background:\s*([^;]+)/);
    if (!fill) throw new Error('the reference bar fill rule is gone');
    const neutral = fill[1].trim();
    ['Part Qty Mismatch', 'Part WO Not Closed'].forEach(lbl => {
      // Locate the legend paragraph by its label, then read the swatch that
      // immediately precedes it. A regex over the whole modal matched an
      // unrelated 'EBOM-MBOM Part Qty Mismatch' bullet instead.
      const at2 = FUNNEL.indexOf('<strong>' + lbl + '</strong>');
      if (at2 < 0) throw new Error('no legend entry for ' + lbl);
      const before = FUNNEL.slice(Math.max(0, at2 - 120), at2);
      const sw = before.match(/background:([^"]+)"><\/span>$/);
      if (!sw) throw new Error(lbl + ' has no swatch immediately before it');
      if (sw[1] !== neutral)
        throw new Error(lbl + ' is shown as ' + sw[1] + ' but reference bars render ' + neutral);
    });
    if (FUNNEL.indexOf('deliberately uncoloured') < 0)
      throw new Error('the legend does not say reference bars carry no category colour');
  });

  console.log('\n== The residual is measured, not just divided ==');
  (() => {
    const RES = SRC.slice(at('const resSegs = ['), at('funnel-residual-rows'));
    t('no residual row sets flex, which would override its width', () => {
      // THE defect. Each segment carried width:${s.w}% AND flex:${s.count}.
      // `flex:N` is shorthand for flex-grow:N flex-shrink:1 flex-basis:0%, and
      // that basis beats the width declaration outright. Every computed width
      // was dead code and the track always filled 100%, so a residual of 3 and
      // a residual of 3,000 drew an identical bar. Nothing in the suite noticed
      // because Tier 11 executes the CANVAS renderers; this one is HTML.
      if (/flex:\$\{/.test(RES))
        throw new Error('a residual row sets flex from a count — widths are dead again');
    });
    t('residual widths are on the same axis as the coverage ladder', () => {
      // Both must be a share of scopeN, or a residual row and a ladder bar of
      // equal length mean different things in the same panel.
      const decl = [...SRC.slice(at('const missPct'), at('const resSegs = ['))
        .matchAll(/const\s+\w+Pct\s*=\s*([^;]+);/g)].map(m => m[1].trim());
      if (!decl.length) throw new Error('the residual percentage block moved');
      const bad = decl.filter(d => !/^pct\(/.test(d));
      if (bad.length)
        throw new Error('residual widths not measured against scope: ' + bad.join(' | '));
    });
    t('every residual category is measured, including Other', () => {
      // `other` used to be a rounding remainder (pRes minus the rest), so its
      // label and its geometry could disagree. It is a real count; measure it.
      if (/othPct\s*=\s*Math\.max/.test(SRC))
        throw new Error('Other is back-filled from a remainder instead of counted');
    });
    t('each residual category renders its own labelled row', () => {
      ['funnel-res-row', 'funnel-res-label', 'funnel-res-track', 'funnel-res-fill']
        .forEach(c => { if (RES.indexOf(c) < 0)
          throw new Error('the residual row layout lost ' + c); });
      if (RES.indexOf('${s.lbl}') < 0)
        throw new Error('rows no longer carry their own label — back to a legend hunt');
    });
    t('the label column matches the ladder, so the tracks line up', () => {
      const css = STYLE_BLOCKS.map(b => b.css).join('\n');
      const w = r => (css.match(new RegExp('\\.' + r + '\\s*\\{[^}]*width:\\s*(\\d+)px')) || [])[1];
      const ladder = w('funnel-stage-label'), res = w('funnel-res-label');
      if (!ladder || !res) throw new Error('a label-column width rule is missing');
      eq(res, ladder, 'residual label width vs ladder label width:');
    });
  })();

  console.log('\n== The residual is rendered, not just described ==');
  (() => {
    // Tier 11's lesson applied to HTML. Reading the percentage block would
    // never have revealed this defect: the widths were computed correctly and
    // then discarded by a CSS shorthand three lines away. Only running it and
    // measuring the output catches that class of bug, so run it.
    const fnSrc = grabFrom(SRC, 'renderFunnelPanel', 'funnel panel');
    const ctx = sandbox({ _funnelActiveStage: null, _funnelCurveOn: false });
    vm.runInContext(fnSrc, ctx);
    const BASE = { total: 1200, scopeN: 1000, d1: 300, d2: 340, d3: 360, residual: 640,
      missing: 400, woopen: 180, qty: 60, flexmiss: 20, other: 10,
      res_woopen: 150, res_proc: 30, res_qty: 30, res_woopen_rfv: 50, res_woopen_bare: 100,
      newDirect: new Set(), newUsedOn: new Set(), newParent: new Set(),
      adjDirect: 0, adjParent: 0 };
    const SMALL = Object.assign({}, BASE, { d1: 900, d2: 960, d3: 990, residual: 10,
      missing: 6, woopen: 2, qty: 1, res_woopen: 2, res_woopen_rfv: 1, res_woopen_bare: 1,
      res_proc: 1, res_qty: 1, flexmiss: 1, other: 0 });
    const render = d => { ctx.__d = d;
      return vm.runInContext('renderFunnelPanel(__d, "abom", "ABOM", "sub")', ctx); };
    const widths = h => [...h.matchAll(/funnel-res-fill" style="width:(\d+)%/g)].map(m => +m[1]);
    const sum = a => a.reduce((x, y) => x + y, 0);

    t('the residual block draws to the size of the residual', () => {
      // The old track was display:flex with flex-grow per segment, so it filled
      // 100% of its width for ANY residual. 3 items and 3,000 items drew the
      // same bar. This is the assertion that would have failed then.
      const big = sum(widths(render(BASE)));
      const small = sum(widths(render(SMALL)));
      eq([big, small], [64, 1], 'total residual width at 640/1000 and 10/1000 scope:');
      if (big <= small) throw new Error('a larger residual does not draw larger');
    });
    t('a residual row and a ladder bar of equal length mean equal counts', () => {
      // The two live in one panel; if they are on different axes the panel
      // lies. Each residual width must be its count as a share of scope.
      const html = render(BASE);
      const rows = [...html.matchAll(
        /funnel-res-fill" style="width:(\d+)%[^>]*><\/div>\s*<div class="funnel-res-count">([\d,]+)</g)];
      if (rows.length < 5) throw new Error('only ' + rows.length + ' residual rows rendered');
      rows.forEach(m => {
        const w = +m[1], n = +m[2].replace(/,/g, '');
        const want = Math.round(n / BASE.scopeN * 100);
        if (w !== want)
          throw new Error(n + ' items drew ' + w + '% where scope share is ' + want + '%');
      });
    });
    t('no residual row is drawn to zero width', () => {
      // At a small residual every row rounds to 0%. A row the reader can click
      // must still be visible, which is what the fill min-width is for.
      const css = STYLE_BLOCKS.map(b => b.css).join('\n');
      const rule = css.match(/\.funnel-res-fill\s*\{[^}]*\}/);
      if (!rule || !/min-width:\s*[1-9]/.test(rule[0]))
        throw new Error('.funnel-res-fill has no min-width; small categories vanish');
      if (!widths(render(SMALL)).length)
        throw new Error('a 10-item residual rendered no rows at all');
    });
  })();

  console.log('\n== One finding, one colour ==');
  t('WO NOT CLOSED wears the token named for it', () => {
    // --wo-open existed and was used for open-WO numbers in three table cells,
    // but the badge for the concept used --warn — the same token as PROC
    // REMOVED and QTY MISMATCH. Three unrelated findings, one amber, on the
    // badges and therefore in the funnel that inherits them.
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    const rule = css.match(/\.badge-woopen\s*\{[^}]*\}/);
    if (!rule) throw new Error('.badge-woopen is gone');
    if (rule[0].indexOf('var(--wo-open)') < 0)
      throw new Error('WO NOT CLOSED is not using --wo-open: ' + rule[0]);
    if (/var\(--warn\)/.test(rule[0]))
      throw new Error('WO NOT CLOSED still carries the shared amber');
  });
  t('the funnel and the badge agree on the bare open-WO colour', () => {
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    const badge = (css.match(/\.badge-woopen\s*\{[^}]*color:\s*var\((--[\w-]+)\)/) || [])[1];
    const bar = (RESSEGS['WO Not Closed (bare)'] || '').replace(/^'|'$/g, '');
    if (!badge) throw new Error('cannot read the badge colour');
    eq(bar, 'var(' + badge + ')', 'residual bar vs badge:');
  });

  console.log('\n== Long notes stay inside the column-mapping modal ==');
  t('the mapping table is fixed-layout so notes wrap rather than widen', () => {
    // v167 — #10. With an auto layout a long note widened its own column and
    // pushed the table past the panel border. Two of the three columns have
    // fixed widths, so table-fixed gives Notes the remainder and wraps it.
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    const tbl = css.match(/\.col-map-panel table\s*\{([^}]*)\}/);
    if (!tbl) throw new Error('the mapping table rule is gone');
    if (tbl[1].indexOf('table-layout: fixed') < 0)
      throw new Error('the table can still be widened by its content');
    const notes = css.match(/\.col-map-panel td\.col-notes\s*\{([^}]*)\}/g) || [];
    const joined = notes.join(' ');
    if (!/overflow-wrap|word-break/.test(joined))
      throw new Error('a single unbroken token in a note has nowhere to wrap');
  });
  t('the two fixed columns still leave room for the notes', () => {
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    const widths = ['col-field', 'col-letter'].map(c => {
      const m = css.match(new RegExp('\\\\.col-map-panel td\\\\.' + c + '\\\\s*\\\\{([^}]*)\\\\}'));
      const w = m && m[1].match(/width:\s*(\d+)px/);
      return w ? parseInt(w[1], 10) : 0;
    });
    const panel = css.match(/\.col-map-panel\s*\{[^}]*max-width:\s*(\d+)px/);
    if (!panel) throw new Error('the panel has no max-width');
    const remaining = parseInt(panel[1], 10) - widths[0] - widths[1];
    if (remaining < 300)
      throw new Error('only ' + remaining + 'px left for notes — they will be unreadable');
  });

  console.log('\n== Job Number search, on all three tables ==');
  t('the summary bar puts Job Number between Part Number and Work Order', () => {
    const bar = SRC.slice(at('class="summary-search-bar"'), at('class="summary-search-bar"') + 1400);
    const order = ['id="search-input"', 'id="job-search-input"', 'id="wo-search-input"']
      .map(k => bar.indexOf(k));
    if (order.some(i => i < 0)) throw new Error('a summary search input is missing');
    eq(order.slice().sort((a, b) => a - b), order, 'order must be PN, Job, WO:');
  });
  t('the MBOM and ABOM bars put Job Number between Used On and Work Order', () => {
    ['mbom', 'abom'].forEach(leg => {
      const order = ['-search-uo', '-search-job', '-search-wo'].map(k => SRC.indexOf('id="' + leg + k + '"'));
      if (order.some(i => i < 0)) throw new Error(leg + ' is missing a search input');
      eq(order.slice().sort((a, b) => a - b), order, leg + ' order:');
    });
  });
  t('the summary job search matches ANY job planned against the line', () => {
    // A line can be planned on several jobs, so the match is "any", read from
    // the cached _meta map rather than rescanning the MBOM per row.
    if (!/function _rowMbomJobs/.test(SRC))
      throw new Error('the job lookup helper is gone');
    const h = grabFn('_rowMbomJobs');
    if (h.indexOf('mbomJobsByKey') < 0)
      throw new Error('the helper no longer reads the cached job map');
    eq((SRC.match(/_rowMbomJobs\(r\)\.some/g) || []).length, 2,
       'both the context and plain match paths must honour it:');
  });
  t('BOM job search uses the DATA path, not a DOM filter', () => {
    // A matching row may sit on another page. Filtering only what is rendered
    // would report "no matches" for data that exists — the same reason WO#
    // search re-renders rather than hiding rows.
    const f = grabFn('filterBomTable');
    if (!/\(woQ \|\| jobQ\)/.test(f))
      throw new Error('job search does not trigger the data-level re-render');
    const cfg = SRC.slice(at('const _bomSearchConfig'), at('const _bomSearchConfig') + 400);
    ['mbom', 'abom'].forEach(leg => {
      if (!new RegExp(leg + ':[^}]*jobCol').test(cfg))
        throw new Error(leg + ' has no jobCol in the search config');
    });
  });
  t('clearing a search clears the job box too', () => {
    const bom = grabFn('clearBomSearch');
    if (!/\['pn','uo','job','wo'\]/.test(bom))
      throw new Error('clearBomSearch leaves the job box populated');
    const sum = grabFn('clearSummarySearch');
    if (sum.indexOf('job-search-input') < 0)
      throw new Error('clearSummarySearch leaves the job box populated');
  });
  t('an empty job box does not suppress collapsed rows', () => {
    // The collapse guard lists every active search; omitting one would keep
    // rows hidden after the box is cleared.
    const T = SRC.slice(at('function renderSummaryTable'), at('function badgeBom('));
    if (!/!search && !woSearch && !ncrDispSearch && !rfvSearch && !jobSearch && isHiddenByCollapse/.test(T))
      throw new Error('jobSearch is missing from the collapse guard');
  });

  console.log('\n== RFV: one glyph rule, one badge colour, and documented ==');
  t('the RFV Links column drops the glyph, as an approved exception', () => {
    // v167 — #8. The build carries a glyph CONTRACT: ◈ means RFV everywhere,
    // ◆ is reserved for structural part-type badges. Dropping it in a column
    // literally headed "RFV Links" is a considered exception, not drift: there
    // the glyph restates the header on every row. It stays everywhere else,
    // where context is ambiguous.
    const cell = SRC.match(/<span style="font-family:var\(--mono\);color:var\(--text\)">[^`]{0,40}esc\(lnk\.rfvNum/);
    if (!cell) throw new Error('the RFV link cell moved');
    if (cell[0].indexOf('\u25c8') >= 0)
      throw new Error('the diamond is back in the RFV Links column');
    // and the contract still holds elsewhere
    ['\u25c8 teal = RFV authorized', '\u25c8 RFV'].forEach(k => {
      if (SRC.indexOf(k) < 0) throw new Error('the glyph contract was broken elsewhere: ' + k);
    });
  });
  t('all three RFV pass badges are the same colour', () => {
    // The pass is carried by the LABEL. Colouring them differently was a second
    // encoding needing a legend — the argument that retired the green glyphs.
    const cols = [...SRC.matchAll(/passLabel:\s*'P\d[^']*',\s*passColor:\s*'([^']+)'/g)].map(m => m[1]);
    if (cols.length !== 3) throw new Error('expected 3 pass badges, found ' + cols.length);
    if (new Set(cols).size !== 1)
      throw new Error('pass badges use different colours: ' + JSON.stringify(cols));
    eq(cols[0], 'var(--text-muted)');
  });
  t('the RFV Information legend and its MATCH PASS badges are both flat', () => {
    // v169 — the first version of this test checked only the legend LINE at the
    // top of the view. The MATCH PASS column badges are built somewhere else
    // entirely, from addMatch(), and stayed blue/red while the legend went dim.
    // Checking one and not the other is how a half-done change passes.
    const seg = SRC.slice(at('function renderRFVTable'), at('function renderRFVTable') + 4000);
    const legend = [...seg.matchAll(/<span style="color:(var\(--[\w-]+\))">P\d/g)].map(m => m[1]);
    if (legend.length < 3) throw new Error('the pass legend moved');
    if (new Set(legend).size !== 1)
      throw new Error('the legend colours the passes differently: ' + JSON.stringify(legend));

    // The badges themselves, from the addMatch() calls.
    const calls = [...SRC.matchAll(/addMatch\(rfvRow,\s*(\d),\s*'([^']+)',\s*([^)]+)\)/g)]
      .map(m => ({ pass: +m[1], label: m[2], color: m[3].trim() }));
    if (calls.length < 4) throw new Error('the MATCH PASS badge builders moved');
    const physical = calls.filter(c => c.pass <= 3);
    if (new Set(physical.map(c => c.color)).size !== 1)
      throw new Error('P1-P3 badges use different colours: ' +
                      JSON.stringify(physical.map(c => c.pass + '=' + c.color)));
    // The SME-linked pass is a PROVENANCE distinction, not a pass ranking, and
    // keeps the manual-provenance purple used across the whole tool.
    const sme = calls.find(c => c.pass === 4);
    if (!sme) throw new Error('the SME-linked pass is gone');
    if (sme.color === physical[0].color)
      throw new Error('the SME-linked pass lost its provenance colour');
    if (sme.color.indexOf('a371f7') < 0)
      throw new Error('the SME-linked pass is no longer the adjudication purple');
  });
  t('the RFV pass badges are documented', () => {
    // They are built INLINE rather than through the badge maps, which is why
    // the guide never carried them and Tier 10 never noticed.
    const help = SRC.slice(at('const BADGE_HELP = {'), at('function _badgeHelp'));
    ['P1\u00b7PN+NH', 'P2\u00b7NCR', 'P3\u00b7WO'].forEach(k => {
      if (help.indexOf("'" + k + "'") < 0)
        throw new Error('no explanation for the ' + k + ' badge');
    });
    // at() searches from the START of the file, and _setReportHtml appears
    // earlier than showBadgeGuide — so anchoring on it produced an INVERTED
    // slice and an empty string, which failed for the wrong reason. Search
    // forward from the guide.
    const gA = at('function showBadgeGuide()');
    const guide = SRC.slice(gA, at('_setReportHtml(html)', gA));
    if (guide.indexOf('RFV Links column') < 0)
      throw new Error('the badge guide has no RFV section');
  });
  t('RFV is explained in the Detailed View modal', () => {
    const m = SRC.slice(at("'detailed-view': {"), at("'adjudication-workbench': {"));
    if (m.indexOf('RFV Links') < 0)
      throw new Error('the Detailed View explanation still never mentions RFV');
    ['P1', 'P2', 'P3', 'not</em> ranked'].forEach(bit => {
      if (m.indexOf(bit) < 0) throw new Error('the RFV explanation omits: ' + bit);
    });
  });
  t('the Has RFV filter behaves like every other conditional filter', () => {
    // There was already an RFV SEARCH ("where is RFV-1234"); there was no way
    // to ask "which lines carry variance coverage at all".
    //
    // v168 — the first cut gated visibility on state.boms.rfv, i.e. on the FILE
    // being loaded. Every other conditional filter gates on count > 0 and shows
    // its count in the label. File-gating meant the button was invisible with no
    // RFV file (reads as "not implemented" rather than "not applicable") and
    // would have offered an always-empty filter for a file matching nothing.
    const btn = SRC.match(/<button[^>]*data-fk="has_rfv"[\s\S]{0,240}?<\/button>/);
    if (!btn) throw new Error('the Has RFV filter is missing');
    if (btn[0].indexOf('var(--rfv)') < 0)
      throw new Error('the filter does not wear the RFV colour');
    const uf = grabFn('updateFilterCounts');
    if (!/has_rfv:\s*\S/.test(uf))
      throw new Error('has_rfv has no entry in the counts object, so it renders with no count');
    if (!/filter-has-rfv'\)[\s\S]{0,160}counts\.has_rfv > 0/.test(SRC))
      throw new Error('the filter is not revealed by its count, like pt_removal is');
    if (/filter-has-rfv'\)[\s\S]{0,120}state\.boms\.rfv/.test(SRC))
      throw new Error('the old file-presence gate is still there — two rules, one button');
    eq((SRC.match(/activeFilter === 'has_rfv'/g) || []).length, 2,
       'both the render and count paths must honour it:');
  });
  t('every conditional filter is revealed the same way', () => {
    // pt_removal, abom_proc_removed and has_rfv all key on count > 0. A filter
    // revealed by a different rule is the one that surprises the reader.
    ['filter-pt-removal', 'filter-abom-proc-removed', 'filter-has-rfv'].forEach(id => {
      const re = new RegExp("getElementById\\('" + id + "'\\)[\\s\\S]{0,200}counts\\.\\w+ > 0");
      if (!re.test(SRC)) throw new Error(id + ' is not revealed by a count');
    });
  });

  console.log('\n== updateFilterCounts may only call what it can see ==');
  t('updateFilterCounts calls nothing that is local to another function', () => {
    // v172 — the counts object is built as ONE literal. A single unresolvable
    // call throws before any button is labelled, so every filter count vanishes
    // and every count-based reveal stops firing. v169 called getRowRfvLinks(),
    // which is local to renderSummaryTable and runs AFTER this — the reported
    // symptom was "no Has RFV button", the actual damage was every count.
    const uf = grabFn('updateFilterCounts').replace(/\/\/[^\n]*/g, '');
    const called = new Set([...uf.matchAll(/(^|[^.\w$])([a-zA-Z_$][\w$]*)\s*\(/g)].map(m => m[2]));
    const BUILTIN = new Set(['if','for','while','switch','return','function','catch','typeof',
      'Set','Map','Array','Object','String','Number','Boolean','parseInt','parseFloat','filter',
      'forEach','some','every','map','has','add','get','set','includes','indexOf','join','split',
      'slice','sort','push','trim','toUpperCase','toLowerCase','querySelectorAll','getElementById',
      'getAttribute','setAttribute','hasAttribute','normPN','esc','fmt']);
    const bad = [];
    called.forEach(fn => {
      if (BUILTIN.has(fn)) return;
      const at2 = SRC.indexOf('function ' + fn + '(');
      if (at2 < 0) return;                       // not a build function
      // is it declared at column 0 (top level) or indented (nested)?
      const lineStart = SRC.lastIndexOf('\n', at2) + 1;
      if (at2 !== lineStart) bad.push(fn);
    });
    if (bad.length)
      throw new Error('updateFilterCounts calls function(s) local to another scope: ' +
                      bad.join(', ') + ' — this throws and kills every filter count');
  });
  t('the RFV row count is computed at top level', () => {
    if (!/^function _rfvLinkedRowCount\(/m.test(SRC))
      throw new Error('_rfvLinkedRowCount is not a top-level function');
    const body = grabFn('_rfvLinkedRowCount');
    if (/getRowRfvLinks/.test(body))
      throw new Error('it delegates to the function that is out of scope');
  });

  console.log('\n== A filter wears the colour of what it finds ==');
  t('the Adjudicated filter matches its badges, not the interaction blue', () => {
    const btn = SRC.match(/<button[^>]*data-fk="adjudicated"[\s\S]{0,260}?<\/button>/);
    if (!btn) throw new Error('the Adjudicated filter is gone');
    if (/var\(--accent\)/.test(btn[0]))
      throw new Error('the filter is still interaction-blue while its badges are purple');
    if (!/var\(--adj\)/.test(btn[0]))
      throw new Error('the filter does not use the adjudication colour');
  });

  console.log('\n== The bar no longer shares its name with the section ==');
  t('the action bar is the Claim Ledger, distinct from the section', () => {
    const bar = SRC.match(/<span class="adj-title">([^<]*)<\/span>/);
    if (!bar) throw new Error('the action bar title is gone');
    if (/Adjudication Workbench/.test(bar[1]))
      throw new Error('the bar still carries the same name as the section it sits inside');
    eq(bar[1].replace(/[^A-Za-z ]/g, '').trim(), 'Claim Ledger');
  });
  t('the explanation modal covers all three blocks in order', () => {
    const m = SRC.slice(at("'adjudication-workbench': {"), at("'adjudication-workbench': {") + 20000);
    const order = ['The Candidates Helpers', 'Imported Claims', 'The Claim Ledger']
      .map(h => m.indexOf('<h3>' + h));
    order.forEach((i, k) => { if (i < 0)
      throw new Error('the explanation modal is missing a block: ' + k); });
    eq(order.slice().sort((a, b) => a - b), order, 'blocks must read in workflow order:');
  });
  t('the modal explains the CM boundary and the pending arrival', () => {
    const m = SRC.slice(at("'adjudication-workbench': {"), at("'adjudication-workbench': {") + 20000);
    ['never touches CI-to-NCR', 'arrive <em>pending</em>'].forEach(bit => {
      if (m.indexOf(bit) < 0) throw new Error('the modal no longer states: ' + bit);
    });
  });

  console.log('\n== The ten upload zones look like one another ==');
  t('every zone tag uses the shared uniform treatment', () => {
    // v163 — adding the tenth zone put a coloured .tag-adj rule INSIDE the
    // shared no-op selector, which turned nine tags purple and left ACN alone.
    // The zones are meant to be visually identical; .bom-tag owns the styling.
    const css = STYLE_BLOCKS.map(b => b.css).join('\n');
    const coloured = [...css.matchAll(/\.tag-[\w-]+[^{}]*\{([^}]*)\}/g)]
      .filter(m => /background|color|border/.test(m[1]));
    if (coloured.length)
      throw new Error('a per-zone tag rule sets its own colour: ' +
                      coloured[0][0].replace(/\s+/g, ' ').slice(0, 90));
  });
  t('every zone offers the same column-mapping help control', () => {
    const icons = [...SRC.matchAll(/class="abom-cm-help"[^>]*>([^<]*)<\/a>/g)].map(m => m[1].trim());
    if (icons.length < 5) throw new Error('only found ' + icons.length + ' help controls');
    const distinct = [...new Set(icons)];
    if (distinct.length !== 1)
      throw new Error('zones use different help icons: ' + JSON.stringify(distinct));
  });
  t('the ME ADJ zone is wired like the other supplemental zones', () => {
    const zone = SRC.slice(at('id="zone-adj"'), at('id="zone-adj"') + 1400);
    ['handleFile(\'adj\'', 'setSuppMappingMode(\'adj\'', 'openSuppManualMap(\'adj\'',
     'id="fn-adj"', 'id="rows-adj"'].forEach(bit => {
      if (zone.indexOf(bit) < 0) throw new Error('the ME ADJ zone is missing ' + bit);
    });
  });

  console.log('\n== Export menu wiring ==');
  t('every menu item is wired, and every wire has a button', () => {
    // The count is derived from the build, not pinned to 13, so ADDING an
    // export is not a failure — leaving one unwired is.
    const items = [...SRC.matchAll(/class="export-menu-item"[^>]*>\s*([^<]{1,60})/g)].map(m => m[1].trim());
    const wired = [...SRC.matchAll(/id="(export-menu-[\w-]+)"[^>]*onclick="invokeExport\('([^']+)'\)/g)];
    if (!items.length) throw new Error('no export menu items found at all');
    eq(wired.length, items.length, 'menu items vs invokeExport wires:');
    const dead = wired.filter(w => !SRC.includes('id="' + w[2] + '"')).map(w => w[2]);
    if (dead.length) throw new Error('wired to missing button(s): ' + dead.join(', '));
  });
  t('menu ids are unique', () => {
    const ids = [...SRC.matchAll(/id="(export-menu-[\w-]+)"/g)].map(m => m[1]);
    const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
    if (dupes.length) throw new Error('duplicate menu ids: ' + [...new Set(dupes)].join(', '));
  });
  t('export menu uses one arrow convention', () => {
    const items = [...SRC.matchAll(/class="export-menu-item"[^>]*>\s*([^<]{1,60})/g)].map(m => m[1].trim());
    const arr = items.filter(i => i.startsWith('\u2b07'));
    if (arr.length !== 0 && arr.length !== items.length)
      throw new Error('mixed: ' + arr.length + '/' + items.length);
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
    if(m[1]!=='v172') throw new Error('says '+m[1]);
  });
});


// ── summary ────────────────────────────────────────────────────────────────
// EXPECTED_TESTS exists because a crashed suite costs ONE reported failure but
// silently skips every test after it. Without this, losing a third of the suite
// still prints a believable total. Bump it deliberately when adding tests.
const EXPECTED_TESTS = 463;
console.log('═'.repeat(60));
console.log('TOTAL: ' + TP + ' passed, ' + TF + ' failed');
if (TP + TF !== EXPECTED_TESTS) {
  console.log('');
  console.log('COUNT MISMATCH: ' + (TP + TF) + ' tests ran, ' + EXPECTED_TESTS + ' expected.');
  console.log(TP + TF < EXPECTED_TESTS
    ? 'Tests went missing — a suite crashed before finishing. Treat this as a failure.'
    : 'Tests were added without updating EXPECTED_TESTS. Update it.');
  process.exit(1);
}
if (FAILED.length) { console.log('Failing suites: ' + FAILED.join(', ')); process.exit(1); }
console.log('All suites green.');
