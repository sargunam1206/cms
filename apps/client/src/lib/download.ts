import { toast } from 'sonner';
import { api, apiError } from '@/api/client';

/** Fetches a protected file (the API needs the auth header, so a plain link will not work) and saves it. */
export async function downloadFile(url: string, fallbackName: string) {
  try {
    const res = await api.get<Blob>(url, { responseType: 'blob' });
    const disposition = String(res.headers['content-disposition'] ?? '');
    const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
    const href = URL.createObjectURL(res.data);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
    URL.revokeObjectURL(href);
    return res.headers;
  } catch (err) {
    // error bodies arrive as blobs when responseType is blob
    const data = (err as { response?: { data?: Blob } }).response?.data;
    if (data instanceof Blob) {
      try {
        toast.error(JSON.parse(await data.text()).message ?? 'Download failed');
        return;
      } catch {
        /* fall through */
      }
    }
    toast.error(apiError(err));
  }
}
