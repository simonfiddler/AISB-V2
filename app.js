let suites = [];
let active = null;
let wakeLock = null;
let currentAudio = null;
let sheetScale = 1;
let pinchStartDistance = 0;
let pinchStartScale = 1;

const $ = id => document.getElementById(id);
const norm = value => (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const favKey = "aisb-favorites-v2";
let favs = new Set(JSON.parse(localStorage.getItem(favKey) || "[]"));

function saveFav(){ localStorage.setItem(favKey, JSON.stringify([...favs])); }
function replaceOptions(select, values, selected, allLabel="Tous"){
  select.textContent=""; select.add(new Option(allLabel,""));
  values.forEach(value=>select.add(new Option(value,value)));
  select.value=values.includes(selected)?selected:"";
}
function searchMatches(){
  const query=norm($("search").value.trim());
  return suites.filter(s=>!query||s.tunes.some(t=>norm(t.title).includes(query)));
}
function syncFilters(source){
  const matches=searchMatches();
  const oldNumber=$("num").value, oldType=$("type").value;
  const numbers=matches.map(s=>s.number);
  const types=[...new Set(matches.map(s=>s.type))].sort();
  replaceOptions($("num"),numbers,oldNumber);
  replaceOptions($("type"),types,oldType);
  if(source==="search"){
    if(matches.length===1){ $("num").value=matches[0].number; $("type").value=matches[0].type; }
    else { $("num").value=""; $("type").value=types.length===1?types[0]:""; }
  }
  if(source==="num"){
    const selected=matches.find(s=>s.number===$("num").value)||suites.find(s=>s.number===$("num").value);
    $("type").value=selected?selected.type:"";
  }
  renderList();
}
function init(){
  const allTypes=[...new Set(suites.map(s=>s.type))].sort();
  replaceOptions($("type"),allTypes,"");
  replaceOptions($("num"),suites.map(s=>s.number),"");
  $("search").addEventListener("input",()=>syncFilters("search"));
  $("num").addEventListener("change",()=>syncFilters("num"));
  $("type").addEventListener("change",renderList);
  $("favorites").addEventListener("change",renderList);
  document.addEventListener("visibilitychange",()=>{ if(document.visibilityState==="visible") requestWakeLock(); });
  document.addEventListener("pointerdown",requestWakeLock,{once:true});
  document.addEventListener("keydown",requestWakeLock,{once:true});
  setupSheetZoom();
  requestWakeLock(); renderList();
}
function isFavSuite(s){ return s.tunes.some(t=>favs.has(t.id)); }
function renderList(){
  const query=norm($("search").value), number=$("num").value, type=$("type").value, favoritesOnly=$("favorites").checked;
  const results=$("results"); results.textContent="";
  const filtered=suites.filter(s=>(!number||s.number===number)&&(!type||s.type===type)&&(!query||s.tunes.some(t=>norm(t.title).includes(query)))&&(!favoritesOnly||isFavSuite(s)));
  filtered.forEach(s=>{
    const b=document.createElement("button"); b.className="result"+(active===s.id?" active":"");
    b.textContent=`#${s.number} [${s.type}] · ${s.tunes.map(t=>t.title).join(" · ")}`;
    b.onclick=()=>showSuite(s); results.appendChild(b);
  });
  if(!filtered.length){ const p=document.createElement("p"); p.className="no-results"; p.textContent="Aucune suite ne correspond aux filtres."; results.appendChild(p); }
}
function showSuite(suite){
  active=suite.id; resetSheetZoom();
  const viewer=$("viewer"); viewer.textContent=""; viewer.scrollTop=0;
  const head=document.createElement("div"); head.className="suitehead";
  const h=document.createElement("h2"); h.textContent=`Suite ${suite.number}`;
  const sp=document.createElement("span"); sp.textContent=suite.type; head.append(h,sp); viewer.append(head);
  suite.tunes.forEach(t=>viewer.append(tuneCard(t)));
  $("sheet").src=suite.partition; $("sheet").alt=`Partition suite ${suite.number}`;
  $("landscapeTitle").textContent=`Suite#${suite.number}`; $("landscape").classList.add("has-sheet");
  $("sheet").onerror=()=>{ $("landscape").classList.remove("has-sheet"); $("sheetMessage").textContent="Partition non disponible pour cette suite."; };
  renderList();
}
function audioUrl(audio){
  const source=audio.file||audio.url; if(!source) return source;
  if(/^https:\/\/pub-20152a597afa4e8187f753b29a2a6c46\.r2\.dev\//i.test(source)) return source;
  let path=source;
  if(/^https?:\/\//i.test(path)){ const marker="/main/", i=path.indexOf(marker); if(i>=0) path=decodeURIComponent(path.slice(i+marker.length)); else return path; }
  const encoded=path.replace(/\\/g,"/").split("/").map(encodeURIComponent).join("/");
  return "https://pub-20152a597afa4e8187f753b29a2a6c46.r2.dev/"+encoded;
}
function tuneCard(tune){
  const section=document.createElement("section"); section.className="tune";
  const row=document.createElement("div"); row.className="tune-title";
  const h=document.createElement("h3"); h.textContent=tune.title;
  const fav=document.createElement("button"); fav.type="button"; fav.className="fav"+(favs.has(tune.id)?" on":""); fav.textContent=favs.has(tune.id)?"★":"☆"; fav.setAttribute("aria-label","Favori");
  fav.onclick=()=>{ favs.has(tune.id)?favs.delete(tune.id):favs.add(tune.id); saveFav(); showSuite(suites.find(s=>s.id===active)); };
  row.append(h,fav); section.append(row);
  if(!tune.audio||!tune.audio.length){ const p=document.createElement("p"); p.className="noaudio"; p.textContent="Aucun enregistrement associé."; section.append(p); return section; }
  tune.audio.forEach(recording=>{
    const block=document.createElement("div"); block.className="audio-block";
    const label=document.createElement("p"); label.className="audio-label"; label.textContent=recording.label||"Enregistrement";
    const audio=document.createElement("audio"); audio.controls=true; audio.preload="metadata"; audio.src=audioUrl(recording);
    audio.addEventListener("play",()=>{ if(currentAudio&&currentAudio!==audio) currentAudio.pause(); currentAudio=audio; requestWakeLock(); });
    audio.addEventListener("ended",()=>{ if(currentAudio===audio) currentAudio=null; });
    const speed=document.createElement("div"); speed.className="speed";
    [0.5,0.75,1].forEach(rate=>{ const b=document.createElement("button"); b.type="button"; b.textContent=`${rate*100} %`; b.onclick=()=>{ audio.playbackRate=rate; speed.querySelectorAll("button").forEach(x=>x.classList.remove("selected")); b.classList.add("selected"); }; if(rate===1)b.classList.add("selected"); speed.append(b); });
    block.append(label,audio,speed); section.append(block);
  });
  return section;
}
function touchDistance(touches){ const dx=touches[0].clientX-touches[1].clientX, dy=touches[0].clientY-touches[1].clientY; return Math.hypot(dx,dy); }
function applySheetZoom(){
  const sheet=$("sheet"); if(!sheet) return;
  sheet.style.transform=`scale(${sheetScale})`;
  sheet.style.transformOrigin="center center";
}
function resetSheetZoom(){
  sheetScale=1; pinchStartDistance=0; pinchStartScale=1;
  const sheet=$("sheet"); if(sheet){ sheet.style.transform="scale(1)"; sheet.style.transformOrigin="center center"; }
  const viewport=$("sheetViewport"); if(viewport){ viewport.scrollLeft=0; viewport.scrollTop=0; }
}
function setupSheetZoom(){
  const viewport=$("sheetViewport"); if(!viewport) return;
  viewport.addEventListener("touchstart",event=>{
    if(event.touches.length===2){ pinchStartDistance=touchDistance(event.touches); pinchStartScale=sheetScale; event.preventDefault(); }
  },{passive:false});
  viewport.addEventListener("touchmove",event=>{
    if(event.touches.length===2&&pinchStartDistance>0){ const ratio=touchDistance(event.touches)/pinchStartDistance; sheetScale=Math.min(4,Math.max(1,pinchStartScale*ratio)); applySheetZoom(); event.preventDefault(); }
  },{passive:false});
  viewport.addEventListener("touchend",event=>{ if(event.touches.length<2) pinchStartDistance=0; },{passive:true});
  const onOrientation=()=>setTimeout(resetSheetZoom,80);
  window.addEventListener("orientationchange",onOrientation);
  if(screen.orientation&&screen.orientation.addEventListener) screen.orientation.addEventListener("change",onOrientation);
}
async function requestWakeLock(){
  if(!("wakeLock" in navigator)||document.visibilityState!=="visible") return;
  if(wakeLock&&!wakeLock.released) return;
  try{ wakeLock=await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release",()=>{wakeLock=null;}); }
  catch(error){ console.info("Maintien de l'écran actif indisponible :",error.name); }
}
fetch("data/repertoire.json").then(r=>{if(!r.ok)throw new Error("Catalogue indisponible");return r.json();}).then(data=>{suites=data.suites;init();}).catch(()=>{$("viewer").innerHTML="<p>Impossible de charger le catalogue.</p>";});
if("serviceWorker" in navigator){ addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js")); }
