import { useEffect, useMemo, useState } from "react";
import { TranslationPanel } from "./components/TranslationPanel";
import { SetupGuide } from "./components/SetupGuide";
import { Settings } from "./components/Settings";
import { useTranslator } from "./useTranslator";
import { isRecognitionSupported } from "./services/speechRecognition";
import {
  isSynthesisSupported,
  loadVoices,
  speechQueue,
} from "./services/speechSynthesis";
import { listAudioInputs, listAudioOutputs } from "./services/whisperStt";
import { LANGUAGES, findLanguage } from "./types";
import type { TranslationSettings } from "./types";

const STORAGE_KEY = "vozpuente:v1";

interface PersistedState {
  myLang: string;
  otherLang: string;
  settings: TranslationSettings;
  myVoiceURI: string;
  otherVoiceURI: string;
  rate: number;
  speakToMe: boolean;
  speakToCall: boolean;
  listenInputId: string;
  speakInputId: string;
  listenOutputId: string;
}

const DEFAULTS: PersistedState = {
  myLang: "es-ES",
  otherLang: "en-US",
  // Preconfigurado para uso real: reconocimiento por Whisper y voz clonada por
  // XTTS (ambos usan el servidor de Colab). Así lo único que hay que rellenar
  // es la URL del servidor en Ajustes.
  settings: { provider: "google", sttEngine: "whisper", ttsEngine: "xtts" },
  myVoiceURI: "",
  otherVoiceURI: "",
  rate: 1,
  speakToMe: true,
  speakToCall: true,
  listenInputId: "",
  speakInputId: "",
  listenOutputId: "",
};

/**
 * Devuelve el deviceId del primer dispositivo cuya etiqueta contenga alguna de
 * las palabras clave (en orden de preferencia). "" si no hay coincidencia.
 */
function pickByKeywords(
  devices: { deviceId: string; label: string }[],
  keywords: string[]
): string {
  for (const kw of keywords) {
    const match = devices.find((d) => d.label.toLowerCase().includes(kw));
    if (match) return match.deviceId;
  }
  return "";
}

function loadPersisted(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULTS;
}

export default function App() {
  const [state, setState] = useState<PersistedState>(loadPersisted);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [audioInputs, setAudioInputs] = useState<
    { deviceId: string; label: string }[]
  >([]);
  const [audioOutputs, setAudioOutputs] = useState<
    { deviceId: string; label: string }[]
  >([]);
  const [showGuide, setShowGuide] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const recognitionOk = isRecognitionSupported();
  const synthesisOk = isSynthesisSupported();

  const myLang = findLanguage(state.myLang) ?? LANGUAGES[0];
  const otherLang = findLanguage(state.otherLang) ?? LANGUAGES[1];

  // Persistencia en localStorage.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Carga de voces TTS.
  useEffect(() => {
    loadVoices().then((v) => {
      setVoices(v);
      speechQueue.setVoices(v);
    });
  }, []);

  // Lista de dispositivos de entrada (para el modo Whisper) y autoselección
  // por nombre, para que el usuario no tenga que elegirlos a mano.
  const refreshDevices = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      /* sin permiso todavía; se listarán sin etiqueta */
    }
    const inputs = await listAudioInputs();
    const outputs = await listAudioOutputs();
    setAudioInputs(inputs);
    setAudioOutputs(outputs);

    // Autoselección: solo rellena lo que aún esté vacío y haya un match claro.
    // Así, tras dar permiso al micrófono, los dispositivos se eligen solos y
    // el usuario únicamente tiene que pegar la URL del servidor.
    setState((prev) => {
      const patch: Partial<PersistedState> = {};
      if (!prev.listenInputId) {
        // Panel Escuchar = audio de la llamada (cable virtual BlackHole 2ch).
        const id = pickByKeywords(inputs, ["blackhole 2"]);
        if (id) patch.listenInputId = id;
      }
      if (!prev.speakInputId) {
        // Panel Hablar = tu micrófono real (integrado del portátil).
        const id = pickByKeywords(inputs, [
          "macbook",
          "built-in",
          "integrado",
          "internal",
        ]);
        if (id) patch.speakInputId = id;
      }
      if (!prev.listenOutputId) {
        // Salida del panel Escuchar = tus auriculares (solo para ti).
        const id = pickByKeywords(outputs, ["airpod", "auricular", "headphone"]);
        if (id) patch.listenOutputId = id;
      }
      return Object.keys(patch).length ? { ...prev, ...patch } : prev;
    });
  };

  useEffect(() => {
    void refreshDevices();
  }, []);

  const whisperReady =
    state.settings.sttEngine === "whisper" && !!state.settings.xttsServerUrl;
  const geminiSttReady =
    state.settings.sttEngine === "gemini" && !!state.settings.geminiKey;
  // STT por servidor/API listo (Whisper o Gemini): habilita los paneles aunque
  // el navegador no soporte Web Speech.
  const serverSttReady = whisperReady || geminiSttReady;

  // Panel "Escuchar": la otra persona habla -> lo oigo/leo en mi idioma.
  const listen = useTranslator({
    sourceLang: otherLang.code,
    targetLang: myLang.code,
    sourceShort: otherLang.short,
    targetShort: myLang.short,
    settings: state.settings,
    speakOutput: state.speakToMe,
    outputVoiceURI: state.myVoiceURI || undefined,
    rate: state.rate,
    sttServerUrl: state.settings.xttsServerUrl,
    inputDeviceId: state.listenInputId || undefined,
    outputDeviceId: state.listenOutputId || undefined,
  });

  // Panel "Hablar": yo hablo en mi idioma -> sale en el idioma de la otra persona.
  const speak = useTranslator({
    sourceLang: myLang.code,
    targetLang: otherLang.code,
    sourceShort: myLang.short,
    targetShort: otherLang.short,
    settings: state.settings,
    speakOutput: state.speakToCall,
    outputVoiceURI: state.otherVoiceURI || undefined,
    rate: state.rate,
    sttServerUrl: state.settings.xttsServerUrl,
    inputDeviceId: state.speakInputId || undefined,
  });

  const update = (patch: Partial<PersistedState>) =>
    setState((prev) => ({ ...prev, ...patch }));

  const swapLanguages = () => {
    listen.stop();
    speak.stop();
    update({ myLang: state.otherLang, otherLang: state.myLang });
  };

  const anyActive = listen.active || speak.active;

  const providerBadge = useMemo(() => {
    const map: Record<string, string> = {
      google: "Google",
      mymemory: "MyMemory",
      libretranslate: "LibreTranslate",
      openai: "OpenAI",
      deepl: "DeepL",
      gemini: "Gemini",
    };
    return map[state.settings.provider] ?? state.settings.provider;
  }, [state.settings.provider]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-icon">🎙️</span>
          <div>
            <h1>VozPuente</h1>
            <p>Traductor de voz en tiempo real para videollamadas</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn ghost" onClick={() => setShowSettings((s) => !s)}>
            ⚙️ Ajustes
          </button>
          <button className="btn ghost" onClick={() => setShowGuide(true)}>
            🎧 Guía Meet/Teams
          </button>
        </div>
      </header>

      {!recognitionOk && (
        <div className="warning-banner">
          ⚠️ Tu navegador no soporta reconocimiento de voz. Abre esta app en{" "}
          <strong>Google Chrome</strong> o <strong>Microsoft Edge</strong>.
        </div>
      )}
      {recognitionOk && !synthesisOk && (
        <div className="warning-banner">
          ⚠️ Tu navegador no soporta síntesis de voz. Podrás leer las
          traducciones, pero no escucharlas.
        </div>
      )}

      <div className="lang-bar">
        <div className="lang-select">
          <label>Mi idioma</label>
          <select
            value={state.myLang}
            onChange={(e) => update({ myLang: e.target.value })}
            disabled={anyActive}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.flag} {l.label}
              </option>
            ))}
          </select>
        </div>

        <button className="swap-btn" onClick={swapLanguages} disabled={anyActive} title="Intercambiar idiomas">
          ⇄
        </button>

        <div className="lang-select">
          <label>Idioma de la otra persona</label>
          <select
            value={state.otherLang}
            onChange={(e) => update({ otherLang: e.target.value })}
            disabled={anyActive}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.flag} {l.label}
              </option>
            ))}
          </select>
        </div>

        <div className="provider-badge">Motor: {providerBadge}</div>
      </div>

      <Settings
        open={showSettings}
        settings={state.settings}
        onChange={(settings) => update({ settings })}
        voices={voices}
        myLangShort={myLang.short}
        otherLangShort={otherLang.short}
        myVoiceURI={state.myVoiceURI}
        otherVoiceURI={state.otherVoiceURI}
        onMyVoiceChange={(myVoiceURI) => update({ myVoiceURI })}
        onOtherVoiceChange={(otherVoiceURI) => update({ otherVoiceURI })}
        rate={state.rate}
        onRateChange={(rate) => update({ rate })}
        audioInputs={audioInputs}
        listenInputId={state.listenInputId}
        speakInputId={state.speakInputId}
        onListenInputChange={(listenInputId) => update({ listenInputId })}
        onSpeakInputChange={(speakInputId) => update({ speakInputId })}
        onRefreshDevices={refreshDevices}
        audioOutputs={audioOutputs}
        listenOutputId={state.listenOutputId}
        onListenOutputChange={(listenOutputId) => update({ listenOutputId })}
      />

      <main className="panels">
        <div className="panel-wrap">
          <label className="speak-toggle">
            <input
              type="checkbox"
              checked={state.speakToMe}
              onChange={(e) => update({ speakToMe: e.target.checked })}
            />
            🔊 Reproducir en voz alta para mí
          </label>
          <TranslationPanel
            title="Escuchar"
            icon="🎧"
            accent="#6366f1"
            sourceLabel={`${otherLang.flag} ${otherLang.label}`}
            targetLabel={`${myLang.flag} ${myLang.label}`}
            active={listen.active}
            interim={listen.interim}
            segments={listen.segments}
            error={listen.error}
            onToggle={() => (listen.active ? listen.stop() : listen.start())}
            onClear={listen.clear}
            disabled={!recognitionOk && !serverSttReady}
          />
        </div>

        <div className="panel-wrap">
          <label className="speak-toggle">
            <input
              type="checkbox"
              checked={state.speakToCall}
              onChange={(e) => update({ speakToCall: e.target.checked })}
            />
            🔊 Reproducir hacia la llamada (cable virtual)
          </label>
          <TranslationPanel
            title="Hablar"
            icon="🗣️"
            accent="#10b981"
            sourceLabel={`${myLang.flag} ${myLang.label}`}
            targetLabel={`${otherLang.flag} ${otherLang.label}`}
            active={speak.active}
            interim={speak.interim}
            segments={speak.segments}
            error={speak.error}
            onToggle={() => (speak.active ? speak.stop() : speak.start())}
            onClear={speak.clear}
            disabled={!recognitionOk && !serverSttReady}
          />
        </div>
      </main>

      <footer className="app-footer">
        <button className="btn link" onClick={() => setShowGuide(true)}>
          ¿Cómo conectarlo a Google Meet o Teams? →
        </button>
      </footer>

      <SetupGuide open={showGuide} onClose={() => setShowGuide(false)} />
    </div>
  );
}
