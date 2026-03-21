import React, { useEffect, useMemo, useState } from 'react';

const STORAGE_KEYS = {
  draft: 'lnf-tariff-draft-v1',
  simulations: 'lnf-simulations-v1',
  tariffs: 'lnf-approved-tariffs-v1',
  analysis: 'lnf-margin-analysis-v1',
};

const DEFAULT_FORM = {
  costoEnergia: 0.22,
  perditeRete: 5,
  ammortamento: 0.04,
  quotaGestione: 0,
  percentualeJCP: 6,
  stripePerc: 3,
  stripeFisso: 0.3,
  iva: 22,
  kwh: 30,
  targetLordo: 0.35,
  calcMode: 'forward',
};

const DEFAULT_ANALYSIS = {
  startMonth: '',
  endMonth: '',
  selectedTariffId: '',
  consumedKwh: 0,
  actualNetRevenue: 0,
  overrideEnergyCost: 0,
  notes: '',
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(
    Number.isFinite(value) ? value : 0,
  );

const formatNumber = (value, digits = 3) =>
  new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);

const safeParse = (value, fallback) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};

const createId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function calculateResults(form) {
  const kwh = Math.max(Number(form.kwh) || 0, 0.0001);
  const costoEnergia = Number(form.costoEnergia) || 0;
  const perditeRete = Number(form.perditeRete) || 0;
  const ammortamento = Number(form.ammortamento) || 0;
  const quotaGestione = Number(form.quotaGestione) || 0;
  const percentualeJCP = Number(form.percentualeJCP) || 0;
  const stripePerc = Number(form.stripePerc) || 0;
  const stripeFisso = Number(form.stripeFisso) || 0;
  const iva = Number(form.iva) || 0;
  const unitarioINFN = costoEnergia * (1 + perditeRete / 100) + ammortamento + quotaGestione;

  let imponibileTotale = 0;
  if (form.calcMode === 'forward') {
    const nettoINFNTarget = unitarioINFN * kwh;
    imponibileTotale = nettoINFNTarget / (1 - percentualeJCP / 100 || 1);
  } else {
    const targetLordo = Number(form.targetLordo) || 0;
    imponibileTotale = (targetLordo * kwh) / (1 + iva / 100);
  }

  const lordoCliente = imponibileTotale * (1 + iva / 100);
  const nettoINFN = imponibileTotale * (1 - percentualeJCP / 100);
  const lordoJCP = imponibileTotale * (percentualeJCP / 100);
  const stripeCost = imponibileTotale * (stripePerc / 100) + stripeFisso;
  const nettoJCP = lordoJCP - stripeCost;
  const quotaAmmortamentoTotale = ammortamento * kwh;
  const quotaEnergiaTotale = costoEnergia * (1 + perditeRete / 100) * kwh;
  const quotaGestioneTotale = quotaGestione * kwh;

  return {
    unitarioINFN,
    lordoCliente,
    incassoCPONetto: imponibileTotale,
    nettoINFN,
    lordoJCP,
    stripeCost,
    nettoJCP,
    prezzoUnitario: lordoCliente / kwh,
    quotaAmmortamentoTotale,
    quotaEnergiaTotale,
    quotaGestioneTotale,
    deltaProtezioneINFN: nettoINFN - (quotaEnergiaTotale + quotaAmmortamentoTotale + quotaGestioneTotale),
  };
}

function App() {
  const [form, setForm] = useState(() => ({
    ...DEFAULT_FORM,
    ...safeParse(localStorage.getItem(STORAGE_KEYS.draft), DEFAULT_FORM),
  }));
  const [simulations, setSimulations] = useState(() =>
    safeParse(localStorage.getItem(STORAGE_KEYS.simulations), []),
  );
  const [tariffs, setTariffs] = useState(() => safeParse(localStorage.getItem(STORAGE_KEYS.tariffs), []));
  const [analysisDraft, setAnalysisDraft] = useState(() => ({
    ...DEFAULT_ANALYSIS,
    ...safeParse(localStorage.getItem(STORAGE_KEYS.analysis), DEFAULT_ANALYSIS),
  }));
  const [activePanel, setActivePanel] = useState('dashboard');
  const [message, setMessage] = useState('');

  const results = useMemo(() => calculateResults(form), [form]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(form));
  }, [form]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.simulations, JSON.stringify(simulations));
  }, [simulations]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.tariffs, JSON.stringify(tariffs));
  }, [tariffs]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.analysis, JSON.stringify(analysisDraft));
  }, [analysisDraft]);

  useEffect(() => {
    if (!message) return undefined;
    const timeout = setTimeout(() => setMessage(''), 2200);
    return () => clearTimeout(timeout);
  }, [message]);

  const tariffOptions = useMemo(() => {
    return tariffs.filter((tariff) => {
      if (!analysisDraft.startMonth && !analysisDraft.endMonth) return true;
      const ref = tariff.referencePeriod;
      if (analysisDraft.startMonth && ref < analysisDraft.startMonth) return false;
      if (analysisDraft.endMonth && ref > analysisDraft.endMonth) return false;
      return true;
    });
  }, [analysisDraft.endMonth, analysisDraft.startMonth, tariffs]);

  const selectedTariff = tariffOptions.find((item) => item.id === analysisDraft.selectedTariffId) || tariffOptions[0];

  useEffect(() => {
    if (selectedTariff && selectedTariff.id !== analysisDraft.selectedTariffId) {
      setAnalysisDraft((current) => ({ ...current, selectedTariffId: selectedTariff.id }));
    }
  }, [analysisDraft.selectedTariffId, selectedTariff]);

  const analysisPreview = useMemo(() => {
    if (!selectedTariff) return null;
    const tariffForm = selectedTariff.formSnapshot;
    const consumedKwh = Number(analysisDraft.consumedKwh) || 0;
    const actualNetRevenue = Number(analysisDraft.actualNetRevenue) || 0;
    const energyOverride = Number(analysisDraft.overrideEnergyCost) || 0;
    const effectiveEnergyCost = energyOverride > 0 ? energyOverride : Number(tariffForm.costoEnergia) || 0;
    const adjustedUnitCost =
      effectiveEnergyCost * (1 + (Number(tariffForm.perditeRete) || 0) / 100) +
      (Number(tariffForm.ammortamento) || 0) +
      (Number(tariffForm.quotaGestione) || 0);
    const unitNetSubCpo =
      selectedTariff.results.nettoINFN / Math.max(Number(selectedTariff.formSnapshot.kwh) || 0, 0.0001);
    const actualSubCpo = actualNetRevenue > 0 ? actualNetRevenue : unitNetSubCpo;
    const expectedNet = actualSubCpo * consumedKwh;
    const energyCostTotal = effectiveEnergyCost * (1 + (Number(tariffForm.perditeRete) || 0) / 100) * consumedKwh;
    const managementTotal = (Number(tariffForm.quotaGestione) || 0) * consumedKwh;
    const amortizationTotal = (Number(tariffForm.ammortamento) || 0) * consumedKwh;
    const infnMargin = expectedNet - energyCostTotal - managementTotal;

    return {
      adjustedUnitCost,
      expectedNet,
      energyCostTotal,
      managementTotal,
      amortizationTotal,
      infnMargin,
    };
  }, [analysisDraft.actualNetRevenue, analysisDraft.consumedKwh, analysisDraft.overrideEnergyCost, selectedTariff]);

  const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const saveSimulation = () => {
    const entry = {
      id: createId('SIM'),
      savedAt: new Date().toISOString(),
      title: `${form.calcMode === 'forward' ? 'Forward' : 'Reverse'} · ${form.kwh} kWh`,
      formSnapshot: form,
      results,
    };
    setSimulations((current) => [entry, ...current]);
    setMessage(`Simulazione salvata con ID ${entry.id}`);
  };

  const saveTariff = () => {
    const referencePeriod = window.prompt('Inserisci il mese o trimestre di riferimento (es. 2026-03 oppure 2026-Q1)');
    if (!referencePeriod) return;
    const entry = {
      id: createId('TAR'),
      savedAt: new Date().toISOString(),
      referencePeriod,
      formSnapshot: form,
      results,
    };
    setTariffs((current) => [entry, ...current]);
    setMessage(`Tariffa approvata salvata con ID ${entry.id}`);
  };

  const loadSnapshot = (snapshot) => {
    setForm(snapshot.formSnapshot);
    setActivePanel('dashboard');
    setMessage(`Configurazione ${snapshot.id} caricata`);
  };

  const SectionButton = ({ id, children }) => (
    <button
      className={`nav-button ${activePanel === id ? 'active' : ''}`}
      onClick={() => setActivePanel(id)}
      type="button"
    >
      {children}
    </button>
  );

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Laboratori Nazionali di Frascati</p>
          <h1>Tariffa EV • simulatore, archivio e verifica margini</h1>
          <p className="hero-copy">
            App React + Vite pronta per Vercel, responsive su desktop e mobile, con persistenza locale di
            simulazioni, tariffe approvate e analisi economica dell&apos;utile INFN.
          </p>
        </div>
        <div className="hero-badges">
          <span>Persistenza locale</span>
          <span>Storico con ID</span>
          <span>Preview finale</span>
        </div>
      </header>

      <nav className="panel-nav">
        <SectionButton id="dashboard">Simulatore</SectionButton>
        <SectionButton id="simulations">Storico simulazioni</SectionButton>
        <SectionButton id="tariffs">Storico tariffe</SectionButton>
        <SectionButton id="analysis">Tool utile ente</SectionButton>
        <SectionButton id="manual">Manuale</SectionButton>
      </nav>

      {message ? <div className="toast">{message}</div> : null}

      {activePanel === 'dashboard' && (
        <>
          <section className="grid-layout">
            <article className="card">
              <div className="card-title-row">
                <h2>Card impostazioni</h2>
                <span className="tag">Costo industriale INFN</span>
              </div>
              <div className="field-grid">
                <label>
                  <span>Costo energia (€/kWh)</span>
                  <input type="number" step="0.001" value={form.costoEnergia} onChange={(e) => updateField('costoEnergia', Number(e.target.value))} />
                </label>
                <label>
                  <span>Perdite rete (%)</span>
                  <input type="number" value={form.perditeRete} onChange={(e) => updateField('perditeRete', Number(e.target.value))} />
                </label>
                <label>
                  <span>Ammortamento (€/kWh)</span>
                  <input type="number" step="0.001" value={form.ammortamento} onChange={(e) => updateField('ammortamento', Number(e.target.value))} />
                </label>
                <label>
                  <span>Quota gestione (€/kWh)</span>
                  <input type="number" step="0.001" value={form.quotaGestione} onChange={(e) => updateField('quotaGestione', Number(e.target.value))} />
                </label>
                <label>
                  <span>Commissione JCP (%)</span>
                  <input type="number" value={form.percentualeJCP} onChange={(e) => updateField('percentualeJCP', Number(e.target.value))} />
                </label>
                <label>
                  <span>IVA (%)</span>
                  <input type="number" value={form.iva} onChange={(e) => updateField('iva', Number(e.target.value))} />
                </label>
                <label>
                  <span>Stripe %</span>
                  <input type="number" step="0.1" value={form.stripePerc} onChange={(e) => updateField('stripePerc', Number(e.target.value))} />
                </label>
                <label>
                  <span>Stripe fisso (€)</span>
                  <input type="number" step="0.01" value={form.stripeFisso} onChange={(e) => updateField('stripeFisso', Number(e.target.value))} />
                </label>
              </div>
            </article>

            <article className="card">
              <div className="card-title-row">
                <h2>Card simulazione</h2>
                <span className="tag alt">Direzione di calcolo</span>
              </div>
              <div className="mode-switch">
                <button className={form.calcMode === 'forward' ? 'active' : ''} onClick={() => updateField('calcMode', 'forward')} type="button">
                  A · Dal costo al prezzo
                </button>
                <button className={form.calcMode === 'reverse' ? 'active' : ''} onClick={() => updateField('calcMode', 'reverse')} type="button">
                  B · Dal prezzo alla ripartizione
                </button>
              </div>
              <label className="kwh-box">
                <span>kWh erogati</span>
                <input type="number" value={form.kwh} onChange={(e) => updateField('kwh', Number(e.target.value))} />
              </label>
              {form.calcMode === 'reverse' && (
                <label>
                  <span>Prezzo lordo desiderato (€/kWh)</span>
                  <input type="number" step="0.01" value={form.targetLordo} onChange={(e) => updateField('targetLordo', Number(e.target.value))} />
                </label>
              )}
              <div className="action-row">
                <button className="primary" type="button" onClick={saveSimulation}>
                  Salva simulazione
                </button>
                <button className="secondary" type="button" onClick={saveTariff}>
                  Salva come tariffa approvata
                </button>
              </div>
              <p className="support-text">
                Ogni salvataggio conserva ID univoco, data ISO e tutti i parametri necessari per riaprire la
                sessione.
              </p>
            </article>

            <article className="card results-card">
              <div className="card-title-row">
                <h2>Card risultati</h2>
                <span className="tag success">Preview live</span>
              </div>
              <div className="metric-big">
                <span>Prezzo finale cliente</span>
                <strong>{formatCurrency(results.lordoCliente)}</strong>
                <small>{formatCurrency(results.prezzoUnitario)} / kWh</small>
              </div>
              <div className="metric-list">
                <div>
                  <span>Netto INFN</span>
                  <strong>{formatCurrency(results.nettoINFN)}</strong>
                </div>
                <div>
                  <span>Lordo JCP</span>
                  <strong>{formatCurrency(results.lordoJCP)}</strong>
                </div>
                <div>
                  <span>Ammanco Stripe</span>
                  <strong>{formatCurrency(results.stripeCost)}</strong>
                </div>
                <div className={results.nettoJCP >= 0 ? 'positive' : 'negative'}>
                  <span>Utile reale JCP</span>
                  <strong>{formatCurrency(results.nettoJCP)}</strong>
                </div>
              </div>
              <div className="preview-panel">
                <p>Protezione recupero INFN</p>
                <strong>{formatCurrency(results.deltaProtezioneINFN)}</strong>
                <small>Se negativo, il prezzo impostato non copre integralmente il costo industriale.</small>
              </div>
            </article>
          </section>

          <section className="table-card">
            <div className="table-head">
              <div>
                <p className="eyebrow">Anteprima finale</p>
                <h3>Rendiconto netto della simulazione</h3>
              </div>
              <span>{new Date().toLocaleString('it-IT')}</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Consumo</th>
                    <th>Incasso CPO</th>
                    <th>Costo SubCPO</th>
                    <th>Utile CPO</th>
                    <th>Ammanco Stripe</th>
                    <th>Quota Ammortamento INFN</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{formatNumber(form.kwh, 2)} kWh</td>
                    <td>{formatCurrency(results.incassoCPONetto)}</td>
                    <td>{formatCurrency(results.nettoINFN)}</td>
                    <td>{formatCurrency(results.lordoJCP)}</td>
                    <td>{formatCurrency(results.stripeCost)}</td>
                    <td>{formatCurrency(results.quotaAmmortamentoTotale)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {activePanel === 'simulations' && (
        <section className="archive-grid">
          {simulations.length === 0 ? <div className="empty-state">Nessuna simulazione salvata.</div> : simulations.map((entry) => (
            <article key={entry.id} className="archive-card">
              <div>
                <p className="eyebrow">{entry.id}</p>
                <h3>{entry.title}</h3>
                <p>Salvata il {new Date(entry.savedAt).toLocaleString('it-IT')}</p>
              </div>
              <ul>
                <li>Lordo cliente: {formatCurrency(entry.results.lordoCliente)}</li>
                <li>Netto INFN: {formatCurrency(entry.results.nettoINFN)}</li>
                <li>Utile JCP: {formatCurrency(entry.results.nettoJCP)}</li>
              </ul>
              <button type="button" className="secondary" onClick={() => loadSnapshot(entry)}>
                Riapri simulazione
              </button>
            </article>
          ))}
        </section>
      )}

      {activePanel === 'tariffs' && (
        <section className="archive-grid">
          {tariffs.length === 0 ? <div className="empty-state">Nessuna tariffa approvata presente.</div> : tariffs.map((entry) => (
            <article key={entry.id} className="archive-card">
              <div>
                <p className="eyebrow">{entry.id}</p>
                <h3>Tariffa {entry.referencePeriod}</h3>
                <p>Approvata il {new Date(entry.savedAt).toLocaleString('it-IT')}</p>
              </div>
              <ul>
                <li>Prezzo pubblico: {formatCurrency(entry.results.prezzoUnitario)}/kWh</li>
                <li>Netto INFN unitario: {formatCurrency(entry.results.nettoINFN / entry.formSnapshot.kwh)}/kWh</li>
                <li>JCP netto: {formatCurrency(entry.results.nettoJCP)}</li>
              </ul>
              <button type="button" className="secondary" onClick={() => loadSnapshot(entry)}>
                Applica tariffa al simulatore
              </button>
            </article>
          ))}
        </section>
      )}

      {activePanel === 'analysis' && (
        <section className="analysis-layout">
          <article className="card">
            <div className="card-title-row">
              <h2>Tool utile ente</h2>
              <span className="tag">Selezione periodo</span>
            </div>
            <div className="field-grid">
              <label>
                <span>Mese iniziale</span>
                <input type="month" value={analysisDraft.startMonth} onChange={(e) => setAnalysisDraft((c) => ({ ...c, startMonth: e.target.value }))} />
              </label>
              <label>
                <span>Mese finale</span>
                <input type="month" value={analysisDraft.endMonth} onChange={(e) => setAnalysisDraft((c) => ({ ...c, endMonth: e.target.value }))} />
              </label>
              <label>
                <span>Tariffa applicata nel periodo</span>
                <select value={analysisDraft.selectedTariffId} onChange={(e) => setAnalysisDraft((c) => ({ ...c, selectedTariffId: e.target.value }))}>
                  {tariffOptions.map((item) => <option key={item.id} value={item.id}>{item.referencePeriod} · {item.id}</option>)}
                </select>
              </label>
              <label>
                <span>kWh realmente erogati</span>
                <input type="number" value={analysisDraft.consumedKwh} onChange={(e) => setAnalysisDraft((c) => ({ ...c, consumedKwh: Number(e.target.value) }))} />
              </label>
              <label>
                <span>Incasso netto SubCPO effettivo (€/kWh)</span>
                <input type="number" step="0.001" value={analysisDraft.actualNetRevenue} onChange={(e) => setAnalysisDraft((c) => ({ ...c, actualNetRevenue: Number(e.target.value) }))} />
              </label>
              <label>
                <span>Override costo energia (€/kWh)</span>
                <input type="number" step="0.001" value={analysisDraft.overrideEnergyCost} onChange={(e) => setAnalysisDraft((c) => ({ ...c, overrideEnergyCost: Number(e.target.value) }))} />
              </label>
            </div>
            <label>
              <span>Note</span>
              <textarea rows="4" value={analysisDraft.notes} onChange={(e) => setAnalysisDraft((c) => ({ ...c, notes: e.target.value }))} />
            </label>
          </article>

          <article className="card results-card">
            <div className="card-title-row">
              <h2>Anteprima analisi periodo</h2>
              <span className="tag success">Fine processo</span>
            </div>
            {!analysisPreview || !selectedTariff ? (
              <div className="empty-state">Salva almeno una tariffa per usare il tool.</div>
            ) : (
              <>
                <div className="metric-list preview-only">
                  <div>
                    <span>Tariffa riferimento</span>
                    <strong>{selectedTariff.referencePeriod}</strong>
                  </div>
                  <div>
                    <span>Costo unitario aggiornato</span>
                    <strong>{formatCurrency(analysisPreview.adjustedUnitCost)}/kWh</strong>
                  </div>
                  <div>
                    <span>Ricavo netto INFN stimato</span>
                    <strong>{formatCurrency(analysisPreview.expectedNet)}</strong>
                  </div>
                  <div>
                    <span>Costo energia complessivo</span>
                    <strong>{formatCurrency(analysisPreview.energyCostTotal)}</strong>
                  </div>
                  <div>
                    <span>Quota gestione</span>
                    <strong>{formatCurrency(analysisPreview.managementTotal)}</strong>
                  </div>
                  <div>
                    <span>Quota ammortamento teorica</span>
                    <strong>{formatCurrency(analysisPreview.amortizationTotal)}</strong>
                  </div>
                  <div className={analysisPreview.infnMargin >= 0 ? 'positive' : 'negative'}>
                    <span>Utile ente / quota ammortamento</span>
                    <strong>{formatCurrency(analysisPreview.infnMargin)}</strong>
                  </div>
                </div>
                <p className="support-text">
                  L&apos;utile ente è calcolato come ricavo netto INFN del periodo meno costo energia e quota gestione;
                  la quota di ammortamento rimane così leggibile come margine disponibile o recuperato.
                </p>
              </>
            )}
          </article>
        </section>
      )}

      {activePanel === 'manual' && (
        <section className="manual card">
          <div className="card-title-row">
            <h2>Manuale operativo</h2>
            <span className="tag">Specifiche e formule</span>
          </div>
          <ol>
            <li>
              <strong>Scopo.</strong> L&apos;app determina la tariffa di ricarica EV dei LNF, separando la quota INFN da
              quella del service provider e proteggendo il recupero costi dell&apos;ente.
            </li>
            <li>
              <strong>Input INFN.</strong> Costo energia, perdite di rete, quota ammortamento e quota gestione
              definiscono il costo industriale unitario.
            </li>
            <li>
              <strong>Input provider.</strong> JCP incassa una percentuale dell&apos;imponibile; Stripe grava sul netto con
              percentuale più quota fissa.
            </li>
            <li>
              <strong>Direzione A.</strong> U = (Costo Energia × (1 + Perdite)) + Ammortamento + Gestione. Netto INFN = U
              × kWh. Imponibile = Netto INFN / (1 - JCP%). Prezzo finale = Imponibile × (1 + IVA).
            </li>
            <li>
              <strong>Direzione B.</strong> Imponibile = (Prezzo lordo × kWh) / (1 + IVA). Netto INFN = Imponibile × (1 -
              JCP%). Lordo JCP = Imponibile × JCP%.
            </li>
            <li>
              <strong>Colpo di Stripe.</strong> Stripe = (Imponibile × Stripe%) + quota fissa. Utile reale JCP = Lordo
              JCP - Stripe. Se il risultato è negativo, l&apos;INFN continua comunque a ricevere il proprio netto.
            </li>
            <li>
              <strong>Salvataggi.</strong> Le simulazioni creano record con prefisso SIM, data e snapshot completo; le
              tariffe approvate usano prefisso TAR e richiedono il mese o trimestre di riferimento.
            </li>
            <li>
              <strong>Tool utile ente.</strong> Permette di selezionare un periodo, recuperare la tariffa applicata,
              registrare i kWh effettivi, correggere il ricavo netto SubCPO e variare il costo energia del mese per
              misurare l&apos;utile ente/ammortamento nel periodo.
            </li>
            <li>
              <strong>Persistenza.</strong> Tutto lo storico viene mantenuto nel browser tramite localStorage, quindi Vercel
              pubblica l&apos;app senza bisogno di backend.
            </li>
          </ol>
        </section>
      )}
    </div>
  );
}

export default App;
