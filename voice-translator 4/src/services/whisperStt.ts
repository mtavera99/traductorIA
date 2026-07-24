// Reconocimiento de voz por SEGMENTOS, capturando de un dispositivo de entrada
// CONCRETO. Esto permite que "Escuchar" y "Hablar" usen fuentes distintas a la
// vez (p. ej. BlackHole y tu micrófono).
//
// La captura + segmentación por energía (VAD sencillo) vive en `VadRecognizer`.
// Cada motor concreto solo implementa `transcribe()`:
//   - WhisperRecognizer -> servidor Colab (/stt)  [usa la GPU]
//   - GeminiRecognizer  -> API de Gemini          [NO usa la GPU del Colab]
//
// Anti-eco: mientras suena una reproducción TTS (ttsIsActive), se ignora el
// audio capturado para no re-transcribir la voz traducida y evitar bucles.

import { ttsIsActive } from "./ttsGate";

export interface WhisperCallbacks {
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (error: string) => void;
  onStateChange?: (listening: boolean) => void;
}

const TARGET_SR = 16000;
const FRAME = 4096; // muestras por bloque (~256 ms a 16 kHz)
const RMS_THRESHOLD = 0.02; // energía mínima para considerar "voz activa"
const SPEECH_RMS = 0.045; // el pico del segmento debe superar esto (voz real)
const HANGOVER_MS = 650; // silencio para cerrar la frase
const MIN_SEGMENT_MS = 450; // ignora ruiditos muy cortos
const MAX_SEGMENT_MS = 12000; // corta frases larguísimas
const PREROLL_FRAMES = 2; // incluye un poco de audio previo al inicio

// Nombres de idioma para el prompt de Gemini (a partir del código corto).
const LANG_NAMES: Record<string, string> = {
  es: "Spanish",
  en: "English",
  pt: "Portuguese",
  fr: "French",
  de: "German",
  it: "Italian",
};

// Frases típicas que el STT "alucina" con silencio/ruido. Se descartan.
const HALLUCINATIONS = [
  "suscríbete",
  "suscribete",
  "subscribe to the channel",
  "subscribe to my channel",
  "subtítulos realizados",
  "subtitulos realizados",
  "subtitles made by",
  "subtitled by",
  "amara.org",
  "thanks for watching",
  "gracias por ver",
  "like and subscribe",
  "www.",
  "♪",
];

function looksLikeHallucination(text: string): boolean {
  const t = text.toLowerCase().trim();
  if (!t) return true;
  for (const h of HALLUCINATIONS) if (t.includes(h)) return true;

  // Repeticiones de palabras ("subscribe subscribe...", "no no no no...").
  const words = t.split(/\s+/);
  if (words.length >= 6 && new Set(words).size <= 2) return true;

  // Solo letras (sin espacios, signos ni acentos).
  const letters = t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");

  // Risa / tos / ruido: texto largo con muy poca variedad de letras
  // (p. ej. "ajajajaja...ahahaha", "mmmmm", "hhhhh", "eeee").
  if (letters.length >= 10 && new Set(letters.split("")).size <= 4) {
    return true;
  }

  // Patrón explícito de risa/tos: casi todo son sílabas ja/aj/ah/ha/je/eh/ji/hi.
  if (letters.length >= 6) {
    const rest = letters.replace(/ja|aj|ah|ha|je|eh|ji|hi|ji/g, "");
    if (rest.length <= letters.length * 0.2) return true;
  }

  return false;
}

/** Lista los dispositivos de entrada de audio (necesita permiso de micrófono). */
export async function listAudioInputs(): Promise<
  { deviceId: string; label: string }[]
> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Entrada ${i + 1}`,
    }));
}

/** Lista los dispositivos de SALIDA de audio (altavoces/auriculares). */
export async function listAudioOutputs(): Promise<
  { deviceId: string; label: string }[]
> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audiooutput")
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Salida ${i + 1}`,
    }));
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}

/** Codifica un Blob a base64 (para enviar el audio inline a Gemini). */
async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Base de reconocimiento: captura del micrófono elegido, segmenta por energía
 * (VAD) y, al cerrar cada frase, delega la transcripción en `transcribe()`.
 */
export abstract class VadRecognizer {
  protected language: string;
  private deviceId: string | undefined;
  private cbs: WhisperCallbacks;

  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private running = false;

  // Estado del VAD
  private speaking = false;
  private segment: Float32Array[] = [];
  private preroll: Float32Array[] = [];
  private silenceMs = 0;
  private segmentMs = 0;
  private maxRms = 0;

  constructor(
    language: string,
    deviceId: string | undefined,
    cbs: WhisperCallbacks = {}
  ) {
    this.language = language;
    this.deviceId = deviceId;
    this.cbs = cbs;
  }

  setLanguage(lang: string): void {
    this.language = lang;
  }

  /** Transcribe un segmento de audio (WAV mono 16 kHz) a texto. */
  protected abstract transcribe(wav: Blob): Promise<string>;

  async start(): Promise<void> {
    if (this.running) return;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.deviceId ? { exact: this.deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor({ sampleRate: TARGET_SR });
      await this.ctx.resume();
      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.processor = this.ctx.createScriptProcessor(FRAME, 1, 1);
      // Nodo silencioso para que onaudioprocess dispare sin oír el micrófono.
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      this.source.connect(this.processor);
      this.processor.connect(mute);
      mute.connect(this.ctx.destination);

      this.processor.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0);
        this.handleFrame(new Float32Array(input));
      };
      this.running = true;
      this.cbs.onStateChange?.(true);
    } catch (err) {
      this.cbs.onError?.(
        `Micrófono: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private frameMs(): number {
    return (FRAME / TARGET_SR) * 1000;
  }

  private handleFrame(frame: Float32Array): void {
    // Anti-eco: si está sonando una traducción, descarta lo captado para no
    // crear un bucle de realimentación (voz traducida -> micro -> re-traducida).
    if (ttsIsActive()) {
      if (this.speaking) {
        this.speaking = false;
        this.segment = [];
        this.segmentMs = 0;
        this.silenceMs = 0;
        this.maxRms = 0;
        this.cbs.onInterim?.("");
      }
      this.preroll = [];
      return;
    }

    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    const fms = this.frameMs();

    if (this.speaking) {
      this.segment.push(frame);
      this.segmentMs += fms;
      if (rms > this.maxRms) this.maxRms = rms;
      if (rms < RMS_THRESHOLD) {
        this.silenceMs += fms;
      } else {
        this.silenceMs = 0;
      }
      if (this.silenceMs >= HANGOVER_MS || this.segmentMs >= MAX_SEGMENT_MS) {
        this.endSegment();
      }
    } else {
      // Mantener un pequeño preroll de audio previo.
      this.preroll.push(frame);
      if (this.preroll.length > PREROLL_FRAMES) this.preroll.shift();
      if (rms >= RMS_THRESHOLD) {
        this.speaking = true;
        this.segment = [...this.preroll, frame];
        this.segmentMs = (this.preroll.length + 1) * fms;
        this.silenceMs = 0;
        this.maxRms = rms;
        this.preroll = [];
        this.cbs.onInterim?.("…");
      }
    }
  }

  private endSegment(): void {
    const frames = this.segment;
    const totalMs = this.segmentMs;
    const peak = this.maxRms;
    this.speaking = false;
    this.segment = [];
    this.segmentMs = 0;
    this.silenceMs = 0;
    this.maxRms = 0;
    this.cbs.onInterim?.("");

    // Descarta segmentos demasiado cortos o sin energía de voz real
    // (así evitamos que el STT "alucine" con silencio/ruido).
    if (totalMs < MIN_SEGMENT_MS || peak < SPEECH_RMS) return;

    // Unir todos los bloques en un solo Float32Array.
    let len = 0;
    for (const f of frames) len += f.length;
    const samples = new Float32Array(len);
    let off = 0;
    for (const f of frames) {
      samples.set(f, off);
      off += f.length;
    }
    void this.sendSegment(samples);
  }

  private async sendSegment(samples: Float32Array): Promise<void> {
    try {
      const wav = encodeWav(samples, TARGET_SR);
      const text = (await this.transcribe(wav)).trim();
      if (text && !looksLikeHallucination(text)) this.cbs.onFinal?.(text);
    } catch (err) {
      this.cbs.onError?.(
        `Reconocimiento: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  stop(): void {
    this.running = false;
    if (this.processor) {
      this.processor.onaudioprocess = null;
      try {
        this.processor.disconnect();
      } catch {
        /* noop */
      }
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        /* noop */
      }
    }
    if (this.ctx) {
      try {
        void this.ctx.close();
      } catch {
        /* noop */
      }
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
    }
    this.processor = null;
    this.source = null;
    this.ctx = null;
    this.stream = null;
    this.speaking = false;
    this.segment = [];
    this.preroll = [];
    this.cbs.onStateChange?.(false);
  }
}

/** STT con Whisper en el servidor Colab (/stt). Usa la GPU. */
export class WhisperRecognizer extends VadRecognizer {
  private serverUrl: string;

  constructor(
    serverUrl: string,
    language: string,
    deviceId: string | undefined,
    cbs: WhisperCallbacks = {}
  ) {
    super(language, deviceId, cbs);
    this.serverUrl = serverUrl.replace(/\/$/, "");
  }

  protected async transcribe(wav: Blob): Promise<string> {
    const form = new FormData();
    form.append("audio", wav, "seg.wav");
    form.append("language", this.language);
    const res = await fetch(`${this.serverUrl}/stt`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      // Intenta mostrar el motivo REAL del servidor (no solo el código).
      let detail = "";
      try {
        const j = (await res.json()) as { detail?: string };
        detail = j.detail || "";
      } catch {
        try {
          detail = await res.text();
        } catch {
          /* noop */
        }
      }
      throw new Error(`STT HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    const data = (await res.json()) as { text?: string };
    return data.text || "";
  }
}

/**
 * STT con la API de Gemini. NO usa la GPU del Colab, así que descarga el
 * servidor (menos riesgo de errores de CUDA) y funciona aunque XTTS esté ocupado.
 */
export class GeminiRecognizer extends VadRecognizer {
  private apiKey: string;

  constructor(
    apiKey: string,
    language: string,
    deviceId: string | undefined,
    cbs: WhisperCallbacks = {}
  ) {
    super(language, deviceId, cbs);
    this.apiKey = apiKey;
  }

  protected async transcribe(wav: Blob): Promise<string> {
    const b64 = await blobToBase64(wav);
    const langName = LANG_NAMES[this.language] || this.language;
    // Alias mantenido por Google que apunta siempre al último Flash disponible,
    // así no se rompe cuando retiran una versión concreta del modelo.
    const model = "gemini-flash-latest";
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
      encodeURIComponent(this.apiKey);
    const prompt =
      `Transcribe the speech in this audio. The language is ${langName}. ` +
      "Return ONLY the exact transcription, with no quotes, no notes and no " +
      "translation. If there is no clear speech, return an empty string.";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt },
              { inline_data: { mime_type: "audio/wav", data: b64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0 },
      }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        detail = j.error?.message || "";
      } catch {
        /* noop */
      }
      throw new Error(
        `Gemini STT HTTP ${res.status}${detail ? ` — ${detail}` : ""}`
      );
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
  }
}
