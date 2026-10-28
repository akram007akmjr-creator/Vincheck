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
    const { carA, carB } = await request.json();

    if (!carA?.modele || !carB?.modele) {
      return new Response(JSON.stringify({ error: "Veuillez renseigner les deux véhicules à comparer." }), { status: 400, headers: corsHeaders });
    }

    const apiKeys = [env.GEMINI_API_KEY, env.GEMINI_API_KEY1, env.GEMINI_API_KEY2].filter(Boolean);
    if (apiKeys.length === 0) {
      return new Response(JSON.stringify({ error: "Clé GEMINI_API_KEY manquante." }), { status: 500, headers: corsHeaders });
    }

    const prompt = `Tu es un expert du marché automobile marocain (mécanique, pièces de rechange, argus et revente au Maroc).
Compare ces deux véhicules pour un acheteur au Maroc :
- VÉHICULE A : ${carA.marque} ${carA.modele} (${carA.annee}) - ${carA.km} km - Statut : ${carA.statut}
- VÉHICULE B : ${carB.marque} ${carB.modele} (${carB.annee}) - ${carB.km} km - Statut : ${carB.statut}

Réponds UNIQUEMENT en JSON valide respectant strictement cette structure :
{
  "titre_duel": "Nom Véhicule A vs Nom Véhicule B",
  "gagnant_global": "Véhicule A ou Véhicule B",
  "verdict_maroc": "Explication franche et directe adaptée au marché marocain (pourquoi choisir l'une plutôt que l'autre selon le budget, la route et la revente)",
  "comparaison": {
    "prix_marche_mad": { "carA": "ex: 280 000 MAD", "carB": "ex: 265 000 MAD", "avantage": "A ou B" },
    "score_fiabilite": { "carA": "8.6/10", "carB": "8.1/10", "avantage": "A ou B" },
    "cout_entretien_annuel_mad": { "carA": "ex: 3 500 MAD/an", "carB": "ex: 2 800 MAD/an", "avantage": "A ou B" },
    "disponibilite_pieces_maroc": { "carA": "Excellente (Ferraille & Maison)", "carB": "Moyenne / Chère", "avantage": "A ou B" },
    "consommation_moyenne": { "carA": "ex: 5.1 L/100km", "carB": "ex: 5.6 L/100km", "avantage": "A ou B" },
    "vignette_annuelle_mad": { "carA": "ex: 1 500 MAD (8 CV)", "carB": "ex: 1 500 MAD (8 CV)", "avantage": "Égalité" },
    "facilite_revente_maroc": { "carA": "Très rapide (Chèque en poche)", "carB": "Normale", "avantage": "A ou B" }
  },
  "conseil_achat": {
    "achetez_carA_si": "Profil d'acheteur idéal pour la voiture A au Maroc",
    "achetez_carB_si": "Profil d'acheteur idéal pour la voiture B au Maroc"
  }
}`;

    let comparisonData = null;
    let lastError = null;

    for (const key of apiKeys) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${key}`,
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

        if (res.status === 429) continue;
        if (!res.ok) throw new Error(`Erreur API (${res.status})`);

        const json = await res.json();
        const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
        comparisonData = JSON.parse(rawText);
        break;
      } catch (e) {
        lastError = e;
      }
    }

    if (!comparisonData) {
      throw new Error(lastError?.message || "Impossible de générer le comparatif.");
    }

    return new Response(JSON.stringify({ success: true, data: comparisonData }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
