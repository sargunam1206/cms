import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';

/** Access token lives only in memory; the refresh token is an httpOnly cookie. */
let accessToken: string | null = null;
export const setAccessToken = (t: string | null) => {
  accessToken = t;
};

let onSessionExpired: () => void = () => {};
export const setSessionExpiredHandler = (fn: () => void) => {
  onSessionExpired = fn;
};

export const api = axios.create({ baseURL: '/api', withCredentials: true });

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// One refresh at a time; concurrent 401s wait for the same promise.
let refreshing: Promise<string> | null = null;
export function refreshAccessToken() {
  refreshing ??= axios
    .post<{ accessToken: string }>('/api/auth/refresh', null, { withCredentials: true })
    .then((r) => {
      setAccessToken(r.data.accessToken);
      return r.data.accessToken;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as (InternalAxiosRequestConfig & { _retried?: boolean }) | undefined;
  if (error.response?.status === 401 && original && !original._retried && !original.url?.startsWith('/auth/')) {
    original._retried = true;
    try {
      await refreshAccessToken();
      return api(original);
    } catch {
      setAccessToken(null);
      onSessionExpired();
    }
  }
  return Promise.reject(error);
});

/** Human-readable message from an API error, including zod field errors. */
export function apiError(err: unknown): string {
  if (err instanceof AxiosError) {
    const data = err.response?.data as { message?: string; details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] } } | undefined;
    const fields = data?.details?.fieldErrors;
    if (fields && Object.keys(fields).length) {
      return Object.entries(fields)
        .map(([k, v]) => `${k}: ${v.join(', ')}`)
        .join('; ');
    }
    if (data?.details?.formErrors?.length) return data.details.formErrors.join('; ');
    return data?.message ?? err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}
