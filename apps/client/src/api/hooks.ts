import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, apiError } from './client';

export function useGet<T>(key: QueryKey, url: string, params?: Record<string, unknown>, enabled = true) {
  return useQuery<T>({
    queryKey: [...key, params ?? {}],
    queryFn: async () => (await api.get<T>(url, { params })).data,
    enabled,
    placeholderData: keepPreviousData, // keep the old rows on screen while a new filter loads
  });
}

/** Value that settles after `ms` of no change, so typing in a search box does not fire a request per key. */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

type Method = 'post' | 'put' | 'patch' | 'delete';

/**
 * Mutation that toasts success/errors and invalidates the given query-key prefixes.
 * `url` may be a function of the variables (e.g. for /:id routes).
 */
export function useSend<TVars = unknown, TResult = unknown>(
  method: Method,
  url: string | ((v: TVars) => string),
  opts: { invalidate?: QueryKey[]; success?: string; body?: (v: TVars) => unknown; onSuccess?: (r: TResult) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation<TResult, unknown, TVars>({
    mutationFn: async (vars) => {
      const u = typeof url === 'function' ? url(vars) : url;
      const body = opts.body ? opts.body(vars) : vars;
      const res = method === 'delete' ? await api.delete<TResult>(u) : await api[method]<TResult>(u, body);
      return res.data;
    },
    onSuccess: (r) => {
      opts.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      if (opts.success) toast.success(opts.success);
      opts.onSuccess?.(r);
    },
    onError: (err) => toast.error(apiError(err)),
  });
}
