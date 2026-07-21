// Envoltorio sobre la Web Speech API (SpeechRecognition) para transcripción
// continua de voz en tiempo real, con reconexión automática.

export interface RecognitionCallbacks {
  /** Resultado parcial (mientras la persona sigue hablando). */
  onInterim?: (text: string) => void;
  /** Resultado final de una frase. */
  onFinal?: (text: string) => void;
  /** Error de reconocimiento. */
  onError?: (error: string) => void;
  /** Cambio de estado activo/inactivo. */
  onStateChange?: (listening: boolean) => void;
}

export function isRecognitionSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    (!!window.SpeechRecognition || !!window.webkitSpeechRecognition)
  );
}

export class SpeechRecognizer {
  private recognition: SpeechRecognition | null = null;
  private lang: string;
  private callbacks: RecognitionCallbacks;
  private shouldRun = false;
  private restartTimer: number | null = null;

  constructor(lang: string, callbacks: RecognitionCallbacks = {}) {
    this.lang = lang;
    this.callbacks = callbacks;
  }

  setLanguage(lang: string): void {
    this.lang = lang;
    if (this.recognition) {
      this.recognition.lang = lang;
      // Reiniciar para aplicar el idioma nuevo si está activo.
      if (this.shouldRun) {
        this.restart();
      }
    }
  }

  private build(): SpeechRecognition {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) {
      throw new Error(
        "Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge."
      );
    }
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript;
        if (result.isFinal) {
          const finalText = transcript.trim();
          if (finalText) this.callbacks.onFinal?.(finalText);
        } else {
          interim += transcript;
        }
      }
      if (interim.trim()) this.callbacks.onInterim?.(interim.trim());
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "no-speech" y "aborted" son normales; no los tratamos como fallo grave.
      if (event.error !== "no-speech" && event.error !== "aborted") {
        this.callbacks.onError?.(event.error);
      }
    };

    rec.onend = () => {
      // El navegador detiene el reconocimiento periódicamente; lo reanudamos.
      if (this.shouldRun) {
        this.scheduleRestart();
      } else {
        this.callbacks.onStateChange?.(false);
      }
    };

    rec.onstart = () => {
      this.callbacks.onStateChange?.(true);
    };

    return rec;
  }

  private scheduleRestart(): void {
    if (this.restartTimer !== null) return;
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = null;
      if (this.shouldRun && this.recognition) {
        try {
          this.recognition.start();
        } catch {
          // start() lanza si ya está corriendo; se ignora.
        }
      }
    }, 250);
  }

  start(): void {
    if (this.shouldRun) return;
    this.shouldRun = true;
    this.recognition = this.build();
    try {
      this.recognition.start();
    } catch (err) {
      this.callbacks.onError?.(String(err));
    }
  }

  stop(): void {
    this.shouldRun = false;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* noop */
      }
    }
  }

  private restart(): void {
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        /* noop */
      }
    }
    this.recognition = this.build();
    this.scheduleRestart();
  }
}
