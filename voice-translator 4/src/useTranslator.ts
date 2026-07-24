// Hook que orquesta el pipeline completo para UNA dirección de traducción:
//   micrófono -> STT -> traducción -> TTS
// Cada panel (Escuchar / Hablar) usa una instancia independiente de este hook.
//
// Incluye TRADUCCIÓN INCREMENTAL: en frases largas no espera a que termines;
// suelta trozos cuando acumulas varias palabras o haces una micro-pausa.

import { useCallback, useEffect, useRef, useState } from "react";
import { SpeechRecognizer } from "./services/speechRecognition";
import { WhisperRecognizer, GeminiRecognizer } from "./services/whisperStt";
import { speechQueue } from "./services/speechSynthesis";
import { elevenLabsQueue } from "./services/elevenLabsTts";
import { XttsPlayer } from "./services/xttsTts";
import { translate } from "./services/translation";
import type { TranscriptSegment, TranslationSettings } from "./types";

// Interfaz común a ambos reconocedores (navegador y Whisper).
interface Recognizer {
  start: () => void | Promise<void>;
  stop: () => void;
  setLanguage: (lang: string) => void;
}

let segmentCounter = 0;
function nextId(): string {
  segmentCounter += 1;
  return `seg-${Date.now()}-${segmentCounter}`;
}

// Ajustes de la traducción incremental.
const STABILITY_MS = 700; // micro-pausa para soltar un trozo
const CHUNK_MIN_WORDS = 5; // mínimo de palabras para soltar en una pausa
const CHUNK_MAX_WORDS = 11; // si acumula esto, suelta sin esperar pausa

function countWords(t: string): number {
  const s = t.trim();
  return s ? s.split(/\s+/).length : 0;
}

// Ventana para descartar la MISMA frase repetida (eco/duplicado de captura).
const DEDUPE_MS = 6000;

// Normaliza texto para comparar duplicados: minúsculas, sin acentos ni signos.
function normalizeText(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface UseTranslatorOptions {
  sourceLang: string;
  targetLang: string;
  sourceShort: string;
  targetShort: string;
  settings: TranslationSettings;
  speakOutput: boolean;
  outputVoiceURI?: string;
  rate?: number;
  /** URL del servidor (Colab) para Whisper; suele ser la misma de XTTS. */
  sttServerUrl?: string;
  /** Dispositivo de entrada de audio para este panel (modo Whisper). */
  inputDeviceId?: string;
  /** Dispositivo de SALIDA para la voz de este panel (XTTS). Vacío = sistema. */
  outputDeviceId?: string;
}

export interface TranslatorState {
  active: boolean;
  interim: string;
  segments: TranscriptSegment[];
  error: string | null;
  start: () => void;
  stop: () => void;
  clear: () => void;
}

export function useTranslator(options: UseTranslatorOptions): TranslatorState {
  const [active, setActive] = useState(false);
  const [interim, setInterim] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recognizerRef = useRef<Recognizer | null>(null);
  const xttsPlayerRef = useRef<XttsPlayer | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Estado de la traducción incremental.
  const committedRef = useRef(""); // texto ya traducido de la frase en curso
  const latestInterimRef = useRef(""); // último interim recibido
  const flushTimerRef = useRef<number | null>(null);
  // Última frase confirmada (para descartar duplicados/eco).
  const lastCommitRef = useRef<{ norm: string; ts: number }>({ norm: "", ts: 0 });

  // Traduce un trozo de texto, lo muestra como segmento y lo reproduce.
  const commitChunk = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean) return;

    // Anti-duplicado: descarta la misma frase si llega repetida en pocos
    // segundos (típico del eco: el micro capta la voz reproducida y se
    // re-transcribe casi idéntica).
    const norm = normalizeText(clean);
    const now = Date.now();
    if (
      norm &&
      norm === lastCommitRef.current.norm &&
      now - lastCommitRef.current.ts < DEDUPE_MS
    ) {
      return;
    }
    lastCommitRef.current = { norm, ts: now };

    const id = nextId();
    const segment: TranscriptSegment = {
      id,
      original: clean,
      translated: "…",
      isFinal: true,
      timestamp: Date.now(),
    };
    setSegments((prev) => [...prev, segment]);

    const opts = optionsRef.current;
    try {
      const translated = await translate({
        text: clean,
        from: opts.sourceShort,
        to: opts.targetShort,
        settings: opts.settings,
      });
      setSegments((prev) =>
        prev.map((s) => (s.id === id ? { ...s, translated } : s))
      );
      if (opts.speakOutput && translated) {
        const s = opts.settings;
        const useXtts = s.ttsEngine === "xtts" && !!s.xttsServerUrl;
        const useEleven =
          s.ttsEngine === "elevenlabs" &&
          !!s.elevenLabsKey &&
          !!s.elevenLabsVoiceId;
        if (useXtts) {
          if (!xttsPlayerRef.current) xttsPlayerRef.current = new XttsPlayer();
          xttsPlayerRef.current.enqueue({
            text: translated,
            serverUrl: s.xttsServerUrl!,
            language: opts.targetShort,
            outputDeviceId: opts.outputDeviceId,
            onError: (m) => setError(`Voz (XTTS): ${m}`),
          });
        } else if (useEleven) {
          elevenLabsQueue.enqueue({
            text: translated,
            apiKey: s.elevenLabsKey!,
            voiceId: s.elevenLabsVoiceId!,
            modelId: s.elevenLabsModel,
            onError: (m) => setError(`Voz (ElevenLabs): ${m}`),
          });
        } else {
          speechQueue.enqueue({
            text: translated,
            lang: opts.targetLang,
            voiceURI: opts.outputVoiceURI,
            rate: opts.rate ?? 1,
          });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Error al traducir: ${msg}`);
      setSegments((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, translated: "⚠️ (fallo de traducción)" } : s
        )
      );
    }
  }, []);

  // Devuelve la parte del interim que aún no se ha traducido.
  const pendingOf = (full: string): string => {
    const committed = committedRef.current;
    return full.startsWith(committed) ? full.slice(committed.length) : full;
  };

  const clearFlushTimer = () => {
    if (flushTimerRef.current !== null) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  };

  // Suelta el trozo pendiente si tiene suficientes palabras.
  const flushPending = useCallback(
    (minWords: number) => {
      const full = latestInterimRef.current;
      const pending = pendingOf(full).trim();
      if (countWords(pending) >= minWords) {
        committedRef.current = full;
        setInterim("");
        void commitChunk(pending);
      }
    },
    [commitChunk]
  );

  const handleInterim = useCallback(
    (text: string) => {
      latestInterimRef.current = text;
      const pending = pendingOf(text).trim();
      setInterim(pending);
      clearFlushTimer();

      if (countWords(pending) >= CHUNK_MAX_WORDS) {
        // Acumuló bastante: soltar ya, sin esperar pausa.
        flushPending(CHUNK_MAX_WORDS);
      } else {
        // Esperar una micro-pausa (el timer se reinicia con cada palabra nueva).
        flushTimerRef.current = window.setTimeout(
          () => flushPending(CHUNK_MIN_WORDS),
          STABILITY_MS
        );
      }
    },
    [flushPending]
  );

  const handleFinal = useCallback(
    (text: string) => {
      clearFlushTimer();
      const remaining = pendingOf(text).trim();
      committedRef.current = "";
      latestInterimRef.current = "";
      setInterim("");
      if (remaining) void commitChunk(remaining);
    },
    [commitChunk]
  );

  const start = useCallback(() => {
    setError(null);
    committedRef.current = "";
    latestInterimRef.current = "";
    // Cerrar cualquier reconocedor previo y crear uno según el motor elegido.
    if (recognizerRef.current) {
      recognizerRef.current.stop();
      recognizerRef.current = null;
    }
    const opts = optionsRef.current;
    const vadCbs = {
      onInterim: (t: string) => setInterim(t === "…" ? "escuchando…" : t),
      onFinal: handleFinal,
      onError: (e: string) => setError(e),
      onStateChange: (listening: boolean) => setActive(listening),
    };
    if (opts.settings.sttEngine === "whisper" && opts.sttServerUrl) {
      recognizerRef.current = new WhisperRecognizer(
        opts.sttServerUrl,
        opts.sourceShort,
        opts.inputDeviceId,
        vadCbs
      );
    } else if (opts.settings.sttEngine === "gemini" && opts.settings.geminiKey) {
      recognizerRef.current = new GeminiRecognizer(
        opts.settings.geminiKey,
        opts.sourceShort,
        opts.inputDeviceId,
        vadCbs
      );
    } else {
      recognizerRef.current = new SpeechRecognizer(opts.sourceLang, {
        onInterim: handleInterim,
        onFinal: handleFinal,
        onError: (e) => setError(`Reconocimiento: ${e}`),
        onStateChange: (listening) => setActive(listening),
      });
    }
    void recognizerRef.current.start();
  }, [handleInterim, handleFinal]);

  const stop = useCallback(() => {
    clearFlushTimer();
    recognizerRef.current?.stop();
    setActive(false);
    setInterim("");
    committedRef.current = "";
    latestInterimRef.current = "";
  }, []);

  const clear = useCallback(() => {
    setSegments([]);
    setInterim("");
    setError(null);
  }, []);

  useEffect(() => {
    const opts = optionsRef.current;
    const lang =
      opts.settings.sttEngine === "whisper" ? opts.sourceShort : opts.sourceLang;
    recognizerRef.current?.setLanguage(lang);
  }, [options.sourceLang, options.sourceShort]);

  useEffect(() => {
    return () => {
      clearFlushTimer();
      recognizerRef.current?.stop();
    };
  }, []);

  return { active, interim, segments, error, start, stop, clear };
}
