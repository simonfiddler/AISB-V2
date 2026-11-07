let suites = [];
let active = null;
let activeSuite = null;
let fullPartitionMode = false;
let wakeLock = null;
let currentAudio = null;
let scoreZoom = 1;
let scoreZoomStart = 1;
let scoreBaseWidth = 0;
let scoreBaseHeight = 0;
let zoomFocusX = 0;
let zoomFocusY = 0;
let zoomScreenX = 0;
let zoomScreenY = 0;

const $ = id => document.getElementById(id);
const norm = value => (value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase();

const favKey = "aisb-favorites-v2";
let favs = new Set(JSON.parse(localStorage.getItem(favKey) || "[]"));

function saveFav() {
  localStorage.setItem(favKey, JSON.stringify([...favs]));
}

function replaceOptions(select, values, selected, allLabel = "Tous") {
  select.textContent = "";
  select.add(new Option(allLabel, ""));
  values.forEach(value => select.add(new Option(value, value)));
  select.value = values.includes(selected) ? selected : "";
}

function searchMatches() {
  const query = norm($("search").value.trim());
  return suites.filter(suite =>
    !query || suite.tunes.some(tune => norm(tune.title).includes(query))
  );
}

function syncFilters(source) {
  const matches = searchMatches();
  const oldNumber = $("num").value;
  const availableNumbers = matches.map(suite => suite.number);

  replaceOptions($("num"), availableNumbers, oldNumber);

  if (source === "search") {
    if (matches.length === 1) {
      $("num").value = matches[0].number;
      $("type").value = matches[0].type;
    } else {
      const types = [...new Set(matches.map(suite => suite.type))];
      $("num").value = "";
      $("type").value = types.length === 1 ? types[0] : "";
    }
  }

  if (source === "num") {
    const selectedSuite = suites.find(suite => suite.number === $("num").value);
    $("type").value = selectedSuite ? selectedSuite.type : "";
  }

  renderList();
}

function init() {
  const allTypes = [...new Set(suites.map(suite => suite.type))].sort();
  replaceOptions($("type"), allTypes, "");
  replaceOptions($("num"), suites.map(suite => suite.number), "");

  $("search").addEventListener("input", () => syncFilters("search"));
  $("num").addEventListener("change", () => syncFilters("num"));
  $("type").addEventListener("change", renderList);
  $("favorites").addEventListener("change", renderList);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestWakeLock();
  });

  // iOS can preserve the page's pinch-zoom scale across orientation changes.
  // Reset the visual viewport whenever the phone changes orientation.
  window.addEventListener("orientationchange", resetPageZoom);
  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener("change", resetPageZoom);
  }
  setupIOSScoreZoom();
  const pageFlip = $("pageFlip");
  if (pageFlip) pageFlip.addEventListener("click", togglePartitionView);
  document.addEventListener("pointerdown", requestWakeLock, { once: true });
  document.addEventListener("keydown", requestWakeLock, { once: true });

  requestWakeLock();
  renderList();
}

function isFavSuite(suite) {
  return suite.tunes.some(tune => favs.has(tune.id));
}

function renderList() {
  const query = norm($("search").value);
  const number = $("num").value;
  const type = $("type").value;
  const favoritesOnly = $("favorites").checked;
  const results = $("results");

  results.textContent = "";

  const filtered = suites.filter(suite =>
    (!number || suite.number === number) &&
    (!type || suite.type === type) &&
    (!query || suite.tunes.some(tune => norm(tune.title).includes(query))) &&
    (!favoritesOnly || isFavSuite(suite))
  );

  filtered.forEach(suite => {
    const button = document.createElement("button");
    button.className = "result" + (active === suite.id ? " active" : "");
    button.textContent = `#${suite.number} [${suite.type}] · ${suite.tunes.map(tune => tune.title).join(" · ")}`;
    button.onclick = () => showSuite(suite);
    results.appendChild(button);
  });

  if (!filtered.length) {
    const message = document.createElement("p");
    message.className = "no-results";
    message.textContent = "Aucune suite ne correspond aux filtres.";
    results.appendChild(message);
  }
}

function showSuite(suite) {
  active = suite.id;
  activeSuite = suite;
  fullPartitionMode = false;
  resetScoreZoom();

  const viewer = $("viewer");
  viewer.textContent = "";
  viewer.scrollTop = 0;
  const head = document.createElement("div");
  head.className = "suitehead";
  const title = document.createElement("h2");
  title.textContent = `Suite ${suite.number}`;
  const type = document.createElement("span");
  type.textContent = suite.type;
  head.append(title, type);
  viewer.append(head);
  suite.tunes.forEach(tune => viewer.append(tuneCard(tune)));

  $("landscapeTitle").textContent = `Suite#${suite.number}`;
  showSimplePartition();
  checkFullPartition(suite);
  renderList();
}

function showSimplePartition() {
  if (!activeSuite) return;
  fullPartitionMode = false;
  resetScoreZoom();
  const landscape = $("landscape");
  const sheet = $("sheet");
  const viewport = $("sheetViewport");
  const button = $("pageFlip");
  landscape.classList.remove("full-partition");
  if (viewport) { viewport.scrollTop = 0; viewport.scrollLeft = 0; }
  sheet.src = activeSuite.partition;
  sheet.alt = `Partition simplifiée suite ${activeSuite.number}`;
  if (button) {
    button.classList.remove("active");
    button.setAttribute("aria-label", "Afficher la partition complète");
    button.title = "Afficher la partition complète";
  }
  sheet.onload = () => {
    landscape.classList.add("has-sheet");
    prepareScoreView();
  };
  sheet.onerror = () => {
    landscape.classList.remove("has-sheet");
    $("sheetMessage").textContent = "Partition non disponible pour cette suite.";
  };
}

function showFullPartition() {
  if (!activeSuite || !activeSuite.partitionFull) return;
  fullPartitionMode = true;
  resetScoreZoom();
  const landscape = $("landscape");
  const sheet = $("sheet");
  const viewport = $("sheetViewport");
  const button = $("pageFlip");
  landscape.classList.add("full-partition");
  if (viewport) { viewport.scrollTop = 0; viewport.scrollLeft = 0; }
  sheet.src = activeSuite.partitionFull;
  sheet.alt = `Partition complète suite ${activeSuite.number}`;
  sheet.onload = () => {
    landscape.classList.add("has-sheet");
    prepareScoreView();
  };
  if (button) {
    button.classList.add("active");
    button.setAttribute("aria-label", "Revenir à la partition simplifiée");
    button.title = "Revenir à la partition simplifiée";
  }
}

function togglePartitionView() {
  if (!activeSuite || !activeSuite.partitionFull) return;
  fullPartitionMode ? showSimplePartition() : showFullPartition();
}

function checkFullPartition(suite) {
  const button = $("pageFlip");
  if (!button) return;
  button.hidden = true;
  if (!suite.partitionFull) return;
  const probe = new Image();
  probe.onload = () => {
    if (activeSuite && activeSuite.id === suite.id) button.hidden = false;
  };
  probe.onerror = () => {
    if (activeSuite && activeSuite.id === suite.id) button.hidden = true;
  };
  probe.src = suite.partitionFull;
}

function audioUrl(audio) {
  const source = audio.file || audio.url;
  if (!source) return source;

  // Keep any explicit Cloudflare R2 URL unchanged.
  if (/^https:\/\/pub-20152a597afa4e8187f753b29a2a6c46\.r2\.dev\//i.test(source)) {
    return source;
  }

  // repertoire.json stores relative paths. If an older absolute GitHub audio URL
  // is encountered, recover the path after /main/ before pointing it to R2.
  let path = source;
  if (/^https?:\/\//i.test(path)) {
    const marker = '/main/';
    const i = path.indexOf(marker);
    if (i >= 0) path = decodeURIComponent(path.slice(i + marker.length));
    else return path;
  }

  const encodedPath = path
    .replace(/\\/g, '/')
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');

  return 'https://pub-20152a597afa4e8187f753b29a2a6c46.r2.dev/' + encodedPath;
}

function tuneCard(tune) {
  const section = document.createElement("section");
  section.className = "tune";

  const row = document.createElement("div");
  row.className = "tune-title";

  const title = document.createElement("h3");
  title.textContent = tune.title;

  const favorite = document.createElement("button");
  favorite.type = "button";
  favorite.className = "fav" + (favs.has(tune.id) ? " on" : "");
  favorite.textContent = favs.has(tune.id) ? "★" : "☆";
  favorite.setAttribute("aria-label", "Favori");
  favorite.onclick = () => {
    favs.has(tune.id) ? favs.delete(tune.id) : favs.add(tune.id);
    saveFav();
    showSuite(suites.find(suite => suite.id === active));
  };

  row.append(title, favorite);
  section.append(row);

  if (!tune.audio || !tune.audio.length) {
    const message = document.createElement("p");
    message.className = "noaudio";
    message.textContent = "Aucun enregistrement associé.";
    section.append(message);
    return section;
  }

  tune.audio.forEach(recording => {
    const block = document.createElement("div");
    block.className = "audio-block";

    const label = document.createElement("p");
    label.className = "audio-label";
    label.textContent = recording.label || "Enregistrement";

    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    audio.src = audioUrl(recording);
    audio.addEventListener("play", () => {
      if (currentAudio && currentAudio !== audio) currentAudio.pause();
      currentAudio = audio;
      requestWakeLock();
    });
    audio.addEventListener("ended", () => {
      if (currentAudio === audio) currentAudio = null;
    });

    const speed = document.createElement("div");
    speed.className = "speed";
    [0.5, 0.75, 1].forEach(rate => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${rate * 100} %`;
      button.onclick = () => {
        audio.playbackRate = rate;
        speed.querySelectorAll("button").forEach(item => item.classList.remove("selected"));
        button.classList.add("selected");
      };
      if (rate === 1) button.classList.add("selected");
      speed.append(button);
    });

    block.append(label, audio, speed);
    section.append(block);
  });

  return section;
}

function measureScoreBase() {
  const area = $("sheetViewport");
  const sheet = $("sheet");
  if (!area || !sheet || !sheet.naturalWidth || !sheet.naturalHeight) return;

  const ratio = sheet.naturalWidth / sheet.naturalHeight;
  if (fullPartitionMode) {
    scoreBaseWidth = area.clientWidth;
    scoreBaseHeight = scoreBaseWidth / ratio;
  } else {
    scoreBaseWidth = Math.min(area.clientWidth, area.clientHeight * ratio);
    scoreBaseHeight = scoreBaseWidth / ratio;
  }
}

function applyScoreZoom(keepFocus = false) {
  const area = $("sheetViewport");
  const sheet = $("sheet");
  if (!area || !sheet) return;
  if (!scoreBaseWidth || !scoreBaseHeight) measureScoreBase();

  sheet.style.transform = "none";
  sheet.style.width = `${scoreBaseWidth * scoreZoom}px`;
  sheet.style.height = `${scoreBaseHeight * scoreZoom}px`;
  sheet.style.objectFit = "fill";
  sheet.style.margin = fullPartitionMode ? "0" : "auto";

  if (keepFocus) {
    requestAnimationFrame(() => {
      area.scrollLeft = Math.max(0, zoomFocusX * scoreZoom - zoomScreenX);
      area.scrollTop = Math.max(0, zoomFocusY * scoreZoom - zoomScreenY);
    });
  }
}

function prepareScoreView() {
  scoreZoom = 1;
  scoreZoomStart = 1;
  scoreBaseWidth = 0;
  scoreBaseHeight = 0;
  const area = $("sheetViewport");
  if (area) {
    area.scrollLeft = 0;
    area.scrollTop = 0;
  }
  measureScoreBase();
  applyScoreZoom();
}

function resetScoreZoom() {
  scoreZoom = 1;
  scoreZoomStart = 1;
  scoreBaseWidth = 0;
  scoreBaseHeight = 0;
  const sheet = $("sheet");
  if (sheet) {
    sheet.style.transform = "none";
    sheet.style.width = "";
    sheet.style.height = "";
    sheet.style.objectFit = "";
    sheet.style.margin = "";
  }
  const area = $("sheetViewport");
  if (area) {
    area.scrollLeft = 0;
    area.scrollTop = 0;
  }
}

function setupIOSScoreZoom() {
  const area = $("sheetViewport");
  if (!area) return;

  area.addEventListener("gesturestart", event => {
    scoreZoomStart = scoreZoom;
    const rect = area.getBoundingClientRect();
    zoomScreenX = event.clientX - rect.left;
    zoomScreenY = event.clientY - rect.top;
    zoomFocusX = (area.scrollLeft + zoomScreenX) / scoreZoom;
    zoomFocusY = (area.scrollTop + zoomScreenY) / scoreZoom;
    event.preventDefault();
    event.stopPropagation();
  }, { passive: false });

  area.addEventListener("gesturechange", event => {
    scoreZoom = Math.max(1, Math.min(4, scoreZoomStart * event.scale));
    applyScoreZoom(true);
    event.preventDefault();
    event.stopPropagation();
  }, { passive: false });

  area.addEventListener("gestureend", event => {
    event.preventDefault();
    event.stopPropagation();
  }, { passive: false });

  const blockPageZoom = event => event.preventDefault();
  document.addEventListener("gesturestart", blockPageZoom, { passive: false });
  document.addEventListener("gesturechange", blockPageZoom, { passive: false });
  document.addEventListener("gestureend", blockPageZoom, { passive: false });

  const resetAfterRotation = () => setTimeout(() => {
    resetScoreZoom();
    const sheet = $("sheet");
    if (sheet && sheet.complete) prepareScoreView();
  }, 120);
  window.addEventListener("orientationchange", resetAfterRotation);
  if (screen.orientation && screen.orientation.addEventListener) {
    screen.orientation.addEventListener("change", resetAfterRotation);
  }
}

function resetPageZoom() {
  // Kept for orientation listeners from older versions.
  // Zoom is now isolated to the score and the page viewport is never scaled.
  resetScoreZoom();
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  if (wakeLock && !wakeLock.released) return;

  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch (error) {
    console.info("Maintien de l'écran actif indisponible :", error.name);
  }
}

fetch("data/repertoire.json")
  .then(response => {
    if (!response.ok) throw new Error("Catalogue indisponible");
    return response.json();
  })
  .then(data => {
    suites = data.suites;
    init();
  })
  .catch(() => {
    $("viewer").innerHTML = "<p>Impossible de charger le catalogue.</p>";
  });

if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js"));
}
