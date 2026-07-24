// Servicio de traducción con proveedores intercambiables.
// Por defecto usa MyMemory (gratis, sin API key). Se pueden conectar
// OpenAI o DeepL con una API key para mayor calidad, o LibreTranslate propio.

import type { ProviderId, TranslationSettings } from "../types";

export interface TranslateParams {
  text: string;
  /** Código corto ISO-639-1 del idioma de origen, p. ej. "en". */
  from: string;
  /** Código corto ISO-639-1 del idioma de destino, p. ej. "es". */
  to: string;
  settings: TranslationSettings;
}

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  needsKey: boolean;
  description: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "google",
    label: "Google Translate (gratis, recomendado)",
    needsKey: false,
    description: "Calidad de Google Translate, gratis y sin API key. La mejor opción gratuita.",
  },
  {
    id: "mymemory",
    label: "MyMemory (gratis, básico)",
    needsKey: false,
    description: "Sin API key. Calidad básica. Límite diario de uso.",
  },
  {
    id: "libretranslate",
    label: "LibreTranslate (self-host)",
    needsKey: false,
    description: "Servidor propio o público. Configura el endpoint.",
  },
  {
    id: "openai",
    label: "OpenAI (mejor calidad)",
    needsKey: true,
    description: "Traducción natural y con contexto. Requiere API key.",
  },
  {
    id: "deepl",
    label: "DeepL (alta calidad)",
    needsKey: true,
    description: "Excelente para EN/ES/DE/FR. Requiere API key (puede fallar por CORS en navegador).",
  },
  {
    id: "gemini",
    label: "Google Gemini (gratis + buena)",
    needsKey: true,
    description: "Muy buena calidad y con capa gratuita. Recomendado. Requiere API key de Google AI Studio.",
  },
];

class TranslationError extends Error {}

/** Traduce un texto. Lanza TranslationError si falla el proveedor. */
export async function translate(params: TranslateParams): Promise<string> {
  const { text, from, to } = params;
  if (!text.trim()) return "";
  if (from === to) return text;

  switch (params.settings.provider) {
    case "google":
      return translateGoogle(params);
    case "openai":
      return translateOpenAI(params);
    case "deepl":
      return translateDeepL(params);
    case "gemini":
      return translateGemini(params);
    case "libretranslate":
      return translateLibre(params);
    case "mymemory":
    default:
      return translateMyMemory(params);
  }
}

async function translateGemini({
  text,
  from,
  to,
  settings,
}: TranslateParams): Promise<string> {
  if (!settings.apiKey) throw new TranslationError("Falta la API key de Gemini");
  // Alias mantenido por Google que apunta siempre al último Flash disponible.
  const model = "gemini-flash-latest";
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=` +
    encodeURIComponent(settings.apiKey);
  const prompt =
    `You are a professional real-time interpreter. Translate the text below from ${from} to ${to}. ` +
    "Keep the tone natural and colloquial, as a person would actually say it. " +
    "Reply with ONLY the translation, with no quotes, notes or explanations.\n\nText: " +
    text;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new TranslationError(`Gemini HTTP ${res.status}`);
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const translated =
    data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!translated) throw new TranslationError("Gemini: respuesta vacía");
  return translated;
}

async function translateGoogle({
  text,
  from,
  to,
}: TranslateParams): Promise<string> {
  // Endpoint público de Google Translate (sin API key). Devuelve CORS *.
  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=" +
    encodeURIComponent(from) +
    "&tl=" +
    encodeURIComponent(to) +
    "&q=" +
    encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new TranslationError(`Google HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new TranslationError("Google: respuesta inesperada");
  }
  const segments = data[0] as unknown[];
  const translated = segments
    .map((seg) =>
      Array.isArray(seg) && typeof seg[0] === "string" ? seg[0] : ""
    )
    .join("");
  if (!translated.trim()) throw new TranslationError("Google: respuesta vacía");
  return translated;
}

async function translateMyMemory({
  text,
  from,
  to,
}: TranslateParams): Promise<string> {
  const url =
    "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(text) +
    `&langpair=${from}|${to}`;
  const res = await fetch(url);
  if (!res.ok) throw new TranslationError(`MyMemory HTTP ${res.status}`);
  const data = (await res.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number;
  };
  const translated = data.responseData?.translatedText;
  if (!translated) throw new TranslationError("MyMemory: respuesta vacía");
  return decodeEntities(translated);
}

async function translateLibre({
  text,
  from,
  to,
  settings,
}: TranslateParams): Promise<string> {
  const endpoint = (
    settings.libreEndpoint || "https://libretranslate.com"
  ).replace(/\/$/, "");
  const res = await fetch(`${endpoint}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      q: text,
      source: from,
      target: to,
      format: "text",
      ...(settings.apiKey ? { api_key: settings.apiKey } : {}),
    }),
  });
  if (!res.ok) throw new TranslationError(`LibreTranslate HTTP ${res.status}`);
  const data = (await res.json()) as { translatedText?: string };
  if (!data.translatedText)
    throw new TranslationError("LibreTranslate: respuesta vacía");
  return data.translatedText;
}

async function translateDeepL({
  text,
  to,
  settings,
}: TranslateParams): Promise<string> {
  if (!settings.apiKey) throw new TranslationError("Falta la API key de DeepL");
  // Las keys "free" terminan en ":fx" y usan otro host.
  const host = settings.apiKey.endsWith(":fx")
    ? "https://api-free.deepl.com"
    : "https://api.deepl.com";
  const body = new URLSearchParams();
  body.append("text", text);
  body.append("target_lang", to.toUpperCase());
  const res = await fetch(`${host}/v2/translate`, {
    method: "POST",
    headers: {
      Authorization: `DeepL-Auth-Key ${settings.apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new TranslationError(`DeepL HTTP ${res.status}`);
  const data = (await res.json()) as {
    translations?: { text: string }[];
  };
  const translated = data.translations?.[0]?.text;
  if (!translated) throw new TranslationError("DeepL: respuesta vacía");
  return translated;
}

async function translateOpenAI({
  text,
  from,
  to,
  settings,
}: TranslateParams): Promise<string> {
  if (!settings.apiKey) throw new TranslationError("Falta la API key de OpenAI");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are a professional real-time interpreter. Translate the user's " +
            `text from ${from} to ${to}. Keep the tone natural and colloquial. ` +
            "Respond with ONLY the translation, no quotes, no explanations.",
        },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) throw new TranslationError(`OpenAI HTTP ${res.status}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const translated = data.choices?.[0]?.message?.content?.trim();
  if (!translated) throw new TranslationError("OpenAI: respuesta vacía");
  return translated;
}

/** Decodifica entidades HTML que a veces devuelve MyMemory (&#39; etc.). */
function decodeEntities(input: string): string {
  const el = document.createElement("textarea");
  el.innerHTML = input;
  return el.value;
}

export { TranslationError };
