import { useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import { Circle, MapContainer, Polyline, TileLayer, useMap } from "react-leaflet";
import { auth, db, googleProvider, hasFirebaseConfig } from "./firebase";
import { formatCoord, formatTime, haversineDistance, nearestDistanceToRoute } from "./utils";
import appLogo from "../assets/images/logo.png";

const CONTACTS_STORAGE_KEY = "safewalk.contacts.v1";
const DEVIATION_THRESHOLD_METERS = 90;
const HONDURAS_DEFAULT_POSITION = { lat: 14.0818, lng: -87.2068 };

const DEFAULT_CONTACTS = [
  { id: "c1", name: "Ana", phone: "+502 5555-1020" },
  { id: "c2", name: "Carlos", phone: "+502 5555-7788" },
  { id: "c3", name: "Marta", phone: "+502 5555-3001" }
];

const ROUTE_OPTIONS = [
  {
    id: "r1",
    name: "Ruta principal (Avenida Central)",
    riskScore: 22,
    eta: "14 min",
    points: [
      { lat: 14.0818, lng: -87.2068 },
      { lat: 14.0826, lng: -87.2059 },
      { lat: 14.0834, lng: -87.205 },
      { lat: 14.0842, lng: -87.2041 },
      { lat: 14.085, lng: -87.2032 }
    ]
  },
  {
    id: "r2",
    name: "Ruta comercial (mas iluminacion)",
    riskScore: 14,
    eta: "16 min",
    points: [
      { lat: 14.0818, lng: -87.2068 },
      { lat: 14.0821, lng: -87.2057 },
      { lat: 14.0828, lng: -87.2047 },
      { lat: 14.0838, lng: -87.2039 },
      { lat: 14.085, lng: -87.2032 }
    ]
  }
];

const getBestRouteId = () => [...ROUTE_OPTIONS].sort((a, b) => a.riskScore - b.riskScore)[0].id;
const normalizePhone = (phone) => phone.replace(/\D/g, "");
const mapsLink = ({ lat, lng }) => `https://www.google.com/maps?q=${encodeURIComponent(`${lat},${lng}`)}`;

const loadContactsFromLocal = () => {
  try {
    const raw = localStorage.getItem(CONTACTS_STORAGE_KEY);
    if (!raw) return DEFAULT_CONTACTS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_CONTACTS;
  } catch {
    return DEFAULT_CONTACTS;
  }
};

function MapRecentering({ position }) {
  const map = useMap();
  useEffect(() => {
    map.setView([position.lat, position.lng], map.getZoom(), { animate: true });
  }, [map, position]);
  return null;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(!hasFirebaseConfig);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ email: "", password: "" });

  const [contacts, setContacts] = useState(() => (hasFirebaseConfig ? [] : loadContactsFromLocal()));
  const [contactsLoading, setContactsLoading] = useState(hasFirebaseConfig);
  const [selectedContacts, setSelectedContacts] = useState({});
  const [contactForm, setContactForm] = useState({ name: "", phone: "" });
  const [editingContactId, setEditingContactId] = useState(null);
  const [contactBusy, setContactBusy] = useState(false);
  const [contactFeedback, setContactFeedback] = useState("");
  const [contactFeedbackType, setContactFeedbackType] = useState("info");

  const [selectedRouteId, setSelectedRouteId] = useState(getBestRouteId);
  const [isSharing, setIsSharing] = useState(false);
  const [trackingMode, setTrackingMode] = useState("gps");
  const [stepIndex, setStepIndex] = useState(0);
  const [manualDrift, setManualDrift] = useState(false);
  const [gpsPosition, setGpsPosition] = useState(HONDURAS_DEFAULT_POSITION);
  const [gpsError, setGpsError] = useState("");
  const [lastAlertType, setLastAlertType] = useState(null);
  const [eventLog, setEventLog] = useState([]);

  const selectedRoute = useMemo(
    () => ROUTE_OPTIONS.find((r) => r.id === selectedRouteId) ?? ROUTE_OPTIONS[0],
    [selectedRouteId]
  );
  const activeContacts = useMemo(
    () => contacts.filter((c) => selectedContacts[c.id]),
    [contacts, selectedContacts]
  );

  const position = useMemo(() => {
    const base = selectedRoute.points[stepIndex] ?? selectedRoute.points.at(-1);
    if (trackingMode === "gps" && gpsPosition) return gpsPosition;
    if (!manualDrift) return base;
    return { lat: base.lat + 0.0013, lng: base.lng - 0.0011 };
  }, [selectedRoute.points, stepIndex, manualDrift, trackingMode, gpsPosition]);

  const addLog = (message, type = "info") => {
    setEventLog((prev) => [
      { id: `${Date.now()}-${Math.random()}`, message, type, time: formatTime(new Date()) },
      ...prev
    ]);
  };

  const shareLocationViaWhatsApp = () => {
    if (!activeContacts.length) return addLog("No hay contactos seleccionados para enviar WhatsApp.", "danger");
    const msg = `Estoy en camino con SafeWalk. Mi ubicacion actual es: ${mapsLink(position)}`;
    activeContacts.forEach((c, idx) => setTimeout(() => window.open(`https://wa.me/${normalizePhone(c.phone)}?text=${encodeURIComponent(msg)}`, "_blank"), idx * 250));
    setLastAlertType("ubicacion");
  };

  const triggerEmergency = () => {
    if (!activeContacts.length) return addLog("No hay contactos seleccionados para enviar WhatsApp.", "danger");
    const msg = `EMERGENCIA: necesito ayuda ahora. Mi ubicacion actual: ${mapsLink(position)}`;
    activeContacts.forEach((c, idx) => setTimeout(() => window.open(`https://wa.me/${normalizePhone(c.phone)}?text=${encodeURIComponent(msg)}`, "_blank"), idx * 250));
    setLastAlertType("emergencia");
  };

  const resetContactForm = () => {
    setContactForm({ name: "", phone: "" });
    setEditingContactId(null);
  };

  const handleContactSubmit = async (e) => {
    e.preventDefault();
    const name = contactForm.name.trim();
    const phone = contactForm.phone.trim();
    setContactFeedback("");

    if (!name || !phone) {
      setContactFeedbackType("danger");
      return setContactFeedback("Debes completar nombre y telefono.");
    }

    if (!hasFirebaseConfig) {
      const newLocal = editingContactId
        ? contacts.map((c) => (c.id === editingContactId ? { ...c, name, phone } : c))
        : [...contacts, { id: `c-${Date.now()}`, name, phone }];
      setContacts(newLocal);
      localStorage.setItem(CONTACTS_STORAGE_KEY, JSON.stringify(newLocal));
      setContactFeedbackType("success");
      setContactFeedback("Contacto guardado localmente.");
      return resetContactForm();
    }

    if (!user || !db) {
      setContactFeedbackType("danger");
      return setContactFeedback("Inicia sesion para guardar contactos en Firebase.");
    }

    try {
      setContactBusy(true);
      if (editingContactId) {
        await updateDoc(doc(db, "users", user.uid, "contacts", editingContactId), {
          name,
          phone,
          updatedAt: serverTimestamp()
        });
        setContacts((prev) => prev.map((c) => (c.id === editingContactId ? { ...c, name, phone } : c)));
        setContactFeedback("Contacto actualizado en Firebase.");
      } else {
        const newDoc = await addDoc(collection(db, "users", user.uid, "contacts"), {
          name,
          phone,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        setContacts((prev) => [...prev, { id: newDoc.id, name, phone, createdAt: null }]);
        setSelectedContacts((prev) => ({ ...prev, [newDoc.id]: true }));
        setContactFeedback("Contacto guardado en Firebase.");
      }
      setContactFeedbackType("success");
      resetContactForm();
    } catch (error) {
      setContactFeedbackType("danger");
      setContactFeedback(`No se pudo guardar: ${error?.code ?? "error"}: ${error?.message ?? ""}`);
    } finally {
      setContactBusy(false);
    }
  };

  const deleteContact = async (contactId) => {
    if (!hasFirebaseConfig) return setContacts((prev) => prev.filter((c) => c.id !== contactId));
    if (!user || !db) return;
    await deleteDoc(doc(db, "users", user.uid, "contacts", contactId));
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
  };

  const signInGoogle = async () => {
    if (!auth || !googleProvider) return;
    try {
      setAuthBusy(true);
      await signInWithPopup(auth, googleProvider);
    } finally {
      setAuthBusy(false);
    }
  };

  const signInEmail = async () => {
    if (!auth) return;
    try {
      setAuthBusy(true);
      await signInWithEmailAndPassword(auth, authForm.email.trim(), authForm.password.trim());
    } catch (e) {
      addLog(`No se pudo iniciar sesion: ${e.message}`, "danger");
    } finally {
      setAuthBusy(false);
    }
  };

  const registerEmail = async () => {
    if (!auth) return;
    try {
      setAuthBusy(true);
      await createUserWithEmailAndPassword(auth, authForm.email.trim(), authForm.password.trim());
    } catch (e) {
      addLog(`No se pudo crear cuenta: ${e.message}`, "danger");
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError("No se pudo obtener GPS, usando ubicacion por defecto en Honduras.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGpsError("");
      },
      () => {
        setGpsError("No se concedio permiso de ubicacion, usando Honduras por defecto.");
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  }, []);

  useEffect(() => {
    if (hasFirebaseConfig && auth) {
      return onAuthStateChanged(auth, (u) => {
        setUser(u);
        setAuthReady(true);
      });
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (!hasFirebaseConfig || !db || !user) {
      if (hasFirebaseConfig) {
        setContacts([]);
        setContactsLoading(false);
      }
      return undefined;
    }

    setContactsLoading(true);
    return onSnapshot(
      collection(db, "users", user.uid, "contacts"),
      (snap) => {
        const next = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0));
        setContacts(next);
        setContactsLoading(false);
      },
      (error) => {
        setContactsLoading(false);
        setContactFeedbackType("danger");
        setContactFeedback(`No se pudieron cargar contactos: ${error.code}: ${error.message}`);
      }
    );
  }, [user]);

  useEffect(() => {
    setSelectedContacts((prev) => {
      const hasAny = Object.keys(prev).length > 0;
      const next = {};
      contacts.forEach((c, idx) => {
        next[c.id] = prev[c.id] ?? (!hasAny && idx < 2);
      });
      return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
    });
  }, [contacts]);

  useEffect(() => {
    if (!isSharing || trackingMode !== "simulada") return undefined;
    const t = setInterval(() => setStepIndex((s) => Math.min(s + 1, selectedRoute.points.length - 1)), 4500);
    return () => clearInterval(t);
  }, [isSharing, trackingMode, selectedRoute.points.length]);

  useEffect(() => {
    if (!isSharing || trackingMode !== "gps") return undefined;
    if (!navigator.geolocation) return undefined;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGpsPosition({ lat: p.coords.latitude, lng: p.coords.longitude });
        setGpsError("");
      },
      (e) => setGpsError(`Error de GPS: ${e.message}`),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [isSharing, trackingMode]);

  useEffect(() => {
    if (!isSharing) return;
    const d = nearestDistanceToRoute(position, selectedRoute.points);
    if (d > DEVIATION_THRESHOLD_METERS) {
      addLog(`Alerta de desvio: ${Math.round(d)}m fuera de ruta.`, "danger");
      setManualDrift(false);
    }
  }, [isSharing, position, selectedRoute.points]);

  const deviationMeters = nearestDistanceToRoute(position, selectedRoute.points);

  return (
    <main className="app-shell">
      <section className="card hero-card">
        <div className="hero-head">
          <div>
            <div className="hero-brand">
              <img className="app-logo" src={appLogo} alt="SafeWalk logo" />
              <div>
                <p className="eyebrow">SafeWalk Prototipo React</p>
                <h1>Camina con acompanamiento en tiempo real</h1>
              </div>
            </div>
            <p>Comparte ubicacion en vivo y alerta por WhatsApp.</p>
          </div>

          <div className="auth-box">
            {!hasFirebaseConfig && <p className="auth-note">Firebase no esta configurado. Se usa localStorage.</p>}
            {hasFirebaseConfig && !authReady && <p className="auth-note">Cargando sesion...</p>}
            {hasFirebaseConfig && authReady && !user && (
              <>
                <p className="auth-note">Inicia sesion para sincronizar contactos.</p>
                <div className="auth-mode-row">
                  <button type="button" className={`btn ${authMode === "login" ? "btn-secondary" : "btn-muted"}`} onClick={() => setAuthMode("login")} disabled={authBusy}>Iniciar sesion</button>
                  <button type="button" className={`btn ${authMode === "register" ? "btn-secondary" : "btn-muted"}`} onClick={() => setAuthMode("register")} disabled={authBusy}>Registrarse</button>
                </div>
                <div className="auth-form">
                  <input className="input" type="email" placeholder="Correo electronico" value={authForm.email} onChange={(e) => setAuthForm((p) => ({ ...p, email: e.target.value }))} disabled={authBusy} />
                  <input className="input" type="password" placeholder="Contrasena" value={authForm.password} onChange={(e) => setAuthForm((p) => ({ ...p, password: e.target.value }))} disabled={authBusy} />
                  {authMode === "login" ? <button className="btn btn-primary" type="button" onClick={signInEmail} disabled={authBusy}>Entrar con correo</button> : <button className="btn btn-primary" type="button" onClick={registerEmail} disabled={authBusy}>Crear cuenta</button>}
                </div>
                <div className="auth-divider">o</div>
                <button className="btn btn-secondary" type="button" onClick={signInGoogle} disabled={authBusy}>Iniciar sesion con Google</button>
              </>
            )}
            {hasFirebaseConfig && authReady && user && (
              <>
                <p className="auth-note">Sesion: {user.email}</p>
                <button className="btn btn-muted" type="button" onClick={() => signOut(auth)}>Cerrar sesion</button>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="card two-col">
        <div>
          <h2>Rutas sugeridas</h2>
          <div className="routes-grid">
            {ROUTE_OPTIONS.map((route) => (
              <button key={route.id} className={`route-tile ${route.id === selectedRouteId ? "active" : ""}`} onClick={() => { setSelectedRouteId(route.id); setStepIndex(0); setManualDrift(false); }} type="button">
                <strong>{route.name}</strong>
                <span>Riesgo: {route.riskScore}/100</span>
                <span>Tiempo estimado: {route.eta}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h2>Contactos de confianza</h2>
          <form className="contact-form" onSubmit={handleContactSubmit}>
            <input className="input" type="text" placeholder="Nombre del contacto" value={contactForm.name} onChange={(e) => setContactForm((p) => ({ ...p, name: e.target.value }))} />
            <input className="input" type="tel" placeholder="Telefono (+502...)" value={contactForm.phone} onChange={(e) => setContactForm((p) => ({ ...p, phone: e.target.value }))} />
            <button className="btn btn-secondary" type="submit" disabled={(hasFirebaseConfig && !user) || contactBusy}>{contactBusy ? "Guardando..." : editingContactId ? "Actualizar contacto" : "Guardar contacto"}</button>
            {editingContactId && <button className="btn" type="button" onClick={resetContactForm}>Cancelar edicion</button>}
          </form>

          {hasFirebaseConfig && contactsLoading && <p>Cargando contactos...</p>}
          {contactFeedback && <p className={`inline-feedback ${contactFeedbackType === "danger" ? "is-error" : "is-success"}`}>{contactFeedback}</p>}

          <div className="contacts-list">
            {contacts.map((contact) => (
              <div key={contact.id} className="contact-card">
                <label className="contact-row">
                  <input type="checkbox" checked={Boolean(selectedContacts[contact.id])} onChange={() => setSelectedContacts((p) => ({ ...p, [contact.id]: !p[contact.id] }))} />
                  <span>{contact.name} <small>{contact.phone}</small></span>
                </label>
                <div className="contact-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => window.open(`https://wa.me/${normalizePhone(contact.phone)}?text=${encodeURIComponent(`Hola ${contact.name}, comparto mi ubicacion actual: ${mapsLink(position)}`)}`, "_blank")}>Enviar ubicacion por WhatsApp</button>
                  <button type="button" className="btn btn-muted" onClick={() => { setEditingContactId(contact.id); setContactForm({ name: contact.name, phone: contact.phone }); }}>Editar</button>
                  <button type="button" className="btn btn-danger btn-small" onClick={() => deleteContact(contact.id)}>Eliminar</button>
                </div>
              </div>
            ))}
            {contacts.length === 0 && <p>No hay contactos guardados.</p>}
          </div>
        </div>
      </section>

      <section className="card map-card">
        <div className="map-header">
          <h2>Mapa en vivo</h2>
          <div className="mode-switch">
            <label><input type="radio" name="tracking" checked={trackingMode === "simulada"} onChange={() => setTrackingMode("simulada")} />Simulada</label>
            <label><input type="radio" name="tracking" checked={trackingMode === "gps"} onChange={() => setTrackingMode("gps")} />GPS real</label>
          </div>
        </div>

        <div className="map-wrap">
          <MapContainer center={[position.lat, position.lng]} zoom={16} scrollWheelZoom className="leaflet-map">
            <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Polyline positions={selectedRoute.points.map((p) => [p.lat, p.lng])} pathOptions={{ color: "#0f766e", weight: 6, opacity: 0.75 }} />
            <Circle center={[position.lat, position.lng]} radius={18} pathOptions={{ color: "#b91c1c", fillColor: "#dc2626", fillOpacity: 0.9 }} />
            <Circle center={[position.lat, position.lng]} radius={45} pathOptions={{ color: "#ef4444", fillColor: "#fecaca", fillOpacity: 0.3 }} />
            <MapRecentering position={position} />
          </MapContainer>
        </div>

        <div className="stats-row">
          <div><span>Latitud</span><strong>{formatCoord(position.lat)}</strong></div>
          <div><span>Longitud</span><strong>{formatCoord(position.lng)}</strong></div>
          <div><span>Desvio actual</span><strong>{Math.round(deviationMeters)} m</strong></div>
        </div>

        {gpsError && <p className="alert-banner">{gpsError}</p>}

        <div className="actions-row map-actions-grid">
          {!isSharing ? <button className="btn btn-primary btn-large" type="button" onClick={() => { setIsSharing(true); setStepIndex(0); setManualDrift(false); }}>Compartir ruta en vivo</button> : <button className="btn btn-muted btn-large" type="button" onClick={() => setIsSharing(false)}>Detener seguimiento</button>}
          <button className="btn btn-warning btn-large" type="button" onClick={() => setManualDrift(true)} disabled={!isSharing || trackingMode !== "simulada"}>Simular desvio</button>
          <button className="btn btn-secondary btn-large" type="button" onClick={shareLocationViaWhatsApp}>Compartir ubicacion por WhatsApp</button>
          <button className="btn btn-danger btn-large" type="button" onClick={triggerEmergency}>Boton de emergencia (SOS)</button>
        </div>

        {lastAlertType && <p className="status-pill" role="status">Ultima alerta enviada: {lastAlertType.toUpperCase()}</p>}
      </section>

      <section className="card">
        <h2>Actividad</h2>
        <ul className="log-list">
          {eventLog.length === 0 && <li>No hay eventos todavia.</li>}
          {eventLog.map((entry) => (
            <li key={entry.id} className={`log-${entry.type}`}>
              <span>{entry.time}</span>
              <p>{entry.message}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
