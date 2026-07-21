// Motor de voz basado en ElevenLabs: genera el audio de la traducción con
// una VOZ CLONADA del usuario y lo reproduce. Se usa una cola para no solapar
// frases. El audio se reproduce por el dispositivo de salida por defecto del
// sistema (que, en el montaje del usuario, es el dispositivo múltiple -> BlackHole).

export interface ElevenSpeakOptions {
  text: string;
  apiKey: string;
  voiceId: string;
  /** Modelo de ElevenLabs. Por defecto multilingüe rápido. */
  modelId?: string;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (msg: string) => void;
}

const DEFAULT_MODEL = "eleven_multilingual_v2";

class ElevenLabsQueue {
  private queue: ElevenSpeakOptions[] = [];
  private playing = false;
  private currentAudio: HTMLAudioElement | null = null;

  enqueue(options: ElevenSpeakOptions): void {
    if (!options.text.trim()) {
      options.onEnd?.();
      return;
    }
    this.queue.push(options);
    if (!this.playing) void this.processNext();
  }

  private async processNext(): Promise<void> {
    const options = this.queue.shift();
    if (!options) {
      this.playing = false;
      return;
    }
    this.playing = true;

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
          options.voiceId
        )}?optimize_streaming_latency=3&output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": options.apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: options.text,
            model_id: options.modelId || DEFAULT_MODEL,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.85,
              style: 0.0,
              use_speaker_boost: true,
            },
          }),
        }
      );

      if (!res.ok) {
        let detail = "";
        try {
          detail = (await res.text()).slice(0, 160);
        } catch {
          /* noop */
        }
        throw new Error(`ElevenLabs HTTP ${res.status} ${detail}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.currentAudio = audio;

      audio.onplay = () => options.onStart?.();
      audio.onended = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        options.onEnd?.();
        void this.processNext();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        this.currentAudio = null;
        options.onError?.("No se pudo reproducir el audio de ElevenLabs");
        void this.processNext();
      };

      await audio.play();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      options.onError?.(msg);
      void this.processNext();
    }
  }

  clear(): void {
    this.queue = [];
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    this.playing = false;
  }
}

export const elevenLabsQueue = new ElevenLabsQueue();

/**
 * Prueba rápida: valida la API key y devuelve la lista de voces del usuario
 * (incluidas las clonadas), para ayudar a elegir el Voice ID.
 */
export async function listElevenLabsVoices(
  apiKey: string
): Promise<{ voiceId: string; name: string }[]> {
  const res = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) throw new Error(`ElevenLabs HTTP ${res.status}`);
  const data = (await res.json()) as {
    voices?: { voice_id: string; name: string }[];
  };
  return (data.voices ?? []).map((v) => ({ voiceId: v.voice_id, name: v.name }));
}
