import { useCallback, useEffect, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { api, type GlobalCache, type GlobalProgress, type GlobalSummary, type Item, type ScanProgress, type ScanSummary } from "../api";

export type ScanStatus = "idle" | "scanning" | "done" | "stopped" | "error";

/** Collects streamed items and flushes them to React at most once per animation frame. */
function useBatcher<T>(key: (t: T) => string, setList: React.Dispatch<React.SetStateAction<T[]>>) {
  const buf = useRef<T[]>([]);
  const raf = useRef(0);
  const flush = useCallback(() => {
    raf.current = 0;
    const batch = buf.current;
    buf.current = [];
    if (!batch.length) return;
    setList((prev) => {
      const seen = new Set(prev.map(key));
      const fresh = batch.filter((b) => (seen.has(key(b)) ? false : (seen.add(key(b)), true)));
      return fresh.length ? [...prev, ...fresh] : prev;
    });
  }, [key, setList]);
  const push = useCallback((t: T) => {
    buf.current.push(t);
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  }, [flush]);
  const clear = useCallback(() => { buf.current = []; }, []);
  return { push, clear, flush };
}

export function useScan() {
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [items, setItems] = useState<Item[]>([]);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [summary, setSummary] = useState<ScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const itemKey = useCallback((i: Item) => i.path, []);
  const batch = useBatcher<Item>(itemKey, setItems);

  useEffect(() => {
    const subs: Promise<UnlistenFn>[] = [
      listen<Item>("scan-item", (e) => batch.push(e.payload)),
      listen<ScanProgress>("scan-progress", (e) => setProgress(e.payload)),
      listen<ScanSummary>("scan-done", (e) => {
        batch.flush();
        setSummary(e.payload);
        setStatus(e.payload.cancelled ? "stopped" : "done");
        api.getItems().then(setItems);
      }),
    ];
    return () => { subs.forEach((p) => p.then((f) => f())); };
  }, [batch]);

  const start = useCallback(async () => {
    batch.clear(); setItems([]); setSummary(null); setError(null); setProgress(null);
    setStartedAt(Date.now());
    setStatus("scanning");
    try { await api.startScan(); } catch (e) { setError(String(e)); setStatus("error"); }
  }, []);
  const stop = useCallback(() => { api.cancelScan(); }, []);
  const refresh = useCallback(() => api.getItems().then(setItems), []);
  return { status, items, progress, summary, error, startedAt, start, stop, refresh };
}

export function useGlobalScan() {
  const [status, setStatus] = useState<ScanStatus>("idle");
  const [caches, setCaches] = useState<GlobalCache[]>([]);
  const [progress, setProgress] = useState<GlobalProgress | null>(null);
  const [summary, setSummary] = useState<GlobalSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const key = useCallback((c: GlobalCache) => c.id, []);
  const batch = useBatcher<GlobalCache>(key, setCaches);

  useEffect(() => {
    const subs: Promise<UnlistenFn>[] = [
      listen<GlobalCache>("global-item", (e) => batch.push(e.payload)),
      listen<GlobalProgress>("global-progress", (e) => setProgress(e.payload)),
      listen<GlobalSummary>("global-done", (e) => {
        batch.flush();
        setSummary(e.payload);
        setStatus(e.payload.cancelled ? "stopped" : "done");
      }),
    ];
    return () => { subs.forEach((p) => p.then((f) => f())); };
  }, [batch]);

  const start = useCallback(async () => {
    batch.clear(); setCaches([]); setSummary(null); setError(null); setProgress(null);
    setStartedAt(Date.now());
    setStatus("scanning");
    try { await api.startGlobalScan(); } catch (e) { setError(String(e)); setStatus("error"); }
  }, []);
  const stop = useCallback(() => { api.cancelGlobalScan(); }, []);
  return { status, caches, setCaches, progress, summary, error, startedAt, start, stop };
}

export function useElapsed(startedAt: number, running: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [running]);
  return running ? Math.max(0, now - startedAt) : 0;
}
