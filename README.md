# AutoCheck Maroc

Application web (Cloudflare Pages + Pages Functions) : décodage VIN, fiabilité, entretien et cote en MAD, comparateur de 2 voitures, scan OCR de carte grise.

## Structure (à respecter)

```
index.html            <- à la racine
functions/api/
  analyze.js
  compare.js
  scan-vin.js
schema.sql            <- optionnel (cache Supabase)
```

## Déploiement

1. Mettre ces fichiers à la racine d'un dépôt GitHub (sans sous-dossier).
2. Cloudflare > Workers & Pages > Create > **Pages** > Connect to Git > choisir le dépôt.
   - Framework preset : None
   - Build command : (vide)
   - Build output directory : `/`
3. Settings > Environment Variables (Production), ajouter :
   - `GEMINI_API_KEY` (obligatoire)
   - `GEMINI_API_KEY1` (optionnel, clé de secours)
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY` (optionnel, cache)
   - `VINCARIO_API_KEY`, `VINCARIO_SECRET_KEY` (optionnel, contrôle de vol)
4. Deployments > Retry deployment.

Test : ouvrir `https://VOTRE-SITE.pages.dev/api/analyze` dans le navigateur. Une page « 405 » signifie que les fonctions sont bien déployées.

Ne jamais mettre les clés dans le code ou dans GitHub : uniquement dans Cloudflare.
