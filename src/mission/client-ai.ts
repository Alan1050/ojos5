import type { Profile, VisualResult, VisualTrigger } from './protocol.ts';
import { visualTriggers } from './protocol.ts';

export type EdgeAiOptions = {
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
};

/**
 * Executes visual AI analysis directly on the astronaut's mobile device (Edge AI).
 * Avoids sending heavy images over the network to Earth (CentroControl),
 * transmitting only lightweight structured telemetry.
 */
export async function runEdgeVision(
  image: string,
  profile: Profile | undefined,
  options: EdgeAiOptions = {}
): Promise<VisualResult> {
  const apiKey = options.apiKey
    || (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.VITE_GEMINI_API_KEY)
    || '';

  if (!apiKey) {
    throw new Error('No hay clave de Google AI configurada para el procesamiento en el dispositivo móvil.');
  }

  const rawModel = options.model?.trim();
  const model = (!rawModel || rawModel.includes('2.0') || rawModel.includes('2.5') || rawModel.includes('1.5'))
    ? 'gemini-3.8-flash'
    : rawModel;

  const profileInfo = profile
    ? `Tripulante observado: Astronauta ${profile.astronaut_id} (Especialidad: ${profile.specialty.replaceAll('_', ' ')}). Sensibilidades conocidas de misión: ${profile.stress_triggers.replaceAll('|', ', ')}. Estrategias de calma registradas: ${profile.calmers.replaceAll('|', ', ')}.`
    : '';

  const instructions = `Eres el asistente de monitoreo de entorno para la misión NeuroOrbit ejecutándote directamente en el dispositivo móvil del astronauta (Edge AI). Describe únicamente evidencia visible de la cámara. No infieras emociones ni signos vitales. ${profileInfo} Identifica si hay: espacios_reducidos, desorden_visual o alerta_visual. Si no hay evidencia, devuelve observations vacío. Evalúa brevemente si el entorno genera fricción según el rol del tripulante y sugiere una acción breve acorde a su perfil. Todo en español.`;

  const pureBase64 = image.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
  const start = performance.now();

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: options.signal || AbortSignal.timeout(20000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: instructions }] },
      contents: [{
        parts: [
          { text: 'Describe el entorno visible y las posibles situaciones observables que convendría revisar.' },
          { inlineData: { mimeType: 'image/jpeg', data: pureBase64 } }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            summary: { type: 'STRING' },
            impact: { type: 'STRING' },
            suggestion: { type: 'STRING' },
            observations: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  trigger: { type: 'STRING', enum: visualTriggers },
                  confidence: { type: 'NUMBER' },
                  evidence: { type: 'STRING' }
                },
                required: ['trigger', 'confidence', 'evidence']
              }
            }
          },
          required: ['summary', 'observations']
        }
      }
    })
  });

  if (!response.ok) {
    const errJson = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    const msg = errJson?.error?.message || `Google AI respondió código ${response.status}`;
    if (response.status === 429 || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate')) {
      const match = msg.match(/retry in ([0-9.]+)s/i);
      const retrySec = match ? Math.ceil(Number(match[1])) : 60;
      const quotaErr = new Error(`Límite de Google AI (5/min). Esperando ${retrySec}s.`);
      (quotaErr as unknown as { retryAfterSeconds: number }).retryAfterSeconds = retrySec;
      throw quotaErr;
    }
    throw new Error(`Edge AI móvil: ${msg}`);
  }

  const data = await response.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!candidateText) {
    throw new Error('Google AI no devolvió texto de análisis.');
  }

  const cleanText = candidateText.replace(/^```json\s*/, '').replace(/```\s*$/, '').trim();
  const parsed = JSON.parse(cleanText) as VisualResult;
  const latencyMs = Math.round(performance.now() - start);

  return {
    summary: String(parsed.summary || '').slice(0, 500),
    ...(parsed.impact ? { impact: String(parsed.impact).slice(0, 500) } : {}),
    ...(parsed.suggestion ? { suggestion: String(parsed.suggestion).slice(0, 500) } : {}),
    observations: Array.isArray(parsed.observations)
      ? parsed.observations.slice(0, 3).map(o => ({
          trigger: o.trigger as VisualTrigger,
          confidence: Number(o.confidence) || 0.8,
          evidence: String(o.evidence || '').slice(0, 400),
        }))
      : [],
    processedOn: 'edge_device',
    latencyMs,
  };
}
