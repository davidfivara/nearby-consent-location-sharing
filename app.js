// Nearby - consent-based live location sharing
// Front-end only. Real GPS via browser Geolocation API.
// Live cross-device sync via Firebase Realtime Database (optional, user-provided config).
// Falls back to local demo mode when no Firebase config is present.

const LS = { name: "nearby.name", consent: "nearby.consent", group: "nearby.group", fb: "nearby.firebase", uid: "nearby.uid" };

const state = {
  uid: localStorage.getItem(LS.uid) || cryptoId(),
  name: localStorage.getItem(LS.name) || "",
  group: localStorage.getItem(LS.group) || "",
  sharing: true, mode: "demo", map: null, markers: {}, people: {},
  watchId: null, demoTimer: null, fb: null, myPos: null,
};
localStorage.setItem(LS.uid, state.uid);

function cryptoId() { return "u_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s).replace(/[<>&"]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }

const consentCheck = $("consentCheck"), displayName = $("displayName"), enterBtn = $("enterBtn");
displayName.value = state.name;
function refreshGate() { enterBtn.disabled = !(consentCheck.checked && displayName.value.trim().length >= 1); }
consentCheck.addEventListener("change", refreshGate);
displayName.addEventListener("input", refreshGate);
enterBtn.addEventListener("click", () => {
  state.name = displayName.value.trim();
  localStorage.setItem(LS.name, state.name);
  localStorage.setItem(LS.consent, "1");
  $("gate").classList.add("hidden"); $("main").classList.remove("hidden"); boot();
});
if (localStorage.getItem(LS.consent) === "1" && state.name) {
  $("gate").classList.add("hidden"); $("main").classList.remove("hidden");
  window.addEventListener("DOMContentLoaded", boot);
}

function boot() {
  initMap(); loadFirebaseFromStorage();
  if (!state.group) state.group = randomCode();
  localStorage.setItem(LS.group, state.group);
  $("groupCode").value = state.group; updateGroupPill();
  startGeolocation();
  if (state.mode === "demo") startDemo();
  wireUi(); render();
}

function initMap() {
  state.map = L.map("map", { zoomControl: true }).setView([6.5244, 3.3792], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }).addTo(state.map);
}

function startGeolocation() {
  if (!("geolocation" in navigator)) { console.warn("Geolocation unavailable"); return; }
  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      state.myPos = { lat: latitude, lng: longitude, ts: Date.now() };
      upsertPerson({ uid: state.uid, name: state.name, lat: latitude, lng: longitude, ts: Date.now(), me: true });
      if (state.sharing) publishMyPosition();
      centerOnMeOnce();
    },
    (err) => console.warn("Geo error", err.message),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}
let centered = false;
function centerOnMeOnce() { if (centered || !state.myPos) return; centered = true; state.map.setView([state.myPos.lat, state.myPos.lng], 15); }

function upsertPerson(p) { state.people[p.uid] = { ...state.people[p.uid], ...p }; drawMarker(p.uid); render(); }
function removePerson(uid) { if (state.markers[uid]) { state.map.removeLayer(state.markers[uid]); delete state.markers[uid]; } delete state.people[uid]; render(); }
function colorFor(uid) { let h = 0; for (const c of uid) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 70% 55%)`; }
function drawMarker(uid) {
  const p = state.people[uid]; if (!p || p.lat == null) return;
  const isMe = p.me;
  const html = `<div class="marker-label ${isMe ? "marker-me" : ""}">${esc(p.name || "?")}${isMe ? " (you)" : ""}</div>`;
  const icon = L.divIcon({ className: "", html, iconSize: [10, 10], iconAnchor: [10, 24] });
  if (state.markers[uid]) state.markers[uid].setLatLng([p.lat, p.lng]).setIcon(icon);
  else state.markers[uid] = L.marker([p.lat, p.lng], { icon }).addTo(state.map);
}

const DEMO = [
  { uid: "demo_sam", name: "Sam", lat: 6.5290, lng: 3.3760 },
  { uid: "demo_amara", name: "Amara", lat: 6.5200, lng: 3.3850 },
  { uid: "demo_leo", name: "Leo", lat: 6.5265, lng: 3.3710 },
];
function startDemo() {
  DEMO.forEach(d => upsertPerson({ ...d, ts: Date.now() }));
  state.demoTimer = setInterval(() => {
    DEMO.forEach(d => { const p = state.people[d.uid]; if (!p) return;
      p.lat += (Math.random() - 0.5) * 0.0009; p.lng += (Math.random() - 0.5) * 0.0009; p.ts = Date.now(); upsertPerson(p); });
  }, 3000);
}
function stopDemo() { if (state.demoTimer) { clearInterval(state.demoTimer); state.demoTimer = null; } DEMO.forEach(d => removePerson(d.uid)); }

async function loadFirebaseFromStorage() {
  const raw = localStorage.getItem(LS.fb);
  if (!raw) { state.mode = "demo"; return; }
  try { await connectFirebase(JSON.parse(raw)); }
  catch (e) { console.warn("Firebase config invalid, staying in demo mode", e); state.mode = "demo"; }
}
async function connectFirebase(cfg) {
  const appMod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
  const dbMod = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");
  const app = appMod.initializeApp(cfg, "nearby-" + Date.now());
  const db = dbMod.getDatabase(app);
  state.fb = { app, db, mod: dbMod }; state.mode = "live";
  stopDemo(); subscribeGroup(); publishMyPosition(); updateModeBadge();
}
function groupPath() { return `groups/${state.group}/members`; }
function subscribeGroup() {
  if (!state.fb) return; const { db, mod } = state.fb;
  Object.keys(state.people).forEach(uid => { if (uid !== state.uid) removePerson(uid); });
  const r = mod.ref(db, groupPath());
  mod.onValue(r, (snap) => {
    const val = snap.val() || {}; const seen = new Set();
    Object.entries(val).forEach(([uid, m]) => { if (!m || m.lat == null) return; seen.add(uid);
      upsertPerson({ uid, name: m.name, lat: m.lat, lng: m.lng, ts: m.ts, me: uid === state.uid }); });
    Object.keys(state.people).forEach(uid => { if (uid !== state.uid && !seen.has(uid) && !uid.startsWith("demo_")) removePerson(uid); });
  });
}
function publishMyPosition() {
  if (state.mode !== "live" || !state.fb || !state.myPos || !state.sharing) return;
  const { db, mod } = state.fb; const r = mod.ref(db, `${groupPath()}/${state.uid}`);
  mod.set(r, { name: state.name, lat: state.myPos.lat, lng: state.myPos.lng, ts: Date.now() });
  mod.onDisconnect(r).remove();
}
function stopPublishing() { if (state.mode !== "live" || !state.fb) return; const { db, mod } = state.fb; mod.remove(mod.ref(db, `${groupPath()}/${state.uid}`)); }

function wireUi() {
  $("settingsBtn").addEventListener("click", () => $("settingsModal").classList.remove("hidden"));
  $("closeSettings").addEventListener("click", () => $("settingsModal").classList.add("hidden"));
  $("groupBtn").addEventListener("click", () => $("groupModal").classList.remove("hidden"));
  $("closeGroup").addEventListener("click", () => $("groupModal").classList.add("hidden"));
  $("recenterBtn").addEventListener("click", () => { if (state.myPos) state.map.setView([state.myPos.lat, state.myPos.lng], 15); });
  $("toggleShareBtn").addEventListener("click", () => { state.sharing = !state.sharing; if (state.sharing) publishMyPosition(); else stopPublishing(); render(); });
  $("firebaseConfig").value = localStorage.getItem(LS.fb) || "";
  $("saveFirebase").addEventListener("click", async () => {
    const raw = $("firebaseConfig").value.trim();
    if (!raw) { alert("Paste your Firebase config, or tap 'Use demo mode'."); return; }
    let cfg; try { cfg = JSON.parse(raw); } catch { alert("That doesn't look like valid JSON. Copy the config object exactly."); return; }
    if (!cfg.databaseURL) { alert("Config needs a databaseURL (Realtime Database)."); return; }
    localStorage.setItem(LS.fb, JSON.stringify(cfg));
    try { await connectFirebase(cfg); $("settingsModal").classList.add("hidden"); alert("Connected! You're now sharing live with your group."); }
    catch (e) { alert("Could not connect: " + e.message); }
  });
  $("clearFirebase").addEventListener("click", () => { localStorage.removeItem(LS.fb); location.reload(); });
  $("genCode").addEventListener("click", () => { $("groupCode").value = randomCode(); });
  $("copyCode").addEventListener("click", async () => { try { await navigator.clipboard.writeText($("groupCode").value); $("copyCode").textContent = "Copied"; setTimeout(() => $("copyCode").textContent = "Copy code", 1500); } catch {} });
  $("joinGroup").addEventListener("click", () => {
    const code = ($("groupCode").value || "").trim().toUpperCase();
    if (code.length < 4) { alert("Group code must be at least 4 characters."); return; }
    if (state.mode === "live") stopPublishing();
    state.group = code; localStorage.setItem(LS.group, code); updateGroupPill();
    if (state.mode === "live") { subscribeGroup(); publishMyPosition(); }
    $("groupModal").classList.add("hidden"); render();
  });
  $("leaveBtn").addEventListener("click", () => {
    if (!confirm("Stop sharing and clear your identity on this device?")) return;
    if (state.mode === "live") stopPublishing();
    if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
    localStorage.removeItem(LS.consent); localStorage.removeItem(LS.name); location.reload();
  });
}
function randomCode() { const A = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; let s = ""; for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)]; return s; }
function updateGroupPill() { $("groupPill").textContent = state.group || "-"; }
function updateModeBadge() { const b = $("modeBadge"); if (state.mode === "live") { b.textContent = "Live"; b.className = "badge live"; } else { b.textContent = "Demo mode"; b.className = "badge demo"; } }

function render() {
  updateModeBadge();
  const ss = $("shareState");
  ss.textContent = state.sharing ? "\u25cf Sharing on" : "\u25cf Sharing paused";
  ss.className = "share-state " + (state.sharing ? "on" : "off");
  $("toggleShareBtn").textContent = state.sharing ? "Pause sharing" : "Resume sharing";
  const list = $("peopleList"); const entries = Object.values(state.people);
  $("peopleCount").textContent = entries.length + (entries.length === 1 ? " person" : " people");
  list.innerHTML = "";
  entries.sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0)).forEach(p => {
    const li = document.createElement("li");
    const ago = p.ts ? Math.max(0, Math.round((Date.now() - p.ts) / 1000)) : null;
    li.innerHTML = `<span class="dot" style="background:${p.me ? "#22c55e" : colorFor(p.uid)}"></span><span class="person-name">${esc(p.name || "?")}${p.me ? " (you)" : ""}</span><span class="person-meta">${ago == null ? "" : ago + "s ago"}</span>`;
    li.addEventListener("click", () => { if (p.lat != null) state.map.setView([p.lat, p.lng], 16); });
    list.appendChild(li);
  });
}
setInterval(render, 5000);
