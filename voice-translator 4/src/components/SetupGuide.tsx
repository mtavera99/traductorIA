interface Props {
  open: boolean;
  onClose: () => void;
}

export function SetupGuide({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h2>🎧 Cómo usarlo en Google Meet / Teams / Zoom</h2>
          <button className="btn ghost" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="modal-body">
          <p>
            El navegador no puede enviar audio directamente al micrófono de
            Meet/Teams. Para lograrlo se usa un <strong>cable de audio
            virtual</strong>: un micrófono/altavoz "falso" que conecta esta app
            con la videollamada.
          </p>

          <h3>1. Instala un cable de audio virtual</h3>
          <ul>
            <li>
              <strong>Windows:</strong> VB-Audio Virtual Cable (gratis).
            </li>
            <li>
              <strong>macOS:</strong> BlackHole (gratis) o Loopback.
            </li>
            <li>
              <strong>Linux:</strong> módulo <code>module-null-sink</code> de
              PulseAudio / PipeWire.
            </li>
          </ul>

          <h3>2. Para que te hablen a ti (Escuchar 🎧)</h3>
          <p>
            Que la otra persona hable en inglés. Deja que esta app capte ese
            audio y te lo muestre/reproduzca en español. Para captar el audio de
            la llamada (y no tu micrófono real), enruta la salida de la
            videollamada hacia el cable virtual y selecciona ese cable como
            entrada del navegador.
          </p>

          <h3>3. Para hablar tú (Hablar 🗣️)</h3>
          <ol>
            <li>En el panel "Hablar" activa la reproducción por voz (TTS).</li>
            <li>
              En tu sistema, elige el <strong>cable virtual</strong> como
              dispositivo de <em>salida</em> para este navegador (o
              redirecciona el TTS hacia él).
            </li>
            <li>
              En Meet/Teams/Zoom, elige el <strong>cable virtual</strong> como{" "}
              <em>micrófono</em>.
            </li>
            <li>
              Habla en español: la app lo traduce a inglés y lo reproduce por el
              cable, y la otra persona te oye en inglés.
            </li>
          </ol>

          <div className="callout">
            <strong>Consejo:</strong> usa auriculares para evitar que el audio
            traducido se realimente en el micrófono y se genere un bucle.
          </div>

          <h3>Requisitos del navegador</h3>
          <p>
            El reconocimiento de voz funciona mejor en <strong>Google Chrome</strong>{" "}
            o <strong>Microsoft Edge</strong>. Debes permitir el acceso al
            micrófono cuando el navegador lo pida.
          </p>
        </div>
      </div>
    </div>
  );
}
