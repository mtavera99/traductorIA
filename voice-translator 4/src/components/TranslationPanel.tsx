import { useEffect, useRef } from "react";
import type { TranscriptSegment } from "../types";

interface Props {
  title: string;
  icon: string;
  accent: string;
  sourceLabel: string;
  targetLabel: string;
  active: boolean;
  interim: string;
  segments: TranscriptSegment[];
  error: string | null;
  onToggle: () => void;
  onClear: () => void;
  disabled?: boolean;
}

export function TranslationPanel({
  title,
  icon,
  accent,
  sourceLabel,
  targetLabel,
  active,
  interim,
  segments,
  error,
  onToggle,
  onClear,
  disabled,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [segments, interim]);

  return (
    <section className="panel" style={{ ["--accent" as string]: accent }}>
      <header className="panel-header">
        <div className="panel-title">
          <span className="panel-icon">{icon}</span>
          <div>
            <h2>{title}</h2>
            <p className="panel-flow">
              {sourceLabel} <span aria-hidden>→</span> {targetLabel}
            </p>
          </div>
        </div>
        <div className={`status-dot ${active ? "on" : ""}`} title={active ? "Activo" : "Inactivo"} />
      </header>

      <div className="transcript" ref={scrollRef}>
        {segments.length === 0 && !interim && (
          <p className="empty-hint">
            Pulsa <strong>Iniciar</strong> y empieza a hablar. Aquí verás la
            transcripción y su traducción.
          </p>
        )}
        {segments.map((seg) => (
          <div className="segment" key={seg.id}>
            <p className="original">{seg.original}</p>
            <p className="translated">{seg.translated}</p>
          </div>
        ))}
        {interim && (
          <div className="segment interim">
            <p className="original">{interim}</p>
          </div>
        )}
      </div>

      {error && <p className="panel-error">{error}</p>}

      <div className="panel-actions">
        <button
          className={`btn primary ${active ? "recording" : ""}`}
          onClick={onToggle}
          disabled={disabled}
        >
          {active ? "⏹ Detener" : "▶ Iniciar"}
        </button>
        <button className="btn ghost" onClick={onClear} disabled={segments.length === 0}>
          Limpiar
        </button>
      </div>
    </section>
  );
}
