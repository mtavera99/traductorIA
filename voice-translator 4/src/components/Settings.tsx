import { useState } from "react";
import { PROVIDERS } from "../services/translation";
import { voicesForLanguage } from "../services/speechSynthesis";
import { listElevenLabsVoices } from "../services/elevenLabsTts";
import { checkXttsServer } from "../services/xttsTts";
import type {
  ProviderId,
  SttEngine,
  TranslationSettings,
  TtsEngine,
} from "../types";

interface Props {
  open: boolean;
  settings: TranslationSettings;
  onChange: (s: TranslationSettings) => void;
  voices: SpeechSynthesisVoice[];
  myLangShort: string;
  otherLangShort: string;
  myVoiceURI: string;
  otherVoiceURI: string;
  onMyVoiceChange: (uri: string) => void;
  onOtherVoiceChange: (uri: string) => void;
  rate: number;
  onRateChange: (r: number) => void;
  audioInputs: { deviceId: string; label: string }[];
  listenInputId: string;
  speakInputId: string;
  onListenInputChange: (id: string) => void;
  onSpeakInputChange: (id: string) => void;
  onRefreshDevices: () => void;
  audioOutputs: { deviceId: string; label: string }[];
  listenOutputId: string;
  onListenOutputChange: (id: string) => void;
}

export function Settings({
  open,
  settings,
  onChange,
  voices,
  myLangShort,
  otherLangShort,
  myVoiceURI,
  otherVoiceURI,
  onMyVoiceChange,
  onOtherVoiceChange,
  rate,
  onRateChange,
  audioInputs,
  listenInputId,
  speakInputId,
  onListenInputChange,
  onSpeakInputChange,
  onRefreshDevices,
  audioOutputs,
  listenOutputId,
  onListenOutputChange,
}: Props) {
  const [voiceTest, setVoiceTest] = useState<string>("");
  const [foundVoices, setFoundVoices] = useState<
    { voiceId: string; name: string }[]
  >([]);
  const [xttsTest, setXttsTest] = useState<string>("");

  if (!open) return null;

  const current = PROVIDERS.find((p) => p.id === settings.provider);
  const myVoices = voicesForLanguage(voices, myLangShort);
  const otherVoices = voicesForLanguage(voices, otherLangShort);
  const ttsEngine: TtsEngine = settings.ttsEngine ?? "browser";
  const usingBrowserTts = ttsEngine === "browser";
  const sttEngine: SttEngine = settings.sttEngine ?? "browser";
  // Whisper y Gemini capturan de un dispositivo concreto y permiten ambas
  // direcciones a la vez; comparten los mismos selectores de audio.
  const serverStt = sttEngine === "whisper" || sttEngine === "gemini";

  const testElevenLabs = async () => {
    if (!settings.elevenLabsKey) {
      setVoiceTest("Escribe primero tu API key de ElevenLabs.");
      return;
    }
    setVoiceTest("Comprobando…");
    try {
      const list = await listElevenLabsVoices(settings.elevenLabsKey);
      setFoundVoices(list);
      setVoiceTest(
        list.length
          ? `✓ Conectado. ${list.length} voces disponibles (elige una abajo).`
          : "✓ Conectado, pero no hay voces. Clona tu voz en elevenlabs.io."
      );
    } catch (err) {
      setVoiceTest(
        `✗ Error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const testXtts = async () => {
    const urlToTest = settings.xttsServerUrl || "http://localhost:8020";
    setXttsTest("Comprobando…");
    const r = await checkXttsServer(urlToTest);
    setXttsTest(r.message);
  };

  return (
    <div className="settings-drawer">
      <div className="settings-grid">
        <div className="field">
          <label>Motor de traducción</label>
          <select
            value={settings.provider}
            onChange={(e) =>
              onChange({ ...settings, provider: e.target.value as ProviderId })
            }
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          {current && <small>{current.description}</small>}
        </div>

        {current?.needsKey && (
          <div className="field">
            <label>API key ({current.label})</label>
            <input
              type="password"
              placeholder="Pega tu API key"
              value={settings.apiKey ?? ""}
              onChange={(e) => onChange({ ...settings, apiKey: e.target.value })}
            />
            <small>Se guarda solo en tu navegador (localStorage).</small>
          </div>
        )}

        {settings.provider === "libretranslate" && (
          <div className="field">
            <label>Endpoint de LibreTranslate</label>
            <input
              type="text"
              placeholder="https://libretranslate.com"
              value={settings.libreEndpoint ?? ""}
              onChange={(e) =>
                onChange({ ...settings, libreEndpoint: e.target.value })
              }
            />
          </div>
        )}

        <div className="field">
          <label>Reconocimiento de voz (STT)</label>
          <select
            value={sttEngine}
            onChange={(e) =>
              onChange({ ...settings, sttEngine: e.target.value as SttEngine })
            }
          >
            <option value="browser">Navegador (rápido · un solo micrófono)</option>
            <option value="whisper">Whisper · servidor (preciso · bidireccional)</option>
            <option value="gemini">Gemini · API (preciso · NO usa la GPU del Colab)</option>
          </select>
          <small>
            {sttEngine === "browser" &&
              "Usa el micrófono del sistema. No permite Escuchar y Hablar a la vez."}
            {sttEngine === "whisper" &&
              "Preciso y permite ambas direcciones SIMULTÁNEAS. Usa la GPU del servidor de Colab (la misma que XTTS)."}
            {sttEngine === "gemini" &&
              "Preciso y bidireccional. Transcribe con la API de Gemini, así NO carga la GPU del Colab (menos errores y más fluido). Requiere API key."}
          </small>
        </div>

        {sttEngine === "whisper" && (
          <div className="field">
            <label>URL del servidor (Whisper + XTTS)</label>
            <input
              type="text"
              placeholder="https://xxxx.trycloudflare.com"
              value={settings.xttsServerUrl ?? ""}
              onChange={(e) =>
                onChange({ ...settings, xttsServerUrl: e.target.value })
              }
            />
            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 6 }}
              onClick={testXtts}
            >
              Probar conexión con el servidor
            </button>
            {xttsTest && <small>{xttsTest}</small>}
          </div>
        )}

        {sttEngine === "gemini" && (
          <div className="field">
            <label>API key de Gemini (reconocimiento de voz)</label>
            <input
              type="password"
              placeholder="Pega tu API key de Google AI Studio"
              value={settings.geminiKey ?? ""}
              onChange={(e) =>
                onChange({ ...settings, geminiKey: e.target.value })
              }
            />
            <small>
              Puede ser la misma key de Gemini que usas para traducir. Se guarda
              solo en tu navegador (localStorage). Recuerda que sigues
              necesitando el servidor de Colab para la <strong>voz clonada</strong>{" "}
              (XTTS).
            </small>
          </div>
        )}

        {serverStt && (
          <>
            <div className="field">
              <label>🎧 Entrada del panel Escuchar (voz de ELLOS)</label>
              <select
                value={listenInputId}
                onChange={(e) => onListenInputChange(e.target.value)}
              >
                <option value="">Predeterminado del sistema</option>
                {audioInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
              <small>Elige <strong>BlackHole 2ch</strong> (el audio de la llamada).</small>
            </div>

            <div className="field">
              <label>🗣️ Entrada del panel Hablar (TU voz)</label>
              <select
                value={speakInputId}
                onChange={(e) => onSpeakInputChange(e.target.value)}
              >
                <option value="">Predeterminado del sistema</option>
                {audioInputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
              <small>Elige tu <strong>micrófono real</strong> (MacBook).</small>
              <button
                type="button"
                className="btn ghost"
                style={{ marginTop: 6 }}
                onClick={onRefreshDevices}
              >
                Actualizar lista de dispositivos
              </button>
            </div>

            <div className="field">
              <label>🔈 Salida del panel Escuchar (dónde OYES su español)</label>
              <select
                value={listenOutputId}
                onChange={(e) => onListenOutputChange(e.target.value)}
              >
                <option value="">Salida por defecto del sistema</option>
                {audioOutputs.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
              <small>
                Elige tus <strong>AirPods</strong>. Así oyes la traducción al
                español solo tú, sin que se les cuele el eco a ellos. (Requiere
                Motor de voz = XTTS.)
              </small>
            </div>

            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={settings.echoSuppression === true}
                  onChange={(e) =>
                    onChange({ ...settings, echoSuppression: e.target.checked })
                  }
                  style={{ marginRight: 8 }}
                />
                Supresión de eco (solo si escuchas por altavoz)
              </label>
              <small>
                <strong>Déjala DESMARCADA si usas auriculares</strong> (lo normal):
                así la app te capta de corrido aunque el clon esté hablando y no
                se omite nada. Márcala solo si escuchas la traducción por altavoz,
                para evitar bucles de eco.
              </small>
            </div>
          </>
        )}

        <div className="field">
          <label>Motor de voz (TTS)</label>
          <select
            value={ttsEngine}
            onChange={(e) =>
              onChange({ ...settings, ttsEngine: e.target.value as TtsEngine })
            }
          >
            <option value="browser">Navegador (gratis, voz genérica)</option>
            <option value="elevenlabs">ElevenLabs (tu voz clonada)</option>
            <option value="xtts">XTTS · Coqui (tu voz, gratis · servidor propio)</option>
          </select>
          <small>
            {ttsEngine === "browser" &&
              "Voces del sistema. Gratis pero suenan robóticas."}
            {ttsEngine === "elevenlabs" &&
              "Genera el audio con tu propia voz. Requiere cuenta y API key de ElevenLabs."}
            {ttsEngine === "xtts" &&
              "Tu voz clonada gratis con Coqui XTTS. Necesita un servidor propio (Colab/GPU)."}
          </small>
        </div>

        {usingBrowserTts && (
          <>
            <div className="field">
              <label>Voz para escucharte a ti mismo ({myLangShort})</label>
              <select
                value={myVoiceURI}
                onChange={(e) => onMyVoiceChange(e.target.value)}
              >
                <option value="">Automática</option>
                {myVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Voz de salida hacia la llamada ({otherLangShort})</label>
              <select
                value={otherVoiceURI}
                onChange={(e) => onOtherVoiceChange(e.target.value)}
              >
                <option value="">Automática</option>
                {otherVoices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Velocidad de la voz: {rate.toFixed(1)}×</label>
              <input
                type="range"
                min="0.6"
                max="1.6"
                step="0.1"
                value={rate}
                onChange={(e) => onRateChange(parseFloat(e.target.value))}
              />
            </div>
          </>
        )}

        {ttsEngine === "elevenlabs" && (
          <>
            <div className="field">
              <label>API key de ElevenLabs</label>
              <input
                type="password"
                placeholder="Pega tu API key de ElevenLabs"
                value={settings.elevenLabsKey ?? ""}
                onChange={(e) =>
                  onChange({ ...settings, elevenLabsKey: e.target.value })
                }
              />
              <small>Se guarda solo en tu navegador (localStorage).</small>
            </div>

            <div className="field">
              <label>Voice ID (tu voz clonada)</label>
              <input
                type="text"
                placeholder="p. ej. 21m00Tcm4TlvDq8ikWAM"
                value={settings.elevenLabsVoiceId ?? ""}
                onChange={(e) =>
                  onChange({ ...settings, elevenLabsVoiceId: e.target.value })
                }
              />
              <button
                type="button"
                className="btn ghost"
                style={{ marginTop: 6 }}
                onClick={testElevenLabs}
              >
                Probar clave y listar mis voces
              </button>
              {voiceTest && <small>{voiceTest}</small>}
              {foundVoices.length > 0 && (
                <select
                  value={settings.elevenLabsVoiceId ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      elevenLabsVoiceId: e.target.value,
                    })
                  }
                >
                  <option value="">— Elige una voz —</option>
                  {foundVoices.map((v) => (
                    <option key={v.voiceId} value={v.voiceId}>
                      {v.name} ({v.voiceId.slice(0, 8)}…)
                    </option>
                  ))}
                </select>
              )}
            </div>
          </>
        )}

        {ttsEngine === "xtts" && (
          <div className="field">
            <label>URL del servidor XTTS</label>
            <input
              type="text"
              placeholder="http://localhost:8020  o  https://xxxx.trycloudflare.com"
              value={settings.xttsServerUrl ?? ""}
              onChange={(e) =>
                onChange({ ...settings, xttsServerUrl: e.target.value })
              }
            />
            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 6 }}
              onClick={testXtts}
            >
              Probar conexión con el servidor
            </button>
            {xttsTest && <small>{xttsTest}</small>}
            <small>
              Levanta el servidor XTTS en tu Mac o en Google Colab (GPU gratis)
              y pega aquí su URL. Instrucciones en la carpeta <code>server/</code>.
            </small>
          </div>
        )}
      </div>
    </div>
  );
}
