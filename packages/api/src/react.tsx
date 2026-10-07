import { createContext, useCallback, useContext, useEffect, useRef, useState, type DependencyList, type ReactNode } from 'react';
import type { HrisClient } from './client';

const ApiContext = createContext<HrisClient | null>(null);

export const ApiProvider = ({ client, children }: { client: HrisClient; children: ReactNode }) => (
  <ApiContext.Provider value={client}>{children}</ApiContext.Provider>
);

export const useApi = (): HrisClient => {
  const client = useContext(ApiContext);
  if (!client) throw new Error('useApi harus dipakai di dalam <ApiProvider>.');
  return client;
};

export type Resource<T> = {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => Promise<void>;
  /** Ganti data lokal tanpa memuat ulang (mis. setelah mutasi mengembalikan objek terbaru). */
  setData: (next: T) => void;
};

/**
 * Pemuat data sederhana (pengganti ringan TanStack Query untuk MVP).
 * Respons usang dari pemanggilan sebelumnya diabaikan agar tidak menimpa data terbaru.
 */
export const useResource = <T,>(load: () => Promise<T>, deps: DependencyList): Resource<T> => {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const requestId = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(undefined);
    try {
      const result = await loadRef.current();
      if (id === requestId.current) setData(result);
    } catch (e) {
      if (id === requestId.current) setError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload: run, setData };
};
