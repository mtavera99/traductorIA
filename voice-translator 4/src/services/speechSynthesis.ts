// Envoltorio sobre SpeechSynthesis (TTS) del navegador, con una cola de
// reproducción para no solapar frases y selección de voz por idioma.

export interface Voice {
  name: string;
  lang: string;
  voiceURI: string;
}

export function isSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/**
 * Carga las voces disponibles. En algunos navegadores se cargan de forma
 * asíncrona, por eso esperamos al evento "voiceschanged" si hace falta.
 */
export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!isSynthesisSupported()) {
      resolve([]);
      return;
    }
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    const handler = () => {
      resolve(window.speechSynthesis.getVoices());
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
    };
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    // Respaldo por si el evento no dispara.
    setTimeout(() => resolve(window.speechSynthesis.getVoices()), 1000);
  });
}

/** Devuelve las voces que coinciden con un prefijo de idioma (p. ej. "en"). */
export function voicesForLanguage(
  voices: SpeechSynthesisVoice[],
  langPrefix: string
): SpeechSynthesisVoice[] {
  const prefix = langPrefix.toLowerCase().slice(0, 2);
  return voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
}

export interface SpeakOptions {
  text: string;
  lang: string;
  voiceURI?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (msg: string) => void;
}

class SpeechQueue {
  private queue: SpeakOptions[] = [];
  private speaking = false;
  private voices: SpeechSynthesisVoice[] = [];

  setVoices(voices: SpeechSynthesisVoice[]): void {
    this.voices = voices;
  }

  enqueue(options: SpeakOptions): void {
    if (!isSynthesisSupported() || !options.text.trim()) {
      options.onEnd?.();
      return;
    }
    this.queue.push(options);
    if (!this.speaking) this.processNext();
  }

  private processNext(): void {
    const options = this.queue.shift();
    if (!options) {
      this.speaking = false;
      return;
    }
    this.speaking = true;

    const utterance = new SpeechSynthesisUtterance(options.text);
    utterance.lang = options.lang;
    utterance.rate = options.rate ?? 1;
    utterance.pitch = options.pitch ?? 1;
    utterance.volume = options.volume ?? 1;

    const voice = this.pickVoice(options);
    if (voice) utterance.voice = voice;

    utterance.onstart = () => options.onStart?.();
    utterance.onend = () => {
      options.onEnd?.();
      this.processNext();
    };
    utterance.onerror = (e) => {
      options.onError?.(e.error);
      this.processNext();
    };

    window.speechSynthesis.speak(utterance);
  }

  private pickVoice(options: SpeakOptions): SpeechSynthesisVoice | undefined {
    if (options.voiceURI) {
      const exact = this.voices.find((v) => v.voiceURI === options.voiceURI);
      if (exact) return exact;
    }
    const prefix = options.lang.toLowerCase().slice(0, 2);
    return this.voices.find((v) => v.lang.toLowerCase().startsWith(prefix));
  }

  clear(): void {
    this.queue = [];
    if (isSynthesisSupported()) window.speechSynthesis.cancel();
    this.speaking = false;
  }
}

export const speechQueue = new SpeechQueue();
