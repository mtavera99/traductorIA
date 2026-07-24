// Idiomas soportados. Se puede ampliar fácilmente añadiendo entradas aquí.
export interface LanguageOption {
  /** Código BCP-47 usado por STT y TTS, p. ej. "en-US". */
  code: string;
  /** Código corto ISO-639-1 usado por los traductores, p. ej. "en". */
  short: string;
  /** Nombre legible para la UI. */
  label: string;
  /** Emoji de bandera para la UI. */
  flag: string;
}

export const LANGUAGES: LanguageOption[] = [
  { code: "es-ES", short: "es", label: "Español", flag: "🇪🇸" },
  { code: "en-US", short: "en", label: "Inglés (EE. UU.)", flag: "🇺🇸" },
  { code: "en-GB", short: "en", label: "Inglés (Reino Unido)", flag: "🇬🇧" },
  { code: "es-MX", short: "es", label: "Español (México)", flag: "🇲🇽" },
  { code: "pt-BR", short: "pt", label: "Portugués (Brasil)", flag: "🇧🇷" },
  { code: "fr-FR", short: "fr", label: "Francés", flag: "🇫🇷" },
  { code: "de-DE", short: "de", label: "Alemán", flag: "🇩🇪" },
  { code: "it-IT", short: "it", label: "Italiano", flag: "🇮🇹" },
];

export function findLanguage(code: string): LanguageOption | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

export type Direction = "listen" | "speak";

export type ProviderId =
  | "google"
  | "mymemory"
  | "libretranslate"
  | "openai"
  | "deepl"
  | "gemini";

/** Motor de síntesis de voz (TTS). */
export type TtsEngine = "browser" | "elevenlabs" | "xtts";

/** Motor de reconocimiento de voz (STT). */
export type SttEngine = "browser" | "whisper" | "gemini";

export interface TranslationSettings {
  provider: ProviderId;
  /** API key del motor de traducción (OpenAI / DeepL / Gemini). Solo en localStorage. */
  apiKey?: string;
  /** Endpoint personalizado para LibreTranslate. */
  libreEndpoint?: string;

  // --- Motor de reconocimiento (STT) ---
  /**
   * "browser" = Web Speech (un solo micrófono).
   * "whisper" = servidor Colab (por dispositivo).
   * "gemini"  = API de Gemini (por dispositivo, NO usa la GPU del Colab).
   */
  sttEngine?: SttEngine;
  /** API key de Gemini para el reconocimiento de voz (STT). Solo en localStorage. */
  geminiKey?: string;
  /**
   * Supresión de eco: si es true (por defecto), el reconocedor deja de captar
   * mientras suena la traducción (evita bucles con altavoz). Desactívala si
   * usas auriculares y quieres hablar de corrido sin que se corte.
   */
  echoSuppression?: boolean;

  // --- Motor de voz (TTS) ---
  /** "browser" = voces del navegador (gratis). "elevenlabs" = tu voz clonada. */
  ttsEngine?: TtsEngine;
  /** API key de ElevenLabs. */
  elevenLabsKey?: string;
  /** ID de la voz clonada en ElevenLabs (Voice ID). */
  elevenLabsVoiceId?: string;
  /** Modelo de ElevenLabs (por defecto multilingüe rápido). */
  elevenLabsModel?: string;

  /** URL del servidor XTTS propio (Coqui, voz clonada gratis). */
  xttsServerUrl?: string;
}

export interface TranscriptSegment {
  id: string;
  original: string;
  translated: string;
  isFinal: boolean;
  timestamp: number;
}
