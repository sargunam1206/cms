import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Clock, LogIn, LogOut } from 'lucide-react';
import { useGet, useSend } from '@/api/hooks';
import type { Today } from '@/api/types';
import { fmtLate, fmtMinutes, fmtTime } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * The clock shown here is the server's time (offset-corrected), so employees see
 * exactly what will be recorded. The punch itself sends no time at all.
 */
export function CheckInWidget() {
  const today = useGet<Today>(['attendance', 'today'], '/attendance/today');
  const opts = { invalidate: [['attendance'], ['dashboard']] };
  const checkIn = useSend('post', '/attendance/check-in', { ...opts, success: 'Checked in', body: () => ({}) });
  const checkOut = useSend('post', '/attendance/check-out', { ...opts, success: 'Checked out', body: () => ({}) });

  const [offset, setOffset] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    if (today.data) setOffset(new Date(today.data.serverTime).getTime() - Date.now());
  }, [today.data]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const rec = today.data?.record;
  const serverNow = dayjs(Date.now() + offset);
  const onLeave = rec?.status === 'leave';
  const partTime = !!today.data?.partTime;
  const sessions = rec?.sessions ?? [];
  const openSession = sessions.some((x) => !x.out);

  return (
    <Card className="relative h-full overflow-hidden pt-1 before:absolute before:inset-x-0 before:top-0 before:h-1.5 before:bg-gradient-to-r before:from-blue-600 before:via-indigo-500 before:to-emerald-500">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="h-4 w-4" /> Today
        </CardTitle>
        {today.data && today.data.dayType !== 'working' && (
          <Badge variant="secondary" className="capitalize">
            {today.data.dayType}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="text-4xl font-semibold tabular-nums tracking-tight text-blue-700">{serverNow.format('hh:mm:ss A')}</div>
          <div className="text-sm text-muted-foreground">
            {serverNow.format('dddd, DD MMM YYYY')}
            {today.data && (today.data.partTime ? ' · Part time, flexible hours' : ` · Shift ${today.data.shift.start}–${today.data.shift.end}`)}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/60 p-3 text-sm">
          <div>
            <div className="text-muted-foreground">In</div>
            <div className="font-medium">{fmtTime(rec?.checkIn)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Out</div>
            <div className="font-medium">{fmtTime(rec?.checkOut)}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Worked</div>
            <div className="font-medium">{fmtMinutes(rec?.workedMinutes)}</div>
          </div>
        </div>
        {rec?.isLate && <Badge variant="warning">Late by {fmtLate(rec.lateMinutes)}</Badge>}
        {partTime && sessions.length > 0 && (
          <ul className="space-y-1 text-sm">
            {sessions.map((x, k) => (
              <li key={k} className="flex items-center justify-between rounded-md border px-3 py-1.5">
                <span className="text-muted-foreground">Session {k + 1}</span>
                <span className="font-medium">
                  {fmtTime(x.in)} – {x.out ? fmtTime(x.out) : <span className="text-emerald-700">now</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {onLeave ? (
          <p className="text-sm text-muted-foreground">You are on leave today.</p>
        ) : partTime ? (
          openSession ? (
            <Button className="w-full bg-orange-500 font-semibold text-white hover:bg-orange-600" onClick={() => checkOut.mutate(undefined)} disabled={checkOut.isPending}>
              <LogOut /> Check out
            </Button>
          ) : (
            <Button className="w-full bg-emerald-500 font-semibold text-white hover:bg-emerald-600" onClick={() => checkIn.mutate(undefined)} disabled={checkIn.isPending || today.isLoading}>
              <LogIn /> {sessions.length ? 'Check in again' : 'Check in'}
            </Button>
          )
        ) : !rec?.checkIn ? (
          <Button className="w-full bg-emerald-500 font-semibold text-white hover:bg-emerald-600" onClick={() => checkIn.mutate(undefined)} disabled={checkIn.isPending || today.isLoading}>
            <LogIn /> Check in
          </Button>
        ) : (
          <Button className="w-full bg-orange-500 font-semibold text-white hover:bg-orange-600" onClick={() => checkOut.mutate(undefined)} disabled={checkOut.isPending}>
            <LogOut /> {rec.checkOut ? 'Update check-out' : 'Check out'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
