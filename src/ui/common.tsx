import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { WALL_COLORS } from '../view3d/materials';

export function Modal({ title, subtitle, onClose, children, footer, wide }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div className="backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Numeric input that edits in display units and commits on blur/Enter. */
export function NumberField({ label, value, onChange, unit = 'm', step = 0.05, min, max, digits = 2, factor = 1 }: { label?: string; value: number; onChange: (v: number) => void; unit?: string; step?: number; min?: number; max?: number; digits?: number; factor?: number }) {
  const [text, setText] = useState((value * factor).toFixed(digits));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText((value * factor).toFixed(digits)); }, [value, focus, digits, factor]);
  const commit = () => {
    const n = parseFloat(text.replace(',', '.'));
    if (!isFinite(n)) { setText((value * factor).toFixed(digits)); return; }
    let v = n / factor;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (Math.abs(v - value) > 1e-6) onChange(v);
    setText((v * factor).toFixed(digits));
  };
  const field = (
    <div className="num">
      <input className="input" value={text} inputMode="decimal" onFocus={(e) => { setFocus(true); e.target.select(); }} onBlur={() => { setFocus(false); commit(); }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); } if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const v = Math.max(min ?? -1e9, Math.min(max ?? 1e9, value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1))); onChange(v); } }} />
      {unit && <span className="unit">{unit}</span>}
    </div>
  );
  return label ? <label className="field"><span>{label}</span>{field}</label> : field;
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <div className="toggle-row"><span>{label}</span><button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} /></div>;
}

export function Swatches({ value, onChange, colors = WALL_COLORS }: { value?: string; onChange: (c: string) => void; colors?: string[] }) {
  return (
    <div className="swatches">
      {colors.map((c) => <button key={c} className={`swatch ${value?.toLowerCase() === c.toLowerCase() ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} title={c} aria-label={`Color ${c}`} />)}
      <label className="swatch custom" title="Custom color"><input type="color" value={value ?? '#ffffff'} onChange={(e) => onChange(e.target.value)} /></label>
    </div>
  );
}

export function Section({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return <div className="section">{title && <div className="section-title"><span>{title}</span>{right}</div>}{children}</div>;
}

export const unitLabel = (units: 'metric' | 'imperial') => (units === 'imperial' ? 'ft' : 'm');
export const unitFactor = (units: 'metric' | 'imperial') => (units === 'imperial' ? 3.28084 : 1);
