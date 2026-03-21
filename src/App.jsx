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
  overrideAmortization: 0,
  notes: '',
};

const MODE_OPTIONS = [
  { id: 'live_only', label: '1 · Pareggio spese vive', description: 'La tariffa copre esclusivamente energia, perdite e altri costi vivi.' },
  {
    id: 'live_plus_amortization',
    label: '2 · Spese vive + recupero ammortamento',
    description: 'La tariffa copre le spese vive e aggiunge una quota distinta di recupero infrastrutturale.',
  },
  { id: 'manual_gross', label: '3 · Prezzo lordo manuale', description: 'Inserisci un prezzo lordo €/kWh e verifica la ripartizione economica.' },
];

const healthDescriptions = {
  red: 'Rosso · il netto ente non copre le spese vive.',
  yellow: 'Giallo · spese vive coperte ma target ammortamento non pienamente coperto.',
  green: 'Verde · spese vive coperte e target ammortamento raggiunto.',
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
    const overrideAmortization = Number(analysisDraft.overrideAmortization) || 0;

    const actualForm = {
      ...baseForm,
      kwh: consumedKwh,
      costoEnergia: overrideEnergyCost > 0 ? overrideEnergyCost : baseForm.costoEnergia,
      quotaAmmortamento: overrideAmortization > 0 ? overrideAmortization : baseForm.quotaAmmortamento,
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
  }, [analysisDraft.actualNetRevenuePerKwh, analysisDraft.consumedKwh, analysisDraft.overrideAmortization, analysisDraft.overrideEnergyCost, selectedTariff]);

  const updateField = (key, value) => setForm((current) => ({ ...current, [key]: value }));

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
          <h1>Simulatore tariffa EV</h1>
          <p className="hero-copy">
            Interfaccia semplificata e più chiara: da una parte le spese vive dell’ente, dall’altra la sola quota di
            ammortamento infrastrutturale, mantenendo semaforo, storici e analisi dell’utile.
          </p>
        </div>
        <div className="hero-badges">
          <span>Layout alleggerito</span>
          <span>Fondo bianco</span>
          <span>Calcolo semplificato</span>
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
                <h2>Costi ente</h2>
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
                  <span>Quota ammortamento (€/kWh)</span>
                  <input type="number" step="0.001" value={form.quotaAmmortamento} onChange={(e) => updateField('quotaAmmortamento', Number(e.target.value))} />
                </label>
                <label className="span-full">
                  <span>kWh del caso simulato</span>
                  <input type="number" value={form.kwh} onChange={(e) => updateField('kwh', Number(e.target.value))} />
                </label>
              </div>
              <div className="mini-metrics three-col">
                <div>
                  <span>Costo vivo unitario</span>
                  <strong>{formatCurrency(results.costoVivoUnitario)}/kWh</strong>
                </div>
                <div>
                  <span>Costo vivo totale</span>
                  <strong>{formatCurrency(results.costoVivoTotale)}</strong>
                </div>
                <div>
                  <span>Target ammortamento</span>
                  <strong>{formatCurrency(results.targetRecuperoTotale)}</strong>
                </div>
              </div>
            </article>

            <article className="card">
              <div className="card-title-row">
                <h2>Modalità di calcolo prezzo</h2>
                <span className="tag alt">3 modalità</span>
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

            <article className="card emphasis-card">
              <div className="card-title-row">
                <h2>Chiarezza del modello</h2>
                <span className="tag success">Sintesi</span>
              </div>
              <ul className="info-list">
                <li>Le spese vive = energia + perdite + altri costi vivi.</li>
                <li>L’ammortamento è una quota separata e non misura una perdita reale.</li>
                <li>La perdita reale esiste solo se il netto ente non copre le spese vive.</li>
              </ul>
            </article>
          </section>

          <section className="card results-card second-row">
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
              <div>
                <span>Target recupero infrastrutturale</span>
                <strong>{formatCurrency(results.targetRecuperoTotale)}</strong>
              </div>
              <div className={results.saldoSpeseVive < 0 ? 'negative' : 'positive'}>
                <span>Saldo spese vive ente</span>
                <strong>{formatCurrency(results.saldoSpeseVive)}</strong>
              </div>
              <div>
                <span>Recupero infrastrutturale disponibile</span>
                <strong>{formatCurrency(results.recuperoInfrastrutturaleDisponibile)}</strong>
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
          </section>

          <section className="table-card second-row">
            <div className="table-head">
              <div>
                <p className="eyebrow">Anteprima finale</p>
                <h3>Rendiconto sintetico</h3>
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
              <span className="tag">Verifica periodo reale</span>
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
                <span>Quota ammortamento aggiornata (€/kWh)</span>
                <input type="number" step="0.001" value={analysisDraft.overrideAmortization} onChange={(e) => setAnalysisDraft((current) => ({ ...current, overrideAmortization: Number(e.target.value) }))} />
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
                <div><span>Target recupero infrastrutturale</span><strong>{formatCurrency(analysisPreview.targetRecuperoTotale)}</strong></div>
                <div className={analysisPreview.saldoSpeseVive < 0 ? 'negative' : 'positive'}><span>Saldo spese vive ente</span><strong>{formatCurrency(analysisPreview.saldoSpeseVive)}</strong></div>
                <div><span>Recupero infrastrutturale disponibile</span><strong>{formatCurrency(analysisPreview.recuperoInfrastrutturaleDisponibile)}</strong></div>
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
            <span className="tag">Formula verificata</span>
          </div>
          <ol>
            <li><strong>Tutti gli importi inseriti sono netti IVA.</strong> Il prezzo lordo al cliente si ottiene solo alla fine applicando l’IVA all’imponibile totale.</li>
            <li><strong>Spese vive.</strong> Costo vivo unitario = costo energia × (1 + perdite rete / 100) + altri costi vivi unitari.</li>
            <li><strong>Costo vivo totale.</strong> Costo vivo totale = costo vivo unitario × kWh.</li>
            <li><strong>Quota ammortamento.</strong> Il recupero infrastrutturale è ora una sola quota unitaria: target recupero infrastrutturale = quota ammortamento × kWh.</li>
            <li><strong>Pareggio spese vive.</strong> Se scegli la modalità 1, il netto ente target coincide con il solo costo vivo totale.</li>
            <li><strong>Pareggio spese vive + ammortamento.</strong> Se scegli la modalità 2, il netto ente target = costo vivo totale + target recupero infrastrutturale.</li>
            <li><strong>Calcolo imponibile.</strong> Con commissione JCP del 6%, il netto ente è il 94% dell’imponibile. Quindi imponibile = netto ente target / (1 − percentuale JCP).</li>
            <li><strong>Prezzo manuale.</strong> In modalità 3, imponibile = (prezzo lordo manuale × kWh) / (1 + IVA).</li>
            <li><strong>Perdita reale dell’ente.</strong> Esiste solo quando <em>Saldo spese vive ente = netto ente − costo vivo totale</em> è negativo.</li>
            <li><strong>Recupero infrastrutturale disponibile.</strong> È definito come max(0, netto ente − costo vivo totale). Solo ciò che resta dopo aver coperto le spese vive può essere letto come recupero ammortamento.</li>
            <li><strong>Copertura target recupero.</strong> Copertura = recupero infrastrutturale disponibile / target recupero infrastrutturale.</li>
            <li><strong>Semaforo.</strong> Rosso se saldo spese vive &lt; 0; giallo se saldo spese vive ≥ 0 ma copertura target &lt; 100%; verde se entrambe le condizioni sono soddisfatte.</li>
            <li><strong>Utile JCP reale.</strong> Lordo JCP = imponibile × percentuale JCP. Netto JCP = lordo JCP − [(imponibile × stripe %) + stripe fisso].</li>
          </ol>
        </section>
      )}
    </div>
  );
}

export default App;
