import { useState, useEffect, useRef, useCallback } from "react";
import './App.css'

// ── CONFIG ────────────────────────────────────────────────────────────────────
// Cseréld le erre a saját Google Apps Script Web App URL-edet
const SHEET_URL = "https://script.google.com/macros/s/AKfycbzP2j3isl0kW5rI6yn7pFMrAoMXg9ISkFAnslaH8d6_3dYsrUeC4hqPWAMTv_N7u3hA/exec";

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

  // fetch row count on mount
  useEffect(() => {
    fetch(SHEET_URL + "?action=count")
      .then((r) => r.json())
      .then((d) => setRowCount(d.count))
      .catch(() => setRowCount("?"));
  }, []);

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
        parties[p] = null; // no ad_type yet
      }
      return { ...r, parties };
    });
  }

  function confirmParties() {
    const selected = Object.keys(record.parties);
    if (selected.length === 0) return showToast("Válassz legalább egy pártot!", "err");
    // determine which parties need ad_type
    const needAdType = selected.filter((p) => record.parties[p] === null);
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
      parties: { ...r.parties, [adTypeTarget]: adType },
    }));
    const remaining = pendingAdTypes.filter((p) => p !== adTypeTarget);
    setPendingAdTypes(remaining);
    if (remaining.length > 0) {
      setAdTypeTarget(remaining[0]);
    } else {
      setAdTypeTarget(null);
      setStep("photo");
    }
  }

  // ── SAVE ────────────────────────────────────────────────────────────────────
async function handleSave() {
  setStep("saving");
  try {

    const adTypeJson = Object.fromEntries(
      Object.entries(record.parties).filter(([, v]) => v !== null)
    );
    const adNr = Object.keys(adTypeJson).length;
    const partiesStr = Object.keys(record.parties).join(",");

    const params = new URLSearchParams({
      action: "insert",
      id: record.id,
      timestamp: record.timestamp,
      latitude: record.lat,
      longitude: record.lng,
      parties: partiesStr,
      foto: "",
      ad_type: JSON.stringify(adTypeJson),
      ad_nr: adNr,
    });

    await fetch(SHEET_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    // no-cors miatt opaque a válasz, külön GET-tel kérjük le a sorszámot
    const countRes = await fetch(SHEET_URL + "?action=count");
    const countData = await countRes.json();
    setRowCount(countData.count);
    showToast(`Mentve! Összesen ${countData.count} sor.`, "ok");
  } catch (err) {
    showToast("Hiba a mentés során!", "err");
  }
  setStep("idle");
  setRecord(null);
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
        <h1 className="text-sm font-semibold tracking-wide">Plakátrögzítő App</h1>
        <span className="ml-auto text-xs text-slate-400">v1.0</span>
      </header>

      {/* MAIN */}
      <main className="flex-1 p-5 pb-28">
        {/* Row count card */}
        <div className="bg-white rounded-2xl p-4 mb-5 flex justify-between items-center border border-stone-200">
          <span className="text-sm text-stone-500">Rögzített sorok</span>
          <span className="text-2xl font-bold text-slate-900">
            {rowCount === null ? "…" : rowCount}
          </span>
        </div>

        {/* Empty state */}
        {step === "idle" && (
          <p className="text-center text-stone-400 text-sm mt-16">
            Nyomj a&nbsp;<strong className="text-slate-700">+</strong>&nbsp;gombra új rekord hozzáadásához
          </p>
        )}
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
                  Hirdetés típusa —{" "}
                  <span className="text-slate-500 font-normal">
                    {PARTY_LABELS[adTypeTarget] ?? adTypeTarget.toUpperCase()}
                  </span>
                </h2>
                <p className="text-xs text-stone-400 mb-4">
                  {pendingAdTypes.length} párt maradt ({pendingAdTypes.join(", ")})
                </p>
                <div className="grid grid-cols-3 gap-2 mb-6">
                  {AD_TYPES.map((a) => (
                    <button
                      key={a}
                      onClick={() => selectAdType(a)}
                      className="py-4 rounded-xl border border-stone-200 bg-white text-slate-800 text-base font-bold hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all active:scale-95"
                    >
                      {a === "mo" ? "Molinó" : a === "mu" ? "Multireklám (buszmegálló stb.)" : a === "op" ? "Óriásplakát" : a === "nl" ? "Nagy laminált" : a === "kl" ? "Kis laminált" : a === "eg" ? "Egyéb" : a}
                    </button>
                  ))}
                </div>
                {/* Summary of already assigned */}
                {record && (
                  <div className="space-y-2 mb-4">
                    {Object.entries(record.parties)
                      .filter(([, v]) => v !== null)
                      .map(([p, v]) => (
                        <div key={p} className="flex items-center gap-3 bg-stone-50 rounded-xl px-4 py-2">
                          <span className="w-7 h-7 rounded-lg bg-slate-900 text-white flex items-center justify-center text-xs font-bold">
                            {p.toUpperCase()}
                          </span>
                          <span className="flex-1 text-sm text-stone-500">
                            {PARTY_LABELS[p] ?? p}
                          </span>
                          <span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-2 py-1 rounded-lg">
                            {v}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
                <button onClick={handleCancel} className="w-full py-3 rounded-xl bg-stone-100 text-stone-600 text-sm font-medium">
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
              {v ?? "—"}
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
