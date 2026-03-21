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
  notes: '',
};

const MODE_OPTIONS = [
  { id: 'live_only', label: '1 · Pareggio spese vive', description: 'Il prezzo copre solo i costi vivi dell’ente.' },
  {
    id: 'live_plus_infra',
    label: '2 · Pareggio spese vive + target recupero infrastrutturale',
    description: 'Il prezzo include il target infrastrutturale del periodo oltre ai costi vivi.',
  },
  { id: 'manual_gross', label: '3 · Prezzo lordo manuale', description: 'Inserisci direttamente il prezzo lordo €/kWh.' },
];

const newInfrastructureItem = () => ({
  id: createId('infra'),
  descrizione: '',
  categoria: 'investimento',
  importoNetto: 0,
  dataInizio: '',
  dataFine: '',
  metodoRiparto: 'lineare_tempo',
  kwhPrevistiPeriodo: 0,
  note: '',
});

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

  const tariffOptions = useMemo(() => {
    return tariffs.filter((tariff) => {
      if (!analysisDraft.startMonth && !analysisDraft.endMonth) return true;
      const ref = tariff.referencePeriod;
      if (analysisDraft.startMonth && ref < analysisDraft.startMonth) return false;
      if (analysisDraft.endMonth && ref > analysisDraft.endMonth) return false;
      return true;
    });
  }, [analysisDraft.endMonth, analysisDraft.startMonth, tariffs]);

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
    const actualForm = {
      ...baseForm,
      kwh: consumedKwh,
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
  }, [analysisDraft.actualNetRevenuePerKwh, analysisDraft.consumedKwh, analysisDraft.overrideEnergyCost, selectedTariff]);

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

  const healthLabel = {
    red: 'Rosso · il netto ente non copre le spese vive',
    yellow: 'Giallo · spese vive coperte ma target infrastrutturale non pienamente coperto',
    green: 'Verde · spese vive coperte e target recupero raggiunto',
  }[results.health];

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
          <h1>Simulatore tariffa EV · spese vive vs recupero infrastrutturale</h1>
          <p className="hero-copy">
            Frontend React/Vite rifattorizzato per separare chiaramente la copertura delle spese vive dell’ente dal
            recupero dei costi infrastrutturali, senza backend e con salvataggi persistenti nel browser.
          </p>
        </div>
        <div className="hero-badges">
          <span>Tutti i costi netti IVA</span>
          <span>Salvataggi locali</span>
          <span>Semaforo di copertura</span>
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
                  <span>kWh del caso simulato</span>
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

            <article className="card span-two">
              <div className="card-title-row">
                <h2>Voci infrastrutturali</h2>
                <div className="inline-actions">
                  <span className="tag alt">Target periodo</span>
                  <button type="button" className="secondary" onClick={addInfrastructureItem}>Aggiungi voce</button>
                </div>
              </div>
              <div className="period-grid">
                <label>
                  <span>Periodo analizzato · inizio</span>
                  <input type="date" value={form.periodStart} onChange={(e) => updateField('periodStart', e.target.value)} />
                </label>
                <label>
                  <span>Periodo analizzato · fine</span>
                  <input type="date" value={form.periodEnd} onChange={(e) => updateField('periodEnd', e.target.value)} />
                </label>
              </div>
              <div className="infrastructure-table">
                <table>
                  <thead>
                    <tr>
                      <th>Descrizione</th>
                      <th>Categoria</th>
                      <th>Importo netto</th>
                      <th>Inizio</th>
                      <th>Fine</th>
                      <th>Metodo riparto</th>
                      <th>kWh previsti</th>
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
                          <td><input type="date" value={item.dataInizio} onChange={(e) => updateInfrastructureRow(item.id, 'dataInizio', e.target.value)} /></td>
                          <td><input type="date" value={item.dataFine} onChange={(e) => updateInfrastructureRow(item.id, 'dataFine', e.target.value)} /></td>
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
                              value={item.kwhPrevistiPeriodo}
                              disabled={item.metodoRiparto !== 'per_kwh_previsti'}
                              onChange={(e) => updateInfrastructureRow(item.id, 'kwhPrevistiPeriodo', Number(e.target.value))}
                            />
                          </td>
                          <td><input value={item.note} onChange={(e) => updateInfrastructureRow(item.id, 'note', e.target.value)} /></td>
                          <td>{formatCurrency(previewRow.quotaPeriodo || 0)}</td>
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
              <div className="mini-metrics two-col">
                <div>
                  <span>Target recupero infrastrutturale</span>
                  <strong>{formatCurrency(results.targetRecuperoTotale)}</strong>
                </div>
                <div>
                  <span>Target recupero unitario</span>
                  <strong>{formatCurrency(results.targetRecuperoUnitario)}/kWh</strong>
                </div>
              </div>
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

            <article className="card results-card span-two">
              <div className="card-title-row">
                <h2>Metriche economiche</h2>
                <span className={`status-pill ${results.health}`}>{healthLabel}</span>
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
                <h3>Distinzione tra perdita reale e recupero infrastrutturale</h3>
              </div>
              <span>{new Date().toLocaleString('it-IT')}</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Consumo</th>
                    <th>Netto ente</th>
                    <th>Costo vivo totale</th>
                    <th>Saldo spese vive ente</th>
                    <th>Recupero infrastrutturale disponibile</th>
                    <th>Target recupero infrastrutturale</th>
                    <th>Copertura target recupero</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{formatNumber(form.kwh, 2)} kWh</td>
                    <td>{formatCurrency(results.nettoEnte)}</td>
                    <td>{formatCurrency(results.costoVivoTotale)}</td>
                    <td>{formatCurrency(results.saldoSpeseVive)}</td>
                    <td>{formatCurrency(results.recuperoInfrastrutturaleDisponibile)}</td>
                    <td>{formatCurrency(results.targetRecuperoTotale)}</td>
                    <td>{formatNumber(results.coperturaTarget * 100, 1)}%</td>
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
            </div>
            <label>
              <span>Note</span>
              <textarea rows="4" value={analysisDraft.notes} onChange={(e) => setAnalysisDraft((current) => ({ ...current, notes: e.target.value }))} />
            </label>
          </article>

          <article className="card results-card">
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
            <span className="tag">Nuove formule</span>
          </div>
          <ol>
            <li><strong>Principio base.</strong> Tutti i costi inseriti sono netti IVA. L’IVA si applica solo alla fine per ottenere il prezzo al cliente.</li>
            <li><strong>Costi vivi ente.</strong> Costo vivo unitario = costo energia × (1 + perdite rete) + altri costi vivi unitari. Costo vivo totale = costo vivo unitario × kWh.</li>
            <li><strong>Perdita reale.</strong> L’ente è realmente in perdita solo quando il netto ente è inferiore al costo vivo totale. Questa metrica è mostrata come <em>Saldo spese vive ente</em>.</li>
            <li><strong>Voci infrastrutturali.</strong> Gli importi infrastrutturali sono separati in una tabella con categoria, periodo, metodo di riparto e note, per non confondere spese vive e recupero di investimenti/manutenzioni.</li>
            <li><strong>Riparto lineare_tempo.</strong> Quota periodo = importo netto × giorni sovrapposti al periodo / giorni totali della voce.</li>
            <li><strong>Riparto per_kwh_previsti.</strong> Quota unitaria = importo netto / kWh previsti. Quota periodo = quota unitaria × kWh analizzati.</li>
            <li><strong>Riparto una_tantum.</strong> La quota intera viene imputata al periodo solo se la voce ricade nel periodo selezionato, altrimenti vale zero.</li>
            <li><strong>Target recupero infrastrutturale.</strong> È la somma delle quote di periodo di tutte le voci infrastrutturali e rappresenta un obiettivo distinto dal pareggio delle spese vive.</li>
            <li><strong>Modalità prezzo.</strong> 1) Pareggio spese vive. 2) Pareggio spese vive + target recupero infrastrutturale. 3) Prezzo lordo manuale.</li>
            <li><strong>Recupero infrastrutturale disponibile.</strong> È definito come max(0, netto ente - costo vivo totale): quindi solo l’eccedenza dopo il pareggio delle spese vive può essere letta come recupero infrastrutturale.</li>
            <li><strong>Copertura target recupero.</strong> Copertura = recupero disponibile / target recupero. Semaforo rosso se saldo spese vive &lt; 0; giallo se il saldo è positivo ma la copertura &lt; 100%; verde se entrambe le condizioni sono soddisfatte.</li>
          </ol>
        </section>
      )}
    </div>
  );
}

export default App;
