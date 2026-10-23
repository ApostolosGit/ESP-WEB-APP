(() => {
  "use strict";

  const BASE = "home/energy";
  const DISCOVERY_TOPICS = [
    `${BASE}/+/status`,
    `${BASE}/+/health`,
    `${BASE}/+/state`,
    `${BASE}/+/admin/response`,
    `${BASE}/+/admin/csv`,
    `${BASE}/+/admin/history`,
    `${BASE}/+/vent/history`
  ];

  const DEFAULTS = {
    host: "",
    port: "8884",
    path: "/mqtt"
  };

  const APP_VERSION = "5.68";
  const AUTO_REFRESH_MS = 60000;
  const UPDATE_RESPONSE_MS = 10000;
  const DEVICE_LIVE_MS = 45000; // Firmware health arrives every 30 seconds.
  const OTA_ACK_TIMEOUT_MS = 12000;
  const OTA_POLL_MS = 5000;
  const OTA_TOTAL_TIMEOUT_MS = 180000;
  const OTA_PIN = "12134";
  const OTA_MANIFEST_BASE_URL = "https://raw.githubusercontent.com/ApostolosGit/ESP8266-OTA/main/";
  const devices = new Map();
  const csvBuffers = new Map();
  const adminBusy = new Set();

  let client = null;
  let successfulMqttSettings = null;
  let autoRefreshTimer = null;
  let toastTimeout = null;
  let deferredInstallPrompt = null;
  let adminTargetId = null;
  let otaTargetId = null;
  let otaPendingManifest = null;
  let otaManifestLoading = false;
  let otaAwaitingStart = null;
  let otaSession = null;
  let otaAckTimer = null;
  let otaPollTimer = null;
  let otaTimeoutTimer = null;
  let otaElapsedTimer = null;
  let editingUtilityId = null;
  let utilityEntryStep = 0;
  let utilityHistoryRows = [];
  let utilityHistoryDeviceId = null;
  let utilityListIntent = "summary";
  const MIN_DEVIATION_KWH = 1.0;
  const ENERGY_PRICE_KEY = "energy.pricePerKwh";
  const DEFAULT_ENERGY_PRICE = 0.25; // €/kWh, editable locally in Settings.
  let energyPricePerKwh = DEFAULT_ENERGY_PRICE;

  const $ = (id) => document.getElementById(id);

  const ui = {
    brokerDot: $("brokerDot"),
    brokerStatus: $("brokerStatus"),
    metersDot: $("metersDot"),
    metersStatus: $("metersStatus"),
    updateAllBtn: $("updateAllBtn"),
    devicesGrid: $("devicesGrid"),
    emptyState: $("emptyState"),
    settingsBtn: $("settingsBtn"),
    installBtn: $("installBtn"),
    settingsDialog: $("settingsDialog"),
    settingsForm: $("settingsForm"),
    closeSettingsBtn: $("closeSettingsBtn"),
    disconnectBtn: $("disconnectBtn"),
    connectionError: $("connectionError"),
    hostInput: $("hostInput"),
    portInput: $("portInput"),
    pathInput: $("pathInput"),
    usernameInput: $("usernameInput"),
    passwordInput: $("passwordInput"),
    rememberConnectionInput: $("rememberConnectionInput"),
    rememberConnectionStatus: $("rememberConnectionStatus"),
    energyPriceInput: $("energyPriceInput"),
    saveEnergyPriceBtn: $("saveEnergyPriceBtn"),
    energyPriceStatus: $("energyPriceStatus"),
    adminDialog: $("adminDialog"),
    closeAdminBtn: $("closeAdminBtn"),
    adminEyebrow: $("adminEyebrow"),
    adminTitle: $("adminTitle"),
    utilityReadingSettings: $("utilityReadingSettings"),
    utilityReadingTitle: $("utilityReadingTitle"),
    utilityLatestSummary: $("utilityLatestSummary"),
    startUtilityReadingBtn: $("startUtilityReadingBtn"),
    utilityEntryDialog: $("utilityEntryDialog"),
    utilityEntryTitle: $("utilityEntryTitle"),
    utilityStepLabel: $("utilityStepLabel"),
    utilityStepType: $("utilityStepType"),
    utilityStepDate: $("utilityStepDate"),
    utilityStepTime: $("utilityStepTime"),
    utilityStepReading: $("utilityStepReading"),
    utilityStepConfirm: $("utilityStepConfirm"),
    utilityKindFinal: $("utilityKindFinal"),
    utilityKindIntermediate: $("utilityKindIntermediate"),
    utilityTariffLabel: $("utilityTariffLabel"),
    utilityConfirmSummary: $("utilityConfirmSummary"),
    closeUtilityEntryBtn: $("closeUtilityEntryBtn"),
    utilityDateInput: $("utilityDateInput"),
    utilityTimeInput: $("utilityTimeInput"),
    utilityTimeExact: $("utilityTimeExact"),
    utilityTimeEstimated: $("utilityTimeEstimated"),
    utilityTimeField: $("utilityTimeField"),
    monoReadingFields: $("monoReadingFields"),
    dualReadingFields: $("dualReadingFields"),
    utilityZInput: $("utilityZInput"),
    utilityZ1Input: $("utilityZ1Input"),
    utilityZ2Input: $("utilityZ2Input"),
    saveUtilityReadingBtn: $("saveUtilityReadingBtn"),
    utilityHistoryBtn: $("utilityHistoryBtn"),
    utilityHistoryDialog: $("utilityHistoryDialog"),
    utilityHistoryTitle: $("utilityHistoryTitle"),
    utilityHistoryContent: $("utilityHistoryContent"),
    closeUtilityHistoryBtn: $("closeUtilityHistoryBtn"),
    adminStatus: $("adminStatus"),
    otaTargetInfo: $("otaTargetInfo"),
    otaUpdateBtn: $("otaUpdateBtn"),
    restartEspBtn: $("restartEspBtn"),
    otaPinDialog: $("otaPinDialog"),
    otaPinForm: $("otaPinForm"),
    otaPinInput: $("otaPinInput"),
    otaPinTarget: $("otaPinTarget"),
    otaPinError: $("otaPinError"),
    closeOtaPinBtn: $("closeOtaPinBtn"),
    cancelOtaPinBtn: $("cancelOtaPinBtn"),
    otaProgressDialog: $("otaProgressDialog"),
    otaProgressTitle: $("otaProgressTitle"),
    otaProgressStatus: $("otaProgressStatus"),
    otaProgressDevice: $("otaProgressDevice"),
    otaProgressVersions: $("otaProgressVersions"),
    otaProgressDetails: $("otaProgressDetails"),
    otaProgressVisual: $("otaProgressVisual"),
    otaProgressCloseBtn: $("otaProgressCloseBtn"),
    toast: $("toast")
  };

  function injectDualZoneUi() {
    if ($("dualZoneSettings")) return;

    const section = document.createElement("section");
    section.id = "dualZoneSettings";
    section.className = "settings-section dual-zone-settings";
    section.innerHTML = `
      <div class="meter-type-settings">
        <p class="eyebrow">ΤΥΠΟΣ ΜΕΤΡΗΤΗ</p>
        <h3 id="meterPhaseTypeLabel">—</h3>
        <p id="meterPhaseTypeHelp" class="admin-help">Ο τύπος αναγνωρίζεται από το firmware της συσκευής.</p>
        <button id="changeMeterTypeBtn" class="secondary-btn admin-btn full-btn" type="button">
          ΑΛΛΑΓΗ ΤΥΠΟΥ ΜΕΤΡΗΤΗ · ΜΟΝΟΦΑΣΙΚΟ / ΤΡΙΦΑΣΙΚΟ
        </button>
      </div>

      <div class="settings-divider"></div>

      <div class="setting-toggle-row">
        <div>
          <p class="eyebrow">ΤΙΜΟΛΟΓΙΟ</p>
          <h3>Μετρητής Ζ ή Ζ1 / Ζ2</h3>
        </div>
        <label class="switch-label">
          <input id="dualZoneToggle" type="checkbox">
          <span>Ζ1 / Ζ2</span>
        </label>
      </div>

      <p id="dualZoneUnsupported" class="admin-help hidden">
        Η νέα λειτουργία απαιτεί firmware v3.00 ή νεότερο.
      </p>

      <div id="dualZoneDetails" class="hidden">
        <div class="tariff-schedule">
          <strong>Ωράριο Διζωνικού Συστήματος</strong>
          <p><b>Ζ1 / Ακριβό τιμολόγιο:</b> όλες οι ώρες εκτός Ζ2.</p>
          <p><b>Ζ2 / Οικονομικό τιμολόγιο:</b> μειωμένη ζώνη.</p>
          <div class="schedule-grid">
            <div>
              <b>Χειμερινή περίοδος</b>
              <span>Νοέμβριος – Μάρτιος</span>
              <span>02:00 – 05:00</span>
              <span>12:00 – 15:00</span>
            </div>
            <div>
              <b>Θερινή περίοδος</b>
              <span>Απρίλιος – Οκτώβριος</span>
              <span>02:00 – 04:00</span>
              <span>11:00 – 15:00</span>
            </div>
          </div>
          <a href="https://apps.deddie.gr/ccrWebapp/dizoniko.html" target="_blank" rel="noopener noreferrer">Πηγή ωραρίου: ΔΕΔΔΗΕ</a>
        </div>
      </div>

      <button id="saveDualZoneBtn" class="primary-btn admin-btn full-btn" type="button">
        ΑΠΟΘΗΚΕΥΣΗ ΤΙΜΟΛΟΓΙΟΥ
      </button>
    `;

    ui.utilityReadingSettings.insertAdjacentElement("afterend", section);
  }

  injectDualZoneUi();

  ui.meterPhaseTypeLabel = $("meterPhaseTypeLabel");
  ui.meterPhaseTypeHelp = $("meterPhaseTypeHelp");
  ui.changeMeterTypeBtn = $("changeMeterTypeBtn");
  ui.dualZoneToggle = $("dualZoneToggle");
  ui.dualZoneDetails = $("dualZoneDetails");
  ui.dualZoneUnsupported = $("dualZoneUnsupported");
  ui.saveDualZoneBtn = $("saveDualZoneBtn");


  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatNumber(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "--";
    return n.toLocaleString("el-GR", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  // Accept Greek decimal commas and dots; blank disables estimated costs.
  // Invalid prices do not silently overwrite the user's saved preference.
  function parseEnergyPrice(raw) {
    const value = String(raw ?? "").trim();
    if (!value) return null;
    if (!/^\d{1,3}(?:[.,]\d{1,4})?$/.test(value)) return undefined;
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
      ? parsed : undefined;
  }

  function estimatedCostText(value) {
    if (energyPricePerKwh === null || !Number.isFinite(Number(value))) return "";
    const euros = Number(value) * energyPricePerKwh;
    return "(" + euros.toLocaleString("el-GR", { maximumFractionDigits:2 }) + "€)";
  }

  function saveEnergyPrice() {
    const parsed = parseEnergyPrice(ui.energyPriceInput.value);
    if (parsed === undefined) {
      ui.energyPriceStatus.textContent = "Δώσε τιμή 0–100 €/kWh (έως 4 δεκαδικά).";
      ui.energyPriceInput.focus?.();
      return false;
    }
    try {
      localStorage.setItem(ENERGY_PRICE_KEY, parsed === null ? "" : String(parsed));
    } catch (_) {
      ui.energyPriceStatus.textContent = "Δεν ήταν δυνατή η τοπική αποθήκευση.";
      return false;
    }
    energyPricePerKwh = parsed;
    ui.energyPriceInput.value = parsed === null ? "" : String(parsed).replace(".", ",");
    ui.energyPriceStatus.textContent = parsed === null
      ? "Η εμφάνιση ποσού απενεργοποιήθηκε."
      : "Η τιμή αποθηκεύτηκε.";
    renderAll();
    return true;
  }

  function setDot(element, state) {
    element.classList.remove("dot-good", "dot-bad", "dot-warn", "dot-muted");
    element.classList.add(`dot-${state}`);
  }

  function showToast(message, timeout = 2600) {
    clearTimeout(toastTimeout);
    ui.toast.textContent = message;
    ui.toast.classList.remove("hidden");
    toastTimeout = setTimeout(() => ui.toast.classList.add("hidden"), timeout);
  }

  function showConnectionError(message = "") {
    ui.connectionError.textContent = message;
    ui.connectionError.classList.toggle("hidden", !message);
  }

  function setBrokerState(state, label) {
    setDot(ui.brokerDot, state);
    ui.brokerStatus.textContent = label;
    const connected = Boolean(client && client.connected);
    ui.updateAllBtn.disabled = !connected || onlineDeviceIds().length === 0;
  }

  function onlineDeviceIds() {
    return [...devices.values()].filter((d) => d.online).map((d) => d.id);
  }

  function pollDeviceIds() {
    // Retained status is a discovery hint. Probe it without presenting it as a
    // current ESP until a non-retained packet confirms the device is active.
    return [...devices.values()].filter(d => d.online || (d.statusOnline !== false &&
      (d.statusOnline === true || d.health || Object.keys(d.state || {}).length))).map(d => d.id);
  }

  function meterType(device) {
    const s = device.state || {};
    const declared = String(s.device_type || s.meter || device.health?.device_type || device.health?.meter || "").toUpperCase();
    if (declared.includes("VENTILATION") || device.id.toLowerCase().startsWith("vent-")) return "VENTILATION";
    if (declared.includes("JSY")) return "JSY";
    if (declared.includes("DDS")) return "DDS";
    if (Object.prototype.hasOwnProperty.call(s, "v1") ||
        Object.prototype.hasOwnProperty.call(s, "i1") ||
        device.id.toLowerCase().includes("jsy")) return "JSY";
    return "DDS";
  }

  function meterName(device) {
    const s = device.state || {};
    if (s.meter) return String(s.meter);
    return meterType(device) === "VENTILATION" ? "Εξαερισμός" : (meterType(device) === "JSY" ? "JSY-MK-333" : "DDS238");
  }

  function meterPhaseType(device) {
    return meterType(device) === "VENTILATION" ? "Εξαερισμός" : (meterType(device) === "JSY" ? "Τριφασικό" : "Μονοφασικό");
  }

  function deviceTitle(device) {
    const friendly = meterName(device);
    const id = device.id;
    if (id === "dds238" || id === "jsy333") return friendly;
    return `${friendly} · ${id}`;
  }

  function parseTopic(topic) {
    const prefix = `${BASE}/`;
    if (!topic.startsWith(prefix)) return null;
    const rest = topic.slice(prefix.length);
    const firstSlash = rest.indexOf("/");
    if (firstSlash < 1) return null;
    return {
      id: rest.slice(0, firstSlash),
      suffix: rest.slice(firstSlash + 1)
    };
  }

  function ensureDevice(id) {
    if (!devices.has(id)) {
      devices.set(id, {
        id,
        online: false,
        state: {},
        lastReceived: null,
        health: null, sampleReceived: false, stateError: "", statusOnline: null,
        responseTimer: null, probeTimer: null, responseTimedOut: false,
        lastLiveAt: null, updateDelayed: false
      });
    }
    return devices.get(id);
  }

  function cancelDeviceRequest(device) {
    clearTimeout(device.responseTimer);
    clearTimeout(device.probeTimer);
    device.responseTimer = device.probeTimer = null;
  }

  function queueDeviceProbe(device) {
    if (device.responseTimer || device.probeTimer || device.statusOnline === false) return;
    const probeClient = client;
    device.probeTimer = setTimeout(() => {
      device.probeTimer = null;
      if (client === probeClient && client?.connected && devices.get(device.id) === device && device.statusOnline !== false)
        requestUpdate(device.id, false);
    }, 100);
  }

  function confirmDeviceLive(device) {
    device.lastLiveAt = Date.now();
    device.online = true;
    device.statusOnline = true;
    if (device.responseTimedOut) device.updateDelayed = true;
    device.responseTimedOut = false;
  }

  function phaseDirection(state, phase) {
    const explicit = String(state[`dir${phase}`] || "").toUpperCase();
    if (explicit === "REV" || explicit === "FWD") return explicit;
    const current = Number(state[`i${phase}`]);
    return Number.isFinite(current) && current < 0 ? "REV" : "FWD";
  }

  function totalReverse(state) {
    const raw = Number(state.power_direction);
    if (Number.isFinite(raw)) return Boolean(raw & 0x08);
    return false;
  }

  function diffTone(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n === 0) return "diff-zero";
    return n < 0 ? "diff-negative" : "diff-positive";
  }

  function signedPhasePower(state, phase) {
    const raw = Number(state[`p${phase}`]);
    if (!Number.isFinite(raw)) return 0;
    if (raw < 0) return raw;
    return phaseDirection(state, phase) === "REV" ? -Math.abs(raw) : Math.abs(raw);
  }

  function signedTotalPower(state) {
    const raw = Number(state.power_total);
    if (!Number.isFinite(raw)) return 0;
    if (raw < 0) return raw;
    return totalReverse(state) ? -Math.abs(raw) : Math.abs(raw);
  }

  function powerTone(value) {
    const n = Number(value);
    return n < 0 ? "power-negative" : "power-positive";
  }

  function tariffRow(label, value, unit = "kWh", extra = "", digits = 2, suffix = "") {
    const missing = value === null || value === undefined || value === "";
    const display = missing ? "—" : formatNumber(value, digits);
    const cost = label === "Διαφορά" && !missing && unit === "kWh"
      ? estimatedCostText(value) : "";
    return `
      <div class="tariff-row ${extra}">
        <span class="tariff-row-label">${escapeHtml(label)}</span>
        <span class="tariff-row-colon">:</span>
        <b class="tariff-row-value">${escapeHtml(display)}${!missing && unit ? ` <small>${escapeHtml(unit)}</small>` : ""}${cost ? ` <small class="tariff-estimated-cost">${escapeHtml(cost)}</small>` : ""}${!missing && suffix ? ` ${escapeHtml(suffix)}` : ""}</b>
      </div>`;
  }

  function utilityReferenceDateShort(value) {
    const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `(${m[3]}/${m[2]})` : "";
  }

  function renderTariffEnergy(state) {
    const dual = state.dual_zone === true || state.tariff_mode === "dual";
    const hasUtility = state.has_utility === true;
    const estimateValid = state.estimate_valid === true;
    const utilityDate = hasUtility ? utilityReferenceDateShort(state.utility_date) : "";

    const rowValue = (value, digits = 2) =>
      Number.isFinite(Number(value)) ? Number(value) : null;

    if (dual) {
      const zone = String(state.tariff_zone || "-");
      const isZ2 = zone === "Z2";
      const z1Ref = hasUtility ? rowValue(state.z1_ref) : null;
      const z2Ref = hasUtility ? rowValue(state.z2_ref) : null;
      const z1Now = estimateValid ? rowValue(state.z1_now) : null;
      const z2Now = estimateValid ? rowValue(state.z2_now) : null;
      const z1Diff = hasUtility && estimateValid ? rowValue(state.z1_diff) : null;
      const z2Diff = hasUtility && estimateValid ? rowValue(state.z2_diff) : null;

      return `
        <section class="tariff-dashboard">
          <div class="section-title-row">
            <h3>Μετρητής ΔΕΗ Ζ1 / Ζ2</h3>
            <span class="zone-now ${isZ2 ? "cheap" : "normal"}">Τώρα ${isZ2 ? "Ζ2 / Οικονομικό τιμολόγιο" : "Ζ1 / Ακριβό τιμολόγιο"}</span>
          </div>
          <div class="tariff-zone-grid">
            <article class="tariff-zone-card">
              <h4>Ζ1 / Ακριβό τιμολόγιο</h4>
              ${tariffRow("Διαφορά", z1Diff, "kWh", diffTone(z1Diff))}
              ${tariffRow("Εκτίμηση τώρα", z1Now, "kWh")}
              ${tariffRow("Τελευταία ΔΕΗ", z1Ref, "kWh", "", 0, utilityDate)}
            </article>
            <article class="tariff-zone-card cheap-zone-card">
              <h4>Ζ2 / Οικονομικό τιμολόγιο</h4>
              ${tariffRow("Διαφορά", z2Diff, "kWh", diffTone(z2Diff))}
              ${tariffRow("Εκτίμηση τώρα", z2Now, "kWh")}
              ${tariffRow("Τελευταία ΔΕΗ", z2Ref, "kWh", "", 0, utilityDate)}
            </article>
          </div>
          ${!estimateValid
            ? '<div class="tariff-meta">Δεν υπάρχει ακόμη Καταχώρηση Ένδειξης Μετρητή ΔΕΗ για να ξεκινήσει η Εκτίμηση τώρα.</div>'
            : (!hasUtility
                ? '<div class="tariff-meta">Η Εκτίμηση τώρα είναι ενεργή. Καταχώρησε Μέτρηση ΔΕΗ για να εμφανιστεί η Διαφορά.</div>'
                : "")}
        </section>`;
    }

    const zRef = hasUtility ? rowValue(state.z_ref) : null;
    const zNow = estimateValid ? rowValue(state.z_now) : null;
    const zDiff = hasUtility && estimateValid ? rowValue(state.z_diff) : null;

    return `
      <section class="tariff-dashboard single-zone-dashboard">
        <div class="section-title-row">
          <h3>Μετρητής ΔΕΗ Ζ</h3>
          <span class="section-meta">${escapeHtml(state.datetime || "")}</span>
        </div>
        <div class="tariff-zone-grid single-zone-grid">
          <article class="tariff-zone-card single-zone-card">
            <h4>Ζ</h4>
            ${tariffRow("Διαφορά", zDiff, "kWh", diffTone(zDiff))}
            ${tariffRow("Εκτίμηση τώρα", zNow, "kWh")}
            ${tariffRow("Τελευταία ΔΕΗ", zRef, "kWh", "", 0, utilityDate)}
          </article>
        </div>
        ${!estimateValid
          ? '<div class="tariff-meta">Δεν υπάρχει ακόμη Καταχώρηση Ένδειξης Μετρητή ΔΕΗ για να ξεκινήσει η Εκτίμηση τώρα.</div>'
          : (!hasUtility
              ? '<div class="tariff-meta">Η Εκτίμηση τώρα είναι ενεργή. Καταχώρησε Μέτρηση ΔΕΗ για να εμφανιστεί η Διαφορά.</div>'
              : "")}
      </section>`;
  }

  function renderDdsBody(device) {
    const s = device.state;
    const power = Number(s.power) || 0;
    const current = Math.abs(Number(s.current) || 0);
    const dual = s.dual_zone === true || s.tariff_mode === "dual";

    const hasUtility = s.has_utility === true;
    const estimateValid = s.estimate_valid === true;
    const zRef = hasUtility ? s.z_ref : null;
    const zNow = estimateValid ? s.z_now : null;
    const zDiff = hasUtility && estimateValid ? s.z_diff : null;
    const utilityDate = hasUtility ? utilityReferenceDateShort(s.utility_date) : "";

    const singleZoneMeter = dual ? "" : `
      <div class="dds-inline-column dds-meter-column">
        <div class="embedded-tariff-title">Μετρητής ΔΕΗ Ζ</div>
        ${tariffRow("Διαφορά", zDiff, "kWh", diffTone(zDiff))}
        ${tariffRow("Εκτίμηση τώρα", zNow, "kWh")}
        ${tariffRow("Τελευταία ΔΕΗ", zRef, "kWh", "", 0, utilityDate)}
        ${!estimateValid ? '<div class="tariff-meta">Καταχώρησε Ένδειξη Μετρητή ΔΕΗ για Εκτίμηση τώρα.</div>' : (!hasUtility ? '<div class="tariff-meta">Καταχώρησε Μέτρηση ΔΕΗ για τη Διαφορά.</div>' : "")}
      </div>`;

    return `
      <section class="single-phase-grid">
        <article class="phase-card single-phase-card">
          <div class="dds-inline-grid">
            <div class="dds-inline-column dds-measurement-column">
              <div class="phase-head"><strong>Μονοφασικό</strong></div>
              ${phaseRow("Ισχύς", formatNumber(power, 0), "W", `phase-power-row ${powerTone(power)}`)}
              ${phaseRow("Ρεύμα", formatNumber(current, 2), "A")}
              ${phaseRow("Τάση", formatNumber(s.voltage, 1), "V")}
              ${phaseRow("Συχν.", formatNumber(s.frequency, 2), "Hz")}
              ${phaseRow("PF", formatNumber(s.pf, 3))}
            </div>
            ${singleZoneMeter}
          </div>
        </article>
      </section>
      ${dual ? renderTariffEnergy(s) : ""}`;
  }

  function phaseRow(label, value, unit = "", extra = "") {
    return `
      <div class="phase-row ${extra}">
        <span class="phase-label">${escapeHtml(label)}</span>
        <span class="phase-colon">:</span>
        <b class="phase-value">${escapeHtml(value)}${unit ? ` <small>${escapeHtml(unit)}</small>` : ""}</b>
      </div>`;
  }

  function renderJsyBody(device) {
    const s = device.state;
    const phaseNames = ["R", "S", "T"];
    const phaseCards = [1, 2, 3].map((phase) => {
      const current = Math.abs(Number(s[`i${phase}`]) || 0);
      const power = signedPhasePower(s, phase);
      return `
        <article class="phase-card">
          <div class="phase-head"><strong>Φάση ${phaseNames[phase - 1]}</strong></div>
          ${phaseRow("Ισχύς", formatNumber(power, 0), "W", `phase-power-row ${powerTone(power)}`)}
          ${phaseRow("Ρεύμα", formatNumber(current, 2), "A")}
          ${phaseRow("Τάση", formatNumber(s[`v${phase}`], 1), "V")}
          ${phaseRow("Συχν.", formatNumber(s.frequency, 2), "Hz")}
          ${phaseRow("PF", formatNumber(s[`pf${phase}`], 3))}
        </article>`;
    }).join("");

    return `
      <section class="phases-grid phases-without-title">${phaseCards}</section>
      ${renderTariffEnergy(s)}`;
  }

  function renderVentilationBody(device) {
    const s = device.state || {};
    const shown = (v, unit="", digits=1) =>
      v === null || v === undefined || v === "" || !Number.isFinite(Number(v))
        ? "—" : `${escapeHtml(formatNumber(v, digits))} ${unit}`;
    const sensorsOk = s.sensors_ok === true && device.health?.meter_ok !== false;
    const relayConfirmed = firmwareAtLeast(s.firmware,1,1);
    return `
      <section class="vent-dashboard" aria-label="Κατάσταση εξαερισμού">
        ${!relayConfirmed ? '<p class="meter-error" role="alert"><strong>Firmware πριν την 1.01: αναφέρονται αντίστροφοι χειρισμοί ON/OFF και ταχύτητας.</strong> Οι εντολές από το MQTT.app είναι απενεργοποιημένες έως την ασφαλή διόρθωση.</p>' : ""}
        ${!sensorsOk ? '<p class="measurement-notice" role="status">Προσοχή: σφάλμα αισθητήρων. Η αυτόματη λειτουργία ακολουθεί το fail-safe του ESP.</p>' : ""}
        <div class="vent-measurements">
          <div><span>Έξω (DS18B20)</span><b>${shown(s.temp_outside, "°C")}</b></div>
          <div><span>Μέσα (DS18B20)</span><b>${shown(s.temp_inside, "°C")}</b></div>
          <div><span>Ενδιάμεσα</span><b>${shown(s.temp_middle, "°C")}</b></div>
          <div><span>Υγρασία έξω</span><b>${shown(s.humidity_outside, "%", 0)}</b></div>
          <div><span>Υγρασία μέσα</span><b>${shown(s.humidity_inside, "%", 0)}</b></div>
          <div><span>Διακόπτης RF</span><b>${s.rf_high === true ? "ON" : s.rf_high === false ? "OFF" : "—"}</b></div>
        </div>
        <p class="vent-time-schedule">Ώρα ESP <b>${escapeHtml(s.time || "—")}</b> ${s.time_synced === false ? "· χωρίς NTP " : ""}— Παύση λειτουργίας <b>${escapeHtml(s.stop_from || "—")} – ${escapeHtml(s.stop_to || "—")}</b></p>
      </section>`;
  }

  function renderDevice(device) {
    const state = device.state || {};
    const sensorFailed = device.health?.read_attempted === true && device.health.meter_ok === false;
    const hasSample = device.sampleReceived === true;
    const ventilation = meterType(device) === "VENTILATION";
    const body = device.responseTimedOut
        ? '<div class="meter-error"><strong>Ο ESP δεν απάντησε σε δύο αιτήματα ενημέρωσης.</strong><p>Δεν έχει επιβεβαιωθεί πρόσφατα η σύνδεσή του. Οι άλλες συσκευές συνεχίζουν ανεξάρτητα.</p></div>'
      : sensorFailed && !ventilation
        ? `<div class="meter-error" role="status"><strong>Σφάλμα μετρητή ${escapeHtml(meterName(device))}</strong><p>Δεν λαμβάνονται έγκυρα δεδομένα από τον μετρητή. Έλεγξε τροφοδοσία, σύνδεση Modbus και διεύθυνση αισθητήρα. Ο ESP παραμένει συνδεδεμένος και επαναλαμβάνει τις αναγνώσεις.</p><p>${device.health.has_sample ? 'Υπάρχει προηγούμενη έγκυρη μέτρηση. Οι παλιές τιμές δεν εμφανίζονται ως τρέχουσες.' : 'Δεν έχει ληφθεί ακόμη έγκυρη μέτρηση.'}</p></div>`
      : device.stateError
        ? `<div class="meter-error"><strong>Μη έγκυρη ενημέρωση ${escapeHtml(device.id)}</strong><p>${escapeHtml(device.stateError)}</p></div>`
        : hasSample
          ? (ventilation ? renderVentilationBody(device) : (meterType(device) === "JSY" ? renderJsyBody(device) : renderDdsBody(device)))
          : '<div class="waiting-state">Ο ESP είναι online. Αναμονή για τις πρώτες μετρήσεις…</div>';

    const last = device.lastReceived
      ? device.lastReceived.toLocaleTimeString("el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "--";

    const firmware = state.firmware ? `v${state.firmware}` : "--";
    const rssi = Number.isFinite(Number(state.rssi)) ? `${formatNumber(state.rssi, 0)} dBm` : "--";
    const delayedNotice = device.updateDelayed && !sensorFailed && !device.responseTimedOut
      ? `<p class="measurement-notice" role="status">Ο ESP απαντά στο MQTT, αλλά η νέα μέτρηση καθυστερεί.${hasSample ? ' Εμφανίζεται η προηγούμενη μέτρηση, με την ώρα τελευταίας λήψης.' : ' Αναμονή έγκυρων μετρήσεων.'}</p>`
      : "";

    let totalPowerLine = "";
    if (hasSample && !sensorFailed && !device.stateError && !device.responseTimedOut && meterType(device) === "JSY") {
      const totalPower = signedTotalPower(state);
      totalPowerLine = `
        <div class="device-total-power ${powerTone(totalPower)}">
          <span>Συνολική ισχύς</span>
          <span class="device-total-power-colon">:</span>
          <b class="device-total-power-value">${escapeHtml(formatNumber(totalPower, 0))}W</b>
        </div>`;
    }

    return `
      <article class="device-panel ${ventilation ? "vent-device-panel" : ""}" data-device="${escapeHtml(device.id)}">
        <div class="device-head">
          <div class="device-title-wrap">
            <span class="dot ${sensorFailed || device.stateError || device.responseTimedOut || device.updateDelayed ? "dot-warn" : "dot-good"}"></span>
            <div>
              <span class="device-id">${escapeHtml(device.id)}</span>
              <div class="device-title-line">
                <h2>${escapeHtml(deviceTitle(device))}</h2>
                ${totalPowerLine}
              </div>
              <span class="firmware-meta"><span>Firmware ${escapeHtml(firmware)}</span><span class="firmware-meta-sep">·</span><span>MQTT.app. v${escapeHtml(APP_VERSION)}</span></span>
            </div>
          </div>
          <div class="device-head-right">
            <span class="rssi-badge">RSSI ${escapeHtml(rssi)}</span>
            <div class="device-actions">
              <button class="small-btn ghost" type="button" data-action="admin" data-device="${escapeHtml(device.id)}">ΡΥΘΜΙΣΕΙΣ</button>
              <button class="small-btn" type="button" data-action="history" data-device="${escapeHtml(device.id)}">ΓΡΑΦΗΜΑΤΑ</button>
              <button class="small-btn refresh-device" type="button" data-action="refresh" data-device="${escapeHtml(device.id)}">↻ UPDATE</button>
            </div>
          </div>
        </div>
        ${delayedNotice}${body}
        <div class="device-footer">
          <span>${device.responseTimedOut ? "ESP ΧΩΡΙΣ ΑΠΑΝΤΗΣΗ" : sensorFailed ? "ESP ONLINE · ΣΦΑΛΜΑ ΜΕΤΡΗΤΗ" : "ESP ONLINE"}</span>
          <span>Τελευταία λήψη: ${last}</span>
        </div>
      </article>`;
  }

  function renderAll() {
    const online = [...devices.values()]
      .filter((d) => d.online)
      .sort((a, b) => a.id.localeCompare(b.id));

    ui.emptyState.classList.toggle("hidden", online.length > 0);
    ui.devicesGrid.innerHTML = online.map(device => {
      try { return renderDevice(device); }
      catch (error) {
        console.error("Device render failed", device.id, error);
        return `<article class="device-panel meter-error"><strong>${escapeHtml(device.id)}</strong><p>Αδυναμία εμφάνισης δεδομένων αυτής της συσκευής. Οι υπόλοιπες συνεχίζουν κανονικά.</p></article>`;
      }
    }).join("");
    ui.metersStatus.textContent = String(online.length);
    setDot(ui.metersDot, online.length ? "good" : "muted");
    ui.updateAllBtn.disabled = !(client && client.connected) || online.length === 0;
  }

  function topicFor(id, suffix) {
    return `${BASE}/${id}/${suffix}`;
  }

  function publish(id, suffix, payload, callback) {
    if (!client || !client.connected) {
      showToast("Δεν υπάρχει σύνδεση με HiveMQ");
      return false;
    }
    client.publish(topicFor(id, suffix), payload, { qos: 0, retain: false }, callback);
    return true;
  }

  function requestUpdate(id, manual = true) {
    const device = ensureDevice(id);
    if (device.responseTimer) {
      if (manual) showToast(`Αναμονή απάντησης: ${id}`, 1500);
      return;
    }
    if (!client?.connected) return;
    clearTimeout(device.probeTimer); device.probeTimer = null;
    const requestClient = client;
    let attempts = 0;
    function sendAttempt() {
      if (client !== requestClient || !client?.connected || devices.get(id) !== device) return;
      ++attempts;
      const timer = setTimeout(() => {
        if (device.responseTimer !== timer || client !== requestClient || !client?.connected || devices.get(id) !== device) return;
        device.responseTimer = null;
        if (attempts < 2) { sendAttempt(); return; }
        device.updateDelayed = device.lastLiveAt !== null && Date.now() - device.lastLiveAt <= DEVICE_LIVE_MS;
        device.responseTimedOut = !device.updateDelayed;
        renderAll();
      }, UPDATE_RESPONSE_MS);
      // Install the deadline first; an immediate reply must be able to cancel it.
      device.responseTimer = timer;
      try {
        publish(id, "request", "update", err => {
          if (err && manual && client === requestClient) showToast(`Αποτυχία update ${id}`);
        });
      } catch (error) {
        if (manual) showToast(`Αποτυχία update ${id}`);
        console.warn("Update publish failed", id, error);
      }
    }
    sendAttempt();
    if (manual) showToast(`Ζητήθηκε νέα μέτρηση: ${id}`, 1500);
  }

  function requestAll(manual = true) {
    const ids = manual ? onlineDeviceIds() : pollDeviceIds();
    if (!ids.length) {
      if (manual) showToast("Δεν υπάρχει online μετρητής");
      return;
    }
    ids.forEach(id => {
      try { requestUpdate(id, false); }
      catch (error) { console.error("Update request failed", id, error); }
    });
    if (manual) showToast(`Ζητήθηκε update σε ${ids.length} μετρητές`);
    scheduleAutoRefresh();
  }

  function scheduleAutoRefresh() {
    if (!client || !client.connected || autoRefreshTimer !== null) return;
    autoRefreshTimer = setInterval(() => requestAll(false), AUTO_REFRESH_MS);
  }

  function utilityLocalTimeParts(date = new Date()) {
    return Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(date).map((part) => [part.type, part.value]));
  }

  function localDateInputValue(date = new Date()) {
    const p = utilityLocalTimeParts(date);
    return `${p.year}-${p.month}-${p.day}`;
  }

  function refreshDualZoneSettings(device) {
    const s = device.state || {};
    const supported =
      firmwareAtLeast(s.firmware, 3, 0) &&
      Object.prototype.hasOwnProperty.call(s, "has_utility");

    const dual = supported && (s.dual_zone === true || s.tariff_mode === "dual");
    const phaseType = meterPhaseType(device);

    ui.meterPhaseTypeLabel.textContent = `${phaseType} · ${meterName(device)}`;
    ui.meterPhaseTypeHelp.textContent = `Τρέχων τύπος: ${phaseType}. Καθορίζεται από το firmware και το συνδεδεμένο hardware.`;
    ui.dualZoneUnsupported.classList.toggle("hidden", supported);
    ui.dualZoneToggle.disabled = !supported;
    ui.saveDualZoneBtn.disabled = !supported;
    ui.dualZoneToggle.checked = dual;
    ui.dualZoneDetails.classList.toggle("hidden", !dual);

    ui.monoReadingFields.classList.toggle("hidden", dual);
    ui.dualReadingFields.classList.toggle("hidden", !dual);

    if (!ui.utilityDateInput.value) {
      ui.utilityDateInput.value = localDateInputValue();
    }

    ui.saveDualZoneBtn.textContent = "ΑΠΟΘΗΚΕΥΣΗ ΤΙΜΟΛΟΓΙΟΥ";
  }

  function firmwareAtLeast(value, requiredMajor, requiredMinor) {
    const match = String(value || "").trim().match(/^(\d+)\.(\d+)/);
    if (!match) return false;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    return major > requiredMajor || (major === requiredMajor && minor >= requiredMinor);
  }

  function compareFirmwareVersions(a, b) {
    const parse = (value) => {
      const match = String(value || "").trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
      if (!match) return null;
      return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
    };

    const av = parse(a);
    const bv = parse(b);
    if (!av || !bv) return 0;

    for (let i = 0; i < 3; i += 1) {
      if (av[i] > bv[i]) return 1;
      if (av[i] < bv[i]) return -1;
    }
    return 0;
  }

  function parseOtaManifest(text) {
    const data = {};
    String(text || "").split(/\r?\n/).forEach((line) => {
      const pos = line.indexOf("=");
      if (pos <= 0) return;
      const key = line.slice(0, pos).trim();
      const value = line.slice(pos + 1).trim();
      if (key) data[key] = value;
    });

    const size = Number(data.size);
    if (!data.version ||
        !/^[A-Za-z0-9._-]+\.bin$/.test(data.file || "") ||
        !Number.isInteger(size) || size <= 0 ||
        !/^[0-9a-f]{32}$/i.test(data.md5 || "")) {
      throw new Error("Μη έγκυρο OTA manifest.");
    }

    return {
      version: data.version,
      file: data.file,
      size,
      md5: data.md5.toLowerCase(),
      meter: String(data.meter || "").toUpperCase(),
      oled: String(data.oled || "")
    };
  }

  function otaManifestMatchesDevice(manifest, device) {
    const type = meterType(device);
    if (type === "VENTILATION") {
      const match = /^Ventilation_ESP8266_V(\\d+)_(\\d{2})\\.bin$/.exec(manifest.file);
      return manifest.meter === "VENTILATION" && Boolean(match) &&
        manifest.version === `${Number(match?.[1])}.${match?.[2]}`;
    }
    if (!/^(DDS238|JSY-MK333|JSY-MK-333|JSY)$/i.test(manifest.meter)) return false;
    if (manifest.meter.includes("JSY") && type !== "JSY") return false;
    if (manifest.meter.includes("DDS") && type !== "DDS") return false;
    return true;
  }

  function otaManifestUrlForDevice(device) {
    const type = meterType(device);
    const file = type === "VENTILATION" ? "manifest-ventilation.txt" :
      (type === "DDS" ? "manifest-dds.txt" : "manifest-jsy.txt");
    return OTA_MANIFEST_BASE_URL + file;
  }

  async function loadOtaManifest(device) {
    const manifestUrl = `${otaManifestUrlForDevice(device)}?cb=${Date.now()}`;
    const response = await fetch(manifestUrl, {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error(`OTA manifest HTTP ${response.status}`);
    }
    return parseOtaManifest(await response.text());
  }

  function renderOtaAvailability(device, manifest = null, checking = false, checkFailed = false) {
    if (!device || !ui.otaTargetInfo) return;
    const isVentilation = meterType(device) === "VENTILATION";
    if (isVentilation && !firmwareAtLeast(device.state?.firmware,1,4)) {
      ui.otaTargetInfo.textContent = "Ventilation: μία τελευταία τοπική εγκατάσταση firmware 1.04 απαιτείται για την ενεργοποίηση του MQTT OTA.";
      return;
    }
    const currentFw = String((device.state || {}).firmware || "?");
    const parts = [
      `<span class="ota-current-line">Τρέχον firmware: <b>${escapeHtml(currentFw)}</b></span>`
    ];

    const hasNewer = Boolean(
      manifest &&
      otaManifestMatchesDevice(manifest, device) &&
      compareFirmwareVersions(manifest.version, currentFw) > 0
    );

    if (hasNewer) {
      parts.push(
        `<span class="ota-available-line">Available <span class="ota-new-blink">NEW</span> updates: <b>${escapeHtml(manifest.version)}</b></span>`
      );
    } else if (checking) {
      parts.push('<span class="ota-checking-line">Έλεγχος διαθέσιμης έκδοσης…</span>');
    } else if (checkFailed) {
      parts.push('<span class="ota-checking-line">Update check unavailable</span>');
    } else {
      parts.push('<span class="ota-none-line">No new updates</span>');
    }

    if (!isVentilation && !firmwareAtLeast(currentFw, 2, 29)) {
      parts.push('<span class="ota-checking-line">Το remote OTA απαιτεί firmware 2.29+.</span>');
    }
    if (isVentilation) {
      parts.push('<span class="ota-checking-line">Τοπικό Recovery OTA διατηρείται. Απομακρυσμένο OTA μόνο σε νέα δημοσιευμένη έκδοση και μετά από επιβεβαίωση/PIN.</span>');
    }
    ui.otaTargetInfo.innerHTML = parts.join("");
  }

  async function refreshOtaAvailability(id) {
    const device = devices.get(id);
    if (!device) return;
    renderOtaAvailability(device, null, true);
    if (meterType(device) === "VENTILATION" && !firmwareAtLeast(device.state?.firmware,1,4)) return;

    try {
      const manifest = await loadOtaManifest(device);
      if (adminTargetId !== id) return;
      renderOtaAvailability(device, manifest, false);
    } catch (_) {
      if (adminTargetId !== id) return;
      renderOtaAvailability(device, null, false, true);
    }
  }

  function clearOtaAckTimer() {
    if (otaAckTimer) clearTimeout(otaAckTimer);
    otaAckTimer = null;
  }

  function clearOtaSessionTimers() {
    if (otaPollTimer) clearInterval(otaPollTimer);
    if (otaTimeoutTimer) clearTimeout(otaTimeoutTimer);
    if (otaElapsedTimer) clearInterval(otaElapsedTimer);
    otaPollTimer = null;
    otaTimeoutTimer = null;
    otaElapsedTimer = null;
  }

  function otaElapsedSeconds() {
    if (!otaSession || !otaSession.startedAt) return 0;
    return Math.max(0, Math.round((Date.now() - otaSession.startedAt) / 1000));
  }

  function setOtaProgressUi(mode, status, details = "") {
    const running = mode === "running";
    const success = mode === "success";
    const error = mode === "error";

    ui.otaProgressVisual.classList.toggle("is-running", running);
    ui.otaProgressVisual.classList.toggle("is-success", success);
    ui.otaProgressVisual.classList.toggle("is-error", error);

    ui.otaProgressTitle.textContent = success
      ? "Η αναβάθμιση ολοκληρώθηκε"
      : (error ? "Η αναβάθμιση απέτυχε" : "Αναβάθμιση λογισμικού");

    ui.otaProgressStatus.textContent = status;
    ui.otaProgressDetails.textContent = details;
    ui.otaProgressCloseBtn.classList.toggle("hidden", running);
    ui.otaProgressCloseBtn.disabled = running;
  }

  function updateOtaRunningDetails(extra = "") {
    if (!otaSession) return;
    const elapsed = otaElapsedSeconds();
    const onlineText = otaSession.sawOffline
      ? (otaSession.sawOnlineAfterStart ? "επανήλθε online" : "offline / αναβάθμιση")
      : "αναμονή επανεκκίνησης";

    const lines = [
      `Συσκευή: ${otaSession.id}`,
      `Έκδοση: ${otaSession.fromVersion} → ${otaSession.targetVersion}`,
      `Χρόνος: ${elapsed}s`,
      `Κατάσταση MQTT: ${onlineText}`
    ];

    if (extra) lines.push(extra);
    ui.otaProgressDetails.textContent = lines.join("\n");
  }

  function failOtaBeforeStart(reason, debug = "") {
    clearOtaAckTimer();

    const pending = otaAwaitingStart;
    otaAwaitingStart = null;

    if (pending) {
      adminBusy.delete(pending.id);
      updateAdminButtons();
    }

    const message = `OTA δεν ξεκίνησε: ${reason}`;
    setAdminStatus(debug ? `${message} · ${debug}` : message, "error");
    showToast(message, 6000);
  }

  function failActiveOta(reason, debug = "") {
    if (!otaSession) return;

    clearOtaSessionTimers();

    const session = otaSession;
    otaSession = null;

    const details = [
      `Συσκευή: ${session.id}`,
      `Από: ${session.fromVersion}`,
      `Στόχος: ${session.targetVersion}`,
      `Χρόνος: ${Math.max(0, Math.round((Date.now() - session.startedAt) / 1000))}s`,
      debug ? `Debug: ${debug}` : ""
    ].filter(Boolean).join("\n");

    setOtaProgressUi("error", reason, details);
    showToast(`${session.id}: OTA αποτυχία`, 6000);
  }

  function completeActiveOta(currentVersion) {
    if (!otaSession) return;

    clearOtaSessionTimers();

    const session = otaSession;
    otaSession = null;

    const details = [
      `Συσκευή: ${session.id}`,
      `Προηγούμενη: ${session.fromVersion}`,
      `Νέα: ${currentVersion}`,
      "Το ESP8266 επανήλθε online και επιβεβαίωσε τη νέα έκδοση."
    ].join("\n");

    setOtaProgressUi(
      "success",
      `Firmware ${currentVersion} ενεργό.`,
      details
    );
    showToast(`${session.id}: OTA ${currentVersion} ολοκληρώθηκε`, 6000);
  }

  function beginConfirmedOta(id, responseData) {
    if (!otaAwaitingStart || otaAwaitingStart.id !== id) return;

    clearOtaAckTimer();

    const pending = otaAwaitingStart;
    otaAwaitingStart = null;
    adminBusy.delete(id);
    updateAdminButtons();

    otaSession = {
      id,
      fromVersion: pending.fromVersion,
      targetVersion: pending.targetVersion,
      manifest: pending.manifest,
      startedAt: Date.now(),
      sawOffline: false,
      sawOnlineAfterStart: false,
      ack: responseData,
      knownDeviceIds: new Set(devices.keys())
    };

    if (ui.adminDialog.open) ui.adminDialog.close();

    ui.otaProgressDevice.textContent = id;
    ui.otaProgressVersions.textContent =
      `${pending.fromVersion} → ${pending.targetVersion}`;

    setOtaProgressUi(
      "running",
      "Ο ESP8266 αποδέχτηκε το OTA. Γίνεται λήψη, έλεγχος MD5 και εγκατάσταση…"
    );
    updateOtaRunningDetails("ACK OTA: state=starting");

    if (!ui.otaProgressDialog.open) ui.otaProgressDialog.showModal();

    otaElapsedTimer = setInterval(() => updateOtaRunningDetails(), 1000);

    otaPollTimer = setInterval(() => {
      if (!otaSession || otaSession.id !== id) return;
      if (client && client.connected) requestUpdate(id, false);
    }, OTA_POLL_MS);

    otaTimeoutTimer = setTimeout(() => {
      if (!otaSession || otaSession.id !== id) return;
      const device = devices.get(id);
      const lastFw = device ? String((device.state || {}).firmware || "?") : "?";
      failActiveOta(
        "Δεν επιβεβαιώθηκε η νέα έκδοση μέσα σε 3 λεπτά.",
        `Τελευταία γνωστή έκδοση: ${lastFw}. Έλεγξε OLED / Recovery / MQTT.`
      );
    }, OTA_TOTAL_TIMEOUT_MS);

    setTimeout(() => {
      if (otaSession && otaSession.id === id) requestUpdate(id, false);
    }, 7000);
  }

  function openOtaPinDialog(id, manifest) {
    const device = devices.get(id);
    if (!device) return;

    const fw = String((device.state || {}).firmware || "");
    otaTargetId = id;
    otaPendingManifest = manifest;

    ui.otaPinInput.value = "";
    ui.otaPinError.textContent = "";
    ui.otaPinError.classList.add("hidden");
    ui.otaPinTarget.textContent =
      `Συσκευή: ${id} · ${fw} → ${manifest.version}`;
    ui.otaPinDialog.showModal();
    setTimeout(() => ui.otaPinInput.focus(), 50);
  }

  function sendPendingRemoteOta() {
    const id = otaTargetId;
    if (id && meterType(devices.get(id) || {id,state:{}}) === "VENTILATION" &&
        !firmwareAtLeast(devices.get(id)?.state?.firmware,1,4)) {
      otaTargetId = null; otaPendingManifest = null;
      setAdminStatus("Ο εξαερισμός απαιτεί πρώτα τοπική εγκατάσταση της 1.04.", "error");
      return;
    }
    const manifest = otaPendingManifest;

    otaTargetId = null;
    otaPendingManifest = null;

    if (!id || !manifest) {
      setAdminStatus("Δεν υπάρχει έτοιμη OTA εντολή.", "error");
      return;
    }

    const device = devices.get(id);
    if (!device) {
      showToast("Η συσκευή δεν είναι πλέον διαθέσιμη.");
      return;
    }

    if (!client || !client.connected) {
      setAdminStatus("Δεν υπάρχει σύνδεση με HiveMQ.", "error");
      showToast("Δεν υπάρχει σύνδεση με HiveMQ.");
      return;
    }

    clearOtaAckTimer();

    const fromVersion = String((device.state || {}).firmware || "?");
    otaAwaitingStart = {
      id,
      fromVersion,
      targetVersion: manifest.version,
      manifest,
      sentAt: Date.now()
    };

    adminBusy.add(id);
    updateAdminButtons();
    setAdminStatus(
      `Αποστολή OTA ${fromVersion} → ${manifest.version}. Αναμονή επιβεβαίωσης από ESP8266…`
    );

    const firmwareUrl = OTA_MANIFEST_BASE_URL + encodeURIComponent(manifest.file);
    const ventilation = meterType(device) === "VENTILATION";
    const command = `ota_https|${manifest.size}|${manifest.md5}|${firmwareUrl}` +
      (ventilation ? `|${OTA_PIN}` : "");

    const sent = publish(id, "admin/request", command, (err) => {
      if (!err) return;
      if (!otaAwaitingStart || otaAwaitingStart.id !== id) return;
      failOtaBeforeStart(
        "Αποτυχία MQTT publish.",
        err.message || String(err)
      );
    });

    if (!sent) {
      failOtaBeforeStart("Δεν υπάρχει ενεργή MQTT σύνδεση.");
      return;
    }

    otaAckTimer = setTimeout(() => {
      if (!otaAwaitingStart || otaAwaitingStart.id !== id) return;
      failOtaBeforeStart(
        "Δεν ελήφθη επιβεβαίωση έναρξης από τον ESP8266.",
        "Timeout 12s στο admin/response."
      );
    }, OTA_ACK_TIMEOUT_MS);
  }

  async function startRemoteOta(id) {
    const device = devices.get(id);
    if (device && meterType(device) === "VENTILATION" &&
        !firmwareAtLeast(device.state?.firmware,1,4)) {
      setAdminStatus("Πρώτα εγκατάστησε το Ventilation 1.04 μέσω τοπικού Recovery OTA.", "error");
      return;
    }
    if (!device) {
      showToast("Η συσκευή δεν είναι πλέον διαθέσιμη.");
      return;
    }
    if (!client || !client.connected) {
      showToast("Δεν υπάρχει σύνδεση με HiveMQ.");
      return;
    }

    const fw = String((device.state || {}).firmware || "");
    if (meterType(device) !== "VENTILATION" && !firmwareAtLeast(fw, 2, 29)) {
      setAdminStatus("Το remote OTA απαιτεί πρώτα firmware 2.29+.", "error");
      showToast(`${id}: απαιτεί firmware 2.29+`);
      return;
    }

    otaManifestLoading = true;
    updateAdminButtons();
    setAdminStatus("Έλεγχος διαθέσιμου OTA firmware…");

    try {
      const manifest = await loadOtaManifest(device);

      if (!otaManifestMatchesDevice(manifest, device)) {
        throw new Error(`Το διαθέσιμο firmware ${manifest.meter || "?"} δεν αντιστοιχεί στη συσκευή.`);
      }

      const currentFw = String((device.state || {}).firmware || "?");
      const oledText = manifest.oled ? ` · ${manifest.oled}` : "";
      const versionComparison = compareFirmwareVersions(manifest.version, currentFw);

      if (versionComparison < 0) {
        setAdminStatus(
          `Το διαθέσιμο OTA v${manifest.version} είναι παλαιότερο από το τρέχον v${currentFw}. Το downgrade μπλοκαρίστηκε.`,
          "error"
        );
        showToast(`${id}: OTA downgrade μπλοκαρίστηκε`, 5000);
        return;
      }

      const isNewer = versionComparison > 0;
      if (meterType(device) === "VENTILATION" && !isNewer) {
        setAdminStatus("Δεν υπάρχει νεότερο Ventilation firmware προς OTA. Δεν επιτρέπεται επανεγκατάσταση ή downgrade.", "error");
        return;
      }
      const newBadge = isNewer ? " · NEW!" : "";

      renderOtaAvailability(device, manifest, false);

      const confirmed = window.confirm(
        `OTA αναβάθμιση ${id}\n\n` +
        `Τρέχουσα έκδοση ESP8266: ${currentFw}\n` +
        `Available OTA: ${manifest.version}${oledText}${newBadge}\n\n` +
        "Ο ESP θα αποσυνδεθεί προσωρινά από MQTT και θα επανεκκινήσει. Συνέχεια;"
      );

      if (!confirmed) {
        setAdminStatus("Το OTA ακυρώθηκε.");
        return;
      }

      // v1.11: πρώτα εμφανίζονται current/available version και NEW!,
      // μετά η τελική επιβεβαίωση και τελευταίο βήμα το PIN.
      // Καμία MQTT OTA εντολή δεν αποστέλλεται πριν επαληθευτεί το PIN.
      openOtaPinDialog(id, manifest);
      setAdminStatus(
        `ESP8266 ${currentFw} → OTA ${manifest.version}${newBadge} · αναμονή PIN.`
      );
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      setAdminStatus(`OTA: ${message}`, "error");
      showToast(`${id}: ${message}`, 5000);
    } finally {
      otaManifestLoading = false;
      updateAdminButtons();
    }
  }

  function utilityCurrentDual() {
    if (!adminTargetId) return false;
    const device = devices.get(adminTargetId);
    if (!device) return false;
    return device.state.dual_zone === true || device.state.tariff_mode === "dual";
  }

  function utilityKindValue() {
    return ui.utilityKindIntermediate.checked ? "ek" : "tk";
  }

  function resetUtilityEditor() {
    editingUtilityId = null;
    utilityEntryStep = 0;
    ui.utilityEntryTitle.textContent = "Νέα καταχώρηση";
    ui.utilityKindFinal.checked = false;
    ui.utilityKindIntermediate.checked = true;
    ui.utilityKindFinal.disabled = false;
    ui.utilityKindIntermediate.disabled = false;
    ui.utilityTimeExact.checked = false;
    ui.utilityTimeEstimated.checked = true;
    updateUtilityTimeMode();
    ui.utilityDateInput.value = localDateInputValue();
    ui.utilityTimeInput.value = "";
    ui.utilityZInput.value = "";
    ui.utilityZ1Input.value = "";
    ui.utilityZ2Input.value = "";
    setUtilityEntryStep(0);
  }

  function utilityEntrySteps() {
    return utilityKindValue() === "ek" ? [0, 3, 4] : [0, 1, 2, 3, 4];
  }

  function utilityEntryAdjacentStep(direction) {
    const steps = utilityEntrySteps();
    const index = steps.indexOf(utilityEntryStep);
    return steps[Math.max(0, Math.min(steps.length - 1, index + direction))];
  }

  function updateUtilityTimeMode() {
    const estimated = ui.utilityTimeEstimated.checked;
    ui.utilityTimeField.classList.toggle("hidden", estimated);
    ui.utilityTimeInput.disabled = estimated;
    ui.utilityTimeInput.required = !estimated;
  }

  function setUtilityEntryStep(step) {
    utilityEntryStep = Math.max(0, Math.min(4, step));
    const steps = [
      ui.utilityStepType,
      ui.utilityStepDate,
      ui.utilityStepTime,
      ui.utilityStepReading,
      ui.utilityStepConfirm
    ];
    steps.forEach((node, index) => node.classList.toggle("hidden", index !== utilityEntryStep));
    const activeSteps = utilityEntrySteps();
    ui.utilityStepLabel.textContent = `Βήμα ${activeSteps.indexOf(utilityEntryStep) + 1} από ${activeSteps.length}`;
  }

  function updateUtilityReadingMode() {
    const dual = utilityCurrentDual();
    const measurement = utilityKindValue() === "tk";
    ui.monoReadingFields.classList.toggle("hidden", dual);
    ui.dualReadingFields.classList.toggle("hidden", !dual);
    ui.utilityTariffLabel.textContent = `Τιμολόγιο: ${dual ? "Διζωνικό Ζ1 / Ζ2" : "Μονοζωνικό Ζ"}`;

    [ui.utilityZInput, ui.utilityZ1Input, ui.utilityZ2Input].forEach((input) => {
      if (!input) return;
      input.step = measurement ? "1" : "0.01";
      input.min = measurement ? "1" : "0.01";
      input.max = measurement ? "999998" : "999998.99";
      input.inputMode = measurement ? "numeric" : "decimal";
    });
  }

  function openUtilityEntry(row = null) {
    if (!adminTargetId) return;
    const device = devices.get(adminTargetId);
    if (!device) return;

    if (!firmwareAtLeast((device.state || {}).firmware, 4, 0)) {
      setAdminStatus("Οι νέες Καταχωρήσεις Ένδειξης / Μέτρησης ΔΕΗ απαιτούν firmware v4.00+.", "error");
      return;
    }

    const currentMode = utilityCurrentDual() ? "dual" : "mono";
    if (row && row.mode !== currentMode) {
      showToast("Για διόρθωση, το τιμολόγιο Ζ / Ζ1-Ζ2 πρέπει να είναι ίδιο με την εγγραφή.");
      return;
    }

    resetUtilityEditor();
    editingUtilityId = row ? row.id : null;
    ui.utilityEntryTitle.textContent = row ? "Διόρθωση καταχώρησης" : "Νέα καταχώρηση";

    if (row) {
      ui.utilityKindFinal.checked = row.kind !== "ek";
      ui.utilityKindIntermediate.checked = row.kind === "ek";
      ui.utilityDateInput.value = row.date;
      ui.utilityTimeInput.value = row.timeToken === "window" ? "" : row.timeToken;
      ui.utilityTimeEstimated.checked = row.timeToken === "window";
      ui.utilityTimeExact.checked = !ui.utilityTimeEstimated.checked;
      ui.utilityKindFinal.disabled = true;
      ui.utilityKindIntermediate.disabled = true;
      updateUtilityTimeMode();
      const digits = row.kind === "ek" ? 2 : 0;
      if (row.mode === "dual") {
        ui.utilityZ1Input.value = row.z1.toFixed(digits);
        ui.utilityZ2Input.value = row.z2.toFixed(digits);
      } else {
        ui.utilityZInput.value = row.z.toFixed(digits);
      }
    }

    updateUtilityReadingMode();
    setUtilityEntryStep(0);
    if (!ui.utilityEntryDialog.open) ui.utilityEntryDialog.showModal();
  }

  function utilityStepValid(step) {
    if (step === 0) return ui.utilityKindFinal.checked || ui.utilityKindIntermediate.checked;

    if (step === 1) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ui.utilityDateInput.value.trim())) {
        showToast("Επίλεξε έγκυρη ημερομηνία μέτρησης.");
        return false;
      }
      return true;
    }

    if (step === 2) {
      if (ui.utilityTimeEstimated.checked) return true;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(ui.utilityTimeInput.value.trim())) {
        showToast("Επίλεξε την ώρα που η ΔΕΗ πραγματοποίησε τη μέτρηση.");
        return false;
      }
      return true;
    }

    if (step === 3) {
      const measurement = utilityKindValue() === "tk";
      if (utilityCurrentDual()) {
        const z1 = Number(ui.utilityZ1Input.value);
        const z2 = Number(ui.utilityZ2Input.value);
        if (!Number.isFinite(z1) || !Number.isFinite(z2) ||
            z1 <= 0 || z2 <= 0 || z1 >= 999999 || z2 >= 999999 ||
            (measurement && (!Number.isInteger(z1) || !Number.isInteger(z2)))) {
          showToast(measurement
            ? "Οι Μετρήσεις ΔΕΗ Ζ1 και Ζ2 δίνονται σε ακέραιες kWh."
            : "Γράψε έγκυρες ενδείξεις Ζ1 και Ζ2.");
          return false;
        }
      } else {
        const z = Number(ui.utilityZInput.value);
        if (!Number.isFinite(z) || z <= 0 || z >= 999999 ||
            (measurement && !Number.isInteger(z))) {
          showToast(measurement
            ? "Η Μέτρηση ΔΕΗ δίνεται σε ακέραιες kWh."
            : "Γράψε έγκυρη ένδειξη Ζ.");
          return false;
        }
      }
      return true;
    }

    return true;
  }

  function prepareUtilityConfirmation() {
    const form = readUtilityForm();
    if (!form) return false;
    const kindLabel = form.kind === "ek"
      ? "Καταχώρηση Ένδειξης Μετρητή ΔΕΗ"
      : "Καταχώρηση Μέτρησης ΔΕΗ";

    const valueDigits = form.kind === "tk" ? 0 : 2;
    const values = form.dual
      ? `<div class="utility-confirm-values"><strong>Ζ1: ${formatNumber(form.z1, valueDigits)} kWh</strong><strong>Ζ2: ${formatNumber(form.z2, valueDigits)} kWh</strong></div>`
      : `<div class="utility-confirm-values"><strong>Ζ: ${formatNumber(form.z, valueDigits)} kWh</strong></div>`;

    ui.utilityConfirmSummary.innerHTML = `
      ${values}
      <div>Τιμολόγιο: <b>${form.dual ? "Διζωνικό Ζ1 / Ζ2" : "Μονοζωνικό Ζ"}</b></div>
      <div>Τύπος: <b>${kindLabel}</b></div>
      ${form.automaticTime
        ? '<div>Ημερομηνία / ώρα: <b>τρέχουσα, από τον ESP κατά την αποθήκευση</b></div><div>Η ένδειξη συνδέεται με τους εσωτερικούς μετρητές της ίδιας στιγμής και χρησιμοποιείται για Εκτίμηση τώρα / αξιολόγηση %.</div>'
        : `<div>Ημερομηνία μέτρησης ΔΕΗ: <b>${escapeHtml(form.date)}</b></div><div>Ώρα: <b>${form.time === "window" ? "δεν είναι γνωστή" : escapeHtml(form.time)}</b></div><div>Η μέτρηση χρησιμοποιείται μόνο ως «ΔΕΗ τελευταία» για τη ζωντανή Διαφορά.</div>`}
    `;
    return true;
  }

  // Ventilation v1.00 publishes 12 non-retained chunks per requested day:
  // R|current/previous|offset|inside,outside|... and E|range.
  const ventAdminTimeouts = new Map();
  let ventHistorySession = null;
  let ventHistoryTimeout = null;
  function ventHistoryClearTimeout() {
    if (ventHistoryTimeout) clearTimeout(ventHistoryTimeout);
    ventHistoryTimeout = null;
  }
  function renderVentHistory() {
    const h = ventHistorySession;
    if (!h) return;
    const status = $("ventHistoryStatus");
    status.textContent = `${h.id} · ${h.range === "current" ? "Σήμερα" : "Χθες"} · ${h.seen.size * 8}/96 δείγματα${h.complete ? " · ολοκληρώθηκε" : " · λήψη…"}`;
    const numeric = h.rows.flatMap(row => row ? [row.inside,row.outside] : []).filter(Number.isFinite);
    if (!numeric.length) {
      $("ventHistoryChart").innerHTML = '<p class="admin-help">Αναμονή δεδομένων θερμοκρασίας από τον ESP8266.</p>';
      $("ventHistoryTable").innerHTML = "";
      return;
    }
    const lo = Math.floor(Math.min(...numeric) - 1);
    const hi = Math.ceil(Math.max(...numeric) + 1);
    const span = Math.max(1, hi - lo);
    const xy = (index, value) => {
      const x = 46 + index * 7.55;
      const y = 224 - ((value - lo) / span) * 184;
      return [x.toFixed(1),y.toFixed(1)];
    };
    const plot = (key) => h.rows.map((row,i) =>
      row && Number.isFinite(row[key]) ? xy(i,row[key]) : null
    ).reduce((acc,p) => {
      if (!p) {acc.prev=false;return acc;}
      acc.d += (acc.prev ? "L" : "M") + p[0] + "," + p[1] + " ";
      acc.prev=true; return acc;
    },{d:"",prev:false}).d;
    const marks = [0,24,48,72,95].map(i =>
      `<text x="${46+i*7.55}" y="249" text-anchor="middle">${String(Math.floor(i/4)).padStart(2,"0")}:00</text>`
    ).join("");
    $("ventHistoryChart").innerHTML = `<svg viewBox="0 0 800 270" width="800" height="270" role="img" aria-label="Θερμοκρασία μέσα και έξω ανά 15 λεπτά">
      <line x1="46" y1="40" x2="46" y2="224" stroke="currentColor" opacity=".5"/>
      <line x1="46" y1="224" x2="766" y2="224" stroke="currentColor" opacity=".5"/>
      <text x="4" y="45" fill="currentColor" font-size="12">${hi}°</text>
      <text x="4" y="224" fill="currentColor" font-size="12">${lo}°</text>
      <path d="${plot("inside")}" fill="none" stroke="#dc2626" stroke-width="2.5"/>
      <path d="${plot("outside")}" fill="none" stroke="#2563eb" stroke-width="2.5"/>
      <g fill="currentColor" font-size="11">${marks}</g>
      <g font-size="13"><text x="60" y="18" fill="#dc2626">● Μέσα</text>
      <text x="150" y="18" fill="#2563eb">● Έξω</text></g></svg>`;
    if (!h.complete) { $("ventHistoryTable").innerHTML="";return; }
    const td = (x) => Number.isFinite(x) ? escapeHtml(formatNumber(x,1)) : "—";
    $("ventHistoryTable").innerHTML = `<details><summary>Πίνακας 96 δεκαπεντάλεπτων</summary>
      <div class="vent-history-table-scroll"><table><thead><tr><th>Ώρα</th><th>Μέσα °C</th><th>Έξω °C</th></tr></thead>
      <tbody>${h.rows.map((r,i)=>`<tr><td>${String(Math.floor(i/4)).padStart(2,"0")}:${String((i%4)*15).padStart(2,"0")}</td><td>${td(r?.inside)}</td><td>${td(r?.outside)}</td></tr>`).join("")}</tbody>
      </table></div></details>`;
  }
  function requestVentHistory(id, range) {
    const device = devices.get(id);
    if (!device || meterType(device) !== "VENTILATION" || !device.online ||
        !client?.connected || !["current","previous"].includes(range)) return false;
    ventHistoryClearTimeout();
    ventHistorySession = {id,range,rows:Array(96).fill(null),seen:new Set(),complete:false};
    renderVentHistory();
    const ok = publish(id,"admin/request",`vent_history|${range}`,err=>{
      if(err && ventHistorySession?.id===id){
        ventHistoryClearTimeout();
        $("ventHistoryStatus").textContent = "Αποτυχία MQTT: " + String(err.message || err);
      }
    });
    if (!ok) {
      $("ventHistoryStatus").textContent="Δεν ήταν δυνατή η αποστολή του αιτήματος.";
      return false;
    }
    ventHistoryTimeout = setTimeout(()=>{
      if(!ventHistorySession || ventHistorySession.complete || ventHistorySession.id!==id) return;
      $("ventHistoryStatus").textContent="Ελλιπές ιστορικό: δεν λήφθηκαν όλα τα πακέτα (timeout 20s).";
      ventHistoryTimeout = null;
    },20000);
    return true;
  }
  function openVentHistory(id) {
    const device=devices.get(id);
    if (!device || meterType(device)!=="VENTILATION" || !device.online || !client?.connected) {
      showToast("Ο εξαερισμός πρέπει να είναι online για να φορτώσει το ιστορικό.");
      return;
    }
    if (!$("ventHistoryDialog").open) $("ventHistoryDialog").showModal();
    requestVentHistory(id,"current");
  }
  function handleVentHistory(id,text) {
    const h=ventHistorySession;
    if(!h || h.id!==id || h.complete || !$("ventHistoryDialog").open) return;
    const p=String(text).split("|");
    if(p[1]!==h.range) return;
    if(p[0]==="E" && p.length===2){
      ventHistoryClearTimeout();
      if(h.seen.size===12){h.complete=true;renderVentHistory();}
      else $("ventHistoryStatus").textContent=`Ελλιπής λήψη: ${h.seen.size*8}/96 δείγματα. Πάτησε ξανά την ημέρα.`;
      return;
    }
    if(p[0]!=="R" || p.length!==11) return;
    const offset=Number(p[2]);
    if(!Number.isInteger(offset)||offset<0||offset>88||offset%8!==0)return;
    if(h.seen.has(offset)) return;
    const rows=[];
    for(const pair of p.slice(3)){
      const n=pair.split(",");
      if(n.length!==2)return;
      const parsed=n.map(v=>{
        if(v==="null")return null;
        if(!/^-?\d+(?:\.\d+)?$/.test(v))return NaN;
        const t=Number(v);
        return Number.isFinite(t) && t>=-55 && t<=125 ? t : NaN;
      });
      if(parsed.some(v=>Number.isNaN(v))) return;
      rows.push({inside:parsed[0],outside:parsed[1]});
    }
    rows.forEach((row,i)=>h.rows[offset+i]=row);
    h.seen.add(offset);
    renderVentHistory();
  }

  function refreshVentControls(device) {
    const vent = Boolean(device && meterType(device) === "VENTILATION");
    ui.utilityReadingSettings.classList.toggle("hidden", vent);
    $("dualZoneSettings")?.classList.toggle("hidden", vent);
    $("ventilationSettings")?.classList.toggle("hidden", !vent);
    if (!vent) return;
    const state = device.state || {};
    const connected = Boolean(client?.connected && device.online);
    const busy = adminBusy.has(device.id);
    const manual = state.mode === "manual";
    const known = device.sampleReceived === true && (state.mode === "auto" || manual);
    const supported = firmwareAtLeast(state.firmware,1,1);
    const independentSpeed = firmwareAtLeast(state.firmware,1,3);
    const ntpOk = state.time_synced === true;
    $("ventTimeSettings").classList.toggle("hidden", ntpOk);
    $("ventOtaNotice").textContent = !supported
      ? "Firmware πριν την 1.01: αντίστροφοι χειρισμοί, εντολές κλειδωμένες."
      : independentSpeed
        ? "Ανεξάρτητη ταχύτητα 570/440 m³/h και σε AUTO. Το μη δοκιμασμένο απομακρυσμένο MQTT OTA παραμένει κλειδωμένο."
        : "Για επιλογή ταχύτητας και σε AUTO απαιτείται Ventilation 1.03. Το MQTT OTA παραμένει κλειδωμένο.";
    $("ventLiveInfo").textContent = !connected
      ? "Ο εξαερισμός δεν είναι συνδεδεμένος στο MQTT."
      : !known ? "Αναμονή έγκυρης κατάστασης ESP8266." : "";
    $("ventLiveInfo").classList.toggle("hidden", connected && known);
    // Update the visual selection from the last real ESP state, never from
    // optimistic button clicks. Green = selected, gray = not selected.
    const selectedValues = new Set([
      `vent_mode|${manual ? "manual" : "auto"}`,
      `vent_season|${state.season === "summer" ? "summer" : "winter"}`,
      `vent_fan|${state.fan_on === true ? "on" : "off"}`,
      `vent_speed|${state.speed === "high" ? "high" : "low"}`
    ]);
    if (known && !busy) {
      if (/^\d{2}:\d{2}$/.test(state.stop_from || "")) $("ventPauseFrom").value = state.stop_from;
      if (/^\d{2}:\d{2}$/.test(state.stop_to || "")) $("ventPauseTo").value = state.stop_to;
      if (/^\d{2}:\d{2}:\d{2}$/.test(state.time || "")) $("ventClockInput").value = state.time;
    }
    for (const btn of $("ventilationSettings").querySelectorAll?.("[data-vent-command]") || []) {
      const cmd = btn.dataset.ventCommand || "";
      const fanCommand = cmd.startsWith("vent_fan|");
      const speedCommand = cmd.startsWith("vent_speed|");
      btn.disabled = !connected || busy || !known || !supported ||
        (fanCommand && !manual) || (speedCommand && !manual && !independentSpeed);
      const selected = known && selectedValues.has(cmd);
      btn.classList.toggle("vent-selected", selected);
      btn.classList.toggle("vent-auto-disabled", fanCommand && !manual);
      btn.setAttribute("aria-pressed", selected ? "true" : "false");
    }
    $("saveVentScheduleBtn").disabled = !connected || busy || !known || !supported;
    $("saveVentTimeBtn").disabled = !connected || busy || !known || !supported || ntpOk;
  }

  function sendVentCommand(id, command) {
    const device = devices.get(id);
    if (!device || meterType(device) !== "VENTILATION" || !client?.connected ||
        !device.online || adminBusy.has(id) || !device.sampleReceived) return false;
    if (!firmwareAtLeast(device.state?.firmware,1,1)) {
      setAdminStatus("Απαιτείται firmware 1.01+: στο παλιό οι χειρισμοί των ρελέ λειτουργούσαν αντίστροφα. Δεν απεστάλη εντολή.", "error");
      return false;
    }
    const allowed = new Set([
      "vent_mode|auto","vent_mode|manual",
      "vent_fan|on","vent_fan|off",
      "vent_speed|high","vent_speed|low",
      "vent_season|summer","vent_season|winter"
    ]);
    if (!allowed.has(command) &&
        !/^vent_schedule\|(?:[01]\d|2[0-3]):[0-5]\d\|(?:[01]\d|2[0-3]):[0-5]\d$/.test(command) &&
        !/^vent_time\|(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(command)) {
      setAdminStatus("Μη επιτρεπτή εντολή εξαερισμού.", "error");
      return false;
    }
    if (command.startsWith("vent_time|") && device.state?.time_synced === true) {
      setAdminStatus("Η ώρα ρυθμίζεται αυτόματα από NTP. Η χειροκίνητη ρύθμιση είναι διαθέσιμη μόνο χωρίς συγχρονισμό.", "error");
      return false;
    }
    const manual = device.state?.mode === "manual";
    if (command.startsWith("vent_fan|") && !manual) {
      setAdminStatus("Το ON/OFF του ανεμιστήρα επιτρέπεται μόνο σε MANUAL.", "error");
      return false;
    }
    if (command.startsWith("vent_speed|") && !manual &&
        !firmwareAtLeast(device.state?.firmware,1,3)) {
      setAdminStatus("Ανεξάρτητη ταχύτητα AUTO/MANUAL απαιτεί firmware 1.03+.", "error");
      return false;
    }
    if ((command === "vent_fan|on" || command === "vent_mode|manual" ||
         command.startsWith("vent_season|") || command.startsWith("vent_schedule|")) &&
        !window.confirm(`Αποστολή εντολής στον πραγματικό εξαερισμό ${id};\n\n${command}\n\nΕπιβεβαίωσε ότι η εγκατάσταση μπορεί να λειτουργήσει με ασφάλεια.`)) return false;
    adminTargetId = id;
    adminBusy.add(id);
    updateAdminButtons();
    setAdminStatus(`Αποστολή: ${command}…`);
    const sent = publish(id, "admin/request", command, (err) => {
      if (!err) return;
      clearTimeout(ventAdminTimeouts.get(id));
      ventAdminTimeouts.delete(id);
      adminBusy.delete(id);
      updateAdminButtons();
      setAdminStatus(`Αποτυχία εντολής: ${err.message || err}`, "error");
    });
    if (!sent) {
      adminBusy.delete(id);
      updateAdminButtons();
      setAdminStatus("Δεν εστάλη εντολή: σύνδεση MQTT μη διαθέσιμη.", "error");
      return false;
    }
    const timeout = setTimeout(() => {
      if (ventAdminTimeouts.get(id) !== timeout) return;
      ventAdminTimeouts.delete(id);
      adminBusy.delete(id);
      updateAdminButtons();
      if (adminTargetId === id) setAdminStatus("Δεν ελήφθη επιβεβαίωση από τον ESP8266. Έλεγξε την κατάσταση πριν επαναλάβεις.", "error");
    }, 12000);
    ventAdminTimeouts.set(id, timeout);
    refreshVentControls(device);
    return true;
  }

  function openAdmin(id) {
    const device = devices.get(id);
    if (!device) return;

    adminTargetId = id;
    utilityHistoryRows = [];
    utilityHistoryDeviceId = null;
    resetUtilityEditor();

    ui.adminEyebrow.textContent = `${meterName(device)} SETTINGS`;
    ui.adminTitle.textContent = `Ρυθμίσεις · ${id}`;
    refreshDualZoneSettings(device);
    refreshVentControls(device);

    const fw = String((device.state || {}).firmware || "?");
    renderOtaAvailability(device, null, true);

    const supportsEntryTypes = firmwareAtLeast(fw, 4, 0);
    if (meterType(device) === "VENTILATION") {
      setAdminStatus("Έλεγχος εξαερισμού μέσω MQTT · Απομακρυσμένο OTA κλειδωμένο.", "ok");
    } else setAdminStatus(
      supportsEntryTypes
        ? "Έτοιμο."
        : (firmwareAtLeast(fw, 3, 0)
            ? "Οι νέες Καταχωρήσεις Ένδειξης / Μέτρησης ΔΕΗ απαιτούν firmware v4.00+."
            : "Οι μετρήσεις απαιτούν firmware v3.00+."),
      supportsEntryTypes ? "ok" : "error"
    );

    renderUtilityLatestSummary(id);
    updateAdminButtons();
    ui.adminDialog.showModal();

    if (meterType(device) !== "VENTILATION" && firmwareAtLeast(fw, 3, 0) && client && client.connected) {
      setTimeout(() => refreshUtilityRows(id, false), 0);
    }
    if (client && client.connected) {
      setTimeout(() => refreshOtaAvailability(id), 0);
    }
  }

  function setAdminStatus(message, kind = "") {
    ui.adminStatus.textContent = message;
    ui.adminStatus.classList.remove("is-ok", "is-error");
    if (kind) ui.adminStatus.classList.add(`is-${kind}`);
  }

  function updateAdminButtons() {
    const busy = adminTargetId && adminBusy.has(adminTargetId);
    const connected = Boolean(client && client.connected);
    const device = adminTargetId ? devices.get(adminTargetId) : null;
    const state = device ? (device.state || {}) : {};
    const supportsV3 = Boolean(device && firmwareAtLeast(state.firmware, 3, 0));
    const supportsTypes = Boolean(device && firmwareAtLeast(state.firmware, 4, 0));
    const supportsRestart = Boolean(device && (meterType(device) === "VENTILATION" || firmwareAtLeast(state.firmware, 4, 3)));

    if (ui.utilityHistoryBtn) {
      ui.utilityHistoryBtn.disabled = !adminTargetId || busy || !connected || !supportsV3;
    }
    if (ui.startUtilityReadingBtn) {
      ui.startUtilityReadingBtn.disabled = !adminTargetId || busy || !connected || !supportsTypes;
    }
    if (ui.changeMeterTypeBtn) {
      ui.changeMeterTypeBtn.disabled = !adminTargetId || busy;
    }
    if (ui.saveDualZoneBtn) {
      ui.saveDualZoneBtn.disabled = !adminTargetId || busy || !connected || !supportsV3;
    }
    if (ui.saveUtilityReadingBtn) {
      ui.saveUtilityReadingBtn.disabled = !adminTargetId || busy || !connected || !supportsTypes;
    }

    [
      ui.utilityDateInput,
      ui.utilityTimeInput,
      ui.utilityZInput,
      ui.utilityZ1Input,
      ui.utilityZ2Input,
      ui.utilityKindFinal,
      ui.utilityKindIntermediate,
      ui.dualZoneToggle
    ].forEach((control) => {
      if (control) control.disabled =
        !adminTargetId || busy || !connected ||
        (control === ui.dualZoneToggle ? !supportsV3 : !supportsTypes);
    });

    if (ui.otaUpdateBtn) {
      const fwForOta = String(state.firmware || "");
      ui.otaUpdateBtn.disabled =
        !adminTargetId || busy || !connected || otaManifestLoading ||
        (meterType(device) === "VENTILATION"
          ? !firmwareAtLeast(fwForOta,1,4) : !firmwareAtLeast(fwForOta,2,29));
    }
    if (ui.restartEspBtn) {
      ui.restartEspBtn.disabled =
        !adminTargetId || busy || !connected || !supportsRestart;
      ui.restartEspBtn.title = supportsRestart
        ? "Κανονική επανεκκίνηση του ESP8266"
        : "Απαιτεί firmware v4.03+";
    }
    if (device && meterType(device) === "VENTILATION") refreshVentControls(device);
  }

  function readUtilityForm() {
    if (!adminTargetId) return null;
    const device = devices.get(adminTargetId);
    if (!device) return null;

    const dual = utilityCurrentDual();
    const kind = utilityKindValue();
    const automaticTime = kind === "ek" && editingUtilityId === null;
    if (automaticTime && !firmwareAtLeast(device.state.firmware, 4, 0)) {
      setAdminStatus("Η Καταχώρηση Ένδειξης Μετρητή ΔΕΗ απαιτεί firmware v4.00+.", "error");
      return null;
    }
    const date = automaticTime ? "now" : ui.utilityDateInput.value.trim();
    const time = automaticTime ? "now" : (ui.utilityTimeEstimated.checked ? "window" : ui.utilityTimeInput.value.trim());

    if (!automaticTime && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setAdminStatus("Επίλεξε έγκυρη ημερομηνία μέτρησης.", "error");
      return null;
    }
    if (!automaticTime && time !== "window" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      setAdminStatus("Επίλεξε έγκυρη ώρα μέτρησης.", "error");
      return null;
    }

    const measurement = kind === "tk";
    const digits = measurement ? 0 : 2;
    if (dual) {
      const z1 = Number(ui.utilityZ1Input.value);
      const z2 = Number(ui.utilityZ2Input.value);
      if (!Number.isFinite(z1) || !Number.isFinite(z2) ||
          z1 <= 0 || z2 <= 0 || z1 >= 999999 || z2 >= 999999 ||
          (measurement && (!Number.isInteger(z1) || !Number.isInteger(z2)))) {
        setAdminStatus(measurement
          ? "Οι Μετρήσεις ΔΕΗ Ζ1 και Ζ2 δίνονται μόνο σε ακέραιες kWh."
          : "Γράψε έγκυρες ενδείξεις Ζ1 και Ζ2.", "error");
        return null;
      }
      return {
        kind, dual: true, automaticTime, date, time, z1, z2,
        commandTail: `${kind}|dual|${date}|${time}|${z1.toFixed(digits)}|${z2.toFixed(digits)}`
      };
    }

    const z = Number(ui.utilityZInput.value);
    if (!Number.isFinite(z) || z <= 0 || z >= 999999 ||
        (measurement && !Number.isInteger(z))) {
      setAdminStatus(measurement
        ? "Η Μέτρηση ΔΕΗ δίνεται μόνο σε ακέραιες kWh."
        : "Γράψε έγκυρη ένδειξη Ζ.", "error");
      return null;
    }
    return {
      kind, dual: false, automaticTime, date, time, z,
      commandTail: `${kind}|mono|${date}|${time}|${z.toFixed(digits)}`
    };
  }

  function sendAdmin(command, pendingMessage) {
    if (!adminTargetId) return;
    const id = adminTargetId;
    adminBusy.add(id);
    updateAdminButtons();
    setAdminStatus(pendingMessage);
    publish(id, "admin/request", command, (err) => {
      if (!err) return;
      adminBusy.delete(id);
      updateAdminButtons();
      setAdminStatus(`Αποτυχία αποστολής: ${err.message || err}`, "error");
    });
  }

  function utilitySaveMessage(data) {
    const indication = data && data.kind === "ek";
    const kind = indication
      ? "Καταχώρηση Ένδειξης Μετρητή ΔΕΗ"
      : "Καταχώρηση Μέτρησης ΔΕΗ";
    if (indication && (!data || data.mapped !== true)) {
      return `Η ${kind} δεν συνδέθηκε με τους εσωτερικούς μετρητές.`;
    }
    return `Η ${kind} αποθηκεύτηκε.`;
  }

  function handleAdminResponse(id, text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      if (otaAwaitingStart && otaAwaitingStart.id === id) {
        failOtaBeforeStart(
          "Μη έγκυρη απάντηση από ESP8266.",
          `Payload: ${String(text).slice(0, 140)}`
        );
      } else if (adminTargetId === id) {
        setAdminStatus("Μη έγκυρη admin απάντηση.", "error");
      }
      return;
    }

    const errorMessages = {
      invalid_reading: "Τα στοιχεία της μέτρησης ΔΕΗ δεν είναι έγκυρα.",
      invalid_reading_id: "Η εγγραφή ΔΕΗ δεν είναι έγκυρη.",
      reading_not_found: "Η μέτρηση ΔΕΗ δεν βρέθηκε.",
      reading_update_not_allowed: "Η εγγραφή δεν βρέθηκε ή έχει ήδη διαγραφεί και δεν μπορεί να διορθωθεί.",
      reading_not_found_or_not_latest_ek: "Η εγγραφή δεν βρέθηκε ή δεν είναι η τελευταία ενεργή Καταχώρηση Ένδειξης. Μόνο η τελευταία Ένδειξη μπορεί να διαγραφεί.",
      indication_anchor_failed: "Η Ένδειξη ΔΕΗ δεν μπόρεσε να συνδεθεί με φρέσκια εσωτερική μέτρηση του ESP.",
      storage_failed: "Απέτυχε η αποθήκευση στο ESP8266.",
      tariff_mode_mismatch: "Η μέτρηση δεν ταιριάζει με τον ενεργό τύπο Ζ / Ζ1-Ζ2.",
      time_not_valid: "Ο ESP δεν έχει ακόμα έγκυρη ημερομηνία/ώρα από NTP.",
      dds238_read_failed: "Απέτυχε η ανάγνωση DDS238.",
      jsy_read_failed: "Απέτυχε η ανάγνωση JSY-MK-333.",
      missing_parameters: "Λείπουν παράμετροι OTA.",
      invalid_https_url: "Το OTA URL δεν είναι έγκυρο.",
      invalid_command: "Ο ESP8266 δεν αναγνώρισε την εντολή.",
      manual_required: "Η εντολή επιτρέπεται μόνο σε MANUAL.",
      invalid_value: "Μη έγκυρη τιμή για αυτή τη λειτουργία.",
      invalid_time: "Μη έγκυρη ώρα ή περίοδος παύσης.",
      invalid_range: "Μη έγκυρη περίοδος ιστορικού.",
      sensor_invalid: "Πρόβλημα αισθητήρων εξαερισμού.",
      ntp_active: "Το NTP λειτουργεί. Δεν χρειάζεται χειροκίνητη ρύθμιση ώρας."
    };

    const ok = Boolean(data.ok);
    const otaResponse = data.cmd === "ota_https";
    const otaStarting = ok && otaResponse && data.state === "starting";

    if (otaStarting) {
      beginConfirmedOta(id, data);
      showToast(
        `${id}: OTA ξεκίνησε επιτυχώς · ${data.from || "?"} → ${otaSession ? otaSession.targetVersion : "?"}`,
        6500
      );
      return;
    }

    if (otaResponse && otaAwaitingStart && otaAwaitingStart.id === id) {
      const reason = ok
        ? `Μη αναμενόμενη OTA απάντηση: ${data.state || "χωρίς state"}`
        : (errorMessages[data.error] || `ESP error: ${data.error || "άγνωστο"}`);
      failOtaBeforeStart(reason, `admin/response: ${text.slice(0, 180)}`);
      return;
    }

    if (meterType(devices.get(id) || {id,state:{}}) === "VENTILATION") {
      clearTimeout(ventAdminTimeouts.get(id));
      ventAdminTimeouts.delete(id);
    }
    adminBusy.delete(id);
    updateAdminButtons();

    if (!ok) {
      const msg = errorMessages[data.error] || `Σφάλμα: ${data.error || "άγνωστο"}`;
      if (adminTargetId === id) setAdminStatus(msg, "error");
      showToast(`${id}: ${msg}`, 5000);
      return;
    }

    if (meterType(devices.get(id) || {id,state:{}}) === "VENTILATION" &&
        typeof data.cmd === "string" && data.cmd.startsWith("vent_")) {
      const message = "Επιβεβαίωση ESP8266: " + data.cmd;
      if (adminTargetId === id) setAdminStatus(message, "ok");
      showToast(id + ": " + message);
      setTimeout(() => requestUpdate(id, false), 250);
      return;
    }

    if (data.cmd === "utility_reading_add" ||
        data.cmd === "utility_reading_update") {
      const msg = utilitySaveMessage(data);
      if (adminTargetId === id) {
        setAdminStatus(msg, "ok");
        if (ui.utilityEntryDialog.open) ui.utilityEntryDialog.close();
        resetUtilityEditor();
      }
      showToast(`${id}: καταχώρηση αποθηκεύτηκε`, 4500);
      setTimeout(() => requestUpdate(id, false), 250);
      setTimeout(() => {
        if (adminTargetId === id) refreshUtilityRows(id, false);
      }, 450);
      return;
    }

    if (data.cmd === "utility_reading_delete") {
      if (adminTargetId === id) setAdminStatus("Η καταχώρηση διαγράφηκε.", "ok");
      showToast(`${id}: η καταχώρηση διαγράφηκε`);
      setTimeout(() => requestUpdate(id, false), 250);
      setTimeout(() => {
        if (adminTargetId === id) refreshUtilityRows(id, ui.utilityHistoryDialog.open);
      }, 400);
      return;
    }

    if (data.cmd === "tariff_mode_set") {
      if (adminTargetId === id) {
        setAdminStatus(
          `Τύπος μετρητή: ${data.mode === "dual" ? "Ζ1 / Ζ2" : "Ζ"}.`,
          "ok"
        );
        resetUtilityEditor();
      }
      setTimeout(() => requestUpdate(id, false), 250);
      return;
    }

    if (data.cmd === "utility_readings_list") {
      return;
    }

    if (data.cmd === "restart_esp") {
      const msg = "Ο ESP8266 επανεκκινείται. Θα επανέλθει αυτόματα σε λίγα δευτερόλεπτα.";
      if (adminTargetId === id) setAdminStatus(msg, "ok");
      showToast(`${id}: επανεκκίνηση ESP8266…`, 5000);
      setTimeout(() => requestUpdate(id, false), 6000);
      return;
    }

    const msg = `OK: ${data.cmd || "admin"}`;
    if (adminTargetId === id) setAdminStatus(msg, "ok");
    showToast(`${id}: ${msg}`);
  }

  function utilitySortTime(row) {
    if (row.timeToken && row.timeToken !== "window") return row.timeToken;
    return "13:00";
  }

  function parseUtilityHistoryRows(rows) {
    return rows
      .filter((row) => !row.startsWith("ID,"))
      .map((row) => {
        const f = row.split(",");
        if (f.length >= 12 && (f[3] === "tk" || f[3] === "ek")) {
          return {
            id: Number(f[0]),
            date: f[1],
            mode: f[2],
            kind: f[3],
            z: Number(f[4]),
            z1: Number(f[5]),
            z2: Number(f[6]),
            timeToken: f[7] || "window",
            mapped: f[8] === "1",
            anchor: Number(f[9]),
            anchorZ1: Number(f[10]),
            anchorZ2: Number(f[11]),
            ekFlags: f.length >= 16 ? Number(f[12]) : 0,
            predictedWh: f.length >= 16 ? Number(f[13]) : NaN,
            actualWh: f.length >= 16 ? Number(f[14]) : NaN,
            canDelete: f.length >= 16 ? f[15] === "1" : null,
            netSnapshot: f.length >= 26 && f[16] === "1",
            pointEpoch: f.length >= 26 ? Number(f[17]) : 0,
            pointSource: f.length >= 26 ? Number(f[18]) : 0,
            internalImport: f.length >= 26 ? Number(f[19]) : NaN,
            internalExport: f.length >= 26 ? Number(f[20]) : NaN,
            z1Import: f.length >= 26 ? Number(f[21]) : NaN,
            z1Export: f.length >= 26 ? Number(f[22]) : NaN,
            z2Import: f.length >= 26 ? Number(f[23]) : NaN,
            z2Export: f.length >= 26 ? Number(f[24]) : NaN,
            generation: f.length >= 26 ? Number(f[25]) : 0,
            sampleEpoch: f.length >= 27 ? Number(f[26]) : (f.length >= 26 ? Number(f[17]) : 0)
          };
        }
        if (f.length < 7) return null;
        return {
          id: Number(f[0]),
          date: f[1],
          mode: f[2],
          kind: "tk",
          z: Number(f[3]),
          z1: Number(f[4]),
          z2: Number(f[5]),
          timeToken: f[6] || "window",
          mapped: false,
          anchor: NaN,
          anchorZ1: NaN,
          anchorZ2: NaN
        };
      })
      .filter((row) =>
        row &&
        Number.isFinite(row.id) &&
        /^\d{4}-\d{2}-\d{2}$/.test(row.date)
      )
      .sort((a, b) =>
        a.date.localeCompare(b.date) ||
        utilitySortTime(a).localeCompare(utilitySortTime(b)) ||
        a.id - b.id
      );
  }

  function formatUtilityDate(date) {
    const m = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(date || "—");
  }

  function utilityDateTimeLabel(row) {
    const time = row.timeToken && row.timeToken !== "window" ? row.timeToken : "—";
    return `${formatUtilityDate(row.date)} ${time}`;
  }

  function utilityKindBadge(row) {
    const isIndication = row.kind === "ek";
    return `<span class="reading-kind ${isIndication ? "kind-ek" : "kind-tk"}" title="${isIndication ? "Καταχώρηση Ένδειξης Μετρητή ΔΕΗ" : "Καταχώρηση Μέτρησης ΔΕΗ"}">${isIndication ? "ΕΝΔ." : "ΜΕΤ."}</span>`;
  }

  function utilityDeviationResult(previous, row) {
    let actualKwh = null, espKwh = null;
    const unavailable = (reason) => ({ value: null, actualKwh, espKwh, reason });
    if (!row || row.kind !== "ek") {
      return unavailable("Η Μέτρηση ΔΕΗ χρησιμοποιείται μόνο για τη Διαφορά με την Εκτίμηση τώρα");
    }
    const calculate = () => {
      if (!Number.isFinite(actualKwh) || !Number.isFinite(espKwh)) return unavailable("Χωρίς πλήρη σύγκριση εισαγωγής / εξαγωγής");
      if (actualKwh === 0) return unavailable("Μηδενικό καθαρό ισοζύγιο ΔΕΗ");
      if (Math.abs(actualKwh) < MIN_DEVIATION_KWH) return unavailable(`Ισοζύγιο κάτω από ${formatNumber(MIN_DEVIATION_KWH, 1)} kWh`);
      // Absolute denominator keeps the error's sign meaningful during export.
      return { value: ((espKwh - actualKwh) / Math.abs(actualKwh)) * 100, actualKwh, espKwh, reason: "" };
    };
    if (row.kind === "ek" && row.netSnapshot && (row.ekFlags & 4)) {
      if (row.ekFlags & 8) espKwh = Number.isFinite(row.predictedWh) ? row.predictedWh / 1000 : null;
      if (!(row.ekFlags & 8)) return unavailable("Δεν υπάρχει πλήρης βάση σύγκρισης");
      actualKwh = Number.isFinite(row.actualWh) ? row.actualWh / 1000 : null;
      if (!(row.ekFlags & 2)) return unavailable("Μηδενικό καθαρό ισοζύγιο ΔΕΗ");
      return calculate();
    }
    if (!previous || previous.kind !== "ek") {
      return unavailable("Δεν υπάρχει προηγούμενη Καταχώρηση Ένδειξης για σύγκριση");
    }
    if (previous.mode !== row.mode) return unavailable("Διαφορετικό τιμολόγιο");
    actualKwh = row.mode === "dual" ? (row.z1 + row.z2) - (previous.z1 + previous.z2) : row.z - previous.z;
    if (!previous.pointSource || !row.pointSource) return unavailable("Απαιτούνται πλήρεις εσωτερικοί μετρητές από firmware v3.15+");
    if (previous.generation !== row.generation || !row.generation) return unavailable("Διακοπή συνέχειας εσωτερικών μετρητών");
    if (row.pointEpoch < previous.pointEpoch) return unavailable("Οι στιγμές των εσωτερικών μετρητών δεν είναι διαδοχικές");
    const keys = row.mode === "dual" ? ["z1Import", "z1Export", "z2Import", "z2Export"] : ["internalImport", "internalExport"];
    if (!keys.every((key) => Number.isFinite(row[key]) && Number.isFinite(previous[key]) && row[key] >= previous[key] && previous[key] >= 0)) {
      return unavailable("Μη διαθέσιμοι ή ασυνεχείς εσωτερικοί μετρητές");
    }
    espKwh = row.mode === "dual"
      ? (row.z1Import - previous.z1Import) + (row.z2Import - previous.z2Import) - (row.z1Export - previous.z1Export) - (row.z2Export - previous.z2Export)
      : (row.internalImport - previous.internalImport) - (row.internalExport - previous.internalExport);
    return calculate();
  }

  function deviationText(value) {
    if (!Number.isFinite(value)) return "—";
    return `${value > 0 ? "+" : ""}${formatNumber(value, 2)}%`;
  }

  function utilityDeviationCell(previous, row) {
    const result = utilityDeviationResult(previous, row);
    const amount = (value) => Number.isFinite(value) ? formatNumber(value, 3) : "—";
    const reason = result.reason ? `<small class="deviation-reason">${escapeHtml(result.reason)}</small>` : "";
    return `<td class="utility-comparison-cell"><span>ΔΕΗ <b>${amount(result.actualKwh)}</b></span><span>ESP <b>${amount(result.espKwh)}</b></span></td><td class="deviation-cell"><b>${deviationText(result.value)}</b>${reason}</td>`;
  }

  function utilityInternalCounterCell(row, zone) {
    if (!row || row.kind !== "ek") {
      return '<td class="utility-internal-cell"><b>—</b></td>';
    }
    const importKey = zone === "z" ? "internalImport" : `${zone}Import`;
    const exportKey = zone === "z" ? "internalExport" : `${zone}Export`;
    const full = row.pointSource && Number.isFinite(row[importKey]) && Number.isFinite(row[exportKey]);
    const net = full ? row[importKey] - row[exportKey] : null;
    return `<td class="utility-internal-cell"><b>${Number.isFinite(net) ? formatNumber(net, 3) : "—"}</b></td>`;
  }

  function utilityPointLabel(row) {
    if (row && row.kind !== "ek") {
      return '<small class="utility-point-label">Μέτρηση ΔΕΗ · μόνο για «ΔΕΗ τελευταία» / Διαφορά</small>';
    }
    const labels = { 1: "Ακριβές δείγμα ESP", 2: "Παρεμβολή ιστορικού ESP", 3: "Κοντινό δείγμα ESP", 4: "Μέση τιμή ESP 08:00–18:00" };
    let label = labels[row.pointSource] || "Χωρίς πλήρες ιστορικό ESP";
    if (row.pointSource && row.sampleEpoch > 0 && row.pointSource !== 4) {
      const time = new Intl.DateTimeFormat("el-GR", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(row.sampleEpoch * 1000));
      label += ` · ${time}`;
    }
    return `<small class="utility-point-label">${escapeHtml(label)}</small>`;
  }

  function utilityCanDelete(row, latestId = utilityHistoryRows.reduce((max, item) =>
    item.kind === "ek" ? Math.max(max, item.id) : max, 0)) {
    if (row.kind !== "ek") return true;
    return row.id === latestId && row.canDelete !== false;
  }

  function utilityActionButtons(row, currentMode, firmware, latestId) {
    const canDelete = utilityCanDelete(row, latestId);
    const canEdit = row.mode === currentMode && firmwareAtLeast(firmware, 4, 0);
    return `
      <div class="history-actions">
        <button class="secondary-btn history-btn" type="button"
          data-utility-action="edit" data-utility-id="${row.id}"
          ${canEdit ? "" : "disabled"}>ΔΙΟΡΘΩΣΗ</button>
        <button class="danger-outline-btn history-btn" type="button"
          data-utility-action="delete" data-utility-id="${row.id}"
          ${canDelete ? "" : 'disabled title="Μόνο η τελευταία ενεργή Καταχώρηση Ένδειξης μπορεί να διαγραφεί"'}>ΔΙΑΓΡΑΦΗ</button>
      </div>`;
  }

  function renderUtilityLatestSummary(id) {
    const device = devices.get(id);
    if (!device || !ui.utilityLatestSummary) return;

    const dualNow = device.state.dual_zone === true || device.state.tariff_mode === "dual";
    if (utilityHistoryDeviceId !== id) {
      ui.utilityLatestSummary.innerHTML = `
        <div class="utility-latest-values"><strong>Φόρτωση τελευταίας μέτρησης…</strong></div>
        <div class="utility-latest-meta">Τιμολόγιο: ${dualNow ? "Διζωνικό Ζ1 / Ζ2" : "Μονοζωνικό Ζ"}</div>
        <div class="utility-latest-meta">Ημερομηνία – Ώρα: —</div>`;
      return;
    }

    const finals = utilityHistoryRows.filter((row) => row.kind !== "ek");
    const latest = finals.length ? finals[finals.length - 1] : null;
    if (!latest) {
      ui.utilityLatestSummary.innerHTML = `
        <div class="utility-latest-values"><strong>Τελευταία μέτρηση ΔΕΗ: —</strong></div>
        <div class="utility-latest-meta">Τιμολόγιο: ${dualNow ? "Διζωνικό Ζ1 / Ζ2" : "Μονοζωνικό Ζ"}</div>
        <div class="utility-latest-meta">Ημερομηνία – Ώρα: —</div>`;
      return;
    }

    const values = latest.mode === "dual"
      ? `<span><small>Ζ1</small><strong>${formatNumber(latest.z1, 0)} kWh</strong></span><span><small>Ζ2</small><strong>${formatNumber(latest.z2, 0)} kWh</strong></span>`
      : `<span><small>Ζ</small><strong>${formatNumber(latest.z, 0)} kWh</strong></span>`;

    ui.utilityLatestSummary.innerHTML = `
      <div class="utility-latest-values">${values}</div>
      <div class="utility-latest-meta">Τιμολόγιο: ${latest.mode === "dual" ? "Διζωνικό Ζ1 / Ζ2" : "Μονοζωνικό Ζ"}</div>
      <div class="utility-latest-meta">Ημερομηνία – Ώρα: ${escapeHtml(utilityDateTimeLabel(latest))}</div>`;
  }

  function renderUtilityHistory(id) {
    const device = devices.get(id);
    if (!device) return;
    const currentMode =
      device.state.dual_zone === true || device.state.tariff_mode === "dual"
        ? "dual" : "mono";
    const firmware = String((device.state || {}).firmware || "");
    const monoRows = utilityHistoryRows.filter((row) => row.mode === "mono");
    const dualRows = utilityHistoryRows.filter((row) => row.mode === "dual");
    const sections = [];
    const latestId = utilityHistoryRows.reduce((max, row) =>
      row.kind === "ek" ? Math.max(max, row.id) : max, 0);

    if (monoRows.length) {
      let previousIndication = null;
      const body = monoRows.map((row) => {
        const readingDigits = row.kind === "ek" ? 2 : 0;
        const html = `
          <tr>
            <td>${escapeHtml(utilityDateTimeLabel(row))}${utilityPointLabel(row)}</td>
            <td>${utilityKindBadge(row)}</td>
            <td>${formatNumber(row.z, readingDigits)}</td>
            ${utilityInternalCounterCell(row, "z")}
            ${utilityDeviationCell(previousIndication, row)}
            <td>${utilityActionButtons(row, currentMode, firmware, latestId)}</td>
          </tr>`;
        if (row.kind === "ek") previousIndication = row;
        return html;
      }).join("");

      sections.push(`
        <h3>Μετρήσεις Ζ</h3>
        <div class="history-table-wrap">
          <table class="utility-history-table">
            <thead><tr><th>Ημερομηνία / Ώρα</th><th>Τύπος</th><th>Ζ ΔΕΗ</th><th>ESP Ζ (Ι−Ε)</th><th>Σύγκριση kWh</th><th>Σφάλμα %</th><th></th></tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>`);
    }

    if (dualRows.length) {
      let previousIndication = null;
      const body = dualRows.map((row) => {
        const readingDigits = row.kind === "ek" ? 2 : 0;
        const html = `
          <tr>
            <td>${escapeHtml(utilityDateTimeLabel(row))}${utilityPointLabel(row)}</td>
            <td>${utilityKindBadge(row)}</td>
            <td>${formatNumber(row.z1, readingDigits)}</td>
            ${utilityInternalCounterCell(row, "z1")}
            <td>${formatNumber(row.z2, readingDigits)}</td>
            ${utilityInternalCounterCell(row, "z2")}
            ${utilityDeviationCell(previousIndication, row)}
            <td>${utilityActionButtons(row, currentMode, firmware, latestId)}</td>
          </tr>`;
        if (row.kind === "ek") previousIndication = row;
        return html;
      }).join("");

      sections.push(`
        <h3>Μετρήσεις Ζ1 / Ζ2</h3>
        <div class="history-table-wrap">
          <table class="utility-history-table utility-history-dual">
            <thead>
              <tr><th>Ημερομηνία / Ώρα</th><th>Τύπος</th><th>Ζ1 ΔΕΗ</th><th>ESP Ζ1 (Ι−Ε)</th><th>Ζ2 ΔΕΗ</th><th>ESP Ζ2 (Ι−Ε)</th><th>Σύγκριση kWh</th><th>Σφάλμα %</th><th></th></tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>`);
    }

    if (sections.length) {
      sections.unshift('<p class="history-note">Χρονική σειρά: παλαιότερη → νεότερη. Οι Καταχωρήσεις Ένδειξης συνδέονται με τους εσωτερικούς ESP της ίδιας στιγμής. Οι Καταχωρήσεις Μέτρησης ΔΕΗ μένουν στο ιστορικό και χρησιμοποιούνται μόνο για «ΔΕΗ τελευταία» / Διαφορά.</p>');
      sections.push(`<p class="history-note">Το Σφάλμα % υπολογίζεται μόνο μεταξύ Καταχωρήσεων Ένδειξης: 100 × (ισοζύγιο ESP − ισοζύγιο ΔΕΗ) / |ισοζύγιο ΔΕΗ|. Αρνητικό ισοζύγιο επιτρέπεται με Φ/Β. Για |ισοζύγιο ΔΕΗ| κάτω από ${formatNumber(MIN_DEVIATION_KWH, 1)} kWh ή ελλιπή στοιχεία εμφανίζεται — με την αιτία.</p>`);
    }

    ui.utilityHistoryTitle.textContent = `Πίνακας μετρήσεων · ${id}`;
    ui.utilityHistoryContent.innerHTML = sections.length
      ? sections.join("")
      : '<p class="admin-help">Δεν έχει καταχωρηθεί ακόμη μέτρηση.</p>';

    if (!ui.utilityHistoryDialog.open) ui.utilityHistoryDialog.showModal();
  }

  function startUtilityEdit(row) {
    if (!row || !adminTargetId) return;
    openUtilityEntry(row);
    if (ui.utilityHistoryDialog.open) ui.utilityHistoryDialog.close();
  }

  function refreshUtilityRows(id, openHistory) {
    if (!id || !client || !client.connected) return;
    utilityListIntent = openHistory ? "history" : "summary";
    csvBuffers.delete(id);
    sendAdmin(
      "utility_readings_list",
      openHistory ? "Λήψη πίνακα μετρήσεων…" : "Λήψη τελευταίας μέτρησης…"
    );
  }

  let historySession = null;
  const historyDialog = document.createElement('dialog');
  historyDialog.className = 'modal energy-history-dialog';
  historyDialog.innerHTML = `<div class="dialog-head"><h2>Ιστορικό ενέργειας</h2><button type="button" id="closeEnergyHistory">Κλείσιμο</button></div>
    <div class="history-controls"><select id="energyHistoryRange"><option value="48">Τελευταίες 48 ώρες · ανά ώρα</option><option value="30">Τελευταίες 30 ημέρες</option></select><button id="reloadEnergyHistory" type="button">Ανανέωση</button></div>
    <p id="energyHistoryStatus" role="status" aria-live="polite"></p><div id="energyHistoryMemory"></div><div id="energyHistoryPlot" class="energy-history-plot" aria-busy="false"></div>
    <div class="history-table-actions">
      <a id="energyHistoryTableToggle" href="#energyHistoryTable" aria-controls="energyHistoryTable" aria-expanded="false">Προβολή πίνακα τιμών</a>
      <button id="exportEnergyHistoryCsv" type="button" disabled>Εξαγωγή CSV</button>
    </div>
    <div id="energyHistoryTable" hidden></div>
    <p class="history-note">Ισοζύγιο = εισαγωγή − εξαγωγή. Θετικό: ενέργεια από το δίκτυο. Αρνητικό: πλεόνασμα προς το δίκτυο. Δεν είναι η συνολική παραγωγή Φ/Β. ×: χωρίς καταγραφή. Αχνές μπάρες: τρέχουσα, μερική ή εκτιμώμενη περίοδος. Η καταγραφή ξεκινά με τη V5.00· τα παλιά δεδομένα δεν συμπληρώνονται.</p>`;
  document.body.appendChild(historyDialog);
  const historyStatus = () => $('energyHistoryStatus');
  function stopHistoryLoading(message) {
    const h=historySession; if(!h) return;
    clearTimeout(h.timer);
    h.begun=false; h.complete=false; h.loading=false;
    $('energyHistoryPlot').setAttribute?.('aria-busy','false');
    $('exportEnergyHistoryCsv').disabled=true;
    historyStatus().textContent=message+(h.hasRendered
      ? ' Εμφανίζονται μόνο τα δεδομένα που έχουν ήδη ληφθεί.'
      : h.preservedPlot ? ' Εμφανίζεται το προηγούμενο γράφημα.' : '');
  }
  function requestHistoryPage(offset=0, retry=0) {
    const h=historySession;
    if(!h || !client?.connected) { if(h) stopHistoryLoading('Δεν υπάρχει σύνδεση MQTT. Πατήστε Ανανέωση όταν συνδεθεί.'); return; }
    clearTimeout(h.timer);
    h.offset=offset; h.retry=retry; h.token=(Date.now()+Math.floor(Math.random()*10000))%4000000000+1;
    h.pageRows=0; h.begun=false; h.pageData=new Map();
    client.publish(`${BASE}/${h.id}/admin/request`,`history_get|${h.token}|${h.range===48?0:1}|${offset}`,{qos:0,retain:false});
    h.timer=setTimeout(()=>{
      if(historySession!==h) return;
      if(retry<2) requestHistoryPage(offset,retry+1);
      else stopHistoryLoading('Η λήψη δεν ολοκληρώθηκε. Πατήστε Ανανέωση για νέα προσπάθεια.');
    },10000);
  }
  function loadEnergyHistory(id) {
    const previous=historySession;
    if(previous) clearTimeout(previous.timer);
    const range=Number($('energyHistoryRange').value);
    const preserve=previous?.id===id && previous.range===range && (previous.hasRendered || previous.preservedPlot);
    historySession={id,range,rows:new Map(),meta:null,firstRecentIndex:null,phase:range===48?'recent':'daily',olderStarted:false,
      hasRendered:false,preservedPlot:Boolean(preserve),complete:false,loading:true,groups:null,tableData:null,csvRows:null};
    if(!preserve) {
      $('energyHistoryPlot').innerHTML='';
      $('energyHistoryMemory').textContent='';
    }
    $('energyHistoryPlot').setAttribute?.('aria-busy','true');
    $('energyHistoryTable').innerHTML='';
    $('energyHistoryTable').hidden=true;
    $('energyHistoryTableToggle').textContent='Προβολή πίνακα τιμών';
    $('energyHistoryTableToggle').setAttribute?.('aria-expanded','false');
    $('exportEnergyHistoryCsv').disabled=true;
    historyStatus().textContent=preserve
      ? 'Ανανέωση ιστορικού… Εμφανίζεται το προηγούμενο γράφημα μέχρι να ληφθούν νέα δεδομένα.'
      : 'Λήψη ιστορικού…';
    // Daily offsets are calendar slots, so the newest 16 days are known
    // without a discovery request. Raw checkpoint offsets need discovery.
    requestHistoryPage(range===30?14:0);
  }
  function openEnergyHistory(id) {
    const device=devices.get(id);
    if (device && meterType(device) === "VENTILATION") { openVentHistory(id); return; }
    if(!device || compareFirmwareVersions(String(device.state?.firmware||'0'),'5.00')<0) { showToast('Τα γραφήματα απαιτούν firmware V5.00.'); return; }
    if(!historyDialog.open) historyDialog.showModal();
    loadEnergyHistory(id);
  }
  function renderEnergyHistory(complete=true) {
    const h=historySession; if(!h) return;
    const rows=[...h.rows.values()], dual=devices.get(h.id)?.state?.dual_zone===true || devices.get(h.id)?.state?.tariff_mode==='dual';
    const now=h.meta?.epoch ? new Date(h.meta.epoch*1000) : new Date();
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Athens',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
    const part=t=>parts.find(p=>p.type===t).value;
    const today=Math.floor(Date.UTC(+part('year'),+part('month')-1,+part('day'))/86400000);
    const groups=h.range===48
      ? EnergyHistory.hourly(rows,48,h.meta?.epoch)
      : EnergyHistory.daily(rows,30,today);
    if(!complete) groups.forEach((group,i)=>{
      if(!group.values || (h.range===48 && i>=24 && !h.olderStarted)) {
        group.values=null; group.pending=true; group.detail='Αναμονή λήψης δεδομένων';
      }
    });
    const legend=dual || h.range===48 ? '<p class="history-legend"><span class="legend-zone legend-z1">Ζ1</span><span class="legend-zone legend-z2-day">Ζ2 πρωί</span><span class="legend-zone legend-z2-night">Ζ2 βράδυ</span><span class="legend-total">'+(dual?'Σ = συνολικό block':'Χρώμα ανά ώρα (δεν αλλάζει το μονοζωνικό τιμολόγιο)')+'</span></p>' : '';
    // Two 24-hour charts: identical Y scale and X spacing, one shared
    // horizontal scrollbar; the newest hourly slot is on the left in both.
    const plot=h.range===48
      ? '<div class="history-comparison">'+
          '<section class="history-comparison-panel" aria-label="Πρόσφατες 24 ώρες"><h3>Πρόσφατες 24 ώρες</h3>'+
          EnergyHistory.svg(groups.slice(0,24),dual,groups)+'</section>'+
          '<section class="history-comparison-panel" aria-label="Προηγούμενες 24 ώρες"><h3>Προηγούμενες 24 ώρες</h3>'+
          EnergyHistory.svg(groups.slice(24,48),dual,groups)+'</section></div>'
      : EnergyHistory.svg(groups,dual);
    $('energyHistoryPlot').innerHTML=groups.length ? legend+plot : '<p>Δεν υπάρχουν ακόμη αρκετές μετρήσεις για γράφημα.</p>';
    h.groups=groups; h.dual=dual; h.hasRendered=true; h.preservedPlot=false; h.complete=complete; h.loading=!complete;
    h.tableData=null; h.csvRows=null;
    // Hidden tables and CSV rows are built only when explicitly requested.
    if($('energyHistoryTable').hidden) $('energyHistoryTable').innerHTML='';
    else renderEnergyHistoryTable();
    $('energyHistoryPlot').setAttribute?.('aria-busy',String(!complete));
    $('exportEnergyHistoryCsv').disabled=!complete;
    historyStatus().textContent=complete
      ? `${h.id} · ${h.range===48?'48 ώρες · ανά ώρα · νεότερη → παλαιότερη':'30 ημέρες · νεότερη → παλαιότερη'} · ${h.meta?.start ? 'Καταγραφή από '+EnergyHistory.local(h.meta.start) : 'Αναμονή πρώτης μέτρησης με έγκυρη ώρα'}`
      : `Λήψη ιστορικού… Προσωρινή προβολή · ${h.rows.size} εγγραφές. Το γράφημα συμπληρώνεται.`;
    if(h.meta) $('energyHistoryMemory').textContent=`LittleFS: σύνολο ${h.meta.total} / χρησιμοποιημένα ${h.meta.used} / ελεύθερα ${h.meta.free} bytes. RAM με ενεργό MQTT: ${h.meta.heap} bytes, μεγαλύτερο μπλοκ ${h.meta.block}, ελάχιστη RAM σε αυτή την εκκίνηση ${h.meta.minHeap}. ${h.meta.failed?'Πρόβλημα αποθήκευσης ιστορικού.':''}`;
  }
  function energyHistoryTableData() {
    const h=historySession;
    if(!h?.groups) return null;
    if(h.tableData) return h.tableData;
    const names=h.dual?['Ζ1','Ζ2 πρωί','Ζ2 βράδυ','Σύνολο']:['Ζ'];
    const columns=['Περίοδος',...names.map(n=>`${n} kWh`),'Καταγραφή'];
    const tableRows=h.groups.map(g=>{
      const vs=g.values ? (h.dual ? g.values : [g.values.reduce((a,b)=>a+b,0)]) : null;
      const flags=g.flags; const status=g.pending?'Αναμονή δεδομένων':flags&32?'Χωρίς δεδομένα':[(flags&16?'Τρέχουσα':''),(flags&1?'Μερική':''),(flags&2?'Εκτιμώμενη κατανομή':''),(flags&4?'Επαναφορά μετρητή':''),(flags&8?'Σφάλμα αποθήκευσης':'')].filter(Boolean).join(' · ')||'Καταγεγραμμένη';
      const displayValues=vs && h.dual ? [...vs,vs.reduce((sum,value)=>sum+value,0)] : vs;
      return {label:g.label,detail:g.detail,values:names.map((_,i)=>displayValues?EnergyHistory.number(displayValues[i]):'—'),status};
    });
    h.tableData={columns,tableRows};
    return h.tableData;
  }
  function renderEnergyHistoryTable() {
    const data=energyHistoryTableData(); if(!data) return;
    const {columns,tableRows}=data;
    $('energyHistoryTable').innerHTML=`<div class="history-table-wrap"><table class="utility-history-table"><thead><tr>${columns.map(n=>`<th>${escapeHtml(n)}</th>`).join('')}</tr></thead><tbody>${tableRows.map(row=>
      `<tr><td title="${escapeHtml(row.detail)}">${escapeHtml(row.label)}</td>${row.values.map(v=>`<td>${escapeHtml(v)}</td>`).join('')}<td>${escapeHtml(row.status)}</td></tr>`
    ).join('')}</tbody></table></div>`;
  }
  function energyHistoryCsvRows() {
    const h=historySession;
    if(!h?.complete) return null;
    if(!h.csvRows) {
      const data=energyHistoryTableData(); if(!data) return null;
      h.csvRows=[data.columns,...data.tableRows.map(row=>[row.label,...row.values,row.status])];
    }
    return h.csvRows;
  }
  function handleEnergyHistory(id,text) {
    const h=historySession, p=text.split('|');
    if(!h?.loading || id!==h.id || +p[1]!==h.token) return;
    const nums=p.slice(1).map(Number);
    if(nums.some(n=>!Number.isFinite(n) || !Number.isSafeInteger(n))) return;
    if(p[0]==='B' && p.length===12 && +p[2]===(h.range===48?0:1)) {
      h.begun=true; h.pageRows=0; h.pageData=new Map();
      h.meta={start:+p[3],total:+p[4],used:+p[5],free:+p[6],heap:+p[7],block:+p[8],minHeap:+p[9],failed:+p[10],epoch:+p[11]};
    } else if(h.begun && p[0]==='D' && p.length===13 && h.range===30) {
      const row={day:+p[2],first:+p[3],last:+p[4],flags:+p[5],covered:+p[6],wh:p.slice(7).map(Number)};
      h.pageData.set(row.day,row); ++h.pageRows;
    } else if(h.begun && p[0]==='P' && p.length===6 && h.range===48) {
      const row={epoch:+p[2],generation:+p[3],import:+p[4],export:+p[5]};
      h.pageData.set(row.epoch,row); ++h.pageRows;
    } else if(h.begun && p[0]==='E' && p.length===4) {
      clearTimeout(h.timer);
      if(+p[3]!==h.pageRows) { if(h.retry<2) requestHistoryPage(h.offset,h.retry+1); else stopHistoryLoading('Ελλιπής μεταφορά ιστορικού. Πατήστε Ανανέωση.'); return; }
      // Only verified pages enter the graph. Retries discard incomplete data.
      for(const [key,row] of h.pageData) h.rows.set(key,row);
      h.begun=false;
      const nextOffset=+p[2];
      if(h.range===30) {
        if(h.offset===14) {
          renderEnergyHistory(false);
          requestHistoryPage(0);
        } else renderEnergyHistory();
        return;
      }
      // The legacy sender walks each page oldest-first. Finish the recent
      // day before revealing it, so the first visible columns start on the
      // left of the upper chart. Only then fetch older pages backwards.
      if(h.phase==='recent') {
        if(h.offset===0 && nextOffset>=0 && h.pageRows>0)
          h.firstRecentIndex=Math.max(0,nextOffset-h.pageRows);
        if(nextOffset>=0 && nextOffset>h.offset) {
          if(!h.preservedPlot) historyStatus().textContent='Λήψη πρόσφατου 24ώρου… Πρώτα εμφανίζονται οι νεότερες ώρες.';
          requestHistoryPage(nextOffset);
          return;
        }
        h.phase='older';
        if(h.firstRecentIndex>1) {
          renderEnergyHistory(false);
          requestHistoryPage(Math.max(1,h.firstRecentIndex-16));
          return;
        }
      } else {
        h.olderStarted=true;
        const firstHour=Math.floor(h.meta.epoch/3600)*3600-47*3600;
        const oldestEpoch=Math.min(...[...h.rows.values()].map(row=>row.epoch));
        if(h.offset>1 && oldestEpoch>firstHour) {
          renderEnergyHistory(false);
          requestHistoryPage(Math.max(1,h.offset-16));
          return;
        }
      }
      renderEnergyHistory();
    }
  }
  $('closeEnergyHistory').addEventListener('click',()=>historyDialog.close());
  historyDialog.addEventListener('close',()=>{if(historySession)clearTimeout(historySession.timer); historySession=null;});
  $('energyHistoryRange').addEventListener('change',()=>{if(historySession)loadEnergyHistory(historySession.id);});
  $('reloadEnergyHistory').addEventListener('click',()=>{if(historySession)loadEnergyHistory(historySession.id);});
  $('energyHistoryTableToggle').addEventListener('click',event=>{
    event.preventDefault();
    const table=$('energyHistoryTable'), show=table.hidden;
    if(show) renderEnergyHistoryTable();
    table.hidden=!show;
    $('energyHistoryTableToggle').textContent=show?'Απόκρυψη πίνακα τιμών':'Προβολή πίνακα τιμών';
    $('energyHistoryTableToggle').setAttribute('aria-expanded',String(show));
  });
  $('exportEnergyHistoryCsv').addEventListener('click',()=>{
    const h=historySession;
    if(!h?.complete || $('exportEnergyHistoryCsv').disabled) return;
    const csvRows=energyHistoryCsvRows(); if(!csvRows) return;
    // UTF-8 BOM and semicolon columns for spreadsheet apps with Greek locale.
    const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
    const csv='\uFEFF'+csvRows.map(row=>row.map(quote).join(';')).join('\r\n')+'\r\n';
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');
    link.href=url;
    link.download='energy-history-'+h.id.replace(/[^a-zA-Z0-9_-]/g,'_')+(h.range===48?'-48h':'-30d')+'.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });

  function handleCsv(id, text) {
    if (text.startsWith("BEGIN|UTILITY|")) {
      csvBuffers.set(id, { type: "utility", rows: [] });
      if (adminTargetId === id) setAdminStatus("Λήψη καταχωρήσεων…");
      return;
    }

    if (text.startsWith("ROW|")) {
      const buffer = csvBuffers.get(id);
      if (!buffer) return;
      const separator = text.indexOf("|", 4);
      if (separator >= 0) buffer.rows.push(text.slice(separator + 1));
      return;
    }

    if (text === "END") {
      const buffer = csvBuffers.get(id);
      if (!buffer) return;

      csvBuffers.delete(id);
      adminBusy.delete(id);
      updateAdminButtons();

      if (buffer.type === "utility") {
        utilityHistoryRows = parseUtilityHistoryRows(buffer.rows);
        utilityHistoryDeviceId = id;
        if (adminTargetId === id) {
          setAdminStatus("Οι καταχωρήσεις φορτώθηκαν.", "ok");
          renderUtilityLatestSummary(id);
        }
        if (utilityListIntent === "history") renderUtilityHistory(id);
        utilityListIntent = "summary";
      }
    }
  }

  function confirmOtaFromHealth(device) {
    const session = otaSession;
    if (!session || !device.health || compareFirmwareVersions(device.health.firmware, session.targetVersion) !== 0) return;
    if (device.id === session.id) { completeActiveOta(device.health.firmware); return; }
    // One-time transition from the old shared profile topic to hardware identity.
    const suffix = device.id.startsWith(session.id + "-") ? device.id.slice(session.id.length + 1) : "";
    if (!/^[0-9A-F]{12}$/i.test(suffix) || session.knownDeviceIds?.has(device.id) ||
        !otaManifestMatchesDevice(session.manifest, device)) return;
    clearOtaSessionTimers();
    otaSession = null;
    setOtaProgressUi("success", `Firmware ${device.health.firmware} εντοπίστηκε στο νέο ID ${device.id}.`,
      `Το παλιό ID ${session.id} ήταν κοινό ανά τύπο firmware. Η νέα συσκευή εμφανίζεται ανεξάρτητα στον πίνακα. Αν υπήρχαν πολλοί ESP με το παλιό ίδιο ID, έλεγξε τις νέες εγγραφές για κάθε site.`);
    showToast(`Νέο DEVICE_ID: ${device.id}`, 8000);
  }

  function receiveDeviceHealth(device, text, retained = false) {
    let health;
    try {
      health = JSON.parse(text);
      if (!health || Array.isArray(health) || typeof health !== "object" ||
          typeof health.meter_ok !== "boolean" || typeof health.meter !== "string" ||
          typeof health.firmware !== "string" || typeof health.read_attempted !== "boolean") throw new Error("Invalid health frame");
    } catch (error) { console.warn("Invalid health frame", device.id, error); return false; }
    // A retained snapshot can be days old; it is never a reply to our request.
    if (retained && device.lastLiveAt !== null) return true;
    if (device.health?.chip_id && health.chip_id && device.health.chip_id !== health.chip_id)
      showToast(`Πιθανή σύγκρουση DEVICE_ID ${device.id}: διαφορετικοί ESP χρησιμοποιούν το ίδιο ID.`, 8000);
    device.health = health;
    device.state = { ...(device.state || {}), meter:health.meter, device_type:health.device_type || health.meter, firmware:health.firmware, rssi:health.rssi, dual_zone:health.dual_zone };
    if (retained) {
      if (device.statusOnline !== false) queueDeviceProbe(device);
    } else {
      confirmDeviceLive(device);
      // A failed/initial sensor legitimately responds with health instead of state.
      // A healthy heartbeat confirms the ESP, but not a new measurement.
      if (!health.meter_ok || !health.read_attempted) {
        cancelDeviceRequest(device);
        device.updateDelayed = false;
      } else if (!device.sampleReceived) queueDeviceProbe(device);
    }
    renderAll();
    return true;
  }

  function receiveDeviceState(device, text, retained = false) {
    try {
      const state = JSON.parse(text);
      if (!state || Array.isArray(state) || typeof state !== "object" || !Object.keys(state).length) throw new Error("Expected a device object");
      if (retained) {
        if (device.lastLiveAt === null) device.state = state;
        queueDeviceProbe(device);
        return false;
      }
      cancelDeviceRequest(device);
      confirmDeviceLive(device);
      device.updateDelayed = false;
      device.state = state;
      device.stateError = "";
      device.sampleReceived = true;
      device.lastReceived = new Date();
      if (device.health) device.health = {...device.health, meter_ok:state.sensors_ok === false ? false : true, read_attempted:true, has_sample:true};
    } catch (error) {
      device.stateError = "Η απάντηση μετρήσεων δεν είναι έγκυρο αντικείμενο JSON. Αναμονή νέας ενημέρωσης.";
      console.warn("Invalid meter JSON", device.id, error);
      renderAll();
      return false;
    }
    renderAll();
    return true;
  }

  const MQTT_SESSION_KEY = "energy.mqtt.tab-session";
  const MQTT_REMEMBER_KEY = "energy.mqtt.remembered";
  function readMqttConnection(storage, key) {
    const saved = JSON.parse(storage.getItem(key) || "null");
    const keys = ["host","port","path","username","password"];
    if (!saved || !keys.every(name => typeof saved[name] === "string" && saved[name].length > 0)) return null;
    return {...Object.fromEntries(keys.map(name => [name,saved[name]])),remember:saved.remember === true};
  }
  function readMqttSession() {
    try { return readMqttConnection(sessionStorage, MQTT_SESSION_KEY); } catch (_) { return null; }
  }
  function readRememberedMqtt() {
    try {
      const saved = readMqttConnection(localStorage, MQTT_REMEMBER_KEY);
      return saved?.remember === true ? saved : null;
    } catch (_) { return null; }
  }
  function writeMqttSession(settings) {
    try { sessionStorage.setItem(MQTT_SESSION_KEY, JSON.stringify(settings)); } catch (_) {}
  }
  function clearMqttSession() {
    try { sessionStorage.removeItem(MQTT_SESSION_KEY); } catch (_) {}
  }
  function clearRememberedMqtt() {
    try { localStorage.removeItem(MQTT_REMEMBER_KEY); return true; }
    catch (_) {
      ui.rememberConnectionStatus.textContent = "Η συσκευή δεν επέτρεψε τη διαγραφή των αποθηκευμένων στοιχείων.";
      return false;
    }
  }
  function saveRememberedMqtt(settings) {
    // A tab-only reconnect must not erase another tab's remembered login.
    if (!settings.remember) return;
    try {
      localStorage.setItem(MQTT_REMEMBER_KEY, JSON.stringify(settings));
      ui.rememberConnectionStatus.textContent = "Η αυτόματη σύνδεση ενεργοποιήθηκε σε αυτή τη συσκευή.";
    } catch (_) {
      ui.rememberConnectionStatus.textContent = "Η σύνδεση έγινε, αλλά η συσκευή δεν επέτρεψε αποθήκευση των στοιχείων.";
    }
  }
  function updateRememberConnection() {
    const remember = ui.rememberConnectionInput.checked;
    const removed = remember || clearRememberedMqtt();
    if (successfulMqttSettings && client?.connected) {
      successfulMqttSettings = {...successfulMqttSettings,remember};
      writeMqttSession(successfulMqttSettings);
      saveRememberedMqtt(successfulMqttSettings);
    } else if (remember) {
      ui.rememberConnectionStatus.textContent = "Τα στοιχεία θα αποθηκευτούν μετά από επιτυχημένη σύνδεση.";
    } else {
      const saved = readMqttSession();
      if (saved) writeMqttSession({...saved,remember:false});
    }
    if (!remember && removed) ui.rememberConnectionStatus.textContent = "Η αυτόματη σύνδεση σε νέο άνοιγμα είναι απενεργοποιημένη.";
  }
  function readLocalSetting(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function restoreSettings() {
    ui.hostInput.value = readLocalSetting("energy.host") || ui.hostInput.value || DEFAULTS.host;
    ui.portInput.value = readLocalSetting("energy.port") || DEFAULTS.port;
    ui.pathInput.value = readLocalSetting("energy.path") || DEFAULTS.path;
    ui.usernameInput.value = readLocalSetting("energy.username") || "";
    ui.passwordInput.value = "";
    const storedPrice = readLocalSetting(ENERGY_PRICE_KEY);
    if (storedPrice !== null) {
      const parsed = parseEnergyPrice(storedPrice);
      if (parsed !== undefined) energyPricePerKwh = parsed;
    }
    ui.energyPriceInput.value = energyPricePerKwh === null ? ""
      : String(energyPricePerKwh).replace(".", ",");
  }

  function saveNonSecretSettings(settings) {
    try {
      localStorage.setItem("energy.host", settings.host);
      localStorage.setItem("energy.port", settings.port);
      localStorage.setItem("energy.path", settings.path);
      localStorage.setItem("energy.username", settings.username);
    } catch (_) { /* Broker connections can still work without local storage. */ }
  }

  function disconnect(showMessage = true) {
    if (showMessage) {
      clearMqttSession();
      if (clearRememberedMqtt()) ui.rememberConnectionStatus.textContent = "Ο αποθηκευμένος MQTT κωδικός διαγράφηκε.";
      ui.rememberConnectionInput.checked = false;
      ui.passwordInput.value = "";
    }
    successfulMqttSettings = null;
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
    if (client) {
      try { client.end(true); } catch (_) {}
    }
    client = null;
    devices.forEach(cancelDeviceRequest);
    devices.clear();
    renderAll();
    setBrokerState("warn", "Αποσυνδεδεμένο");
    if (showMessage) showToast("Αποσυνδέθηκε από το HiveMQ");
  }

  function connect(settings) {
    if (typeof mqtt === "undefined") {
      showConnectionError("Δεν φορτώθηκε η MQTT.js. Έλεγξε τη σύνδεση Internet.");
      return;
    }

    settings = {...settings,remember:typeof settings.remember === "boolean"
      ? settings.remember : ui.rememberConnectionInput.checked};
    ui.rememberConnectionInput.checked = settings.remember;
    disconnect(false);
    showConnectionError();
    saveNonSecretSettings(settings);

    const cleanPath = settings.path.startsWith("/") ? settings.path : `/${settings.path}`;
    const url = `wss://${settings.host}:${settings.port}${cleanPath}`;
    const clientId = `energy-dds-jsy-${Math.random().toString(16).slice(2, 10)}`;

    setBrokerState("warn", "Σύνδεση…");

    const newClient = mqtt.connect(url, {
      clientId,
      username: settings.username,
      password: settings.password,
      clean: true,
      protocolVersion: 4,
      connectTimeout: 10000,
      reconnectPeriod: 4000,
      keepalive: 30
    });
    client = newClient;

    newClient.on("connect", () => {
      if (client !== newClient) return;
      successfulMqttSettings = {...settings,remember:ui.rememberConnectionInput.checked};
      writeMqttSession(successfulMqttSettings);
      saveRememberedMqtt(successfulMqttSettings);
      setBrokerState("good", "Συνδεδεμένο");
      showConnectionError();

      newClient.subscribe(DISCOVERY_TOPICS, { qos: 0 }, (err, grants = []) => {
        if (client !== newClient || !newClient.connected) return;
        if (err || grants.some(grant => grant.qos === 128)) {
          showToast("Ο broker δεν επέτρεψε όλες τις συνδρομές discovery. Οι επιτρεπόμενες συσκευές συνεχίζουν.", 8000);
        }
        showToast("Συνδέθηκε στο HiveMQ · discovery ενεργό");
        scheduleAutoRefresh();
        setTimeout(() => { if (client === newClient) requestAll(false); }, 500);
      });

      if (ui.settingsDialog.open) ui.settingsDialog.close();
    });

    function brokerUnavailable(state, label) {
      if (client !== newClient) return;
      clearInterval(autoRefreshTimer); autoRefreshTimer = null;
      devices.forEach(device => {
        cancelDeviceRequest(device);
        device.online = false; device.statusOnline = null; device.lastLiveAt = null;
        device.responseTimedOut = false; device.updateDelayed = device.sampleReceived;
      });
      renderAll();
      setBrokerState(state, label);
    }
    newClient.on("reconnect", () => { if (client === newClient) setBrokerState("warn", "Επανασύνδεση…"); });
    newClient.on("offline", () => brokerUnavailable("bad", "Offline"));
    newClient.on("close", () => {
      brokerUnavailable("warn", "Αποσυνδεδεμένο");
    });
    newClient.on("error", (err) => {
      if (client !== newClient) return;
      setBrokerState("bad", "Σφάλμα");
      showConnectionError(`MQTT: ${err.message || err}`);
      if (/not authorized|bad user|bad username|bad password/i.test(String(err.message || err))) {
        clearMqttSession();
        if (clearRememberedMqtt()) ui.rememberConnectionStatus.textContent = "Η αυτόματη σύνδεση απενεργοποιήθηκε. Έλεγξε τα στοιχεία σύνδεσης.";
        successfulMqttSettings = null;
        ui.rememberConnectionInput.checked = false;
        ui.passwordInput.value = "";
        newClient.end(true); // A rejected login needs corrected credentials, not endless retries.
        if (!ui.settingsDialog.open) ui.settingsDialog.showModal();
      }
    });

    newClient.on("message", (topic, payload, packet = {}) => {
      if (client !== newClient) return;
      const parsed = parseTopic(topic);
      if (!parsed) return;

      const text = payload.toString();
      const device = ensureDevice(parsed.id);

      if (parsed.suffix === "health") {
        if (receiveDeviceHealth(device, text, packet.retain === true) && packet.retain !== true) confirmOtaFromHealth(device);
        return;
      }
      if (parsed.suffix === "status") {
        const status = text.trim().toLowerCase();
        if (status !== "online" && status !== "offline") return;
        if (packet.retain === true && device.lastLiveAt !== null) return;
        device.statusOnline = status === "online";
        if (!device.statusOnline) {
          device.online = false; device.lastLiveAt = null;
          cancelDeviceRequest(device);
        } else if (packet.retain !== true) {
          confirmDeviceLive(device);
        }
        renderAll();

        if (otaSession && otaSession.id === device.id) {
          if (!device.statusOnline) {
            otaSession.sawOffline = true;
            ui.otaProgressStatus.textContent =
              "Ο ESP8266 είναι προσωρινά offline. Η αναβάθμιση / επανεκκίνηση βρίσκεται σε εξέλιξη…";
            updateOtaRunningDetails("MQTT status: offline");
          } else if (otaSession.sawOffline && packet.retain !== true) {
            otaSession.sawOnlineAfterStart = true;
            ui.otaProgressStatus.textContent =
              "Ο ESP8266 επανήλθε online. Επιβεβαιώνεται η νέα έκδοση…";
            updateOtaRunningDetails("MQTT status: online μετά το OTA");
            setTimeout(() => requestUpdate(device.id, false), 250);
          }
        }

        if (device.statusOnline && (!device.sampleReceived || !device.online)) queueDeviceProbe(device);
        return;
      }

      if (parsed.suffix === "state") {
        try {
          if (!receiveDeviceState(device, text, packet.retain === true)) return;

          if (otaSession && otaSession.id === device.id) {
            const currentFw = String((device.state || {}).firmware || "?");
            if (compareFirmwareVersions(currentFw, otaSession.targetVersion) === 0) {
              completeActiveOta(currentFw);
            } else if (
              otaSession.sawOffline &&
              otaSession.sawOnlineAfterStart &&
              Date.now() - otaSession.startedAt > 8000
            ) {
              failActiveOta(
                "Ο ESP8266 επανήλθε, αλλά δεν τρέχει τη ζητούμενη έκδοση.",
                `Τρέχουσα: ${currentFw} · αναμενόμενη: ${otaSession.targetVersion}`
              );
            } else {
              updateOtaRunningDetails(`Τελευταία state έκδοση: ${currentFw}`);
            }
          }

          if (adminTargetId === device.id && ui.adminDialog.open) {
            refreshDualZoneSettings(device);
            updateAdminButtons();
            if (meterType(device) === "VENTILATION") refreshVentControls(device);
          }
        } catch (err) {
          console.error("Invalid meter JSON", parsed.id, text, err);
          showToast(`${parsed.id}: μη έγκυρο JSON`);
        }
        return;
      }

      if (parsed.suffix === "vent/history") {
        handleVentHistory(parsed.id, text);
        return;
      }

      if (parsed.suffix === "admin/response") {
        handleAdminResponse(parsed.id, text);
        return;
      }

      if (parsed.suffix === "admin/history") {
        handleEnergyHistory(parsed.id, text);
        return;
      }
      if (parsed.suffix === "admin/csv") {
        handleCsv(parsed.id, text);
      }
    });
  }

  ui.devicesGrid.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-device]");
    if (!button) return;
    const id = button.dataset.device;
    if (button.dataset.action === "refresh") requestUpdate(id, true);
    if (button.dataset.action === "admin") openAdmin(id);
    if (button.dataset.action === "history") openEnergyHistory(id);
  });

  ui.updateAllBtn.addEventListener("click", () => requestAll(true));
  ui.settingsBtn.addEventListener("click", () => {
    showConnectionError();
    ui.settingsDialog.showModal();
  });
  ui.closeSettingsBtn.addEventListener("click", () => ui.settingsDialog.close());
  ui.disconnectBtn.addEventListener("click", () => disconnect(true));
  ui.rememberConnectionInput.addEventListener("change", updateRememberConnection);
  window.addEventListener("storage", (event) => {
    if ((event.key === MQTT_REMEMBER_KEY || event.key === null) && event.newValue === null) {
      // Another tab forgot this device; it must not be re-saved on reconnect.
      ui.rememberConnectionInput.checked = false;
      const saved = successfulMqttSettings || readMqttSession();
      if (saved) {
        successfulMqttSettings = {...saved,remember:false};
        writeMqttSession(successfulMqttSettings);
      }
      ui.rememberConnectionStatus.textContent = "Η αυτόματη σύνδεση απενεργοποιήθηκε από άλλη καρτέλα.";
    }
  });

  ui.saveEnergyPriceBtn.addEventListener("click", saveEnergyPrice);
  ui.energyPriceInput.addEventListener("input", () => {
    ui.energyPriceStatus.textContent = "";
  });

  ui.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    // An unavailable local preference store must not block MQTT login.
    if (!saveEnergyPrice() && parseEnergyPrice(ui.energyPriceInput.value) === undefined) return;
    connect({
      host: ui.hostInput.value.trim(),
      port: ui.portInput.value.trim(),
      path: ui.pathInput.value.trim() || "/mqtt",
      username: ui.usernameInput.value.trim(),
      password: ui.passwordInput.value,
      remember: ui.rememberConnectionInput.checked
    });
  });

  ui.closeAdminBtn.addEventListener("click", () => ui.adminDialog.close());

  $("closeVentHistoryBtn").addEventListener("click", ()=>{
    ventHistoryClearTimeout(); ventHistorySession=null;
    $("ventHistoryDialog").close();
  });
  $("ventHistoryCurrentBtn").addEventListener("click", ()=>{
    if (ventHistorySession) requestVentHistory(ventHistorySession.id,"current");
  });
  $("ventHistoryPreviousBtn").addEventListener("click", ()=>{
    if (ventHistorySession) requestVentHistory(ventHistorySession.id,"previous");
  });

  $("ventilationSettings").addEventListener("click", (event) => {
    const button = event.target.closest?.("button[data-vent-command]");
    if (!button || !adminTargetId) return;
    sendVentCommand(adminTargetId, button.dataset.ventCommand || "");
  });
  $("saveVentScheduleBtn").addEventListener("click", () => {
    if (adminTargetId) sendVentCommand(adminTargetId,
      `vent_schedule|${$("ventPauseFrom").value}|${$("ventPauseTo").value}`);
  });
  $("saveVentTimeBtn").addEventListener("click", () => {
    if (adminTargetId) sendVentCommand(adminTargetId,
      `vent_time|${$("ventClockInput").value}`);
  });

  ui.otaUpdateBtn.addEventListener("click", () => {
    if (adminTargetId) startRemoteOta(adminTargetId);
  });

  ui.restartEspBtn.addEventListener("click", () => {
    if (!adminTargetId) return;
    const device = devices.get(adminTargetId);
    const firmware = String((device && device.state && device.state.firmware) || "");
    if (device && meterType(device) !== "VENTILATION" && !firmwareAtLeast(firmware, 4, 3)) {
      setAdminStatus("Το Restart ESP απαιτεί firmware v4.03+.", "error");
      return;
    }
    if (!window.confirm(
      `Να γίνει επανεκκίνηση του ESP8266 ${adminTargetId};\n\nΟι μετρήσεις και το MQTT θα διακοπούν για λίγα δευτερόλεπτα.`
    )) return;
    sendAdmin("restart_esp", "Αποστολή εντολής Restart ESP…");
  });

  ui.closeOtaPinBtn.addEventListener("click", () => {
    otaTargetId = null;
    otaPendingManifest = null;
    ui.otaPinDialog.close();
    setAdminStatus("Το OTA ακυρώθηκε.");
  });

  ui.cancelOtaPinBtn.addEventListener("click", () => {
    otaTargetId = null;
    otaPendingManifest = null;
    ui.otaPinDialog.close();
    setAdminStatus("Το OTA ακυρώθηκε.");
  });

  ui.otaPinForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const entered = ui.otaPinInput.value.trim();

    if (entered !== OTA_PIN) {
      ui.otaPinError.textContent = "Λάθος PIN.";
      ui.otaPinError.classList.remove("hidden");
      ui.otaPinInput.select();
      return;
    }

    ui.otaPinDialog.close();
    sendPendingRemoteOta();
  });

  ui.otaProgressCloseBtn.addEventListener("click", () => {
    if (otaSession) return;
    ui.otaProgressDialog.close();
  });

  ui.otaProgressDialog.addEventListener("cancel", (event) => {
    if (otaSession) {
      event.preventDefault();
      return;
    }
  });

  ui.startUtilityReadingBtn.addEventListener("click", () => openUtilityEntry());

  ui.utilityKindFinal.addEventListener("change", () => {
    updateUtilityReadingMode();
    setUtilityEntryStep(0);
  });
  ui.utilityKindIntermediate.addEventListener("change", () => {
    updateUtilityReadingMode();
    setUtilityEntryStep(0);
  });
  ui.utilityTimeExact.addEventListener("change", updateUtilityTimeMode);
  ui.utilityTimeEstimated.addEventListener("change", updateUtilityTimeMode);

  ui.closeUtilityEntryBtn.addEventListener("click", () => {
    ui.utilityEntryDialog.close();
    resetUtilityEditor();
  });

  ui.utilityEntryDialog.addEventListener("click", (event) => {
    const button = event.target.closest("[data-entry-action]");
    if (!button) return;
    const action = button.dataset.entryAction;

    if (action === "back") {
      setUtilityEntryStep(utilityEntryAdjacentStep(-1));
      return;
    }

    if (action === "next") {
      if (!utilityStepValid(utilityEntryStep)) return;
      if (utilityEntryStep === 3 && !prepareUtilityConfirmation()) return;
      setUtilityEntryStep(utilityEntryAdjacentStep(1));
    }
  });

  ui.saveUtilityReadingBtn.addEventListener("click", () => {
    const form = readUtilityForm();
    if (!form) return;

    const command = editingUtilityId
      ? `utility_reading_update|${editingUtilityId}|${form.commandTail}`
      : `utility_reading_add|${form.commandTail}`;
    const label = form.kind === "ek" ? "Ένδειξης ΔΕΗ" : "Μέτρησης ΔΕΗ";

    sendAdmin(
      command,
      editingUtilityId
        ? `Αποθήκευση διόρθωσης ${label}…`
        : `Καταχώρηση ${label}…`
    );
  });

  ui.utilityHistoryBtn.addEventListener("click", () => {
    if (!adminTargetId) return;
    refreshUtilityRows(adminTargetId, true);
  });

  ui.closeUtilityHistoryBtn.addEventListener("click", () => {
    ui.utilityHistoryDialog.close();
  });

  ui.utilityHistoryContent.addEventListener("click", (event) => {
    const button = event.target.closest("[data-utility-action]");
    if (!button) return;

    const id = Number(button.dataset.utilityId);
    const row = utilityHistoryRows.find((item) => item.id === id);
    if (!row) return;

    if (button.dataset.utilityAction === "edit") {
      startUtilityEdit(row);
      return;
    }

    if (button.dataset.utilityAction === "delete") {
      if (!utilityCanDelete(row)) return;
      const kind = row.kind === "ek" ? "Καταχώρηση Ένδειξης ΔΕΗ" : "Καταχώρηση Μέτρησης ΔΕΗ";
      if (!window.confirm(`Να διαγραφεί η ${kind} ${utilityDateTimeLabel(row)};`)) return;
      if (ui.utilityHistoryDialog.open) ui.utilityHistoryDialog.close();
      sendAdmin(
        `utility_reading_delete|${row.id}`,
        "Διαγραφή καταχώρησης…"
      );
    }
  });

  ui.changeMeterTypeBtn.addEventListener("click", () => {
    if (!adminTargetId) return;
    const device = devices.get(adminTargetId);
    if (!device) return;
    const phaseType = meterPhaseType(device);
    const meter = meterName(device);
    window.alert(
      `Τρέχων τύπος μετρητή: ${phaseType} (${meter}).\n\n` +
      "Η πραγματική αλλαγή Μονοφασικό ↔ Τριφασικό απαιτεί το αντίστοιχο firmware και συμβατό συνδεδεμένο μετρητή. Δεν γίνεται ασφαλής αλλαγή μόνο από το app."
    );
  });

  ui.dualZoneToggle.addEventListener("change", () => {
    if (!adminTargetId) return;
    const device = devices.get(adminTargetId);
    if (!device) return;

    const selected = ui.dualZoneToggle.checked;
    const currentDual =
      device.state.dual_zone === true ||
      device.state.tariff_mode === "dual";

    if (selected === currentDual) {
      setAdminStatus(`Παραμένει ${selected ? "Ζ1 / Ζ2" : "Ζ"}.`, "ok");
      return;
    }

    setAdminStatus(
      `Επιλέχθηκε ${selected ? "Ζ1 / Ζ2" : "Ζ"}. Πάτησε ΑΠΟΘΗΚΕΥΣΗ ΤΙΜΟΛΟΓΙΟΥ για εφαρμογή.`
    );
  });

  ui.saveDualZoneBtn.addEventListener("click", () => {
    if (!adminTargetId) return;

    const device = devices.get(adminTargetId);
    if (!device || !firmwareAtLeast((device.state || {}).firmware, 3, 0)) {
      setAdminStatus("Απαιτεί firmware v3.00 ή νεότερο.", "error");
      return;
    }

    const enabled = ui.dualZoneToggle.checked;
    const currentDual =
      device.state.dual_zone === true ||
      device.state.tariff_mode === "dual";

    if (enabled === currentDual) {
      setAdminStatus(
        `Ο τύπος είναι ήδη ${enabled ? "Ζ1 / Ζ2" : "Ζ"}.`,
        "ok"
      );
      return;
    }

    const currentLabel = currentDual ? "Ζ1 / Ζ2" : "Ζ";
    const newLabel = enabled ? "Ζ1 / Ζ2" : "Ζ";
    const warning =
      `Επιβεβαίωση αλλαγής τιμολογίου\n\nΤρέχον: ${currentLabel}\nΝέο: ${newLabel}\n\nΝα αποθηκευτεί η αλλαγή;`;

    if (!window.confirm(warning)) {
      ui.dualZoneToggle.checked = currentDual;
      ui.dualZoneDetails.classList.toggle("hidden", !currentDual);
      ui.monoReadingFields.classList.toggle("hidden", currentDual);
      ui.dualReadingFields.classList.toggle("hidden", !currentDual);
      return;
    }

    sendAdmin(
      `tariff_mode_set|${enabled ? "dual" : "mono"}`,
      "Αποθήκευση τιμολογίου…"
    );
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    ui.installBtn.classList.remove("hidden");
  });

  ui.installBtn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    ui.installBtn.classList.add("hidden");
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    ui.installBtn.classList.add("hidden");
    showToast("Η εφαρμογή εγκαταστάθηκε");
  });

  if ("serviceWorker" in navigator) {
    const hadServiceWorkerController = Boolean(navigator.serviceWorker.controller);
    let reloadingForAppUpdate = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadServiceWorkerController || reloadingForAppUpdate) return;
      reloadingForAppUpdate = true;
      showToast("Νέα έκδοση app διαθέσιμη. Θα εφαρμοστεί με την επόμενη φόρτωση· η τρέχουσα σύνδεση συνεχίζεται.", 8000);
    });

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js?v=5.68", { updateViaCache: "none" })
        .then((registration) => {
          const checkForAppUpdate = () => {
            registration.update().catch((err) => {
              console.warn("Service worker update check failed", err);
            });
          };

          // Έλεγχος αμέσως σε κάθε άνοιγμα και περιοδικά όσο το app μένει ανοιχτό.
          checkForAppUpdate();
          setInterval(checkForAppUpdate, 5 * 60 * 1000);

          // Αν το κινητό επιστρέψει στο app μετά από ώρα, ελέγχουμε αμέσως.
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") checkForAppUpdate();
          });
          window.addEventListener("focus", checkForAppUpdate);
        })
        .catch((err) => {
          console.warn("Service worker registration failed", err);
        });
    });
  }

  const footerSpans = document.querySelectorAll("footer span");
  if (footerSpans[0]) footerSpans[0].textContent = `MQTT.app. v${APP_VERSION}`;
  if (footerSpans[1]) footerSpans[1].textContent = "Auto discovery · Z1/Z2 · refresh 60″";

  restoreSettings();
  renderAll();
  setBrokerState("warn", "Αποσυνδεδεμένο");
  const resumedMqttSession = readMqttSession() || readRememberedMqtt();
  if (resumedMqttSession) {
    ui.hostInput.value = resumedMqttSession.host;
    ui.portInput.value = resumedMqttSession.port;
    ui.pathInput.value = resumedMqttSession.path;
    ui.usernameInput.value = resumedMqttSession.username;
    ui.passwordInput.value = resumedMqttSession.password;
    ui.rememberConnectionInput.checked = resumedMqttSession.remember;
    // Resume only previously successful app settings; password-manager
    // autofill is left to the browser and never read without a form submit.
    connect(resumedMqttSession);
  } else setTimeout(() => ui.settingsDialog.showModal(), 250);
})();


