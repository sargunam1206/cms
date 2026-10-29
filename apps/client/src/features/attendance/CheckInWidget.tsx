import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { Clock, LogIn, LogOut } from 'lucide-react';
import { useGet, useSend } from '@/api/hooks';
import type { Today } from '@/api/types';
import { fmtMinutes, fmtTime } from '@/lib/utils';
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

  return (
    <Card>
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
          <div className="text-3xl font-semibold tabular-nums">{serverNow.format('hh:mm:ss A')}</div>
          <div className="text-sm text-muted-foreground">
            {serverNow.format('dddd, DD MMM YYYY')}
            {today.data && ` · Shift ${today.data.shift.start}–${today.data.shift.end}`}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-sm">
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
        {rec?.isLate && <Badge variant="warning">Late by {rec.lateMinutes} min</Badge>}
        {onLeave ? (
          <p className="text-sm text-muted-foreground">You are on leave today.</p>
        ) : !rec?.checkIn ? (
          <Button className="w-full" onClick={() => checkIn.mutate(undefined)} disabled={checkIn.isPending || today.isLoading}>
            <LogIn /> Check in
          </Button>
        ) : (
          <Button variant="outline" className="w-full" onClick={() => checkOut.mutate(undefined)} disabled={checkOut.isPending}>
            <LogOut /> {rec.checkOut ? 'Update check-out' : 'Check out'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
