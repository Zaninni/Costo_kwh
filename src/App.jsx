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
  overrideSessions: 0,
  notes: '',
};

const MODE_OPTIONS = [
  { id: 'live_only', label: '1 · Solo spese vive', description: 'Copre solo i costi vivi.' },
  { id: 'live_plus_amortization', label: '2 · Spese vive + quota ammortamento', description: 'Aggiunge la quota infrastrutturale.' },
  { id: 'manual_gross', label: '3 · Prezzo lordo manuale', description: 'Verifica un prezzo inserito a mano.' },
];

const healthDescriptions = {
  red: 'Rosso · il netto ente non copre le spese vive.',
  yellow: 'Giallo · spese vive coperte, ma quota ammortamento non interamente coperta.',
  green: 'Verde · spese vive coperte e quota ammortamento pienamente coperta.',
};

function HelpButton({ title, children }) {
  return (
    <details className="help-popover">
      <summary className="help-trigger" aria-label={`Apri aiuto: ${title}`}>?</summary>
      <div className="help-panel">
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
    </details>
  );
}

function buildSpreadsheetCsv(form, results) {
  const quotaEnte = 1 - (Number(form.percentualeJCP) || 0) / 100;
  const ivaFactor = 1 + (Number(form.iva) || 0) / 100;
  const rows = [
    ['Voce', 'Valore', 'Formula Excel / Nota'],
    ['Costo energia €/kWh', form.costoEnergia, 'input'],
    ['Perdite rete %', form.perditeRete, 'input'],
    ['Altri costi vivi €/kWh', form.altriCostiViviUnitari, 'input'],
    ['Quota ammortamento €/kWh', form.quotaAmmortamento, 'input'],
    ['Numero ricariche', form.numeroRicariche, 'input'],
    ['kWh simulati', form.kwh, 'input'],
    ['Commissione JCP %', form.percentualeJCP, 'input'],
    ['Stripe %', form.stripePerc, 'input'],
    ['Stripe fisso € per ricarica', form.stripeFisso, 'input'],
    ['IVA %', form.iva, 'input'],
    ['Costo vivo unitario', results.costoVivoUnitario, '=CostoEnergia*(1+PerditeRete/100)+AltriCostiVivi'],
    ['Costo vivo totale', results.costoVivoTotale, '=CostoVivoUnitario*kWh'],
    ['Quota ammortamento totale', results.targetRecuperoTotale, '=QuotaAmmortamento*kWh'],
    ['Netto ente target', '', '=CostoVivoTotale oppure CostoVivoTotale+QuotaAmmortamentoTotale in base alla modalità'],
    ['Quota ente su imponibile', quotaEnte, '=1-JCP%'],
    ['Imponibile totale', results.imponibileTotale, '=NettoEnteTarget/QuotaEnte oppure =(PrezzoLordoManuale*kWh)/(1+IVA)'],
    ['Lordo cliente', results.lordoCliente, '=ImponibileTotale*(1+IVA)'],
    ['Netto ente', results.nettoEnte, '=ImponibileTotale*QuotaEnte'],
    ['Lordo JCP', results.lordoJCP, '=ImponibileTotale*JCP%'],
    ['Stripe fisso totale', results.stripeFixedTotal, '=NumeroRicariche*StripeFisso'],
    ['Costo Stripe totale', results.stripeCost, '=ImponibileTotale*Stripe%+StripeFissoTotale'],
    ['Netto JCP', results.nettoJCP, '=LordoJCP-CostoStripeTotale'],
    ['Saldo spese vive ente', results.saldoSpeseVive, '=NettoEnte-CostoVivoTotale'],
    ['Quota ammortamento coperta', results.recuperoInfrastrutturaleDisponibile, '=MAX(0;NettoEnte-CostoVivoTotale)'],
    ['Copertura quota ammortamento', results.coperturaTarget, '=QuotaAmmortamentoCoperta/QuotaAmmortamentoTotale'],
    ['Note', '', `Modalità attiva: ${MODE_OPTIONS.find((mode) => mode.id === form.calcMode)?.label || form.calcMode}; IVA factor ${ivaFactor}`],
  ];

  return rows
    .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\n');
}

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
    const overrideSessions = Number(analysisDraft.overrideSessions) || 0;

    const actualForm = {
      ...baseForm,
      kwh: consumedKwh,
      costoEnergia: overrideEnergyCost > 0 ? overrideEnergyCost : baseForm.costoEnergia,
      quotaAmmortamento: overrideAmortization > 0 ? overrideAmortization : baseForm.quotaAmmortamento,
      numeroRicariche: overrideSessions > 0 ? overrideSessions : baseForm.numeroRicariche,
    };

    const actualResults = calculateResults(actualForm);
    const netPerKwh = actualNetRevenuePerKwh > 0 ? actualNetRevenuePerKwh : actualResults.prezzoUnitarioNettoEnte;
    const nettoEnte = netPerKwh * consumedKwh;
    const saldoSpeseVive = nettoEnte - actualResults.costoVivoTotale;
    const quotaAmmortamentoCoperta = Math.max(0, saldoSpeseVive);
    const coperturaTarget = actualResults.targetRecuperoTotale > 0 ? quotaAmmortamentoCoperta / actualResults.targetRecuperoTotale : 1;

    return {
      ...actualResults,
      nettoEnte,
      saldoSpeseVive,
      recuperoInfrastrutturaleDisponibile: quotaAmmortamentoCoperta,
      coperturaTarget,
    };
  }, [analysisDraft.actualNetRevenuePerKwh, analysisDraft.consumedKwh, analysisDraft.overrideAmortization, analysisDraft.overrideEnergyCost, analysisDraft.overrideSessions, selectedTariff]);

  const spreadsheetHref = useMemo(() => {
    const csv = buildSpreadsheetCsv(form, results);
    return `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  }, [form, results]);

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
          <h1>Tariffe EV LNF</h1>
          <p className="hero-copy">Simulazione e calcolo delle tariffe EV con ripartizione chiara tra spese vive dell’ente, quota ammortamento e margini del gestore.</p>
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
                <HelpButton title="Costi ente">Inserisci qui i costi vivi per kWh, la quota ammortamento per kWh, i kWh totali simulati e il numero di ricariche usato per moltiplicare il costo fisso Stripe.</HelpButton>
              </div>
              <div className="field-grid">
                <label><span>Costo energia netto IVA (€/kWh)</span><input type="number" step="0.001" value={form.costoEnergia} onChange={(e) => updateField('costoEnergia', Number(e.target.value))} /></label>
                <label><span>Perdite rete (%)</span><input type="number" value={form.perditeRete} onChange={(e) => updateField('perditeRete', Number(e.target.value))} /></label>
                <label><span>Altri costi vivi unitari (€/kWh)</span><input type="number" step="0.001" value={form.altriCostiViviUnitari} onChange={(e) => updateField('altriCostiViviUnitari', Number(e.target.value))} /></label>
                <label><span>Quota ammortamento (€/kWh)</span><input type="number" step="0.001" value={form.quotaAmmortamento} onChange={(e) => updateField('quotaAmmortamento', Number(e.target.value))} /></label>
                <label><span>kWh del caso simulato</span><input type="number" value={form.kwh} onChange={(e) => updateField('kwh', Number(e.target.value))} /></label>
                <label><span>Numero di ricariche</span><input type="number" min="1" value={form.numeroRicariche} onChange={(e) => updateField('numeroRicariche', Number(e.target.value))} /></label>
              </div>
              <div className="mini-metrics three-col">
                <div><span>Costo vivo unitario</span><strong>{formatCurrency(results.costoVivoUnitario)}/kWh</strong></div>
                <div><span>Costo vivo totale</span><strong>{formatCurrency(results.costoVivoTotale)}</strong></div>
                <div><span>Quota ammortamento totale</span><strong>{formatCurrency(results.targetRecuperoTotale)}</strong></div>
              </div>
            </article>

            <article className="card">
              <div className="card-title-row">
                <h2>Modalità di calcolo prezzo</h2>
                <HelpButton title="Modalità di calcolo">Scegli se vuoi coprire solo le spese vive, includere anche la quota ammortamento oppure verificare un prezzo lordo già deciso.</HelpButton>
              </div>
              <div className="mode-stack">
                {MODE_OPTIONS.map((mode) => (
                  <button key={mode.id} type="button" className={`mode-button ${form.calcMode === mode.id ? 'active' : ''}`} onClick={() => updateField('calcMode', mode.id)}>
                    <strong>{mode.label}</strong>
                    <span>{mode.description}</span>
                  </button>
                ))}
              </div>
              {form.calcMode === 'manual_gross' && (
                <label><span>Prezzo lordo manuale (€/kWh)</span><input type="number" step="0.01" value={form.targetLordoManuale} onChange={(e) => updateField('targetLordoManuale', Number(e.target.value))} /></label>
              )}
            </article>

            <article className="card">
              <div className="card-title-row">
                <h2>Impostazioni gestore e IVA</h2>
                <HelpButton title="Impostazioni gestore e IVA">Qui imposti i parametri lato gestore: commissione JCP, commissioni Stripe e aliquota IVA. Questi valori influenzano la ripartizione economica ma non la scelta della modalità.</HelpButton>
              </div>
              <div className="field-grid">
                <label><span>Commissione JCP (%)</span><input type="number" value={form.percentualeJCP} onChange={(e) => updateField('percentualeJCP', Number(e.target.value))} /></label>
                <label><span>IVA (%)</span><input type="number" value={form.iva} onChange={(e) => updateField('iva', Number(e.target.value))} /></label>
                <label><span>Stripe %</span><input type="number" step="0.1" value={form.stripePerc} onChange={(e) => updateField('stripePerc', Number(e.target.value))} /></label>
                <label><span>Stripe fisso per ricarica (€)</span><input type="number" step="0.01" value={form.stripeFisso} onChange={(e) => updateField('stripeFisso', Number(e.target.value))} /></label>
              </div>
              <div className="action-row action-row-split">
                <button type="button" className="primary" onClick={() => persistEntry('simulation')}>Salva simulazione</button>
                <button type="button" className="secondary" onClick={() => persistEntry('tariff')}>Salva come tariffa approvata</button>
              </div>
            </article>
          </section>

          <section className="card results-card second-row">
            <div className="card-title-row">
              <h2>Metriche economiche</h2>
              <div className="title-actions">
                <span className={`status-pill ${results.health}`}>{healthDescriptions[results.health]}</span>
                <HelpButton title="Metriche economiche">Le spese vive dicono se l’ente perde davvero. La quota ammortamento totale è l’obiettivo infrastrutturale del caso simulato. La quota ammortamento coperta è solo la parte che resta dopo avere coperto tutte le spese vive.</HelpButton>
              </div>
            </div>
            <div className="metric-grid">
              <div className="metric-highlight"><span>Prezzo finale cliente</span><strong>{formatCurrency(results.lordoCliente)}</strong><small>{formatCurrency(results.prezzoUnitarioLordo)}/kWh</small></div>
              <div><span>Netto ente</span><strong>{formatCurrency(results.nettoEnte)}</strong></div>
              <div><span>Spese vive totali ente</span><strong>{formatCurrency(results.costoVivoTotale)}</strong></div>
              <div><span>Quota ammortamento totale</span><strong>{formatCurrency(results.targetRecuperoTotale)}</strong></div>
              <div className={results.saldoSpeseVive < 0 ? 'negative' : 'positive'}><span>Saldo spese vive ente</span><strong>{formatCurrency(results.saldoSpeseVive)}</strong></div>
              <div><span>Quota ammortamento coperta</span><strong>{formatCurrency(results.recuperoInfrastrutturaleDisponibile)}</strong></div>
              <div className={results.coperturaTarget >= 1 ? 'positive' : 'warning'}><span>Copertura quota ammortamento</span><strong>{formatNumber(results.coperturaTarget * 100, 1)}%</strong></div>
              <div><span>JCP netto reale</span><strong>{formatCurrency(results.nettoJCP)}</strong></div>
            </div>
          </section>

          <section className="table-card second-row">
            <div className="table-head">
              <div>
                <h3>Dati di sintesi simulazione</h3>
              </div>
              <HelpButton title="Dati di sintesi simulazione">Questa tabella riassume i dati principali del caso simulato, compreso il numero di ricariche utilizzato per il costo fisso Stripe.</HelpButton>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Consumo</th>
                    <th>Numero ricariche</th>
                    <th>Incasso CPO</th>
                    <th>Costo SubCPO</th>
                    <th>Utile CPO</th>
                    <th>Saldo spese vive ente</th>
                    <th>Quota ammortamento coperta</th>
                    <th>Quota ammortamento totale</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{formatNumber(form.kwh, 2)} kWh</td>
                    <td>{form.numeroRicariche}</td>
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
              <div><h3>{entry.title || 'Simulazione salvata'}</h3><p>{entry.id} · {new Date(entry.savedAt).toLocaleString('it-IT')}</p></div>
              <ul>
                <li>Netto ente: {formatCurrency(entry.results.nettoEnte ?? 0)}</li>
                <li>Spese vive totali ente: {formatCurrency(entry.results.costoVivoTotale ?? 0)}</li>
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
              <div><h3>Tariffa {entry.referencePeriod}</h3><p>{entry.id} · {new Date(entry.savedAt).toLocaleString('it-IT')}</p></div>
              <ul>
                <li>Prezzo pubblico: {formatCurrency(entry.results.prezzoUnitarioLordo ?? 0)}/kWh</li>
                <li>Quota ammortamento totale: {formatCurrency(entry.results.targetRecuperoTotale ?? 0)}</li>
                <li>Copertura quota ammortamento: {formatNumber((entry.results.coperturaTarget ?? 0) * 100, 1)}%</li>
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
              <HelpButton title="Tool utile ente">Seleziona una tariffa approvata, inserisci i dati reali del periodo e verifica quanta quota ammortamento è stata effettivamente coperta dopo le spese vive.</HelpButton>
            </div>
            <div className="field-grid">
              <label><span>Mese iniziale</span><input type="month" value={analysisDraft.startMonth} onChange={(e) => setAnalysisDraft((current) => ({ ...current, startMonth: e.target.value }))} /></label>
              <label><span>Mese finale</span><input type="month" value={analysisDraft.endMonth} onChange={(e) => setAnalysisDraft((current) => ({ ...current, endMonth: e.target.value }))} /></label>
              <label><span>Tariffa applicata</span><select value={analysisDraft.selectedTariffId} onChange={(e) => setAnalysisDraft((current) => ({ ...current, selectedTariffId: e.target.value }))}>{tariffOptions.map((item) => <option key={item.id} value={item.id}>{item.referencePeriod} · {item.id}</option>)}</select></label>
              <label><span>kWh realmente erogati</span><input type="number" value={analysisDraft.consumedKwh} onChange={(e) => setAnalysisDraft((current) => ({ ...current, consumedKwh: Number(e.target.value) }))} /></label>
              <label><span>Netto ente effettivo (€/kWh)</span><input type="number" step="0.001" value={analysisDraft.actualNetRevenuePerKwh} onChange={(e) => setAnalysisDraft((current) => ({ ...current, actualNetRevenuePerKwh: Number(e.target.value) }))} /></label>
              <label><span>Costo energia aggiornato (€/kWh)</span><input type="number" step="0.001" value={analysisDraft.overrideEnergyCost} onChange={(e) => setAnalysisDraft((current) => ({ ...current, overrideEnergyCost: Number(e.target.value) }))} /></label>
              <label><span>Quota ammortamento aggiornata (€/kWh)</span><input type="number" step="0.001" value={analysisDraft.overrideAmortization} onChange={(e) => setAnalysisDraft((current) => ({ ...current, overrideAmortization: Number(e.target.value) }))} /></label>
              <label><span>Numero ricariche reale</span><input type="number" min="1" value={analysisDraft.overrideSessions} onChange={(e) => setAnalysisDraft((current) => ({ ...current, overrideSessions: Number(e.target.value) }))} /></label>
            </div>
            <label><span>Note</span><textarea rows="4" value={analysisDraft.notes} onChange={(e) => setAnalysisDraft((current) => ({ ...current, notes: e.target.value }))} /></label>
          </article>

          <article className="card">
            <div className="card-title-row">
              <h2>Anteprima fine processo</h2>
              <HelpButton title="Anteprima fine processo">Questi valori mostrano il risultato economico reale del periodo analizzato usando i dati corretti che hai inserito.</HelpButton>
            </div>
            {!analysisPreview || !selectedTariff ? (
              <div className="empty-state">Salva almeno una tariffa approvata per utilizzare il tool.</div>
            ) : (
              <div className="metric-grid single-column">
                <div><span>Netto ente periodo</span><strong>{formatCurrency(analysisPreview.nettoEnte)}</strong></div>
                <div><span>Spese vive totali ente</span><strong>{formatCurrency(analysisPreview.costoVivoTotale)}</strong></div>
                <div><span>Quota ammortamento totale</span><strong>{formatCurrency(analysisPreview.targetRecuperoTotale)}</strong></div>
                <div className={analysisPreview.saldoSpeseVive < 0 ? 'negative' : 'positive'}><span>Saldo spese vive ente</span><strong>{formatCurrency(analysisPreview.saldoSpeseVive)}</strong></div>
                <div><span>Quota ammortamento coperta</span><strong>{formatCurrency(analysisPreview.recuperoInfrastrutturaleDisponibile)}</strong></div>
                <div className={analysisPreview.coperturaTarget >= 1 ? 'positive' : 'warning'}><span>Copertura quota ammortamento</span><strong>{formatNumber(analysisPreview.coperturaTarget * 100, 1)}%</strong></div>
              </div>
            )}
          </article>
        </section>
      )}

      {activePanel === 'manual' && (
        <section className="manual card">
          <div className="card-title-row">
            <h2>Manuale operativo</h2>
            <a className="download-button" href={spreadsheetHref} download="tariffe-ev-lnf-formule.csv">⬇︎ Scarica foglio di calcolo</a>
          </div>
          <ol>
            <li><strong>Tutti gli importi inseriti sono netti IVA.</strong> Il prezzo lordo al cliente si ottiene solo alla fine applicando l’IVA all’imponibile totale.</li>
            <li><strong>Spese vive ente.</strong> Costo vivo unitario = costo energia × (1 + perdite rete / 100) + altri costi vivi unitari.</li>
            <li><strong>Spese vive totali ente.</strong> Spese vive totali = costo vivo unitario × kWh simulati.</li>
            <li><strong>Quota ammortamento totale.</strong> Quota ammortamento totale = quota ammortamento × kWh simulati.</li>
            <li><strong>Modalità 1.</strong> Il netto ente target coincide con le sole spese vive totali.</li>
            <li><strong>Modalità 2.</strong> Il netto ente target coincide con spese vive totali + quota ammortamento totale.</li>
            <li><strong>Modalità 3.</strong> L’app scompone un prezzo lordo già fissato per capire come si ripartiscono i valori netti.</li>
            <li><strong>Numero di ricariche.</strong> Il costo fisso Stripe viene calcolato come 0,30 € × numero di ricariche, non in funzione dei kWh.</li>
            <li><strong>Imponibile totale.</strong> Se non sei in modalità manuale: imponibile = netto ente target / (1 − commissione JCP). In modalità manuale: imponibile = (prezzo lordo × kWh) / (1 + IVA).</li>
            <li><strong>Saldo spese vive ente.</strong> È il vero indicatore di perdita: saldo spese vive = netto ente − spese vive totali ente.</li>
            <li><strong>Quota ammortamento coperta.</strong> È solo la parte che resta dopo aver coperto le spese vive: max(0, netto ente − spese vive totali ente).</li>
            <li><strong>Copertura quota ammortamento.</strong> Copertura = quota ammortamento coperta / quota ammortamento totale.</li>
            <li><strong>Utile JCP reale.</strong> Netto JCP = lordo JCP − [imponibile × Stripe % + (Stripe fisso × numero ricariche)].</li>
          </ol>
        </section>
      )}
    </div>
  );
}

export default App;
