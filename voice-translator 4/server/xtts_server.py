"""
Servidor XTTS (Coqui XTTS-v2) para VozPuente.

Expone un endpoint HTTP que recibe texto + idioma y devuelve audio (WAV)
generado con TU voz clonada, a partir de una muestra de referencia.

Uso:
    export XTTS_REF_WAV=voz_referencia.wav   # tu muestra de voz (10-30s+)
    python xtts_server.py

Luego, en la app VozPuente:  Ajustes -> Motor de voz -> XTTS
y pega la URL del servidor (por defecto http://localhost:8020).

Nota de licencia: XTTS-v2 usa la licencia Coqui Public Model License (CPML),
de uso NO comercial. Úsalo para fines personales.
"""

import io
import os

import numpy as np
import soundfile as sf
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from TTS.api import TTS

# Muestra de tu voz (WAV o MP3). Cámbiala con la variable de entorno XTTS_REF_WAV.
REF_WAV = os.environ.get("XTTS_REF_WAV", "voz_referencia.wav")
PORT = int(os.environ.get("XTTS_PORT", "8020"))

# Idiomas soportados por XTTS-v2.
SUPPORTED = {
    "en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl",
    "cs", "ar", "zh-cn", "ja", "hu", "ko", "hi",
}

if torch.cuda.is_available():
    DEVICE = "cuda"
elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
    DEVICE = "mps"
else:
    DEVICE = "cpu"

print(f"[XTTS] Cargando modelo xtts_v2 en dispositivo: {DEVICE} ...")
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(DEVICE)
print("[XTTS] Modelo cargado. Listo.")

app = FastAPI(title="VozPuente XTTS Server")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TTSRequest(BaseModel):
    text: str
    language: str = "en"


@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "ref_exists": os.path.exists(REF_WAV)}


@app.post("/tts")
def synth(req: TTSRequest):
    if not os.path.exists(REF_WAV):
        raise HTTPException(
            status_code=400,
            detail=f"No se encuentra la muestra de voz: {REF_WAV}. "
            f"Colócala junto al servidor o define XTTS_REF_WAV.",
        )
    lang = req.language if req.language in SUPPORTED else "en"
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Texto vacío")

    # Genera el audio con la voz clonada.
    wav = tts.tts(text=text, speaker_wav=REF_WAV, language=lang)

    buf = io.BytesIO()
    sf.write(buf, np.array(wav, dtype=np.float32), samplerate=24000, format="WAV")
    buf.seek(0)
    return Response(content=buf.read(), media_type="audio/wav")


if __name__ == "__main__":
    print(f"[XTTS] Sirviendo en http://0.0.0.0:{PORT}")
    uvicorn.run(app, host="0.0.0.0", port=PORT)
