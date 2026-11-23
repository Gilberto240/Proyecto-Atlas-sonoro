// Escala musical pentatónica mayor (C3 a C6) para evitar choques disonantes
const SCALE = [
  "C3", "D3", "E3", "G3", "A3",
  "C4", "D4", "E4", "G4", "A4",
  "C5", "D5", "E5", "G5", "A5",
  "C6"
];

// Mapa con OpenStreetMap (sin necesidad de API Key)
const map = L.map("map").setView([25.565, -108.469], 6);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "© OpenStreetMap contributors"
}).addTo(map);

// Estado de ubicaciones y reproducción
let locations = [];
let nextId = 1;
let toneReady = false;
let mixInterval = null;
let stepIndex = 0;

// Instrumentos y efectos de Tone.js
let mainSynth = null;
let fmSynth = null;
let amSynth = null;
let kickSynth = null;
let filterNode = null;
let delayNode = null;

async function ensureToneAudio() {
  if (!toneReady) {
    await Tone.start();

    delayNode = new Tone.FeedbackDelay("8n", 0.25);
    filterNode = new Tone.Filter(1800, "lowpass");

    mainSynth = new Tone.Synth({
      oscillator: { type: "triangle" },
      envelope: { attack: 0.03, decay: 0.2, sustain: 0.35, release: 0.6 }
    });

    fmSynth = new Tone.FMSynth({
      harmonicity: 2,
      modulationIndex: 3,
      envelope: { attack: 0.02, decay: 0.25, sustain: 0.2, release: 0.5 }
    });

    amSynth = new Tone.AMSynth({
      harmonicity: 1.5,
      envelope: { attack: 0.08, decay: 0.3, sustain: 0.4, release: 0.8 }
    });

    kickSynth = new Tone.MembraneSynth({
      pitchDecay: 0.04,
      octaves: 4,
      envelope: { attack: 0.005, decay: 0.2, sustain: 0, release: 0.2 }
    });

    mainSynth.chain(filterNode, delayNode, Tone.getDestination());
    fmSynth.chain(filterNode, delayNode, Tone.getDestination());
    amSynth.chain(filterNode, delayNode, Tone.getDestination());
    kickSynth.connect(Tone.getDestination());

    toneReady = true;
  }

  if (Tone.context.state !== "running") {
    await Tone.context.resume();
  }
}

// Seleccionar nota, instrumento y filtro según temperatura, viento y tipo de zona
function calcularSonidoUbicacion(temp, wind, zonaClass = "", indexOffset = 0) {
  const tempNorm = Math.max(0, Math.min(42, temp + 4));
  let idx = Math.floor((tempNorm / 46) * (SCALE.length - 1)) + indexOffset;
  idx = Math.max(0, Math.min(SCALE.length - 1, idx));
  const note = SCALE[idx];

  const esAguaOCosta = /water|coast|sea|beach|bay|river/i.test(zonaClass);

  let instrumento = "synth";
  let waveType = "triangle";
  let estiloNombre = "Brisa Melódica";

  if (esAguaOCosta) {
    instrumento = "am";
    estiloNombre = "Onda Costera (AM)";
  } else if (wind > 20) {
    instrumento = "fm";
    estiloNombre = "Viento Cristalino (FM)";
  } else if (temp < 14) {
    instrumento = "synth";
    waveType = "sine";
    estiloNombre = "Pad Frío (Sine)";
  } else if (temp > 29) {
    instrumento = "synth";
    waveType = "sawtooth";
    estiloNombre = "Sol Cálido (Saw)";
  } else {
    instrumento = "synth";
    waveType = "triangle";
    estiloNombre = "Tono Templado (Tri)";
  }

  const cutoff = Math.max(450, Math.min(4500, 700 + Math.max(0, temp) * 45 + Math.min(wind, 50) * 25));

  return { note, instrumento, waveType, estiloNombre, cutoff };
}

// Reproducir una ubicación con Tone.js
async function playLocationSound(loc, duration = "8n", incluirPulso = false) {
  await ensureToneAudio();

  const intensidadPct = Number(document.getElementById("balance-slider").value);
  const gainLevel = Math.max(0.05, Math.min(0.9, intensidadPct / 100));

  filterNode.frequency.rampTo(loc.cutoff, 0.08);
  Tone.getDestination().volume.value = Tone.gainToDb(gainLevel);

  const now = Tone.now();

  if (loc.instrumento === "fm") {
    fmSynth.triggerAttackRelease(loc.note, duration, now);
  } else if (loc.instrumento === "am") {
    amSynth.triggerAttackRelease(loc.note, duration, now);
  } else {
    mainSynth.set({ oscillator: { type: loc.waveType } });
    mainSynth.triggerAttackRelease(loc.note, duration, now);
  }

  if (incluirPulso && kickSynth) {
    kickSynth.triggerAttackRelease("C2", "16n", now, 0.35);
  }
}

// Agregar nueva ubicación
async function agregarUbicacion(lat, lon, nombreOverride = null) {
  const statusEl = document.getElementById("status-text");
  statusEl.textContent = "Consultando clima y lugar...";

  let temp = 22;
  let wind = 10;
  let zonaClass = "";
  let nombreLugar = nombreOverride || `Lat ${Number(lat).toFixed(2)}, Lon ${Number(lon).toFixed(2)}`;

  try {
    const urlClima = new URL("https://api.open-meteo.com/v1/forecast");
    urlClima.searchParams.set("latitude", lat);
    urlClima.searchParams.set("longitude", lon);
    urlClima.searchParams.set("current_weather", "true");

    const resClima = await fetch(urlClima.toString());
    if (resClima.ok) {
      const dataClima = await resClima.json();
      if (dataClima.current_weather) {
        temp = dataClima.current_weather.temperature;
        wind = dataClima.current_weather.windspeed;
      }
    }
  } catch (err) {
    console.warn("Error obteniendo clima:", err);
  }

  try {
    const resGeo = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1&accept-language=es`
    );
    if (resGeo.ok) {
      const dataGeo = await resGeo.json();
      zonaClass = `${dataGeo.class || ""} ${dataGeo.type || ""}`;
      if (!nombreOverride) {
        const addr = dataGeo.address || {};
        const fullText = `${dataGeo.display_name || ""} ${JSON.stringify(addr)}`;
        if (/guasave/i.test(fullText)) {
          nombreLugar = "Guasave, MX";
        } else {
          const ciudad = addr.city || addr.town || addr.municipality || addr.village || addr.state || "Zona";
          const pais = addr.country_code ? addr.country_code.toUpperCase() : "";
          nombreLugar = pais ? `${ciudad}, ${pais}` : ciudad;
        }
      }
    }
  } catch (err) {
    console.warn("Error en geocodificación inversa:", err);
  }

  const id = nextId++;
  const offset = (locations.length % 3) - 1;
  const soundCfg = calcularSonidoUbicacion(temp, wind, zonaClass, offset);

  const marker = L.circleMarker([lat, lon], {
    radius: 8,
    color: "#58a6ff",
    fillOpacity: 0.85
  }).addTo(map);

  const nuevaUbicacion = {
    id,
    nombre: nombreLugar,
    lat: Number(lat),
    lon: Number(lon),
    temp,
    wind,
    ...soundCfg,
    marker
  };

  locations.push(nuevaUbicacion);
  renumerarYActualizarTooltips();
  renderLocations();
  map.setView([lat, lon], Math.max(map.getZoom(), 6));

  statusEl.textContent = `Agregada: ${nombreLugar} • ${soundCfg.estiloNombre} (${soundCfg.note})`;
  await playLocationSound(nuevaUbicacion, "4n", false);
}

// Eliminar una ubicación específica
function eliminarUbicacion(id) {
  const idx = locations.findIndex((item) => item.id === id);
  if (idx === -1) return;

  const estabaMezclando = mixInterval !== null;
  detenerMezcla();

  const [eliminada] = locations.splice(idx, 1);
  if (eliminada && eliminada.marker) {
    map.removeLayer(eliminada.marker);
  }

  renumerarYActualizarTooltips();
  renderLocations();

  document.getElementById("status-text").textContent =
    locations.length > 0
      ? `Eliminada "${eliminada.nombre}". Quedan ${locations.length} ubicaciones.`
      : "Todas las ubicaciones eliminadas. Agrega una nueva.";

  if (estabaMezclando && locations.length > 0) {
    mezclarTodas();
  }
}

// Borrar todas las ubicaciones
function borrarTodasUbicaciones() {
  detenerMezcla();
  locations.forEach((loc) => {
    if (loc.marker) map.removeLayer(loc.marker);
  });
  locations = [];
  renderLocations();
  document.getElementById("status-text").textContent = "Mapa y lista vacíos.";
}

function renumerarYActualizarTooltips() {
  locations.forEach((loc, i) => {
    loc.orden = i + 1;
    if (loc.marker) {
      loc.marker.unbindTooltip();
      loc.marker.bindTooltip(`#${loc.orden} ${loc.nombre}`, {
        permanent: true,
        direction: "top"
      });
    }
  });
}

function renderLocations() {
  const grid = document.getElementById("locations-grid");
  const countEl = document.getElementById("locations-count");
  countEl.textContent = String(locations.length);
  grid.innerHTML = "";

  locations.forEach((loc) => {
    const card = document.createElement("article");
    card.className = "location-card";
    card.id = `loc-card-${loc.id}`;

    card.innerHTML = `
      <div class="location-top">
        <div class="location-title">#${loc.orden} • ${loc.nombre}</div>
        <div class="location-weather">${loc.temp}°C • ${loc.wind} km/h</div>
      </div>
      <div class="location-meta">
        Nota: <strong>${loc.note}</strong> • ${loc.estiloNombre}
      </div>
      <div class="location-actions">
        <button class="btn-solo" onclick="oirSolo(${loc.id})">▶ Solo</button>
        <button class="btn-delete" onclick="eliminarUbicacion(${loc.id})">✕ Eliminar</button>
      </div>
    `;

    grid.appendChild(card);
  });
}

function resaltarTarjeta(id) {
  document.querySelectorAll(".location-card").forEach((el) => el.classList.remove("playing"));
  const card = document.getElementById(`loc-card-${id}`);
  if (card) card.classList.add("playing");
}

async function oirSolo(id) {
  detenerMezcla();
  const loc = locations.find((item) => item.id === id);
  if (!loc) return;

  resaltarTarjeta(id);
  await playLocationSound(loc, "4n", false);
  document.getElementById("status-text").textContent =
    `Solo: #${loc.orden} ${loc.nombre} • ${loc.estiloNombre} (${loc.note})`;

  setTimeout(() => {
    const card = document.getElementById(`loc-card-${id}`);
    if (card) card.classList.remove("playing");
  }, 600);
}

async function mezclarTodas() {
  if (locations.length === 0) {
    alert("Agrega al menos una ubicación primero.");
    return;
  }

  detenerMezcla();
  await ensureToneAudio();

  const intervaloMs = Number(document.getElementById("speed-slider").value);
  stepIndex = 0;

  const tick = async () => {
    if (locations.length === 0) return;
    const actual = locations[stepIndex % locations.length];

    // Variación de nota dentro de la escala en cada vuelta
    const baseIdx = Math.max(0, SCALE.indexOf(actual.note));
    const salto = (Math.floor(stepIndex / locations.length) + stepIndex) % 3 === 0 ? 1 : 0;
    const notaActual = SCALE[Math.min(SCALE.length - 1, baseIdx + salto)];

    resaltarTarjeta(actual.id);
    await playLocationSound(
      { ...actual, note: notaActual },
      stepIndex % 2 === 0 ? "8n" : "16n",
      stepIndex % 2 === 0
    );

    document.getElementById("status-text").textContent =
      `Mezclando: #${actual.orden} ${actual.nombre} • ${actual.estiloNombre} (${notaActual})`;
    stepIndex++;
  };

  await tick();
  mixInterval = setInterval(tick, intervaloMs);
}

function detenerMezcla() {
  if (mixInterval) {
    clearInterval(mixInterval);
    mixInterval = null;
  }
  document.querySelectorAll(".location-card").forEach((el) => el.classList.remove("playing"));
}

async function buscarYAgregarCiudad() {
  const input = document.getElementById("city-input");
  const query = input.value.trim();
  if (!query) return;

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}&accept-language=es`
    );
    if (res.ok) {
      const results = await res.json();
      if (results.length > 0) {
        const item = results[0];
        await agregarUbicacion(parseFloat(item.lat), parseFloat(item.lon), query);
        input.value = "";
      } else {
        alert("No se encontró esa ciudad.");
      }
    }
  } catch (err) {
    console.error("Error buscando ciudad:", err);
  }
}

function agregarDesdeCoordenadas() {
  const latInput = document.getElementById("lat-input");
  const lonInput = document.getElementById("lon-input");
  const lat = parseFloat(latInput.value);
  const lon = parseFloat(lonInput.value);

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    alert("Ingresa latitud y longitud válidas.");
    return;
  }

  agregarUbicacion(lat, lon);
  latInput.value = "";
  lonInput.value = "";
}

// Eventos
document.getElementById("add-city-btn").addEventListener("click", buscarYAgregarCiudad);
document.getElementById("city-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") buscarYAgregarCiudad();
});

document.getElementById("add-coords-btn").addEventListener("click", agregarDesdeCoordenadas);
document.getElementById("mix-btn").addEventListener("click", mezclarTodas);
document.getElementById("stop-btn").addEventListener("click", detenerMezcla);
document.getElementById("clear-all-btn").addEventListener("click", borrarTodasUbicaciones);

document.getElementById("gps-btn").addEventListener("click", () => {
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => agregarUbicacion(pos.coords.latitude, pos.coords.longitude),
      () => alert("No se pudo obtener tu ubicación GPS.")
    );
  }
});

document.getElementById("balance-slider").addEventListener("input", (e) => {
  const val = Number(e.target.value);
  document.getElementById("balance-label").textContent = `Volumen / Intensidad: ${val}%`;
});

document.getElementById("speed-slider").addEventListener("input", (e) => {
  const val = Number(e.target.value);
  const ritmo = val <= 250 ? "Rápido" : val <= 550 ? "Normal" : "Lento";
  document.getElementById("speed-label").textContent = `${ritmo} (${val} ms)`;
  if (mixInterval) mezclarTodas();
});

map.on("click", (e) => {
  agregarUbicacion(e.latlng.lat, e.latlng.lng);
});

// Carga inicial de ejemplo
agregarUbicacion(25.565, -108.469, "Guasave, MX");
agregarUbicacion(64.1466, -21.9426, "Reykjavík, IS");