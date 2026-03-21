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
- salvare simulazioni su Supabase;
- aggiornare o cancellare solo le proprie simulazioni cloud;
- marcare una simulazione cloud come pubblica o privata;
- vedere sia simulazioni pubbliche sia proprie simulazioni private.

## Salvataggio cloud vs salvataggio locale
- **Visitatore / guest**: può usare tutta la simulazione e salvare solo nel browser (`localStorage`).
- **Proprietario autenticato**: oltre ai salvataggi locali può salvare e gestire simulazioni cloud su Supabase.
- I dati già presenti in `localStorage` **non vengono migrati automaticamente** su Supabase.

## File principali modificati
- `src/App.jsx`: UI, flussi guest/proprietario, auth, simulazioni cloud e locali.
- `src/lib/supabase.js`: client Supabase con env vars Vite.
- `src/services/simulations.js`: operazioni CRUD verso `public.simulations`.
- `src/styles.css`: piccoli aggiustamenti per la UI auth/cloud.
- `.env.example`: esempio variabili ambiente.
