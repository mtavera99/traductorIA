# 🎙️ Servidor XTTS (voz clonada gratis) para VozPuente

Genera la traducción hablada con **tu propia voz**, gratis, usando Coqui XTTS-v2.
Necesitas una **muestra de tu voz** (`voz_referencia.wav`, 15–60 seg hablando claro).

> ⚠️ **Rendimiento:** XTTS necesita **GPU** para ir en tiempo real.
> - En CPU (MacBook Air Intel) funciona pero **muy lento** (solo para probar).
> - Para uso real, usa **Google Colab** (GPU gratis) — ver más abajo.

---

## 🟢 Opción 1 — Google Colab (GPU gratis, recomendado)

1. Abre https://colab.research.google.com → **Nuevo cuaderno**.
2. Menú **Entorno de ejecución → Cambiar tipo de entorno → GPU (T4)** → Guardar.
3. Pega y ejecuta estas celdas **una por una**:

**Celda 1 — Instalar dependencias:**
```python
!pip -q install coqui-tts fastapi "uvicorn[standard]" soundfile numpy
!wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O /usr/local/bin/cloudflared
!chmod +x /usr/local/bin/cloudflared
```

**Celda 2 — Subir tu muestra de voz** (elige un `.wav` de tu voz):
```python
from google.colab import files
up = files.upload()
import os
fn = list(up.keys())[0]
os.rename(fn, "voz_referencia.wav")
print("Guardado como voz_referencia.wav")
```

**Celda 3 — Crear el servidor** (copia aquí el contenido de `xtts_server.py`):
```python
%%writefile xtts_server.py
# >>> PEGA AQUÍ TODO EL CONTENIDO DEL ARCHIVO xtts_server.py <<<
```

**Celda 4 — Lanzar el servidor + túnel público:**
```python
import os, subprocess, time, re
os.environ["COQUI_TOS_AGREED"] = "1"          # acepta licencia XTTS (no interactivo)
os.environ["XTTS_REF_WAV"] = "voz_referencia.wav"

# Arranca el servidor (carga el modelo; tarda ~1-2 min)
srv = subprocess.Popen(["python", "xtts_server.py"])
print("Cargando modelo XTTS... espera ~90s")
time.sleep(100)

# Abre un túnel HTTPS público
tun = subprocess.Popen(
    ["cloudflared", "tunnel", "--no-autoupdate", "--url", "http://localhost:8020"],
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
)
url = None
for line in tun.stdout:
    print(line, end="")
    m = re.search(r"https://[-\w]+\.trycloudflare\.com", line)
    if m:
        url = m.group(0)
        print("\n\n✅ URL de tu servidor XTTS:", url, "\n")
        break
```

4. Copia la **URL `https://….trycloudflare.com`** que aparece.
5. En VozPuente → **⚙️ Ajustes → Motor de voz → XTTS** → pega esa URL → **Probar conexión**.

> Mantén la pestaña de Colab abierta mientras lo uses. Colab gratis se
> desconecta tras un rato de inactividad; si pasa, vuelve a ejecutar la Celda 4.

---

## 🖥️ Opción 2 — Local en tu Mac (solo para probar, lento en Intel)

```bash
cd server
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export COQUI_TOS_AGREED=1
export XTTS_REF_WAV=voz_referencia.wav   # pon aquí tu muestra de voz
python xtts_server.py
```

El servidor quedará en `http://localhost:8020`. En VozPuente pon esa URL en
Ajustes → Motor de voz → XTTS.

---

## Endpoints
- `GET /health` → estado y dispositivo (cuda/mps/cpu).
- `POST /tts` → `{ "text": "...", "language": "en" }` → devuelve audio WAV.
