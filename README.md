# Tariffe EV LNF

## Variabili ambiente
Crea un file `.env` locale oppure configura le variabili su Vercel:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

In fallback legacy è supportata anche `VITE_SUPABASE_ANON_KEY`, ma la chiave consigliata resta `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Login proprietario
Il login proprietario usa Supabase Auth con email + password.
Non esiste sign-up pubblico nella UI.

Il proprietario autenticato può:
- salvare simulazioni cloud private nella tabella `public.simulations`;
- salvare tariffe cloud private nella tabella `public.tariffs`;
- vedere, riaprire, esportare CSV ed eliminare solo i propri record cloud.

## Struttura dati lato app
Le simulazioni locali e cloud usano lo stesso shape:

```js
{
  id: string,
  savedAt: string,
  updatedAt?: string,
  title: string,
  referencePeriod: '',
  formSnapshot: object,
  results: object,
  source: 'local' | 'cloud'
}
```

Le tariffe locali e cloud usano lo stesso shape:

```js
{
  id: string,
  savedAt: string,
  updatedAt?: string,
  title: string,
  referencePeriod: string,
  formSnapshot: object,
  results: object,
  source: 'local' | 'cloud'
}
```

## Salvataggi locali e cloud
- **Browser**: simulazioni e tariffe restano separate in `localStorage`.
- **Cloud Supabase**: simulazioni e tariffe restano separate in due tabelle diverse.
- I pulsanti nel dashboard sono separati:
  - Salva simulazione nel browser
  - Salva simulazione su cloud
  - Salva tariffa nel browser
  - Salva tariffa su cloud
- Ogni click sui pulsanti di salvataggio crea sempre un nuovo record, anche se la configurazione corrente deriva da un record già aperto.
- Gli ID applicativi restano stringhe generate lato app con `createId('SIM')` e `createId('TAR')`, sia in locale sia su Supabase.

## Tabelle Supabase attese
### `public.simulations`
- `id` text primary key
- `owner_id` uuid
- `saved_at` timestamptz
- `updated_at` timestamptz
- `title` text
- `reference_period` text
- `form_snapshot` jsonb
- `results` jsonb

### `public.tariffs`
- `id` text primary key
- `owner_id` uuid
- `saved_at` timestamptz
- `updated_at` timestamptz
- `title` text
- `reference_period` text
- `form_snapshot` jsonb
- `results` jsonb

## File principali
- `src/App.jsx`: UI, login guest/proprietario, salvataggi separati locali/cloud, storico simulazioni e storico tariffe.
- `src/lib/calculations.js`: calcoli, helper condivisi per costruire gli oggetti app e upsert locale/cloud.
- `src/services/simulations.js`: fetch/upsert/delete verso `public.simulations`.
- `src/services/tariffs.js`: fetch/upsert/delete verso `public.tariffs`.
- `src/lib/supabase.js`: client Supabase con env vars Vite.
