# 🎙️ VozPuente — Traductor de voz en tiempo real (bidireccional)

Traductor de voz en tiempo real para videollamadas (Google Meet, Teams, Zoom).
Permite hablar en un idioma y que la otra persona te escuche en otro **con tu
propia voz clonada**, y entender lo que ellos dicen **traducido a tu idioma**.

- 🗣️ **Hablar:** tú hablas español → la otra persona te oye en inglés (con tu voz).
- 🎧 **Escuchar:** ellos hablan inglés → tú lo oyes/lees en español.
- 🔄 **Bidireccional simultáneo** (con reconocimiento Whisper).
- 🆓 Traducción con **Google Translate** (gratis) o Gemini/OpenAI/DeepL.
- 🗣️ Voz clonada **gratis** con **Coqui XTTS** (en Google Colab) o **ElevenLabs** (pago).

---

## 🧩 Arquitectura

```
                    NAVEGADOR (esta app, React)                 SERVIDOR GPU (Google Colab)
  ┌───────────────────────────────────────────────┐         ┌──────────────────────────────┐
  🎤 Micrófono ─► captura por dispositivo ─────────┼──audio──► Whisper (/stt) ── texto ──┐   │
                                                    │         │                           │   │
  📝 texto ◄──────────────────────────────────────┼─────────┘                           │   │
     │                                              │                                     │   │
     ├─► 🌐 Traducción (Google Translate, etc.)     │                                     │   │
     │                                              │                                     │   │
     └─► 🔊 texto ─────────────────────────────────┼──texto──► XTTS (/tts_stream) ─audio─┘   │
                                                    │         │  (tu voz clonada)             │
  🔈 reproduce por dispositivo (AirPods/BlackHole) ◄┘         └──────────────────────────────┘
```

- **Frontend**: app React (un solo archivo `index.html` autocontenido tras el build).
- **Backend (opcional)**: servidor en Google Colab (`server/setup_xtts.py`) que
  corre **Whisper** (reconocimiento de voz) y **XTTS** (voz clonada) en una GPU
  gratuita, expuesto por un túnel público de Cloudflare.

---

## 🚀 Ejecutar la app

Requiere **Node 18+** y **Google Chrome / Edge**.

```bash
npm install
npm run dev            # desarrollo (http://localhost:5173)
npm run build          # build normal (carpeta dist/)
SINGLEFILE=1 npm run build -- --outDir dist-single   # un solo index.html autocontenido
```

Para usarla sin instalar nada, sirve el `index.html` autocontenido:
```bash
python3 -m http.server 8098   # y abre http://localhost:8098
```
> ⚠️ Usa siempre `http://localhost` (contexto seguro): permite micrófono y elegir
> dispositivos de audio.

---

## 🖥️ Servidor de voz + reconocimiento (Google Colab, GPU gratis)

El código está en `server/setup_xtts.py`. En un cuaderno de Colab (con **GPU T4**):

1. Sube una muestra de tu voz (`.wav/.mp3/.m4a`, **45-60 s**, limpia) por el panel de archivos.
2. Ejecuta el script (instala dependencias, carga XTTS + Whisper, abre el túnel):
   ```python
   # Descargar y ejecutar (o pega el contenido de setup_xtts.py con %%writefile)
   !python setup_xtts.py
   ```
3. Copia la URL `https://XXXX.trycloudflare.com` que imprime.
4. En la app → **Ajustes** → pega esa URL en el servidor XTTS/Whisper → *Probar conexión*
   (debe decir `cuda · streaming · whisper`).

**Endpoints del servidor:**
- `GET /health` → `{status, device, stream, whisper}`
- `POST /stt` → `multipart(audio, language)` → `{text}` (Whisper)
- `POST /tts_stream` → `{text, language}` → PCM int16 24 kHz en streaming (XTTS)
- `POST /tts` → `{text, language}` → WAV completo (XTTS)

> Colab gratis se desconecta por inactividad y tiene límite de GPU. Al reconectar
> hay que **re-ejecutar la celda** y **pegar la URL nueva**. Si un día no da GPU,
> usa **otra cuenta de Google** (cuota fresca) o **Kaggle**.

---

## 🎛️ Configuración de audio para videollamadas (macOS + BlackHole)

Instala dos cables virtuales:
```bash
brew install blackhole-2ch blackhole-16ch
```
Reinicia el Mac. En **Configuración de Audio y MIDI** crea un *Dispositivo de
salida múltiple* (BlackHole 2ch + tus auriculares; pon los auriculares como
"principal" y corrección de deriva en BlackHole).

| Cosa | Dispositivo |
|------|-------------|
| Salida del sistema | Multi-Output (BlackHole **2ch** + AirPods) |
| Meet — Micrófono | BlackHole **2ch** (recibe tu voz en inglés) |
| Meet — Altavoz | BlackHole **16ch** (la app capta la voz de ellos) |
| App — entrada **Hablar** | Tu micrófono real |
| App — entrada **Escuchar** | BlackHole **16ch** |
| App — **salida Escuchar** | AirPods (oyes su traducción, sin eco a ellos) |

> **Auriculares obligatorios** (no altavoces): evitan que el micrófono capte la
> voz traducida y se genere un bucle.

---

## ⚙️ Motores configurables (en Ajustes)

- **Traducción**: Google Translate (gratis, recomendado), MyMemory, Gemini, OpenAI, DeepL.
- **Reconocimiento (STT)**: Navegador (Web Speech, rápido, un micrófono) o **Whisper** (servidor, preciso, bidireccional).
- **Voz (TTS)**: Navegador (genérica), **ElevenLabs** (tu voz, pago) o **XTTS** (tu voz, gratis por servidor).
- Selección de **dispositivo de entrada/salida por panel** (modo Whisper).
- Traducción **incremental**: en frases largas suelta trozos sin esperar a que termines.

Las claves y ajustes se guardan **solo en tu navegador** (localStorage).

---

## 🩹 Problemas conocidos y soluciones

- **Errores 500 en cadena / "device-side assert"**: la GPU se "rompió" (assert de
  CUDA). Cura: **Reiniciar entorno de ejecución** en Colab y re-ejecutar. El
  servidor ya parte las frases largas (evita el assert de XTTS) y usa Whisper en
  **fp32 + atención eager** (evita el assert de Whisper).
- **"¡Suscríbete!", "Subtítulos por…", "jajaja"**: alucinaciones de Whisper con
  silencio/tos/risa. La app las **filtra** (ver `src/services/whisperStt.ts`).
- **Voz robótica**: usa una muestra de voz más larga y limpia (45-60 s). El
  servidor usa hasta 30 s de referencia para clonar mejor.
- **No suena en el audífono**: elige el dispositivo en "Salida del panel Escuchar".
- **Colab sin GPU**: límite de la cuenta; usa otra cuenta de Google o espera.

---

## 📁 Estructura

```
voice-translator/
├── index.html
├── package.json / vite.config.ts / tsconfig.json
├── server/
│   ├── setup_xtts.py        # servidor Colab: XTTS + Whisper + túnel (todo en uno)
│   ├── xtts_server.py       # servidor XTTS mínimo (referencia)
│   ├── run_xtts.py          # arranque alternativo
│   ├── requirements.txt
│   └── README.md            # guía del servidor (Colab / local)
└── src/
    ├── App.tsx              # UI: paneles, idiomas, ajustes, dispositivos
    ├── useTranslator.ts     # orquesta STT → traducción → TTS (con incremental)
    ├── types.ts             # idiomas, proveedores, motores
    ├── components/          # TranslationPanel, Settings, SetupGuide
    └── services/
        ├── speechRecognition.ts  # STT navegador (Web Speech)
        ├── whisperStt.ts         # STT Whisper (captura por dispositivo + VAD + filtro)
        ├── translation.ts        # motores de traducción
        ├── speechSynthesis.ts    # TTS navegador
        ├── elevenLabsTts.ts      # TTS ElevenLabs (voz clonada, pago)
        └── xttsTts.ts            # TTS XTTS por streaming + salida por dispositivo
```

---

Hecho con ❤️ para conversaciones sin barreras de idioma.
