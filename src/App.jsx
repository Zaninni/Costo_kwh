import React, { useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_FORM,
  calculateResults,
  createId,
  formatCurrency,
  formatNumber,
  migrateDraft,
  safeParse,
} from './lib/calculations';

const STORAGE_KEYS = {
  draft: 'lnf-tariff-draft-v2',
  simulations: 'lnf-simulations-v1',
  tariffs: 'lnf-approved-tariffs-v1',
  analysis: 'lnf-margin-analysis-v2',
  legacyDraft: 'lnf-tariff-draft-v1',
};

const DEFAULT_ANALYSIS = {
  startMonth: '',
  endMonth: '',
  selectedTariffId: '',
  consumedKwh: 0,
  actualNetRevenuePerKwh: 0,
  overrideEnergyCost: 0,
  periodExpectedKwh: 0,
  notes: '',
};

const MODE_OPTIONS = [
  { id: 'live_only', label: '1 · Pareggio spese vive', description: 'Il prezzo copre solo le spese vive nette IVA dell’ente.' },
  {
    id: 'live_plus_infra',
    label: '2 · Pareggio spese vive + target recupero infrastrutturale',
    description: 'Il prezzo incorpora spese vive e quota di recupero del periodo analizzato.',
  },
  { id: 'manual_gross', label: '3 · Prezzo lordo manuale', description: 'Inserisci direttamente il prezzo lordo €/kWh da verificare.' },
];

const newInfrastructureItem = () => ({
  id: createId('infra'),
  descrizione: '',
  categoria: 'investimento',
  importoNetto: 0,
  dataInizio: '',
  dataFine: '',
  metodoRiparto: 'lineare_tempo',
  kwhPrevistiTotali: 0,
  note: '',
});

const healthDescriptions = {
  red: 'Rosso · il netto ente non copre le spese vive.',
  yellow: 'Giallo · spese vive coperte ma target recupero non pienamente coperto.',
  green: 'Verde · spese vive coperte e target recupero raggiunto.',
};

function App() {
  const [form, setForm] = useState(() => {
    const current = safeParse(localStorage.getItem(STORAGE_KEYS.draft), null);
    if (current) return migrateDraft(current);
    const legacy = safeParse(localStorage.getItem(STORAGE_KEYS.legacyDraft), null);
    return migrateDraft(legacy || DEFAULT_FORM);
  });
  const [simulations, setSimulations] = useState(() => safeParse(localStorage.getItem(STORAGE_KEYS.simulations), []));
  const [tariffs, setTariffs] = useState(() => safeParse(localStorage.getItem(STORAGE_KEYS.tariffs), []));
  const [analysisDraft, setAnalysisDraft] = useState(() => ({
    ...DEFAULT_ANALYSIS,
    ...safeParse(localStorage.getItem(STORAGE_KEYS.analysis), DEFAULT_ANALYSIS),
  }));
  const [activePanel, setActivePanel] = useState('dashboard');
  const [message, setMessage] = useState('');
  const [showInfraManager, setShowInfraManager] = useState(false);

  const results = useMemo(() => calculateResults(form), [form]);

  useEffect(() => localStorage.setItem(STORAGE_KEYS.draft, JSON.stringify(form)), [form]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.simulations, JSON.stringify(simulations)), [simulations]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.tariffs, JSON.stringify(tariffs)), [tariffs]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.analysis, JSON.stringify(analysisDraft)), [analysisDraft]);
  useEffect(() => {
    if (!message) return undefined;
    const timeout = setTimeout(() => setMessage(''), 2400);
    return () => clearTimeout(timeout);
  }, [message]);

  const tariffOptions = useMemo(() => tariffs.filter((tariff) => {
    if (!analysisDraft.startMonth && !analysisDraft.endMonth) return true;
    const ref = tariff.referencePeriod;
    if (analysisDraft.startMonth && ref < analysisDraft.startMonth) return false;
    if (analysisDraft.endMonth && ref > analysisDraft.endMonth) return false;
    return true;
  }), [analysisDraft.endMonth, analysisDraft.startMonth, tariffs]);

  const selectedTariff = tariffOptions.find((item) => item.id === analysisDraft.selectedTariffId) || tariffOptions[0] || null;

  useEffect(() => {
    if (selectedTariff && selectedTariff.id !== analysisDraft.selectedTariffId) {
      setAnalysisDraft((current) => ({ ...current, selectedTariffId: selectedTariff.id }));
    }
  }, [analysisDraft.selectedTariffId, selectedTariff]);

  const analysisPreview = useMemo(() => {
    if (!selectedTariff) return null;
    const baseForm = migrateDraft(selectedTariff.formSnapshot);
    const consumedKwh = Number(analysisDraft.consumedKwh) || 0;
    const actualNetRevenuePerKwh = Number(analysisDraft.actualNetRevenuePerKwh) || 0;
    const overrideEnergyCost = Number(analysisDraft.overrideEnergyCost) || 0;
    const periodExpectedKwh = Number(analysisDraft.periodExpectedKwh) || baseForm.periodExpectedKwh;

    const actualForm = {
      ...baseForm,
      kwh: consumedKwh,
      periodExpectedKwh,
      costoEnergia: overrideEnergyCost > 0 ? overrideEnergyCost : baseForm.costoEnergia,
    };

    const actualResults = calculateResults(actualForm);
    const netPerKwh = actualNetRevenuePerKwh > 0 ? actualNetRevenuePerKwh : actualResults.prezzoUnitarioNettoEnte;
    const nettoEnte = netPerKwh * consumedKwh;
    const saldoSpeseVive = nettoEnte - actualResults.costoVivoTotale;
    const recuperoDisponibile = Math.max(0, saldoSpeseVive);
    const coperturaTarget = actualResults.targetRecuperoTotale > 0 ? recuperoDisponibile / actualResults.targetRecuperoTotale : 1;

    return {
      ...actualResults,
      nettoEnte,
      saldoSpeseVive,
      recuperoInfrastrutturaleDisponibile: recuperoDisponibile,
      coperturaTarget,
    };
  }, [analysisDraft.actualNetRevenuePerKwh, analysisDraft.consumedKwh, analysisDraft.overrideEnergyCost, analysisDraft.periodExpectedKwh, selectedTariff]);

  const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateInfrastructureRow = (id, key, value) => {
    setForm((current) => ({
      ...current,
      infrastructureItems: current.infrastructureItems.map((item) => (item.id === id ? { ...item, [key]: value } : item)),
    }));
  };

  const addInfrastructureItem = () => {
    setForm((current) => ({ ...current, infrastructureItems: [...current.infrastructureItems, newInfrastructureItem()] }));
  };

  const removeInfrastructureItem = (id) => {
    setForm((current) => ({
      ...current,
      infrastructureItems: current.infrastructureItems.filter((item) => item.id !== id),
    }));
  };

  const persistEntry = (type) => {
    const entry = {
      id: createId(type === 'simulation' ? 'SIM' : 'TAR'),
      savedAt: new Date().toISOString(),
      referencePeriod: type === 'tariff' ? window.prompt('Mese o trimestre di riferimento (es. 2026-03 o 2026-Q1)') : '',
      title: `${form.kwh} kWh · ${MODE_OPTIONS.find((mode) => mode.id === form.calcMode)?.label || form.calcMode}`,
      formSnapshot: form,
      results,
    };
    if (type === 'tariff' && !entry.referencePeriod) return;
    if (type === 'simulation') setSimulations((current) => [entry, ...current]);
    else setTariffs((current) => [entry, ...current]);
    setMessage(`${type === 'simulation' ? 'Simulazione' : 'Tariffa'} salvata con ID ${entry.id}`);
  };

  const loadSnapshot = (entry) => {
    setForm(migrateDraft(entry.formSnapshot));
    setActivePanel('dashboard');
    setMessage(`Configurazione ${entry.id} caricata`);
  };

  const PanelButton = ({ id, children }) => (
    <button type="button" className={`nav-button ${activePanel === id ? 'active' : ''}`} onClick={() => setActivePanel(id)}>
      {children}
    </button>
  );

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div>
          <p className="eyebrow">Laboratori Nazionali di Frascati</p>
          <h1>Tariffa EV: pareggio spese vive e recupero infrastrutturale</h1>
          <p className="hero-copy">
            Il frontend separa il flusso di gestione costi infrastrutturali dal calcolo tariffario, distingue i kWh
            previsti per il periodo analizzato dai kWh reali simulati e rende trasparente quando esiste una perdita
            reale dell’ente rispetto al semplice mancato recupero infrastrutturale.
          </p>
        </div>
        <div className="hero-badges">
          <span>Tutti i costi netti IVA</span>
          <span>Periodo analizzato dedicato</span>
          <span>Storici e manuale inclusi</span>
        </div>
      </header>

      <nav className="panel-nav">
        <PanelButton id="dashboard">Simulatore</PanelButton>
        <PanelButton id="simulations">Storico simulazioni</PanelButton>
        <PanelButton id="tariffs">Storico tariffe</PanelButton>
        <PanelButton id="analysis">Tool utile ente</PanelButton>
        <PanelButton id="manual">Manuale</PanelButton>
      </nav>

      {message ? <div className="toast">{message}</div> : null}

      {activePanel === 'dashboard' && (
        <>
          <section className="grid-layout dashboard-grid">
            <article className="card">
              <div className="card-title-row">
                <h2>Costi vivi ente</h2>
                <span className="tag">Netto IVA</span>
              </div>
              <div className="field-grid">
                <label>
                  <span>Costo energia netto IVA (€/kWh)</span>
                  <input type="number" step="0.001" value={form.costoEnergia} onChange={(e) => updateField('costoEnergia', Number(e.target.value))} />
                </label>
                <label>
                  <span>Perdite rete (%)</span>
                  <input type="number" value={form.perditeRete} onChange={(e) => updateField('perditeRete', Number(e.target.value))} />
                </label>
                <label>
                  <span>Altri costi vivi unitari (€/kWh)</span>
                  <input type="number" step="0.001" value={form.altriCostiViviUnitari} onChange={(e) => updateField('altriCostiViviUnitari', Number(e.target.value))} />
                </label>
                <label>
                  <span>kWh reali simulati per il prezzo</span>
                  <input type="number" value={form.kwh} onChange={(e) => updateField('kwh', Number(e.target.value))} />
                </label>
              </div>
              <div className="mini-metrics two-col">
                <div>
                  <span>Costo vivo unitario</span>
                  <strong>{formatCurrency(results.costoVivoUnitario)}/kWh</strong>
                </div>
                <div>
                  <span>Costo vivo totale</span>
                  <strong>{formatCurrency(results.costoVivoTotale)}</strong>
                </div>
              </div>
            </article>

            <article className="card">
              <div className="card-title-row">
                <h2>Periodo analizzato</h2>
                <span className="tag alt">Quota target</span>
              </div>
              <div className="field-grid">
                <label>
                  <span>Periodo analizzato · inizio</span>
                  <input type="date" value={form.periodStart} onChange={(e) => updateField('periodStart', e.target.value)} />
                </label>
                <label>
                  <span>Periodo analizzato · fine</span>
                  <input type="date" value={form.periodEnd} onChange={(e) => updateField('periodEnd', e.target.value)} />
                </label>
                <label className="span-full">
                  <span>kWh previsti periodo analizzato</span>
                  <input type="number" value={form.periodExpectedKwh} onChange={(e) => updateField('periodExpectedKwh', Number(e.target.value))} />
                </label>
              </div>
              <p className="helper-copy">
                Questo valore serve solo a distribuire le voci con metodo <strong>per_kwh_previsti</strong>. Non coincide con i kWh reali simulati usati per il prezzo cliente.
              </p>
              <div className="mini-metrics two-col">
                <div>
                  <span>Target recupero infrastrutturale</span>
                  <strong>{formatCurrency(results.targetRecuperoTotale)}</strong>
                </div>
                <div>
                  <span>Target recupero unitario sul caso simulato</span>
                  <strong>{formatCurrency(results.targetRecuperoUnitario)}/kWh</strong>
                </div>
              </div>
            </article>

            <article className="card">
              <div className="card-title-row">
                <h2>Gestione costi infrastrutturali</h2>
                <span className="tag success">Pannello dedicato</span>
              </div>
              <div className="mini-metrics single-column">
                <div>
                  <span>Numero voci</span>
                  <strong>{form.infrastructureItems.length}</strong>
                </div>
                <div>
                  <span>Periodo voce vs periodo analizzato</span>
                  <strong>Separati</strong>
                </div>
              </div>
              <p className="helper-copy">
                Inserisci e modifica le voci infrastrutturali in un pannello dedicato: durata ammortamento voce, metodo di allocazione costi, kWh previsti totali voce e quota del periodo analizzato.
              </p>
              <button type="button" className="primary" onClick={() => setShowInfraManager(true)}>
                Apri gestione voci infrastrutturali
              </button>
            </article>
          </section>

          <section className="grid-layout dashboard-grid second-row">
            <article className="card">
              <div className="card-title-row">
                <h2>Modalità di calcolo prezzo</h2>
                <span className="tag success">3 modalità</span>
              </div>
              <div className="mode-stack">
                {MODE_OPTIONS.map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    className={`mode-button ${form.calcMode === mode.id ? 'active' : ''}`}
                    onClick={() => updateField('calcMode', mode.id)}
                  >
                    <strong>{mode.label}</strong>
                    <span>{mode.description}</span>
                  </button>
                ))}
              </div>
              {form.calcMode === 'manual_gross' && (
                <label>
                  <span>Prezzo lordo manuale (€/kWh)</span>
                  <input type="number" step="0.01" value={form.targetLordoManuale} onChange={(e) => updateField('targetLordoManuale', Number(e.target.value))} />
                </label>
              )}
              <div className="field-grid compact-top">
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
              <div className="action-row">
                <button type="button" className="primary" onClick={() => persistEntry('simulation')}>Salva simulazione</button>
                <button type="button" className="secondary" onClick={() => persistEntry('tariff')}>Salva come tariffa approvata</button>
              </div>
            </article>

            <article className="card span-two">
              <div className="card-title-row">
                <h2>Metriche economiche</h2>
                <span className={`status-pill ${results.health}`}>{healthDescriptions[results.health]}</span>
              </div>
              <div className="metric-grid">
                <div className="metric-highlight">
                  <span>Prezzo finale cliente</span>
                  <strong>{formatCurrency(results.lordoCliente)}</strong>
                  <small>{formatCurrency(results.prezzoUnitarioLordo)}/kWh</small>
                </div>
                <div>
                  <span>Netto ente</span>
                  <strong>{formatCurrency(results.nettoEnte)}</strong>
                </div>
                <div>
                  <span>Costo vivo totale</span>
                  <strong>{formatCurrency(results.costoVivoTotale)}</strong>
                </div>
                <div className={results.saldoSpeseVive < 0 ? 'negative' : 'positive'}>
                  <span>Saldo spese vive ente</span>
                  <strong>{formatCurrency(results.saldoSpeseVive)}</strong>
                </div>
                <div>
                  <span>Recupero infrastrutturale disponibile</span>
                  <strong>{formatCurrency(results.recuperoInfrastrutturaleDisponibile)}</strong>
                </div>
                <div>
                  <span>Target recupero infrastrutturale</span>
                  <strong>{formatCurrency(results.targetRecuperoTotale)}</strong>
                </div>
                <div className={results.coperturaTarget >= 1 ? 'positive' : 'warning'}>
                  <span>Copertura target recupero</span>
                  <strong>{formatNumber(results.coperturaTarget * 100, 1)}%</strong>
                </div>
                <div>
                  <span>JCP netto reale</span>
                  <strong>{formatCurrency(results.nettoJCP)}</strong>
                </div>
              </div>
            </article>
          </section>

          <section className="table-card">
            <div className="table-head">
              <div>
                <p className="eyebrow">Anteprima finale</p>
                <h3>Rendiconto sintetico del caso simulato</h3>
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
                    <th>Saldo spese vive ente</th>
                    <th>Recupero infrastrutturale disponibile</th>
                    <th>Target recupero infrastrutturale</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{formatNumber(form.kwh, 2)} kWh</td>
                    <td>{formatCurrency(results.imponibileTotale)}</td>
                    <td>{formatCurrency(results.nettoEnte)}</td>
                    <td>{formatCurrency(results.lordoJCP)}</td>
                    <td>{formatCurrency(results.saldoSpeseVive)}</td>
                    <td>{formatCurrency(results.recuperoInfrastrutturaleDisponibile)}</td>
                    <td>{formatCurrency(results.targetRecuperoTotale)}</td>
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
                <h3>{entry.title || 'Simulazione salvata'}</h3>
                <p>Salvata il {new Date(entry.savedAt).toLocaleString('it-IT')}</p>
              </div>
              <ul>
                <li>Netto ente: {formatCurrency(entry.results.nettoEnte ?? entry.results.nettoINFN ?? 0)}</li>
                <li>Costo vivo totale: {formatCurrency(entry.results.costoVivoTotale ?? 0)}</li>
                <li>Saldo spese vive ente: {formatCurrency(entry.results.saldoSpeseVive ?? 0)}</li>
              </ul>
              <button type="button" className="secondary" onClick={() => loadSnapshot(entry)}>Riapri simulazione</button>
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
                <li>Prezzo pubblico: {formatCurrency(entry.results.prezzoUnitarioLordo ?? entry.results.prezzoUnitario ?? 0)}/kWh</li>
                <li>Target recupero: {formatCurrency(entry.results.targetRecuperoTotale ?? 0)}</li>
                <li>Copertura target: {formatNumber((entry.results.coperturaTarget ?? 0) * 100, 1)}%</li>
              </ul>
              <button type="button" className="secondary" onClick={() => loadSnapshot(entry)}>Applica tariffa al simulatore</button>
            </article>
          ))}
        </section>
      )}

      {activePanel === 'analysis' && (
        <section className="analysis-layout">
          <article className="card">
            <div className="card-title-row">
              <h2>Tool utile ente</h2>
              <span className="tag">Periodo reale</span>
            </div>
            <div className="field-grid">
              <label>
                <span>Mese iniziale</span>
                <input type="month" value={analysisDraft.startMonth} onChange={(e) => setAnalysisDraft((current) => ({ ...current, startMonth: e.target.value }))} />
              </label>
              <label>
                <span>Mese finale</span>
                <input type="month" value={analysisDraft.endMonth} onChange={(e) => setAnalysisDraft((current) => ({ ...current, endMonth: e.target.value }))} />
              </label>
              <label>
                <span>Tariffa applicata</span>
                <select value={analysisDraft.selectedTariffId} onChange={(e) => setAnalysisDraft((current) => ({ ...current, selectedTariffId: e.target.value }))}>
                  {tariffOptions.map((item) => <option key={item.id} value={item.id}>{item.referencePeriod} · {item.id}</option>)}
                </select>
              </label>
              <label>
                <span>kWh realmente erogati</span>
                <input type="number" value={analysisDraft.consumedKwh} onChange={(e) => setAnalysisDraft((current) => ({ ...current, consumedKwh: Number(e.target.value) }))} />
              </label>
              <label>
                <span>Netto ente effettivo (€/kWh)</span>
                <input type="number" step="0.001" value={analysisDraft.actualNetRevenuePerKwh} onChange={(e) => setAnalysisDraft((current) => ({ ...current, actualNetRevenuePerKwh: Number(e.target.value) }))} />
              </label>
              <label>
                <span>Costo energia aggiornato (€/kWh)</span>
                <input type="number" step="0.001" value={analysisDraft.overrideEnergyCost} onChange={(e) => setAnalysisDraft((current) => ({ ...current, overrideEnergyCost: Number(e.target.value) }))} />
              </label>
              <label className="span-full">
                <span>kWh previsti periodo analizzato</span>
                <input type="number" value={analysisDraft.periodExpectedKwh} onChange={(e) => setAnalysisDraft((current) => ({ ...current, periodExpectedKwh: Number(e.target.value) }))} />
              </label>
            </div>
            <label>
              <span>Note</span>
              <textarea rows="4" value={analysisDraft.notes} onChange={(e) => setAnalysisDraft((current) => ({ ...current, notes: e.target.value }))} />
            </label>
          </article>

          <article className="card">
            <div className="card-title-row">
              <h2>Anteprima fine processo</h2>
              <span className="tag success">Preview</span>
            </div>
            {!analysisPreview || !selectedTariff ? (
              <div className="empty-state">Salva almeno una tariffa approvata per utilizzare il tool.</div>
            ) : (
              <div className="metric-grid single-column">
                <div><span>Netto ente periodo</span><strong>{formatCurrency(analysisPreview.nettoEnte)}</strong></div>
                <div><span>Costo vivo totale</span><strong>{formatCurrency(analysisPreview.costoVivoTotale)}</strong></div>
                <div className={analysisPreview.saldoSpeseVive < 0 ? 'negative' : 'positive'}><span>Saldo spese vive ente</span><strong>{formatCurrency(analysisPreview.saldoSpeseVive)}</strong></div>
                <div><span>Recupero infrastrutturale disponibile</span><strong>{formatCurrency(analysisPreview.recuperoInfrastrutturaleDisponibile)}</strong></div>
                <div><span>Target recupero infrastrutturale</span><strong>{formatCurrency(analysisPreview.targetRecuperoTotale)}</strong></div>
                <div className={analysisPreview.coperturaTarget >= 1 ? 'positive' : 'warning'}><span>Copertura target recupero</span><strong>{formatNumber(analysisPreview.coperturaTarget * 100, 1)}%</strong></div>
              </div>
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
            <li><strong>Costi netti IVA.</strong> Tutti gli importi inseriti dall’utente sono netti IVA. L’IVA viene applicata solo a valle per ottenere il prezzo lordo cliente.</li>
            <li><strong>Distinzione concettuale.</strong> Le spese vive coprono energia, perdite rete e altri costi vivi unitari. Il recupero infrastrutturale è un obiettivo separato: se non viene raggiunto non significa automaticamente perdita reale.</li>
            <li><strong>Perdita reale ente.</strong> Esiste solo quando il <em>Netto ente</em> è inferiore al <em>Costo vivo totale</em>. Per questo la metrica chiave è <em>Saldo spese vive ente = netto ente − costo vivo totale</em>.</li>
            <li><strong>Periodo della voce vs periodo analizzato.</strong> Ogni voce infrastrutturale ha una durata propria (<em>data inizio/data fine</em>) che definisce il periodo della voce. Separatamente il simulatore usa un <em>periodo analizzato</em> per capire quale quota di quella voce allocare nel mese o trimestre osservato.</li>
            <li><strong>Gestione costi infrastrutturali.</strong> Le voci sono gestite in un pannello dedicato con: descrizione, categoria, importo netto, durata ammortamento voce, metodo di allocazione costi, kWh previsti totali voce e note.</li>
            <li><strong>Metodo lineare_tempo.</strong> Quota periodo = importo netto × (giorni sovrapposti tra periodo voce e periodo analizzato / giorni totali della voce).</li>
            <li><strong>Metodo per_kwh_previsti.</strong> Quota unitaria = importo netto / kWh previsti totali voce. Quota periodo = quota unitaria × kWh previsti periodo analizzato. Questo dato non usa i kWh reali simulati per il prezzo.</li>
            <li><strong>Metodo una_tantum.</strong> L’intera voce viene imputata se cade in tutto o in parte nel periodo analizzato; altrimenti la quota del periodo vale zero.</li>
            <li><strong>kWh previsti vs kWh reali.</strong> <em>kWh previsti periodo analizzato</em> servono esclusivamente per ripartire le voci <em>per_kwh_previsti</em>. <em>kWh reali simulati</em> servono invece per stimare il prezzo al cliente e i saldi economici del caso.</li>
            <li><strong>Target recupero infrastrutturale.</strong> È la somma delle quote periodo di tutte le voci calcolate prima del motore tariffario. Il target unitario è poi ottenuto dividendo il target periodo per i kWh reali simulati.</li>
            <li><strong>Motori di prezzo.</strong> Modalità 1: pareggio spese vive. Modalità 2: pareggio spese vive + target recupero. Modalità 3: prezzo lordo manuale da scomporre.</li>
            <li><strong>Formule principali.</strong> Costo vivo unitario = costo energia × (1 + perdite rete) + altri costi vivi unitari. Costo vivo totale = costo vivo unitario × kWh reali. Recupero infrastrutturale disponibile = max(0, netto ente − costo vivo totale). Copertura target recupero = recupero disponibile / target recupero.</li>
            <li><strong>Semaforo.</strong> Rosso se il saldo spese vive è negativo. Giallo se il saldo spese vive è non negativo ma la copertura target è sotto il 100%. Verde se spese vive e target risultano entrambi coperti.</li>
            <li><strong>Esempio pratico.</strong> Un investimento da 10.000 € su 5 anni allocato su Q1 2026 usa il rapporto tra giorni del trimestre e giorni totali della voce. Con metodo per_kwh_previsti, invece, la quota dipende da kWh previsti totali voce e kWh previsti del periodo analizzato.</li>
          </ol>
        </section>
      )}

      {showInfraManager && (
        <div className="modal-backdrop" role="presentation" onClick={() => setShowInfraManager(false)}>
          <section className="modal-card" role="dialog" aria-modal="true" aria-label="Gestione costi infrastrutturali" onClick={(e) => e.stopPropagation()}>
            <div className="card-title-row">
              <div>
                <p className="eyebrow">Pannello dedicato</p>
                <h2>Gestione costi infrastrutturali</h2>
              </div>
              <div className="inline-actions">
                <button type="button" className="secondary" onClick={addInfrastructureItem}>Aggiungi voce</button>
                <button type="button" className="danger" onClick={() => setShowInfraManager(false)}>Chiudi</button>
              </div>
            </div>
            <div className="infrastructure-table">
              <table>
                <thead>
                  <tr>
                    <th>Descrizione</th>
                    <th>Categoria</th>
                    <th>Importo netto IVA (€)</th>
                    <th>Durata ammortamento voce</th>
                    <th>Metodo di allocazione costi</th>
                    <th>KWh previsti totali voce</th>
                    <th>Note</th>
                    <th>Quota periodo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {form.infrastructureItems.map((item, index) => {
                    const previewRow = results.infrastructureRows.find((row) => row.id === item.id) || item;
                    return (
                      <tr key={item.id}>
                        <td><input aria-label={`descrizione-${index}`} value={item.descrizione} onChange={(e) => updateInfrastructureRow(item.id, 'descrizione', e.target.value)} /></td>
                        <td>
                          <select value={item.categoria} onChange={(e) => updateInfrastructureRow(item.id, 'categoria', e.target.value)}>
                            <option value="investimento">investimento</option>
                            <option value="manutenzione">manutenzione</option>
                            <option value="gestione_fissa">gestione_fissa</option>
                            <option value="altro">altro</option>
                          </select>
                        </td>
                        <td><input type="number" step="0.01" value={item.importoNetto} onChange={(e) => updateInfrastructureRow(item.id, 'importoNetto', Number(e.target.value))} /></td>
                        <td>
                          <div className="stacked-inputs">
                            <input type="date" value={item.dataInizio} onChange={(e) => updateInfrastructureRow(item.id, 'dataInizio', e.target.value)} />
                            <input type="date" value={item.dataFine} onChange={(e) => updateInfrastructureRow(item.id, 'dataFine', e.target.value)} />
                          </div>
                        </td>
                        <td>
                          <select value={item.metodoRiparto} onChange={(e) => updateInfrastructureRow(item.id, 'metodoRiparto', e.target.value)}>
                            <option value="lineare_tempo">lineare_tempo</option>
                            <option value="per_kwh_previsti">per_kwh_previsti</option>
                            <option value="una_tantum">una_tantum</option>
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            value={item.kwhPrevistiTotali}
                            disabled={item.metodoRiparto !== 'per_kwh_previsti'}
                            onChange={(e) => updateInfrastructureRow(item.id, 'kwhPrevistiTotali', Number(e.target.value))}
                          />
                        </td>
                        <td><textarea rows="3" value={item.note} onChange={(e) => updateInfrastructureRow(item.id, 'note', e.target.value)} /></td>
                        <td>
                          <strong>{formatCurrency(previewRow.quotaPeriodo || 0)}</strong>
                          <small>{previewRow.metodoRiparto === 'per_kwh_previsti' ? `${formatCurrency(previewRow.quotaUnitariaPeriodo || 0)}/kWh previsto` : `${previewRow.overlappedDays || 0} gg sovrapposti`}</small>
                        </td>
                        <td>
                          <button type="button" className="danger" onClick={() => removeInfrastructureItem(item.id)} disabled={form.infrastructureItems.length === 1}>
                            Elimina voce
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
