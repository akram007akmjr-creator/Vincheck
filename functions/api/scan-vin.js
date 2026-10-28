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
    const { imageBase64, mimeType = "image/jpeg" } = await request.json();

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: "Aucune image fournie." }), { status: 400, headers: corsHeaders });
    }

    const apiKeys = [env.GEMINI_API_KEY, env.GEMINI_API_KEY1, env.GEMINI_API_KEY2].filter(Boolean);
    if (apiKeys.length === 0) {
      return new Response(JSON.stringify({ error: "Clé GEMINI_API_KEY manquante." }), { status: 500, headers: corsHeaders });
    }

    const prompt = `Tu es un système OCR expert en documents automobiles marocains (Carte Grise NARSA / ASSIAQ) et européens, ainsi qu'en lecture de plaques de châssis (VIN).
Analyse cette image et extrais les informations suivantes :
1. Le numéro de châssis (VIN) exact de 17 caractères (Attention: un VIN ne contient jamais les lettres I, O ou Q. Remplace O par 0 et I par 1 si nécessaire).
2. La marque et le modèle du véhicule s'ils sont visibles sur la carte grise.
3. L'année de première mise en circulation (Année modèle).
4. L'année de première mise en circulation au Maroc (ou dédouanement) si elle diffère de l'année modèle sur la carte grise marocaine (ex: Mise en circulation 2020, mais au Maroc en 2025 => Statut = "Dédouanée").

Réponds UNIQUEMENT en JSON valide :
{
  "vin": "17 caractères majuscules ou vide si illisible",
  "marque": "string ou vide",
  "modele": "string ou vide",
  "motorisation": "Genre/Carburant ex: Diesel / Essence ou vide",
  "annee_modele": 2020,
  "statut_douane": "WW Maroc ou Dédouanée",
  "annee_dedouanement": 2025,
  "confiance": "Haute / Moyenne / Faible"
}`;

    let extractedData = null;
    let lastError = null;

    for (const key of apiKeys) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${key}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: prompt },
                    {
                      inlineData: {
                        mimeType: mimeType,
                        data: imageBase64
                      }
                    }
                  ]
                }
              ],
              generationConfig: {
                temperature: 0.1,
                responseMimeType: "application/json"
              }
            })
          }
        );

        if (res.status === 429) {
          console.warn("Rate limit 429 sur scan-vin, passage à la clé suivante...");
          continue;
        }

        if (!res.ok) {
          throw new Error(`Erreur Vision API (${res.status})`);
        }

        const json = await res.json();
        const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text;
        extractedData = JSON.parse(rawText);
        break;
      } catch (e) {
        lastError = e;
      }
    }

    if (!extractedData) {
      throw new Error(lastError?.message || "Impossible de lire l'image.");
    }

    return new Response(JSON.stringify({ success: true, data: extractedData }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
}
