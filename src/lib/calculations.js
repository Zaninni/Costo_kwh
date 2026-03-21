export const DEFAULT_INFRA_ITEMS = [
  {
    id: 'infra-1',
    descrizione: 'Ammortamento infrastruttura base',
    categoria: 'investimento',
    importoNetto: 1200,
    dataInizio: '2026-01-01',
    dataFine: '2026-12-31',
    metodoRiparto: 'lineare_tempo',
    kwhPrevistiTotali: 0,
    note: 'Voce modificabile dall’utente',
  },
];

export const DEFAULT_FORM = {
  costoEnergia: 0.22,
  perditeRete: 5,
  altriCostiViviUnitari: 0,
  percentualeJCP: 6,
  stripePerc: 3,
  stripeFisso: 0.3,
  iva: 22,
  kwh: 30,
  targetLordoManuale: 0.35,
  calcMode: 'live_plus_infra',
  periodStart: '2026-01-01',
  periodEnd: '2026-01-31',
  periodExpectedKwh: 400,
  infrastructureItems: DEFAULT_INFRA_ITEMS,
};

const MS_IN_DAY = 1000 * 60 * 60 * 24;

export const createId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export const formatCurrency = (value) =>
  new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number.isFinite(value) ? value : 0);

export const formatNumber = (value, digits = 3) =>
  new Intl.NumberFormat('it-IT', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    Number.isFinite(value) ? value : 0,
  );

export function safeParse(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function asDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clampNonNegative(value) {
  return Math.max(Number(value) || 0, 0);
}

function daysBetweenInclusive(start, end) {
  const startDate = asDate(start);
  const endDate = asDate(end);
  if (!startDate || !endDate || endDate < startDate) return 0;
  return Math.floor((endDate - startDate) / MS_IN_DAY) + 1;
}

function overlapDays(startA, endA, startB, endB) {
  const aStart = asDate(startA);
  const aEnd = asDate(endA);
  const bStart = asDate(startB);
  const bEnd = asDate(endB);
  if (!aStart || !aEnd || !bStart || !bEnd) return 0;
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  if (end < start) return 0;
  return Math.floor((end - start) / MS_IN_DAY) + 1;
}

function fallsInPeriod(item, periodStart, periodEnd) {
  const start = asDate(item.dataInizio);
  const end = asDate(item.dataFine || item.dataInizio);
  const pStart = asDate(periodStart);
  const pEnd = asDate(periodEnd);
  if (!start || !end || !pStart || !pEnd) return false;
  return !(end < pStart || start > pEnd);
}

export function migrateDraft(raw) {
  const merged = {
    ...DEFAULT_FORM,
    ...raw,
  };

  const legacyInfra = [];
  if (Number(raw?.ammortamento) > 0) {
    legacyInfra.push({
      id: createId('infra'),
      descrizione: 'Ammortamento legacy',
      categoria: 'investimento',
      importoNetto: Number(raw.ammortamento) * Math.max(Number(raw.kwh) || DEFAULT_FORM.kwh, 1),
      dataInizio: merged.periodStart,
      dataFine: merged.periodEnd,
      metodoRiparto: 'per_kwh_previsti',
      kwhPrevistiTotali: Math.max(Number(raw.kwh) || DEFAULT_FORM.kwh, 1),
      note: 'Migrato dal precedente campo ammortamento unitario',
    });
  }
  if (Number(raw?.quotaGestione) > 0) {
    legacyInfra.push({
      id: createId('infra'),
      descrizione: 'Gestione legacy',
      categoria: 'gestione_fissa',
      importoNetto: Number(raw.quotaGestione) * Math.max(Number(raw.kwh) || DEFAULT_FORM.kwh, 1),
      dataInizio: merged.periodStart,
      dataFine: merged.periodEnd,
      metodoRiparto: 'per_kwh_previsti',
      kwhPrevistiTotali: Math.max(Number(raw.kwh) || DEFAULT_FORM.kwh, 1),
      note: 'Migrato dal precedente campo quota gestione unitaria',
    });
  }

  const incomingInfrastructure = Array.isArray(raw?.infrastructureItems) && raw.infrastructureItems.length
    ? raw.infrastructureItems
    : legacyInfra.length
      ? legacyInfra
      : DEFAULT_INFRA_ITEMS;

  merged.infrastructureItems = incomingInfrastructure.map((item, index) => ({
    id: item.id || `infra-${index + 1}`,
    descrizione: item.descrizione || '',
    categoria: item.categoria || 'investimento',
    importoNetto: clampNonNegative(item.importoNetto),
    dataInizio: item.dataInizio || merged.periodStart,
    dataFine: item.dataFine || item.dataInizio || merged.periodEnd,
    metodoRiparto: item.metodoRiparto || 'lineare_tempo',
    kwhPrevistiTotali: clampNonNegative(item.kwhPrevistiTotali ?? item.kwhPrevistiPeriodo),
    note: item.note || '',
  }));

  merged.periodExpectedKwh = clampNonNegative(raw?.periodExpectedKwh ?? raw?.kwhPrevistiPeriodo ?? DEFAULT_FORM.periodExpectedKwh);

  return merged;
}

export function calculateInfrastructureTargets(items, periodStart, periodEnd, simulatedKwh, periodExpectedKwh) {
  const realKwh = clampNonNegative(simulatedKwh);
  const plannedPeriodKwh = clampNonNegative(periodExpectedKwh);

  const rows = (items || []).map((item) => {
    const importoNetto = clampNonNegative(item.importoNetto);
    const totalDays = daysBetweenInclusive(item.dataInizio, item.dataFine || item.dataInizio);
    const overlappedDays = overlapDays(item.dataInizio, item.dataFine || item.dataInizio, periodStart, periodEnd);
    const kwhPrevistiTotali = clampNonNegative(item.kwhPrevistiTotali);
    let quotaPeriodo = 0;
    let quotaUnitariaPeriodo = 0;

    if (item.metodoRiparto === 'lineare_tempo') {
      quotaPeriodo = totalDays > 0 ? (importoNetto * overlappedDays) / totalDays : 0;
    } else if (item.metodoRiparto === 'per_kwh_previsti') {
      quotaUnitariaPeriodo = kwhPrevistiTotali > 0 ? importoNetto / kwhPrevistiTotali : 0;
      quotaPeriodo = quotaUnitariaPeriodo * plannedPeriodKwh;
    } else if (item.metodoRiparto === 'una_tantum') {
      quotaPeriodo = fallsInPeriod(item, periodStart, periodEnd) ? importoNetto : 0;
    }

    const quotaUnitSimulata = realKwh > 0 ? quotaPeriodo / realKwh : 0;

    return {
      ...item,
      quotaPeriodo,
      quotaUnitariaPeriodo,
      quotaUnitSimulata,
      overlappedDays,
      totalDays,
      kwhPrevistiTotali,
    };
  });

  const targetRecuperoTotale = rows.reduce((sum, row) => sum + row.quotaPeriodo, 0);
  const targetRecuperoUnitario = realKwh > 0 ? targetRecuperoTotale / realKwh : 0;

  return { rows, targetRecuperoTotale, targetRecuperoUnitario, periodExpectedKwh: plannedPeriodKwh };
}

export function calculateResults(form) {
  const kwh = Math.max(clampNonNegative(form.kwh), 0.0001);
  const costoEnergia = clampNonNegative(form.costoEnergia);
  const perditeRete = clampNonNegative(form.perditeRete);
  const altriCostiViviUnitari = clampNonNegative(form.altriCostiViviUnitari);
  const percentualeJCP = clampNonNegative(form.percentualeJCP);
  const stripePerc = clampNonNegative(form.stripePerc);
  const stripeFisso = clampNonNegative(form.stripeFisso);
  const iva = clampNonNegative(form.iva);

  const costoVivoUnitario = costoEnergia * (1 + perditeRete / 100) + altriCostiViviUnitari;
  const costoVivoTotale = costoVivoUnitario * kwh;
  const infraTargets = calculateInfrastructureTargets(
    form.infrastructureItems,
    form.periodStart,
    form.periodEnd,
    kwh,
    form.periodExpectedKwh,
  );

  const nettoEnteTarget =
    form.calcMode === 'live_only'
      ? costoVivoTotale
      : form.calcMode === 'live_plus_infra'
        ? costoVivoTotale + infraTargets.targetRecuperoTotale
        : 0;

  const quotaEnte = 1 - percentualeJCP / 100;
  let imponibileTotale = 0;
  if (form.calcMode === 'manual_gross') {
    imponibileTotale = (clampNonNegative(form.targetLordoManuale) * kwh) / (1 + iva / 100);
  } else {
    imponibileTotale = quotaEnte > 0 ? nettoEnteTarget / quotaEnte : 0;
  }

  const lordoCliente = imponibileTotale * (1 + iva / 100);
  const nettoEnte = imponibileTotale * quotaEnte;
  const lordoJCP = imponibileTotale * (percentualeJCP / 100);
  const stripeCost = imponibileTotale * (stripePerc / 100) + stripeFisso;
  const nettoJCP = lordoJCP - stripeCost;
  const saldoSpeseVive = nettoEnte - costoVivoTotale;
  const recuperoInfrastrutturaleDisponibile = Math.max(0, saldoSpeseVive);
  const coperturaTarget = infraTargets.targetRecuperoTotale > 0 ? recuperoInfrastrutturaleDisponibile / infraTargets.targetRecuperoTotale : 1;

  let health = 'green';
  if (saldoSpeseVive < 0) health = 'red';
  else if (coperturaTarget < 1) health = 'yellow';

  return {
    costoVivoUnitario,
    costoVivoTotale,
    targetRecuperoTotale: infraTargets.targetRecuperoTotale,
    targetRecuperoUnitario: infraTargets.targetRecuperoUnitario,
    infrastructureRows: infraTargets.rows,
    periodExpectedKwh: infraTargets.periodExpectedKwh,
    nettoEnte,
    lordoCliente,
    imponibileTotale,
    lordoJCP,
    stripeCost,
    nettoJCP,
    saldoSpeseVive,
    recuperoInfrastrutturaleDisponibile,
    coperturaTarget,
    prezzoUnitarioLordo: lordoCliente / kwh,
    prezzoUnitarioNettoEnte: nettoEnte / kwh,
    health,
  };
}
