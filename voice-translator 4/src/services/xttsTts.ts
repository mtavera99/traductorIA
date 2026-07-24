// Cliente para el servidor XTTS propio (Coqui XTTS-v2) con reproducción en
// STREAMING de baja latencia. Cada panel usa su PROPIO reproductor, con salida
// de audio configurable (setSinkId), para poder mandar el español solo a los
// AirPods y el inglés al cable virtual, sin mezclarse.

import { ttsBegin, ttsEnd } from "./ttsGate";

export interface XttsSpeakOptions {
  text: string;
  serverUrl: string;
  language: string;
  /** Dispositivo de SALIDA (audiooutput). Vacío = salida por defecto del sistema. */
  outputDeviceId?: string;
  onError?: (msg: string) => void;
}

const SAMPLE_RATE = 24000;

type SinkableAudio = HTMLAudioElement & {
  setSinkId?: (id: string) => Promise<void>;
};

export class XttsPlayer {
  private queue: XttsSpeakOptions[] = [];
  private playing = false;
  private ctx: AudioContext | null = null;
  // Enrutamos el audio a un <audio> element (que SÍ soporta setSinkId en la
  // mayoría de navegadores) mediante un MediaStreamDestination.
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private sinkAudio: SinkableAudio | null = null;
  private currentSink = "";

  private getCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  // Prepara el destino de audio y aplica el dispositivo de salida elegido.
  private async ensureOutput(deviceId: string | undefined): Promise<void> {
    const ctx = this.getCtx();
    if (!this.streamDest) {
      this.streamDest = ctx.createMediaStreamDestination();
      this.sinkAudio = new Audio();
      this.sinkAudio.srcObject = this.streamDest.stream;
      this.sinkAudio.autoplay = true;
    }
    const want = deviceId || "";
    if (
      want !== this.currentSink &&
      this.sinkAudio &&
      typeof this.sinkAudio.setSinkId === "function"
    ) {
      try {
        await this.sinkAudio.setSinkId(want);
        this.currentSink = want;
      } catch {
        /* navegador sin soporte de setSinkId; usará la salida por defecto */
      }
    }
    try {
      await this.sinkAudio?.play();
    } catch {
      /* noop */
    }
  }

  private outNode(): AudioNode {
    return this.streamDest ?? this.getCtx().destination;
  }

  enqueue(options: XttsSpeakOptions): void {
    if (!options.text.trim()) return;
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
    // Cierra la puerta anti-eco mientras suena esta reproducción, para que los
    // reconocedores no capten (y re-traduzcan) la propia voz traducida.
    ttsBegin();
    try {
      await this.playStream(options);
    } catch {
      try {
        await this.playFull(options);
      } catch (e2) {
        options.onError?.(e2 instanceof Error ? e2.message : String(e2));
      }
    } finally {
      ttsEnd();
    }
    void this.processNext();
  }

  private async playStream(options: XttsSpeakOptions): Promise<void> {
    const base = options.serverUrl.replace(/\/$/, "");
    const ctx = this.getCtx();
    await ctx.resume();
    await this.ensureOutput(options.outputDeviceId);

    const res = await fetch(`${base}/tts_stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: options.text, language: options.language }),
    });
    if (!res.ok || !res.body) throw new Error(`XTTS stream HTTP ${res.status}`);

    const reader = res.body.getReader();
    let scheduled = ctx.currentTime + 0.08;
    let lastEnd = scheduled;
    let leftover = new Uint8Array(0);

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      const combined = new Uint8Array(leftover.length + value.length);
      combined.set(leftover, 0);
      combined.set(value, leftover.length);

      const usable = combined.length - (combined.length % 2);
      if (usable <= 0) {
        leftover = combined;
        continue;
      }
      leftover = combined.slice(usable);

      const int16 = new Int16Array(combined.buffer, 0, usable / 2);
      const f32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;

      const buffer = ctx.createBuffer(1, f32.length, SAMPLE_RATE);
      buffer.copyToChannel(f32, 0);
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(this.outNode());

      const startAt = Math.max(ctx.currentTime + 0.02, scheduled);
      node.start(startAt);
      scheduled = startAt + buffer.duration;
      lastEnd = scheduled;
    }

    const waitMs = Math.max(0, (lastEnd - ctx.currentTime) * 1000) + 60;
    await new Promise((r) => setTimeout(r, waitMs));
  }

  private async playFull(options: XttsSpeakOptions): Promise<void> {
    const base = options.serverUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: options.text, language: options.language }),
    });
    if (!res.ok) throw new Error(`XTTS HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    await new Promise<void>((resolve) => {
      const audio = new Audio(url) as SinkableAudio;
      if (options.outputDeviceId && typeof audio.setSinkId === "function") {
        void audio.setSinkId(options.outputDeviceId).catch(() => {});
      }
      audio.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      void audio.play();
    });
  }

  clear(): void {
    this.queue = [];
    this.playing = false;
  }
}

/** Comprueba que el servidor XTTS responde. */
export async function checkXttsServer(
  serverUrl: string
): Promise<{ ok: boolean; device?: string; message: string }> {
  try {
    const base = serverUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/health`);
    if (!res.ok) return { ok: false, message: `HTTP ${res.status}` };
    const data = (await res.json()) as {
      status?: string;
      device?: string;
      stream?: boolean;
      whisper?: boolean;
    };
    const parts = [data.device ?? "?"];
    if (data.stream) parts.push("streaming");
    if (data.whisper) parts.push("whisper");
    return {
      ok: data.status === "ok",
      device: data.device,
      message: `✓ Servidor activo (${parts.join(" · ")})`,
    };
  } catch (err) {
    return {
      ok: false,
      message: `✗ No responde: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
