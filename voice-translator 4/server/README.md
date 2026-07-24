# 🎙️ Servidor XTTS (voz clonada gratis) para VozPuente

Genera la traducción hablada con **tu propia voz**, gratis, usando Coqui XTTS-v2.
Necesitas una **muestra de tu voz** (`voz_referencia.wav`, 15–60 seg hablando claro).

> ⚠️ **Rendimiento:** XTTS necesita **GPU** para ir en tiempo real.
> - En CPU (MacBook Air Intel) funciona pero **muy lento** (solo para probar).
> - Para uso real, usa **Google Colab** (GPU gratis) — ver más abajo.

---

## 🟢 Opción 1 — Google Colab (GPU gratis, recomendado) · MODO UN SOLO CLIC

Con `setup_xtts.py` **todo va en una sola celda**. Se configura **una vez** y
después usarlo es literalmente: abrir el cuaderno → pulsar ▶️ → copiar el enlace.

### Preparación (solo la primera vez)

1. Abre https://colab.research.google.com → **Nuevo cuaderno**.
2. Menú **Entorno de ejecución → Cambiar tipo de entorno → GPU (T4)** → Guardar.
   *(Esto queda guardado en el cuaderno, no hay que repetirlo.)*
3. Sube tu muestra de voz a un sitio con **enlace de descarga directa** y copia ese enlace:
   - **Google Drive:** sube tu audio → botón derecho → *Compartir* → “Cualquiera con el
     enlace” → copia el **ID** del archivo (la parte larga de la URL). Tu enlace será:
     `https://drive.google.com/uc?export=download&id=EL_ID`
   - **Dropbox:** copia el enlace para compartir y cambia el final `?dl=0` por `?dl=1`.
4. Pega **todo el contenido de `setup_xtts.py`** en la primera celda del cuaderno.
5. Arriba del archivo, rellena la variable **`VOZ_URL`** con tu enlace del paso 3.

### Uso diario (un clic)

1. Abre el cuaderno y pulsa ▶️ en la celda.
2. Espera a que aparezca el recuadro con tu enlace `https://….trycloudflare.com`.
3. Cópialo y pégalo en **VozPuente → ⚙️ Ajustes → URL del servidor** → **Probar conexión**.

> La voz se **descarga sola** desde `VOZ_URL`, así que no tienes que volver a subir
> nada aunque Colab reinicie el entorno.

> **Alternativas a `VOZ_URL`:** poner `USE_DRIVE = True` (monta tu Drive con 1 clic de
> permiso y lee la voz de una ruta fija), o dejar ambas vacías y subir el audio a mano
> al panel de archivos de Colab.

> ⚠️ Colab gratis se desconecta tras un rato de inactividad y el enlace **cambia**
> cada vez que reinicias. Si pasa, vuelve a pulsar ▶️ y pega el enlace nuevo.

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
