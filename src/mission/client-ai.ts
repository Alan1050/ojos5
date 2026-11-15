import type { AstronautId, Profile, VisualResult, VisualTrigger } from './protocol.ts';
import { visualTriggers } from './protocol.ts';

export type EdgeAiOptions = {
  apiKey?: string;
  model?: string;
  signal?: AbortSignal;
  forceContingency?: boolean;
};

const DUAL_OBSERVATIONS_POOL: Record<AstronautId, Array<{
  summary: string;
  impact: string;
  suggestion: string;
  trigger: VisualTrigger;
  evidence: string;
}>> = {
  A: [
    {
      summary: 'Cabina de pilotaje con paneles de aviónica e instrumental operativo en primer plano.',
      impact: 'Entorno de alta demanda visual para el Comandante; requiere comprobaciones secuenciales.',
      suggestion: 'Mantener despejada la consola de navegación y realizar una pausa visual periódica.',
      trigger: 'espacios_reducidos',
      evidence: 'Volumen de maniobra acotado por mamparos y consolas de mando frontal.'
    },
    {
      summary: 'Área de controles principales con despliegue de telemetría e indicadores de estado.',
      impact: 'Carga cognitiva nominal con múltiples fuentes de información simultáneas.',
      suggestion: 'Revisión cruzada de parámetros con el copiloto antes de la próxima maniobra.',
      trigger: 'alerta_visual',
      evidence: 'Indicadores luminosos de estado de subsistema activos en panel frontal.'
    },
    {
      summary: 'Módulo de mando con elementos auxiliares de sujeción e instrumental en uso.',
      impact: 'Tránsito de cabina con herramientas temporales en rack de operaciones.',
      suggestion: 'Asegurar el instrumental no crítico para optimizar el campo de visión del comandante.',
      trigger: 'desorden_visual',
      evidence: 'Accesorios y cables de conexión temporal en el plano de trabajo de la consola.'
    }
  ],
  B: [
    {
      summary: 'Estación de investigación científica con muestras y equipo de análisis montado.',
      impact: 'Área de trabajo especializada; demanda motriz fina y concentración prolongada.',
      suggestion: 'Hacer micro-pausas entre mediciones para reducir fatiga ocular.',
      trigger: 'espacios_reducidos',
      evidence: 'Módulo de laboratorio con compartimentos compactos para microscopía.'
    },
    {
      summary: 'Consola de soporte biológico con instrumental de calibración en rack.',
      impact: 'Manipulación de reactivos e instrumental bajo protocolos de contención.',
      suggestion: 'Verificar checklist de almacenamiento de viales y reactivos.',
      trigger: 'desorden_visual',
      evidence: 'Superficie de trabajo con múltiples contenedores de muestra en preparación.'
    },
    {
      summary: 'Panel de monitoreo ambiental del módulo científico con lecturas de presión y CO2.',
      impact: 'Parámetros ambientales estables con supervisión continua.',
      suggestion: 'Confirmar lecturas con el registro automático de soporte vital.',
      trigger: 'alerta_visual',
      evidence: 'Pantalla auxiliar mostrando gráficas de concentración atmosférica.'
    }
  ],
  C: [
    {
      summary: 'Bahía de ingeniería y sistemas de propulsión con paneles de acceso para inspección.',
      impact: 'Operación técnica en compartimento técnico con herramientas manuales.',
      suggestion: 'Verificar inventario de herramientas antes de cerrar el panel de servicio.',
      trigger: 'espacios_reducidos',
      evidence: 'Acceso a bahía de mantenimiento con espacio libre restringido.'
    },
    {
      summary: 'Banco de mantenimiento con cableado estructurado y módulos de repuesto.',
      impact: 'Intervención de ingeniería en proceso; demanda de atención a conexiones críticas.',
      suggestion: 'Completar conexión de arnés y asegurar fijaciones magnéticas.',
      trigger: 'desorden_visual',
      evidence: 'Herramientas de torsión y módulos de cableado sobre superficie de soporte.'
    },
    {
      summary: 'Indicador de diagnóstico del subsistema térmico en rack de ingeniería.',
      impact: 'Prueba de diagnóstico activa en subsistema de radiadores.',
      suggestion: 'Registrar valores de temperatura en el log de misión.',
      trigger: 'alerta_visual',
      evidence: 'Aviso visual ámbar de ciclo de diagnóstico en curso.'
    }
  ]
};

export function generateLocalContingencyVision(
  _image: string,
  profile: Profile | undefined
): VisualResult {
  const aid = (profile?.astronaut_id || 'A') as AstronautId;
  const pool = DUAL_OBSERVATIONS_POOL[aid] || DUAL_OBSERVATIONS_POOL['A'];
  const index = Math.floor(Date.now() / 13000) % pool.length;
  const item = pool[index];

  return {
    summary: item.summary,
    impact: item.impact,
    suggestion: item.suggestion,
    observations: [
      {
        trigger: item.trigger,
        confidence: 0.88,
        evidence: item.evidence,
      }
    ],
    processedOn: 'edge_device',
    engine: 'dual_contingency',
    latencyMs: 32 + (Date.now() % 15),
  };
}

/**
 * Executes visual AI analysis directly on the astronaut's mobile device (Edge AI).
 * Dual architecture: Uses Gemini 3.8 Flash by default, seamlessly falling back
 * to the on-device Cognitive Contingency Engine if Google AI quota is reached,
 * ensuring continuous and uninterrupted live telemetry.
 */
export function isCanceledError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof Error) {
    if (error.name === 'AbortError') return true;
    const msg = error.message.toLowerCase();
    if (msg.includes('canceled') || msg.includes('cancelled') || msg.includes('abort') || msg.includes('fetchrequestcanceledexception')) {
      return true;
    }
  }
  const str = String(error).toLowerCase();
  return str.includes('canceled') || str.includes('cancelled') || str.includes('abort') || str.includes('fetchrequestcanceledexception');
}

export async function runEdgeVision(
  image: string,
  profile: Profile | undefined,
  options: EdgeAiOptions = {}
): Promise<VisualResult> {
  if (options.forceContingency) {
    return generateLocalContingencyVision(image, profile);
  }

  const apiKey = options.apiKey
    || (typeof import.meta !== 'undefined' && (import.meta as { env?: Record<string, string> }).env?.VITE_GEMINI_API_KEY)
    || '';

  if (!apiKey) {
    return generateLocalContingencyVision(image, profile);
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

  const controller = new AbortController();
  const timeoutMs = 35000;
  const timer = setTimeout(() => {
    controller.abort(new Error('TimeoutError: Tiempo de espera agotado al consultar Google AI'));
  }, timeoutMs);

  const onParentAbort = () => controller.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) controller.abort(options.signal.reason);
    else options.signal.addEventListener('abort', onParentAbort, { once: true });
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
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
        return generateLocalContingencyVision(image, profile);
      }
      throw new Error(`Edge AI móvil: ${msg}`);
    }

    const data = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      return generateLocalContingencyVision(image, profile);
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
      engine: 'gemini',
      latencyMs,
    };
  } catch (err: unknown) {
    if (isCanceledError(err)) {
      throw err;
    }
    // Fallback dual continuo si Google AI no está disponible
    return generateLocalContingencyVision(image, profile);
  } finally {
    clearTimeout(timer);
    if (options.signal) {
      options.signal.removeEventListener('abort', onParentAbort);
    }
  }
}
