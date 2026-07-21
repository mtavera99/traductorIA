import os, subprocess, time, urllib.request, json, sys

os.environ["COQUI_TOS_AGREED"] = "1"
os.environ.setdefault("XTTS_REF_WAV", "voz_referencia.wav")

if not os.path.exists(os.environ["XTTS_REF_WAV"]):
    print("ERROR: no existe voz_referencia.wav. Sube tu voz primero (Celda 2).")
    sys.exit(1)

# Fija transformers 4.57.x: la unica linea que tiene TANTO isin_mps_friendly
# (removida en 4.58+) COMO is_torchcodec_available (agregada en 4.57).
print("Ajustando dependencias compatibles (transformers 4.57)...", flush=True)
subprocess.run(
    [sys.executable, "-m", "pip", "install", "-q", "transformers>=4.57,<4.58"],
    check=False,
)

SERVER = r'''
import io, os
import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from TTS.api import TTS

REF_WAV = os.environ.get("XTTS_REF_WAV", "voz_referencia.wav")
PORT = int(os.environ.get("XTTS_PORT", "8020"))
SUPPORTED = {"en","es","fr","de","it","pt","pl","tr","ru","nl","cs","ar","zh-cn","ja","hu","ko","hi"}
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
print("[XTTS] Cargando modelo en", DEVICE)
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(DEVICE)
print("[XTTS] Listo")
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class R(BaseModel):
    text: str
    language: str = "en"

@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE}

@app.post("/tts")
def synth(r: R):
    if not os.path.exists(REF_WAV):
        raise HTTPException(400, "no ref")
    lang = r.language if r.language in SUPPORTED else "en"
    wav = tts.tts(text=r.text.strip(), speaker_wav=REF_WAV, language=lang)
    buf = io.BytesIO()
    sf.write(buf, np.array(wav, dtype=np.float32), samplerate=24000, format="WAV")
    buf.seek(0)
    return Response(content=buf.read(), media_type="audio/wav")

uvicorn.run(app, host="0.0.0.0", port=PORT)
'''

with open("xtts_server.py", "w") as f:
    f.write(SERVER)

srv = subprocess.Popen([sys.executable, "xtts_server.py"])
print("Cargando modelo XTTS (2-5 min la primera vez)...", flush=True)

ready = False
for i in range(150):
    time.sleep(5)
    try:
        with urllib.request.urlopen("http://localhost:8020/health", timeout=3) as resp:
            if json.loads(resp.read()).get("status") == "ok":
                ready = True
                break
    except Exception:
        print(".", end="", flush=True)

if not ready:
    print("\nEl servidor tardo demasiado. Revisa si hubo errores arriba.")
    sys.exit(1)

print("\n\nSERVIDOR LISTO. Abriendo tunel publico...", flush=True)
print(">>> Copia la linea de abajo que termina en .trycloudflare.com <<<\n", flush=True)
subprocess.run(["cloudflared", "tunnel", "--no-autoupdate", "--url", "http://localhost:8020"])
