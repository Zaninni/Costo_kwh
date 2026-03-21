export const DEFAULT_FORM = {
  costoEnergia: 0.22,
  perditeRete: 5,
  altriCostiViviUnitari: 0,
  quotaAmmortamento: 0.04,
  percentualeJCP: 6,
  stripePerc: 3,
  stripeFisso: 0.3,
  iva: 22,
  kwh: 30,
  targetLordoManuale: 0.35,
  calcMode: 'live_plus_amortization',
};

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

function clampNonNegative(value) {
  return Math.max(Number(value) || 0, 0);
}

export function migrateDraft(raw) {
  const merged = {
    ...DEFAULT_FORM,
    ...raw,
  };

  const legacyAmortization = raw?.quotaAmmortamento ?? raw?.ammortamento ?? 0;

  return {
    ...merged,
    quotaAmmortamento: clampNonNegative(legacyAmortization),
    calcMode:
      raw?.calcMode === 'live_plus_infra'
        ? 'live_plus_amortization'
        : raw?.calcMode === 'live_only' || raw?.calcMode === 'manual_gross'
          ? raw.calcMode
          : DEFAULT_FORM.calcMode,
  };
}

export function calculateResults(form) {
  const kwh = Math.max(clampNonNegative(form.kwh), 0.0001);
  const costoEnergia = clampNonNegative(form.costoEnergia);
  const perditeRete = clampNonNegative(form.perditeRete);
  const altriCostiViviUnitari = clampNonNegative(form.altriCostiViviUnitari);
  const quotaAmmortamento = clampNonNegative(form.quotaAmmortamento);
  const percentualeJCP = clampNonNegative(form.percentualeJCP);
  const stripePerc = clampNonNegative(form.stripePerc);
  const stripeFisso = clampNonNegative(form.stripeFisso);
  const iva = clampNonNegative(form.iva);

  const costoVivoUnitario = costoEnergia * (1 + perditeRete / 100) + altriCostiViviUnitari;
  const costoVivoTotale = costoVivoUnitario * kwh;
  const targetAmmortamentoTotale = quotaAmmortamento * kwh;

  const nettoEnteTarget =
    form.calcMode === 'live_only'
      ? costoVivoTotale
      : form.calcMode === 'live_plus_amortization'
        ? costoVivoTotale + targetAmmortamentoTotale
        : 0;

  const quotaEnte = Math.max(0, 1 - percentualeJCP / 100);

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
  const coperturaTarget = targetAmmortamentoTotale > 0 ? recuperoInfrastrutturaleDisponibile / targetAmmortamentoTotale : 1;

  let health = 'green';
  if (saldoSpeseVive < 0) health = 'red';
  else if (coperturaTarget < 1) health = 'yellow';

  return {
    costoVivoUnitario,
    costoVivoTotale,
    quotaAmmortamento,
    targetRecuperoTotale: targetAmmortamentoTotale,
    targetRecuperoUnitario: quotaAmmortamento,
    nettoEnte,
    imponibileTotale,
    lordoCliente,
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
