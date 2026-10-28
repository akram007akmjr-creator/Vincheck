export async function onRequestPost(context) {
  const { request, env } = context;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const {
      searchMode, // 'vin' ou 'manual'
      vin = "",
      marque = "",
      modele = "",
      motorisation = "",
      annee = 2020,
      kilometrage = 100000,
      statutDouane = "WW Maroc", // 'WW Maroc' ou 'Dédouanée'
      anneeDedouanement = 2025,
      paysOrigine = "Europe"
    } = body;

    const cleanVin = vin.trim().toUpperCase();
    const kmRounded = Math.round(Number(kilometrage) / 10000) * 10000;

    const cacheKey = searchMode === "vin" && cleanVin
      ? `vin_${cleanVin}_${kmRounded}_${statutDouane}`
      : `mod_${marque}_${modele}_${motorisation}_${annee}_${kmRounded}_${statutDouane}_${anneeDedouanement}`
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "");

    // 1. Vérifier si le rapport existe déjà dans le cache Supabase
    if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
      try {
        const supRes = await fetch(
          `${env.SUPABASE_URL}/rest/v1/vehicle_reports?cache_key=eq.${encodeURIComponent(cacheKey)}&select=report_data`,
          {
            headers: {
              apikey: env.SUPABASE_ANON_KEY,
              Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`
            }
          }
        );
        if (supRes.ok) {
          const rows = await supRes.json();
          if (rows && rows.length > 0) {
            return new Response(JSON.stringify({ source: "cache", data: rows[0].report_data }), { headers: corsHeaders });
          }
        }
      } catch (e) {
        console.warn("Supabase cache read skipped:", e.message);
      }
    }

    // 2. Décodage préliminaire du VIN (ISO 3779 + NHTSA gratuit + Vincario Stolen Check)
    let vinDecodedInfo = null;
    if (searchMode === "vin" && cleanVin.length === 17) {
      vinDecodedInfo = decodeVinMetadata(cleanVin);
      try {
        const nhtsaRes = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${cleanVin}?format=json`);
        if (nhtsaRes.ok) {
          const nhtsaData = await nhtsaRes.json();
          const r = nhtsaData.Results?.[0];
          if (r && r.Make) {
            vinDecodedInfo.nhtsaMake = r.Make;
            vinDecodedInfo.nhtsaModel = r.Model;
            vinDecodedInfo.nhtsaYear = r.ModelYear;
            vinDecodedInfo.nhtsaEngine = `${r.DisplacementL || ""}L ${r.FuelTypePrimary || ""}`.trim();
          }
        }
      } catch (e) {
        console.warn("NHTSA fallback used");
      }

      const vincarioReport = await checkVincarioStolenAndDecode(cleanVin, env);
      if (vincarioReport) {
        vinDecodedInfo.vincario = vincarioReport;
      }
    }

    // 3. Prompt structuré pour le marché automobile marocain
    const prompt = `Tu es un expert en mécanique automobile, diagnostic technique, dédouanement et argus du marché de l'occasion au Maroc.
Analyse ce véhicule en détail :
- Mode de recherche : ${searchMode === "vin" ? `Par Numéro de Châssis (VIN: ${cleanVin})` : "Par Modèle"}
- Infos décodées du VIN : ${vinDecodedInfo ? JSON.stringify(vinDecodedInfo) : "Non applicable"}
- Marque indiquée : ${marque || "À déduire du VIN"}
- Modèle / Motorisation : ${modele || "À déduire du VIN"} ${motorisation || ""}
- Année modèle : ${annee || "À déduire du VIN"}
- Kilométrage actuel : ${kilometrage} km
- Statut au Maroc : ${statutDouane} ${statutDouane === "Dédouanée" ? `(Dédouanée en ${anneeDedouanement}, provenance: ${paysOrigine})` : ""}

RÈGLES IMPORTANTES :
1. Si seul le VIN est fourni, identifie précisément la marque, le modèle, la génération et la motorisation la plus courante au Maroc à partir du WMI (3 premiers caractères du VIN) et VDS.
2. Adapte tous les prix en Dirham Marocain (MAD) selon la réalité du marché marocain (Avito, Moteur.ma, souk auto, mécaniciens et pièces de rechange au Maroc en 2026).
3. Pour l'entretien au kilométrage (${kilometrage} km), liste les opérations critiques à faire maintenant ou à vérifier d'urgence, avec le prix des pièces + main d'œuvre au Maroc.
4. Pour la vérification "Voiture Dédouanée / Vol", analyse la cohérence du VIN (ou du modèle importé), indique les points de contrôle obligatoires (frappe à froid, certificat d'origine, bases Schengen SIS II / Interpol, manipulation du compteur en Europe avant dédouanement).

Réponds UNIQUEMENT avec un objet JSON valide respectant strictement cette structure :
{
  "identite": {
    "marque": "string",
    "modele": "string",
    "generation": "string",
    "annee_modele": "string",
    "motorisation_probable": "string",
    "pays_fabrication_vin": "string",
    "statut_douane": "string"
  },
  "securite_et_origine": {
    "statut_alerte": "Clean / Vérification Physique Requise / Risque Élevé",
    "score_risque_vol": "Faible / Moyen / Élevé",
    "analyse_vin_et_douane": "Explication détaillée sur l'origine du châssis, le risque de trafic de compteur ou de gage/vol en Europe pour ce modèle précis",
    "points_verification_physique": [
      "Emplacement exact de la frappe à froid sur ce modèle et comment vérifier qu'elle n'est pas maquillée",
      "Vérification OBD2 du kilométrage réel dans le calculateur ABS / Boîte",
      "Document douanier / Certificat de dédouanement ANFCC / Assurances"
    ]
  },
  "histoire_et_avis": {
    "histoire_modele": "Histoire de cette génération, évolutions/restylage et sa réputation au Maroc",
    "avis_maroc": "Ce que disent les propriétaires et mécaniciens marocains (confort, consommation, disponibilité des pièces à la ferraille/maison)",
    "points_forts": ["string", "string", "string"],
    "points_faibles": ["string", "string", "string"]
  },
  "fiabilite": {
    "note_globale": 8.5,
    "note_moteur": 8.8,
    "note_boite": 8.2,
    "note_electronique": 7.9,
    "defauts_connus": [
      {
        "probleme": "Nom du défaut ou maladie connue",
        "symptome": "Comment le détecter lors de l'essai",
        "gravite": "Haute / Moyenne / Faible",
        "cout_reparation_mad": "ex: 2500 - 4500 MAD"
      }
    ]
  },
  "entretien_kilometrage": {
    "kilometrage_analyse": ${Number(kilometrage)},
    "resume_entretien": "Conseil global pour ce kilométrage",
    "operations": [
      {
        "operation": "Nom de l'intervention (ex: Kit distribution + Pompe à eau)",
        "urgence": "Immédiate / À contrôler / Préventif",
        "prix_pieces_mad": "ex: 1800 - 2400 MAD",
        "main_oeuvre_mad": "ex: 400 - 600 MAD",
        "total_estime_mad": "ex: 2200 - 3000 MAD"
      }
    ],
    "budget_total_remise_a_niveau_mad": "ex: 4500 - 6500 MAD"
  },
  "cote_maroc": {
    "prix_min_mad": "ex: 165 000 MAD",
    "prix_moyen_mad": "ex: 182 000 MAD",
    "prix_max_mad": "ex: 198 000 MAD",
    "difference_ww_vs_dedouanee": "Explication de l'impact du dédouanement et du kilométrage sur le prix de ce modèle au Maroc",
    "liquidite_revente": "Très Rapide / Normale / Difficile (et pourquoi)"
  }
}`;

    // 4. Appel Gemini API avec système de Failover multi-clés
    const apiKeys = [env.GEMINI_API_KEY, env.GEMINI_API_KEY1, env.GEMINI_API_KEY2].filter(Boolean);
    if (apiKeys.length === 0) {
      return new Response(
        JSON.stringify({ error: "Aucune clé GEMINI_API_KEY configurée dans Cloudflare Pages." }),
        { status: 500, headers: corsHeaders }
      );
    }

    let reportData = null;
    let lastError = null;

    for (const key of apiKeys) {
      try {
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.3,
                responseMimeType: "application/json"
              }
            })
          }
        );

        if (geminiRes.status === 429) {
          console.warn("Clé API saturée (429), basculement vers la clé suivante...");
          continue;
        }

        if (!geminiRes.ok) {
          const errText = await geminiRes.text();
          throw new Error(`Erreur Gemini (${geminiRes.status}): ${errText}`);
        }

        const geminiJson = await geminiRes.json();
        const rawText = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text;
        reportData = JSON.parse(rawText);
        break;
      } catch (err) {
        lastError = err;
      }
    }

    if (!reportData) {
      throw new Error(lastError?.message || "Échec de génération du rapport avec toutes les clés API.");
    }

    // 5. Sauvegarder dans le cache Supabase
    if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
      try {
        await fetch(`${env.SUPABASE_URL}/rest/v1/vehicle_reports`, {
          method: "POST",
          headers: {
            apikey: env.SUPABASE_ANON_KEY,
            Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
            "Content-Type": "application/json",
            Prefer: "resolution=ignore-duplicates"
          },
          body: JSON.stringify({
            cache_key: cacheKey,
            vin: cleanVin || null,
            marque: reportData.identite?.marque || marque,
            modele: reportData.identite?.modele || modele,
            annee: parseInt(annee) || 2020,
            statut_douane: statutDouane,
            annee_dedouanement: statutDouane === "Dédouanée" ? parseInt(anneeDedouanement) : null,
            kilometrage: parseInt(kilometrage),
            report_data: reportData
          })
        });
      } catch (e) {
        console.warn("Supabase insert skipped:", e.message);
      }
    }

    return new Response(JSON.stringify({ source: "live", data: reportData }), { headers: corsHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
}

function decodeVinMetadata(vin) {
  const wmi = vin.substring(0, 3);
  const firstChar = vin.charAt(0);

  const countryMap = {
    W: "Allemagne",
    V: "France / Espagne",
    Z: "Italie",
    S: "Royaume-Uni",
    T: "République Tchèque / Hongrie",
    J: "Japon",
    K: "Corée du Sud",
    "1": "États-Unis",
    "2": "Canada",
    "3": "Mexique",
    U: "Roumanie / Europe de l'Est"
  };

  const wmiMakerMap = {
    W1K: "Mercedes-Benz", WDD: "Mercedes-Benz", WDB: "Mercedes-Benz",
    WBA: "BMW", WBS: "BMW M",
    WAU: "Audi", WVW: "Volkswagen", WV1: "Volkswagen Utilitaire",
    VF1: "Renault", VF3: "Peugeot", VF7: "Citroën", VR3: "Peugeot", VR7: "Citroën",
    UU1: "Dacia", VSS: "SEAT / Cupra", TMB: "Skoda",
    ZFA: "Fiat", ZAR: "Alfa Romeo",
    SAL: "Land Rover", SAJ: "Jaguar",
    JTD: "Toyota", SB1: "Toyota Europe", SJN: "Nissan",
    KMH: "Hyundai", U5Y: "Kia", KNA: "Kia",
    WF0: "Ford Europe"
  };

  return {
    vin,
    wmi,
    pays_fabrication_detecte: countryMap[firstChar] || "International",
    constructeur_detecte: wmiMakerMap[wmi] || "Détection via IA",
    checksum_valide: /^[A-HJ-NPR-Z0-9]{17}$/.test(vin)
  };
}

async function getVincarioControlSum(vin, actionId, apiKey, secretKey) {
  const rawString = `${vin}|${actionId}|${apiKey}|${secretKey}`;
  const msgBuffer = new TextEncoder().encode(rawString);
  const hashBuffer = await crypto.subtle.digest("SHA-1", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex.substring(0, 10).toLowerCase();
}

async function checkVincarioStolenAndDecode(vin, env) {
  const apiKey = env.VINCARIO_API_KEY;
  const secretKey = env.VINCARIO_SECRET_KEY;

  if (!apiKey || !secretKey || vin.length !== 17) {
    return null;
  }

  const result = {
    vincario_active: true,
    stolen_status: "Inconnu",
    stolen_records: [],
    decoded_specs: {}
  };

  try {
    const stolenSum = await getVincarioControlSum(vin, "stolen-check", apiKey, secretKey);
    const stolenUrl = `https://api.vindecoder.eu/3.2/${apiKey}/${stolenSum}/stolen-check/${vin}.json`;
    const stolenRes = await fetch(stolenUrl);

    if (stolenRes.ok) {
      const stolenJson = await stolenRes.json();
      if (Array.isArray(stolenJson.stolen)) {
        const alerts = stolenJson.stolen.filter(item => item.status === "stolen" || item.status === "wanted");
        result.stolen_status = alerts.length > 0 ? "ALERTE VOL DÉTECTÉE" : "Clean (Aucun signalement dans les bases policières interrogées)";
        result.stolen_records = stolenJson.stolen;
      }
    }

    const decodeSum = await getVincarioControlSum(vin, "decode", apiKey, secretKey);
    const decodeUrl = `https://api.vindecoder.eu/3.2/${apiKey}/${decodeSum}/decode/${vin}.json`;
    const decodeRes = await fetch(decodeUrl);

    if (decodeRes.ok) {
      const decodeJson = await decodeRes.json();
      if (Array.isArray(decodeJson.decode)) {
        decodeJson.decode.forEach(item => {
          if (["Make", "Model", "Model Year", "Engine (full)", "Fuel Type", "Transmission", "Plant Country"].includes(item.label)) {
            result.decoded_specs[item.label] = item.value;
          }
        });
      }
    }
  } catch (err) {
    console.warn("Erreur appel Vincario:", err.message);
  }

  return result;
}
