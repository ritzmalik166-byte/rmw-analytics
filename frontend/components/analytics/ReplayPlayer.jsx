'use client';
import 'rrweb/dist/style.css';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, RotateCw, Maximize2, Radio, FastForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/feedback';

const clock = (ms) => {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  return `${h ? `${h}:` : ''}${mm}:${String(s % 60).padStart(2, '0')}`;
};
const SPEEDS = [1, 2, 4, 8];

/**
 * Video-style player for an rrweb recording. `events` may grow over time (live recordings);
 * new events are appended to the running replay. Exposes seek(ms) through a ref.
 */
export const ReplayPlayer = forwardRef(function ReplayPlayer({ events, live = false, onTime, className }, ref) {
  const boxRef = useRef(null);
  const stageRef = useRef(null);
  const rp = useRef(null);
  const fed = useRef(0);
  const dims = useRef({ w: 1280, h: 720 });
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [total, setTotal] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [skip, setSkip] = useState(true);
  const [follow, setFollow] = useState(live);
  const [scale, setScale] = useState(1);

  const fit = useCallback(() => {
    const box = boxRef.current;
    const r = rp.current;
    if (!box || !r?.wrapper) return;
    const { w, h } = dims.current;
    const maxH = document.fullscreenElement ? window.innerHeight - 70 : Math.max(320, window.innerHeight - 300);
    const s = Math.min(box.clientWidth / w, maxH / h, 1.5);
    r.wrapper.style.transform = `scale(${s})`;
    r.wrapper.style.transformOrigin = 'top left';
    setScale(s);
  }, []);

  // Create the replayer once the first events (with a full snapshot) are available.
  useEffect(() => {
    if (rp.current || !events?.length || !events.some((e) => e.type === 2)) return undefined;
    let disposed = false;
    (async () => {
      const { Replayer } = await import('rrweb');
      if (disposed || !stageRef.current) return;
      const meta = events.find((e) => e.type === 4 && e.data?.width);
      if (meta) dims.current = { w: meta.data.width, h: meta.data.height };
      const r = new Replayer(events, {
        root: stageRef.current, skipInactive: true, showWarning: false, showDebug: false, triggerFocus: false,
        mouseTail: { duration: 600, lineCap: 'round', lineWidth: 3, strokeStyle: '#d93025' },
      });
      rp.current = r;
      fed.current = events.length;
      r.on('resize', (d) => { if (d?.width) { dims.current = { w: d.width, h: d.height }; fit(); } });
      r.on('finish', () => setPlaying(false));
      setTotal(r.getMetaData().totalTime);
      fit();
      setReady(true);
      if (live) r.play(Math.max(0, r.getMetaData().totalTime - 1500));
      else r.play(0);
      setPlaying(true);
    })();
    return () => { disposed = true; };
  }, [events, live, fit]);

  // Append newly arrived events (live recordings keep growing).
  useEffect(() => {
    const r = rp.current;
    if (!r || !events || events.length <= fed.current) return;
    for (let i = fed.current; i < events.length; i += 1) r.addEvent(events[i]);
    fed.current = events.length;
    const t = r.getMetaData().totalTime;
    setTotal(t);
    if (follow) { r.play(Math.max(0, t - 1500)); setPlaying(true); }
  }, [events, follow]);

  useEffect(() => () => { try { rp.current?.destroy(); } catch { /* ignore */ } rp.current = null; }, []);

  // Clock: read the replayer's position every frame.
  useEffect(() => {
    let raf;
    const tick = () => {
      const r = rp.current;
      if (r) { const t = r.getCurrentTime(); setCur(t); onTime?.(t); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onTime]);

  useEffect(() => {
    const ro = new ResizeObserver(fit);
    if (boxRef.current) ro.observe(boxRef.current);
    document.addEventListener('fullscreenchange', fit);
    return () => { ro.disconnect(); document.removeEventListener('fullscreenchange', fit); };
  }, [fit]);

  const seek = useCallback((ms, keepPlaying = true) => {
    const r = rp.current;
    if (!r) return;
    const t = Math.max(0, Math.min(ms, r.getMetaData().totalTime));
    if (keepPlaying || playing) { r.play(t); setPlaying(true); } else r.pause(t);
    setCur(t);
  }, [playing]);
  useImperativeHandle(ref, () => ({ seek: (ms) => { setFollow(false); seek(ms, true); } }), [seek]);

  const toggle = () => {
    const r = rp.current;
    if (!r) return;
    if (playing) { r.pause(); setPlaying(false); setFollow(false); } else { r.play(cur >= total - 50 ? 0 : cur); setPlaying(true); }
  };
  const setSpd = (s) => { setSpeed(s); rp.current?.setConfig({ speed: s }); };
  const setSkp = (v) => { setSkip(v); rp.current?.setConfig({ skipInactive: v }); };

  const stageW = dims.current.w * scale;
  const stageH = dims.current.h * scale;
  return (
    <div ref={boxRef} className={cn('overflow-hidden rounded-md border bg-slate-900', className)}>
      <div className="flex justify-center bg-[repeating-linear-gradient(45deg,#0f172a_0_10px,#111c33_10px_20px)] py-3">
        <div className="relative overflow-hidden rounded bg-white shadow-2xl" style={{ width: stageW || '100%', height: stageH || 360 }}>
          <div ref={stageRef} className="rmwa-replay-stage" />
          {!ready && <Skeleton className="absolute inset-0 h-full w-full rounded-none" />}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/10 bg-slate-900 px-3 py-2 text-white">
        <button type="button" onClick={toggle} disabled={!ready} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1a73e8] hover:bg-[#1765cc] disabled:opacity-50" aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-[1px]" />}
        </button>
        <button type="button" onClick={() => seek(cur - 10_000)} className="rounded p-1.5 hover:bg-white/10" aria-label="Back 10 seconds"><RotateCcw className="h-4 w-4" /></button>
        <button type="button" onClick={() => seek(cur + 10_000)} className="rounded p-1.5 hover:bg-white/10" aria-label="Forward 10 seconds"><RotateCw className="h-4 w-4" /></button>
        <span className="w-24 shrink-0 tabular-nums text-[12px] text-white/80">{clock(cur)} / {clock(total)}</span>
        <input type="range" min={0} max={Math.max(1, total)} step={100} value={Math.min(cur, total)} onChange={(e) => { setFollow(false); seek(Number(e.target.value), playing); }}
          className="h-1.5 min-w-[160px] flex-1 cursor-pointer accent-[#f9ab00]" aria-label="Seek" />
        <div className="flex overflow-hidden rounded ring-1 ring-white/20">
          {SPEEDS.map((s) => <button key={s} type="button" onClick={() => setSpd(s)} className={cn('px-2 py-1 text-[11px] font-semibold', speed === s ? 'bg-[#f9ab00] text-slate-900' : 'hover:bg-white/10')}>{s}×</button>)}
        </div>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-white/80"><input type="checkbox" checked={skip} onChange={(e) => setSkp(e.target.checked)} className="accent-[#f9ab00]" /><FastForward className="h-3.5 w-3.5" />Skip idle</label>
        {live && (
          <button type="button" onClick={() => { setFollow(true); seek(total - 1500, true); }} className={cn('inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-bold uppercase', follow ? 'bg-[#d93025] text-white' : 'bg-white/10 text-white/80 hover:bg-white/20')}>
            <Radio className={cn('h-3.5 w-3.5', follow && 'animate-pulse')} />{follow ? 'Live' : 'Go live'}
          </button>
        )}
        <button type="button" onClick={() => boxRef.current?.requestFullscreen?.()} className="rounded p-1.5 hover:bg-white/10" aria-label="Full screen"><Maximize2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
});
