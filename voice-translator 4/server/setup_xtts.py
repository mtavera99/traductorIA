import os, subprocess, sys, time, urllib.request, json

# ============================================================
#  VozPuente - Setup XTTS + Whisper (Google Colab)
#  Traductor BIDIRECCIONAL: reconoce voz (Whisper) y genera
#  voz clonada (XTTS) en la misma GPU. Baja latencia (streaming).
# ============================================================

print("== [1/4] Instalando dependencias (2-4 min la primera vez) ==", flush=True)
subprocess.run(
    [sys.executable, "-m", "pip", "install", "-q",
     "coqui-tts", "fastapi", "uvicorn[standard]", "soundfile", "numpy",
     "python-multipart"],
    check=False,
)
subprocess.run(
    [sys.executable, "-m", "pip", "install", "-q", "transformers>=4.57,<4.58"],
    check=False,
)

print("== [2/4] Preparando cloudflared (tunel publico) ==", flush=True)
if not os.path.exists("/usr/local/bin/cloudflared"):
    subprocess.run(
        ["wget", "-q",
         "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
         "-O", "/usr/local/bin/cloudflared"],
        check=False,
    )
    subprocess.run(["chmod", "+x", "/usr/local/bin/cloudflared"], check=False)

print("== [3/4] Buscando tu muestra de voz ==", flush=True)
REF = "voz_referencia.wav"
if not os.path.exists(REF):
    audio_exts = (".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".mp4")
    cands = [f for f in os.listdir(".") if f.lower().endswith(audio_exts)]
    if cands:
        print(f"   Convirtiendo {cands[0]} -> {REF}", flush=True)
        subprocess.run(
            ["ffmpeg", "-y", "-i", cands[0], "-ac", "1", "-ar", "24000", REF],
            check=False,
        )
if not os.path.exists(REF):
    print("\n" + "=" * 50)
    print("FALTA TU VOZ. Sube un archivo de audio de tu voz:")
    print(" 1. Panel izquierdo -> icono de CARPETA.")
    print(" 2. Boton SUBIR (hoja con flecha).")
    print(" 3. Elige tu grabacion (wav/mp3/m4a).")
    print(" 4. Vuelve a ejecutar esta celda.")
    print("=" * 50)
    sys.exit(1)

os.environ["COQUI_TOS_AGREED"] = "1"
os.environ["XTTS_REF_WAV"] = REF

SERVER = r'''
import io, os, re
import numpy as np
import torch
import uvicorn
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel
from TTS.api import TTS

# XTTS revienta la GPU si una frase es demasiado larga. Partimos el texto
# en frases y en trozos de longitud segura antes de generar el audio.
def split_text(text, max_chars=180):
    text = (text or "").strip()
    if not text:
        return []
    parts = re.split(r"(?<=[.!?\u2026])\s+", text)
    chunks = []
    for p in parts:
        p = p.strip()
        while len(p) > max_chars:
            cut = p.rfind(" ", 0, max_chars)
            if cut <= 0:
                cut = max_chars
            chunks.append(p[:cut].strip())
            p = p[cut:].strip()
        if p:
            chunks.append(p)
    return [c for c in chunks if c]

REF_WAV = os.environ.get("XTTS_REF_WAV", "voz_referencia.wav")
PORT = int(os.environ.get("XTTS_PORT", "8020"))
SUPPORTED = {"en","es","fr","de","it","pt","pl","tr","ru","nl","cs","ar","zh-cn","ja","hu","ko","hi"}
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# -------- XTTS (voz clonada) --------
print("[XTTS] Cargando modelo en", DEVICE, flush=True)
_tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(DEVICE)

model = None
gpt_latent = None
spk_emb = None
STREAM_OK = False
try:
    model = _tts.synthesizer.tts_model
    print("[XTTS] Precalculando latentes de tu voz (una vez)...", flush=True)
    gpt_latent, spk_emb = model.get_conditioning_latents(
        audio_path=[REF_WAV],
        gpt_cond_len=30,
        gpt_cond_chunk_len=6,
        max_ref_length=60,
        sound_norm_refs=True,
    )
    for _chunk in model.inference_stream("Hola, esto es una prueba.", "es", gpt_latent, spk_emb):
        break
    STREAM_OK = True
    print("[XTTS] Streaming ACTIVO + precalentado", flush=True)
except Exception as e:
    print("[XTTS] Streaming no disponible, modo normal:", e, flush=True)

# -------- Whisper (reconocimiento de voz) --------
asr = None
WHISPER_OK = False
try:
    from transformers import pipeline
    print("[WHISPER] Cargando modelo (whisper-small)...", flush=True)
    asr = pipeline(
        "automatic-speech-recognition",
        model="openai/whisper-small",
        device=0 if DEVICE == "cuda" else -1,
        torch_dtype=torch.float32,
        model_kwargs={"attn_implementation": "eager"},
    )
    # Warmup con 1s de silencio
    import soundfile as sf
    _b = io.BytesIO()
    sf.write(_b, np.zeros(16000, dtype=np.float32), 16000, format="WAV")
    _b.seek(0)
    asr(_b.read(), generate_kwargs={"language": "es", "task": "transcribe"})
    WHISPER_OK = True
    print("[WHISPER] Listo", flush=True)
except Exception as e:
    print("[WHISPER] No disponible:", e, flush=True)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class R(BaseModel):
    text: str
    language: str = "en"

@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "stream": STREAM_OK, "whisper": WHISPER_OK}

# ---- STT: audio -> texto ----
@app.post("/stt")
async def stt(audio: UploadFile = File(...), language: str = Form("es")):
    if not WHISPER_OK:
        raise HTTPException(400, "whisper no disponible")
    data = await audio.read()
    if not data:
        return {"text": ""}
    lang = language if language in SUPPORTED else "es"
    try:
        out = asr(data, generate_kwargs={"language": lang, "task": "transcribe"})
        return {"text": (out.get("text") or "").strip()}
    except Exception as e:
        raise HTTPException(500, f"stt error: {e}")

# ---- TTS streaming: texto -> voz (por trozos) ----
def pcm_generator(text, lang):
    for sent in split_text(text):
        for chunk in model.inference_stream(
            sent, lang, gpt_latent, spk_emb,
            temperature=0.75,
            length_penalty=1.0,
            repetition_penalty=5.0,
            top_k=50,
            top_p=0.85,
            speed=1.0,
            enable_text_splitting=False,
            stream_chunk_size=40,
        ):
            a = chunk.detach().cpu().numpy().astype(np.float32)
            a = np.clip(a, -1.0, 1.0)
            yield (a * 32767.0).astype("<i2").tobytes()

@app.post("/tts_stream")
def tts_stream(r: R):
    if not STREAM_OK:
        raise HTTPException(400, "streaming no disponible")
    lang = r.language if r.language in SUPPORTED else "en"
    text = r.text.strip()
    if not text:
        raise HTTPException(400, "vacio")
    return StreamingResponse(
        pcm_generator(text, lang),
        media_type="application/octet-stream",
        headers={"X-Sample-Rate": "24000"},
    )

@app.post("/tts")
def tts_full(r: R):
    lang = r.language if r.language in SUPPORTED else "en"
    text = r.text.strip()
    if not text:
        raise HTTPException(400, "vacio")
    if STREAM_OK:
        pieces = []
        for sent in split_text(text):
            out = model.inference(
                sent, lang, gpt_latent, spk_emb,
                temperature=0.75,
                length_penalty=1.0,
                repetition_penalty=5.0,
                top_k=50,
                top_p=0.85,
                speed=1.0,
                enable_text_splitting=False,
            )
            pieces.append(np.array(out["wav"], dtype=np.float32))
        wav = np.concatenate(pieces) if pieces else np.zeros(1, dtype=np.float32)
    else:
        wav = _tts.tts(text=text, speaker_wav=REF_WAV, language=lang)
    import soundfile as sf
    buf = io.BytesIO()
    sf.write(buf, np.array(wav, dtype=np.float32), 24000, format="WAV")
    return Response(content=buf.getvalue(), media_type="audio/wav")

uvicorn.run(app, host="0.0.0.0", port=PORT)
'''

with open("xtts_server.py", "w") as f:
    f.write(SERVER)

print("== [4/4] Arrancando servidor (XTTS streaming + Whisper) ==", flush=True)
srv = subprocess.Popen([sys.executable, "xtts_server.py"])
print("Cargando modelos (3-6 min la primera vez)...", flush=True)

ready = False
for i in range(240):
    time.sleep(5)
    try:
        with urllib.request.urlopen("http://localhost:8020/health", timeout=3) as resp:
            if json.loads(resp.read()).get("status") == "ok":
                ready = True
                break
    except Exception:
        print(".", end="", flush=True)

if not ready:
    print("\nEl servidor no arranco a tiempo. Revisa si hubo errores rojos arriba.")
    sys.exit(1)

print("\n\n== SERVIDOR LISTO (voz + reconocimiento) ==", flush=True)
print(">>> Copia abajo la linea que termina en .trycloudflare.com <<<\n", flush=True)
subprocess.run(["cloudflared", "tunnel", "--no-autoupdate", "--url", "http://localhost:8020"])
