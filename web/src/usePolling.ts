import { useState, useEffect, useRef, useCallback } from 'react';

export function usePolling<T>(fn: () => Promise<T>, intervalMs = 1500) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const isMounted = useRef(true);
  const inFlight = useRef(false);

  const tick = useCallback(async () => {
    if (!isMounted.current) return;
    if (inFlight.current) return;

    inFlight.current = true;
    try {
      const res = await fn();
      if (isMounted.current) {
        setData(res);
        setError(null);
      }
    } catch (err: any) {
      if (isMounted.current) {
        setError(err);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
      inFlight.current = false;
    }
  }, [fn]);

  useEffect(() => {
    isMounted.current = true;
    tick(); // initial fetch
    const id = setInterval(tick, intervalMs);

    return () => {
      isMounted.current = false;
      clearInterval(id);
    };
  }, [tick, intervalMs]);

  return { data, error, loading, refresh: tick };
}
