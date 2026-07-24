// Puerta anti-eco COMPARTIDA entre todos los paneles/reproductores.
//
// Problema: sin auriculares, la voz traducida sale por el altavoz, el
// micrófono la vuelve a captar y se re-traduce en bucle infinito.
//
// Solución: mientras suena CUALQUIER reproducción TTS (más un pequeño colchón
// para la cola del altavoz), los reconocedores ignoran el audio capturado.
// Así se corta el bucle de realimentación aunque haya fuga de audio.

let playing = 0;
let quietUntil = 0;

/** Marca que empezó a sonar una reproducción TTS. */
export function ttsBegin(): void {
  playing += 1;
}

/**
 * Marca que terminó una reproducción TTS. Mantiene la puerta cerrada un
 * instante extra (tailMs) para cubrir la reverberación/cola del altavoz.
 */
export function ttsEnd(tailMs = 400): void {
  playing = Math.max(0, playing - 1);
  quietUntil = Date.now() + tailMs;
}

/** ¿Hay una reproducción sonando (o acaba de terminar)? */
export function ttsIsActive(): boolean {
  return playing > 0 || Date.now() < quietUntil;
}
