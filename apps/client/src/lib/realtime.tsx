import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { getAccessToken, refreshAccessToken } from '@/api/client';
import { useAuth } from '@/lib/auth';

interface Pushed {
  _id: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
}

/**
 * Keeps one live connection to the server while signed in, so the bell updates the moment something happens.
 * The server closes the connection when the access token expires; we fetch a fresh token and reconnect. If the
 * connection cannot be made at all, the bell still refreshes on a timer, so nothing depends on it.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const qc = useQueryClient();

  useEffect(() => {
    if (!user) return;
    let socket: Socket | null = null;
    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (stopped) return;
      socket = io({ path: '/socket.io', transports: ['websocket'], reconnection: false, auth: { token: getAccessToken() ?? '' } });
      socket.on('notification', (n: Pushed) => {
        qc.invalidateQueries({ queryKey: ['notifications'] });
        toast.info(n.title, { description: n.body });
      });
      const again = (delay: number) => {
        if (stopped) return;
        retry = setTimeout(async () => {
          try {
            await refreshAccessToken(); // a fresh token for the new connection
          } catch {
            return; // signed out: the auth layer takes over
          }
          connect();
        }, delay);
      };
      socket.on('disconnect', () => again(500)); // token expired or server restarted
      socket.on('connect_error', () => again(15_000)); // not reachable: try again quietly
    };
    connect();
    return () => {
      stopped = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, [user?.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  return <>{children}</>;
}
