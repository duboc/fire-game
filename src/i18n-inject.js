// Builds the <script> block that server.js splices into each page's <head> at
// boot, before the ETag is computed and before gzip/brotli run.
//
// Why inlined rather than served as /i18n.js: the lobby is the heaviest moment
// of the event — every phone in the room pulls assets at once (docs/SCALE.md,
// finding 6). A separate script file would be a third asset fetch per phone for
// something that compresses to well under a kilobyte inside the page it belongs
// to. Inlining also means the catalogue exists before the body is parsed, so
// there is no window in which the wrong language is on screen.
//
// The runtime below is written once here and lands identically in all three
// pages. That is deliberate: the pages are otherwise self-contained (each has
// its own `$`, `escapeHtml`, clock sync), but three hand-maintained copies of a
// plural-selection routine is three chances to fix a bug twice and miss once.
import { UI, UI_FALLBACK, UI_LANG_NAMES, UI_LOCALES } from './locales/ui.js';

/**
 * Serialises to a string that is safe between <script> tags. JSON alone is not:
 * a translation containing `</script>` would end the block and the rest of the
 * catalogue would render as text. Escaping `<` covers that and `<!--`.
 */
function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

// Attributes translatable via `data-i18n-<attr>="key"`. An explicit list keeps
// apply() to one querySelectorAll instead of a walk over every attribute in
// the document, and these four are all the pages need.
const I18N_ATTRS = ['placeholder', 'title', 'aria-label', 'content'];

// The client runtime, as source text. Every byte here is multiplied by the
// number of phones in the room, so it is written tight and carries no comments
// of its own — the explanation lives out here instead:
//
//   pick()   Resolution order is ?lang= -> localStorage.tapLang ->
//            navigator.languages -> fallback, taking the first tag we actually
//            speak. That is the same first-supported-tag-wins rule the server
//            applies to Accept-Language (normalizeLocale, src/names.js:49), so
//            the chrome and the generated name agree without either side being
//            told about the other.
//   t()      Falls back to the reference language per *key*, not per language,
//            so one untranslated string can never blank out a whole page.
//            Plurals go through Intl.PluralRules; numeric {vars} are grouped
//            for the locale, anything pre-formatted (a "#12" rank) is not.
//   apply()  One pass over [data-i18n] and [data-i18n-<attr>], plus <html lang>
//            and <title>. Re-runnable: set() calls it again on a switch.
//
// Kept ES5-ish and free of optional chaining. It runs in <head> on whatever
// phone walked into the venue, before any of our other code, and a syntax error
// here is a blank screen rather than a degraded one.
const RUNTIME = `(function(){
var S=window.__I18N_STRINGS,F=${JSON.stringify(UI_FALLBACK)},A=${JSON.stringify(I18N_ATTRS)},D='data-i18n';
var SEL='['+D+']';for(var a=0;a<A.length;a++)SEL+=',['+D+'-'+A[a]+']';
var lang=pick(),nf,pr;build();
function pick(){
var q=null,s=null;
try{q=new URLSearchParams(location.search).get('lang');}catch(e){}
try{s=localStorage.getItem('tapLang');}catch(e){}
var c=[q,s].concat(navigator.languages||[navigator.language||'']);
for(var i=0;i<c.length;i++){if(!c[i])continue;
var g=String(c[i]).split(',')[0].trim().split(';')[0].split(/[-_]/)[0].toLowerCase();
if(S[g])return g;}
return F;}
function build(){
try{nf=new Intl.NumberFormat(lang);}catch(e){nf=null;}
try{pr=new Intl.PluralRules(lang);}catch(e){pr=null;}}
function n(v){v=Number(v)||0;return nf?nf.format(v):String(v);}
function t(k,vars){
var v=S[lang]&&S[lang][k];
if(v==null)v=S[F][k];
if(v==null)return k;
if(typeof v==='object'){var c=Number(vars&&vars.n)||0;
v=v[pr?pr.select(c):(c===1?'one':'other')]||v.other;}
return String(v).replace(/\\{(\\w+)\\}/g,function(m,p){
if(!vars||vars[p]==null)return '';
return typeof vars[p]==='number'?n(vars[p]):String(vars[p]);});}
function apply(root){
var e=(root||document).querySelectorAll(SEL),i,j,k;
for(i=0;i<e.length;i++){
k=e[i].getAttribute(D);if(k)e[i].textContent=t(k);
for(j=0;j<A.length;j++){k=e[i].getAttribute(D+'-'+A[j]);if(k)e[i].setAttribute(A[j],t(k));}}
document.documentElement.lang=lang;
if(S[F].title)document.title=t('title');}
function set(c){
if(!S[c]||c===lang)return false;
lang=c;build();
try{localStorage.setItem('tapLang',c);}catch(e){}
apply();
window.dispatchEvent(new CustomEvent('i18n:change',{detail:{lang:c}}));
return true;}
window.I18N={t:t,n:n,apply:apply,set:set,langs:${jsonForScript(UI_LOCALES)},names:${jsonForScript(UI_LANG_NAMES)},get lang(){return lang;}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){apply();});else apply();
})();`;

/**
 * @param {'phone'|'screen'|'host'} surface
 * @returns {string} a complete <script> element for that surface's <head>
 */
export function buildI18nTag(surface) {
  const strings = UI[surface];
  if (!strings) throw new Error(`i18n: unknown surface "${surface}"`);
  return `<script>window.__I18N_STRINGS=${jsonForScript(strings)};\n${RUNTIME}</script>`;
}

/**
 * Splices the tag over the `<!--I18N-->` marker in a page. Throws rather than
 * silently serving an untranslated page if a marker is ever renamed away.
 * @param {'phone'|'screen'|'host'} surface
 * @returns {(html: string) => string}
 */
export function injectI18n(surface) {
  return (html) => {
    if (!html.includes('<!--I18N-->')) {
      throw new Error(`i18n: the ${surface} page has no <!--I18N--> marker`);
    }
    return html.replace('<!--I18N-->', buildI18nTag(surface));
  };
}
