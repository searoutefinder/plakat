import { useState, useEffect, useRef, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import './App.css'

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Cseréld le erre a saját Google Apps Script Web App URL-edet
const SHEET_URL = "https://script.google.com/macros/s/AKfycbxd3NGOoWWDt86whCLGi8FdG8jpCXmDDDLEVRZ3oVFNAv2olVX9v3JxvthCrw9JKPRK/exec";

const PARTIES = ["f", "t", "m", "d", "k"];
const AD_TYPES = ["mo", "mu", "op", "nl", "kl", "eg"];
const PARTY_LABELS = { f: "Fidesz", t: "TISZA", m: "Mi Hazánk", d: "DK", k: "Kutyapárt" };

// ── HELPERS ───────────────────────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function formatTs(d) {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

const LS_KEY = "voteapp_records";

function loadLocalRecords() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

async function getLocation() {
  return new Promise((res, rej) =>
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(
          (p) => res({ lat: p.coords.latitude.toFixed(6), lng: p.coords.longitude.toFixed(6) }),
          () => res({ lat: "", lng: "" })
        )
      : res({ lat: "", lng: "" })
  );
}

// ── APP ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [rowCount, setRowCount] = useState(null);
  const [step, setStep] = useState("idle"); // idle | parties | adtype | photo | saving
  const [record, setRecord] = useState(null);
  const [adTypeTarget, setAdTypeTarget] = useState(null); // which party we're picking ad_type for

  const [toast, setToast] = useState(null);
  const [pendingAdTypes, setPendingAdTypes] = useState([]); // parties that still need ad_type
  const fileInputRef = useRef();

  const [records, setRecords] = useState([]);
  const mapContainerRef = useRef();
  const mapRef = useRef();  
  const geolocateRef = useRef(null);

  const [localRecords, setLocalRecords] = useState([]);
  const [syncStatus, setSyncStatus] = useState("idle"); // idle | syncing | done | error
  const [storageInfo, setStorageInfo] = useState({ used: 0, total: 5 * 1024 * 1024 });

  const [sheetRecords, setSheetRecords] = useState([]);

  useEffect(() => {
    const local = loadLocalRecords();
    setLocalRecords(local);
    setRecords(local);
    updateStorageInfo();

    fetch(SHEET_URL + "?action=list")
      .then((r) => r.json())
      .then((d) => {
        setRowCount(d.count);
        setSheetRecords(d.records ?? []);
      })
      .catch(() => setRowCount("?"));
  }, []); 

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [18.9302, 47.5112],
      zoom: 11,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    mapRef.current = map;

    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
      },
      trackUserLocation: true,
      showUserLocation: true,
      showAccuracyCircle: true,
    });

    map.addControl(geolocate, "top-right");
    geolocateRef.current = geolocate;    

    map.on("load", () => {

      // Sheet rekordok forrása
      map.addSource("sheet-records", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Sheet rekordok rétege — más szín hogy megkülönböztethető legyen
      map.addLayer({
        id: "sheet-records-circle",
        type: "circle",
        source: "sheet-records",
        paint: {
          "circle-radius": 8,
          "circle-color": "#059669",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.85,
        },
      });

      map.on("click", "sheet-records-circle", (e) => {
        const props = e.features[0].properties;
        new maplibregl.Popup()
          .setLngLat(e.features[0].geometry.coordinates)
          .setHTML(`
            <div style="font-size:13px;line-height:1.6">
              <strong>${props.parties}</strong><br/>
              ${props.ad_type}<br/>
              <span style="color:#888;font-size:11px">${props.timestamp}</span>
            </div>
          `)
          .addTo(map);
      });

      map.on("mouseenter", "sheet-records-circle", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "sheet-records-circle", () => {
        map.getCanvas().style.cursor = "";
      });

      map.addSource("records", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "records-circle",
        type: "circle",
        source: "records",
        paint: {
          "circle-radius": 8,
          "circle-color": "#0f172a",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.85,
        },
      });

      map.on("click", "records-circle", (e) => {
        const props = e.features[0].properties;
        new maplibregl.Popup()
          .setLngLat(e.features[0].geometry.coordinates)
          .setHTML(`
            <div style="font-size:13px;line-height:1.6">
              <strong>${props.parties}</strong><br/>
              ${props.ad_type}<br/>
              <span style="color:#888;font-size:11px">${props.timestamp}</span>
            </div>
          `)
          .addTo(map);
      });

      map.on("mouseenter", "records-circle", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "records-circle", () => {
        map.getCanvas().style.cursor = "";
      });

      setTimeout(() => {
        geolocate.trigger();
      }, 500);      
    });

    return () => map.remove();
  }, []); 

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      const features = sheetRecords
        .filter((r) => r.latitude && r.longitude)
        .map((r) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [parseFloat(r.longitude), parseFloat(r.latitude)],
          },
          properties: {
            id: r.id,
            timestamp: r.timestamp,
            parties: r.parties,
            ad_type: r.ad_type,
            ad_nr: r.ad_nr,
          },
        }));

      const source = map.getSource("sheet-records");
      if (source) {
        source.setData({ type: "FeatureCollection", features });
      }

      // bounds igazítása az összes rekordra (helyi + sheet)
      const allFeatures = [
        ...features,
        ...records
          .filter((r) => r.latitude && r.longitude)
          .map((r) => ({
            geometry: {
              coordinates: [parseFloat(r.longitude), parseFloat(r.latitude)],
            },
          })),
      ];

      if (allFeatures.length === 0) return;

      if (allFeatures.length === 1) {
        map.flyTo({ center: allFeatures[0].geometry.coordinates, zoom: 14 });
        return;
      }

      const bounds = allFeatures.reduce(
        (b, f) => b.extend(f.geometry.coordinates),
        new maplibregl.LngLatBounds(
          allFeatures[0].geometry.coordinates,
          allFeatures[0].geometry.coordinates
        )
      );

      map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 800 });
    };

    if (map.isStyleLoaded()) {
      update();
    } else {
      map.once("load", update);
    }
  }, [sheetRecords]);  
  
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      const features = records
        .filter((r) => r.latitude && r.longitude)
        .map((r) => ({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [parseFloat(r.longitude), parseFloat(r.latitude)],
          },
          properties: {
            id: r.id,
            timestamp: r.timestamp,
            parties: r.parties,
            ad_type: r.ad_type,
            ad_nr: r.ad_nr,
          },
        }));

      const source = map.getSource("records");
      if (source) {
        source.setData({
          type: "FeatureCollection",
          features,
        });
      }
    };

    if (map.isStyleLoaded()) {
      update();
    } else {
      map.once("load", update);
    }
  }, [records]); 

  function saveLocalRecords(recs) {
    localStorage.setItem(LS_KEY, JSON.stringify(recs));
    updateStorageInfo();
  }

  function updateStorageInfo() {
    try {
      let used = 0;
      for (let k in localStorage) {
        if (localStorage.hasOwnProperty(k)) {
          used += (localStorage[k].length + k.length) * 2;
        }
      }
      setStorageInfo({ used, total: 5 * 1024 * 1024 });
    } catch {
      setStorageInfo({ used: 0, total: 5 * 1024 * 1024 });
    }
  }

  function showToast(msg, type = "ok") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  // ── START NEW RECORD ────────────────────────────────────────────────────────
  async function handleFabPress() {
    const ts = formatTs(new Date());
    const { lat, lng } = await getLocation();
    const id = genId();
    setRecord({ id, timestamp: ts, lat, lng, parties: {}, photo: null });
    setStep("parties");
  }

  // ── PARTY TOGGLE ────────────────────────────────────────────────────────────
  function toggleParty(p) {
    setRecord((r) => {
      const parties = { ...r.parties };
      if (parties[p] !== undefined) {
        delete parties[p];
      } else {
        //parties[p] = null; // no ad_type yet
        parties[p] = { adType: null, qty: 1 };
      }
      return { ...r, parties };
    });
  }

  function confirmParties() {
    const selected = Object.keys(record.parties);
    if (selected.length === 0) return showToast("Válassz legalább egy pártot!", "err");
    // determine which parties need ad_type
    //const needAdType = selected.filter((p) => record.parties[p] === null);
    const needAdType = selected.filter((p) => record.parties[p].adType === null);

    if (needAdType.length === 0) {
      setStep("photo");
      return;
    }
    setPendingAdTypes(needAdType);
    setAdTypeTarget(needAdType[0]);
    setStep("adtype");
  }

  // ── AD TYPE SELECT ──────────────────────────────────────────────────────────
  function selectAdType(adType) {
    setRecord((r) => ({
      ...r,
      parties: { ...r.parties, [adTypeTarget]: { adType, qty: 1 } },
    }));
    // itt megállunk — a Tovább gomb visz a következő pártra
  }

  // ── SAVE ────────────────────────────────────────────────────────────────────
  async function handleSave() {
    setStep("saving");
    try {
      const adTypeJson = Object.fromEntries(
        Object.entries(record.parties)
          .filter(([, v]) => v.adType !== null)
          .map(([p, v]) => [p, { type: v.adType, qty: v.qty }])
      );
      const adNr = Object.keys(adTypeJson).length;
      const partiesStr = Object.keys(record.parties).join(",");

      const newRec = {
        id: record.id,
        timestamp: record.timestamp,
        latitude: record.lat,
        longitude: record.lng,
        parties: partiesStr,
        foto: "",
        ad_type: JSON.stringify(adTypeJson),
        ad_nr: adNr,
      };

      const updated = [...loadLocalRecords(), newRec];
      console.log(updated);
      saveLocalRecords(updated);
      setLocalRecords(updated);
      setRecords(updated);
      showToast(`Helyi mentés kész! (${updated.length} db)`, "ok");
    } catch (err) {
      showToast("Hiba a mentés során!", "err");
    }
    setStep("idle");
    setRecord(null);
  }

  async function handleSync() {
    const local = loadLocalRecords();
    if (local.length === 0) return showToast("Nincs helyi adat!", "err");

    setSyncStatus("syncing");
    try {
      let successCount = 0;
      for (const rec of local) {
        const params = new URLSearchParams({ action: "insert", ...rec });
        await fetch(SHEET_URL, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        successCount++;
      }

      // sorszám frissítése
      const countRes = await fetch(SHEET_URL + "?action=count");
      const countData = await countRes.json();
      setRowCount(countData.count);

      // localStorage törlése
      localStorage.removeItem(LS_KEY);
      setLocalRecords([]);
      setRecords([]);      
      const listRes = await fetch(SHEET_URL + "?action=list");
      const listData = await listRes.json();
      setSheetRecords(listData.records ?? []);
      setRowCount(listData.count);      
      updateStorageInfo();
      setSyncStatus("done");
      showToast(`${successCount} rekord szinkronizálva!`, "ok");
      setTimeout(() => setSyncStatus("idle"), 3000);
    } catch (err) {
      setSyncStatus("error");
      showToast("Szinkron hiba!", "err");
      setTimeout(() => setSyncStatus("idle"), 3000);
    }
  }   

  function handleCancel() {
    setStep("idle");
    setRecord(null);
  }

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-stone-100 flex flex-col max-w-sm mx-auto relative select-none">
      {/* HEADER */}
      <header className="bg-slate-900 text-white px-5 py-4 flex items-center gap-3 sticky top-0 z-10">
        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
        <h1 className="text-sm font-semibold tracking-wide">Erre bezzeg telik</h1>
        <span className="ml-auto text-xs text-slate-400">v1.0</span>
      </header>

      {/* MAIN */}
      <main className="flex-1 p-5 pb-28">

        {/* Row count card */}
        <div className="bg-white rounded-2xl p-4 mb-5 flex justify-between items-center border border-stone-200">
          <span className="text-sm text-stone-500">Rögzített plakáthelyszínek</span>
          <span className="text-2xl font-bold text-slate-900">
            {rowCount === null ? "…" : rowCount}
          </span>
        </div>

        {/* Storage meter + Sync */}
        <div className="bg-white rounded-2xl p-4 mb-5 border border-stone-200">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-semibold text-stone-500 uppercase tracking-wider">
              Helyi tárhely
            </span>
            <span className="text-xs text-stone-400">
              {formatBytes(storageInfo.used)} / {formatBytes(storageInfo.total)}
            </span>
          </div>
          {/* progress bar */}
          <div className="w-full h-2 bg-stone-100 rounded-full overflow-hidden mb-3">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, (storageInfo.used / storageInfo.total) * 100).toFixed(1)}%`,
                background: storageInfo.used / storageInfo.total > 0.8
                  ? "#ef4444"
                  : storageInfo.used / storageInfo.total > 0.5
                  ? "#f59e0b"
                  : "#0f172a",
              }}
            />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-stone-500">
              <strong className="text-slate-900">{localRecords.length}</strong> helyi rekord
            </span>
            <button
              onClick={handleSync}
              disabled={syncStatus === "syncing" || localRecords.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold disabled:opacity-40 active:scale-95 transition-all"
            >
              {syncStatus === "syncing" ? (
                <>
                  <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Szinkron…
                </>
              ) : syncStatus === "done" ? (
                "✓ Kész!"
              ) : (
                "↑ Sheet szinkron"
              )}
            </button>
          </div>
        </div>

        {/* Térkép */}
        <div
          ref={mapContainerRef}
          className="rounded-2xl overflow-hidden mb-5 border border-stone-200"
          style={{ height: "400px" }}
        /> 

        <div className="flex gap-4 px-1 mb-5">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-slate-900 border-2 border-white shadow" />
            <span className="text-xs text-stone-500">Helyi (nem szinkronizált)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-600 border-2 border-white shadow" />
            <span className="text-xs text-stone-500">Sheet</span>
          </div>
        </div>               

      </main>

      {/* FAB */}
      {step === "idle" && (
        <button
          onClick={handleFabPress}
          className="fixed bottom-7 right-7 w-16 h-16 bg-slate-900 text-white rounded-full flex items-center justify-center text-3xl shadow-xl active:scale-95 transition-transform z-20"
          aria-label="Új rekord"
        >
          +
        </button>
      )}

      {/* TOAST */}
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl text-sm font-medium shadow-lg z-50 whitespace-nowrap ${
            toast.type === "ok" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* ── MODAL OVERLAY ── */}
      {step !== "idle" && step !== "saving" && (
        <div className="fixed inset-0 bg-black/40 z-30 flex items-end">
          <div className="bg-white rounded-t-3xl p-6 w-full max-h-[90vh] overflow-y-auto">
            {/* Timestamp + coords */}
            {record && (
              <p className="text-xs text-stone-400 mb-4">
                {record.timestamp} · {record.lat || "GPS…"}, {record.lng || ""}
              </p>
            )}

            {/* ── STEP: PARTIES ── */}
            {step === "parties" && (
              <>
                <h2 className="text-base font-semibold mb-1">Pártok kiválasztása</h2>
                <p className="text-xs text-stone-400 mb-4">Több párt is kijelölhető</p>
                <div className="flex flex-wrap gap-2 mb-6">
                  {PARTIES.map((p) => (
                    <button
                      key={p}
                      onClick={() => toggleParty(p)}
                      className={`px-5 py-2 rounded-full border text-sm font-semibold transition-all ${
                        record?.parties[p] !== undefined
                          ? "bg-slate-900 text-white border-slate-900"
                          : "bg-white text-slate-700 border-stone-300"
                      }`}
                    >
                      {p.toUpperCase() === "F" ? "Fidesz" : p.toUpperCase() === "T" ? "Tisza" : p.toUpperCase() === "M" ? "Mi Hazánk" : p.toUpperCase() === "D" ? "DK" : p.toUpperCase() === "K" ? "Kutyapárt" : p.toUpperCase()}
                    </button>
                  ))}
                </div>
                {record && Object.keys(record.parties).length > 0 && (
                  <div className="mb-4">
                    <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">
                      Kijelölve
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {Object.keys(record.parties).map((p) => (
                        <span
                          key={p}
                          className="bg-slate-100 text-slate-700 text-xs font-medium px-3 py-1 rounded-full"
                        >
                          {PARTY_LABELS[p] ?? p.toUpperCase()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex gap-3 mt-2">
                  <button onClick={handleCancel} className="flex-1 py-3 rounded-xl bg-stone-100 text-stone-600 text-sm font-medium">
                    Mégsem
                  </button>
                  <button onClick={confirmParties} className="flex-1 py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold">
                    Tovább →
                  </button>
                </div>
              </>
            )}

            {/* ── STEP: AD TYPE ── */}
{step === "adtype" && adTypeTarget && (
  <>
    <h2 className="text-base font-semibold mb-1">
      Hirdetés —{" "}
      <span className="text-slate-500 font-normal">
        {PARTY_LABELS[adTypeTarget] ?? adTypeTarget.toUpperCase()}
      </span>
    </h2>
    <p className="text-xs text-stone-400 mb-4">
      {pendingAdTypes.length} párt maradt ({pendingAdTypes.join(", ")})
    </p>

    {record.parties[adTypeTarget]?.adType === null ? (
      <>
        <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">Típus</p>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {AD_TYPES.map((a) => (
            <button
              key={a}
              onClick={() => selectAdType(a)}
              className="py-4 rounded-xl border border-stone-200 bg-white text-slate-800 text-base font-bold hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all active:scale-95"
            >
              {a === "mo" ? 
              "Molinó" : 
              a === "mu" ? 
              "Multireklám (busz stb.)" : 
              a === "op" ? 
              "Óriásplakát" : 
              a === "nl" ? 
              "Nagy laminált" : 
              a === "kl" ? 
              "Kis laminált" : 
              a === "eg" ? 
              "Egyéb" : 
              a}
            </button>
          ))}
        </div>
      </>
    ) : (
      <>
        <div className="flex items-center gap-3 bg-stone-50 rounded-xl px-4 py-3 mb-4">
          <span className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center text-xs font-bold">
            {adTypeTarget.toUpperCase()}
          </span>
          <span className="flex-1 text-sm font-medium">{record.parties[adTypeTarget].adType}</span>
        </div>
        <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Mennyiség</p>
        <div className="flex items-center justify-center gap-6 mb-6">
          <button
            onClick={() =>
              setRecord((r) => ({
                ...r,
                parties: {
                  ...r.parties,
                  [adTypeTarget]: {
                    ...r.parties[adTypeTarget],
                    qty: Math.max(1, r.parties[adTypeTarget].qty - 1),
                  },
                },
              }))
            }
            className="w-12 h-12 rounded-full bg-stone-100 text-slate-700 text-2xl font-bold flex items-center justify-center active:scale-95 transition-transform"
          >
            −
          </button>
          <span className="text-4xl font-bold text-slate-900 w-12 text-center">
            {record.parties[adTypeTarget].qty}
          </span>
          <button
            onClick={() =>
              setRecord((r) => ({
                ...r,
                parties: {
                  ...r.parties,
                  [adTypeTarget]: {
                    ...r.parties[adTypeTarget],
                    qty: r.parties[adTypeTarget].qty + 1,
                  },
                },
              }))
            }
            className="w-12 h-12 rounded-full bg-slate-900 text-white text-2xl font-bold flex items-center justify-center active:scale-95 transition-transform"
          >
            +
          </button>
        </div>
        <button
          onClick={() => {
            const remaining = pendingAdTypes.filter((p) => p !== adTypeTarget);
            setPendingAdTypes(remaining);
            if (remaining.length > 0) {
              setAdTypeTarget(remaining[0]);
              setRecord((r) => ({
                ...r,
                parties: {
                  ...r.parties,
                  [remaining[0]]: { adType: null, qty: 1 },
                },
              }));
            } else {
              setAdTypeTarget(null);
              setStep("photo");
            }
          }}
          className="w-full py-3 rounded-xl bg-slate-900 text-white text-sm font-semibold active:scale-95 transition-transform"
        >
          Tovább →
        </button>
      </>
    )}

    {/* Már hozzárendelt pártok összefoglalója */}
    {record && (
      <div className="space-y-2 mt-4">
        {Object.entries(record.parties)
          .filter(([, v]) => v.adType !== null)
          .map(([p, v]) => (
            <div key={p} className="flex items-center gap-3 bg-stone-50 rounded-xl px-4 py-2">
              <span className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center text-xs font-bold">
                {p.toUpperCase()}
              </span>
              <span className="flex-1 text-sm text-stone-500">{PARTY_LABELS[p] ?? p}</span>
              <span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-2 py-1 rounded-lg">
                {v.adType} × {v.qty}
              </span>
            </div>
          ))}
      </div>
    )}

    <button onClick={handleCancel} className="w-full py-3 rounded-xl bg-stone-100 text-stone-600 text-sm font-medium mt-3">
      Mégsem
    </button>
  </>
)}

            {/* ── STEP: PHOTO ── */}
{step === "photo" && (
  <>
    <h2 className="text-base font-semibold mb-4">Összefoglaló</h2>
    {record && (
      <div className="space-y-2 mb-6">
        {Object.entries(record.parties).map(([p, v]) => (
          <div key={p} className="flex items-center gap-3 bg-stone-50 rounded-xl px-4 py-2">
            <span className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center text-xs font-bold">
              {p.toUpperCase()}
            </span>
            <span className="flex-1 text-sm text-stone-500">{PARTY_LABELS[p] ?? p}</span>
<span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-2 py-1 rounded-lg">
  {v.adType ?? "—"} × {v.qty}
</span>
          </div>
        ))}
      </div>
    )}
    <div className="flex gap-3">
      <button onClick={handleCancel} className="flex-1 py-3 rounded-xl bg-stone-100 text-stone-600 text-sm font-medium">
        Mégsem
      </button>
      <button
        onClick={handleSave}
        className="flex-1 py-3 rounded-xl bg-emerald-600 text-white text-sm font-semibold active:scale-95 transition-transform"
      >
        💾 Mentés
      </button>
    </div>
  </>
)}
          </div>
        </div>
      )}

      {/* SAVING OVERLAY */}
      {step === "saving" && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-white rounded-2xl px-8 py-6 flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-4 border-slate-900 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-medium text-slate-700">Mentés folyamatban…</p>
          </div>
        </div>
      )}
    </div>
  );
}
