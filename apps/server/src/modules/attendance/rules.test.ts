import { describe, expect, it } from 'vitest';
import { DEFAULT_WORK_CALENDAR, type WorkCalendarSettings } from '@cms/shared';
import { zonedDateTime } from '../../utils/time';
import { dayType, evaluateDay, summarizeMonth, type SummaryDay } from './rules';

const cal: WorkCalendarSettings = { ...DEFAULT_WORK_CALENDAR }; // 09:30-18:30, 15m grace, 8h full, 4h half, 3 lates
const at = (date: string, t: string) => zonedDateTime(date, t);

describe('dayType', () => {
  const none = new Set<string>();
  it('treats Sunday as week-off and Saturday as working by default', () => {
    expect(dayType('2026-10-04', cal, none)).toBe('weekoff'); // Sunday
    expect(dayType('2026-10-03', cal, none)).toBe('working'); // Saturday
  });
  it('applies alternate Saturdays (2nd & 4th off)', () => {
    const alt = { ...cal, saturdayRule: 'alternate' as const, saturdaysOff: [2, 4] };
    expect(dayType('2026-10-03', alt, none)).toBe('working'); // 1st Sat
    expect(dayType('2026-10-10', alt, none)).toBe('weekoff'); // 2nd Sat
    expect(dayType('2026-10-24', alt, none)).toBe('weekoff'); // 4th Sat
    expect(dayType('2026-10-31', alt, none)).toBe('working'); // 5th Sat
  });
  it('supports a 5-day week', () => {
    expect(dayType('2026-10-03', { ...cal, saturdayRule: 'off' }, none)).toBe('weekoff');
  });
  it('holidays win over working days', () => {
    expect(dayType('2026-10-02', cal, new Set(['2026-10-02']))).toBe('holiday');
  });
});

describe('evaluateDay', () => {
  const d = '2026-10-05';
  it('within grace is not late', () => {
    const r = evaluateDay(d, at(d, '09:45'), at(d, '18:30'), cal);
    expect(r.isLate).toBe(false);
    expect(r.status).toBe('present');
  });
  it('past grace is late, measured from shift start', () => {
    const r = evaluateDay(d, at(d, '09:46'), at(d, '18:30'), cal);
    expect(r.isLate).toBe(true);
    expect(r.lateMinutes).toBe(16);
  });
  it('classifies half day and absent by hours worked', () => {
    expect(evaluateDay(d, at(d, '09:30'), at(d, '14:00'), cal).status).toBe('half');
    expect(evaluateDay(d, at(d, '09:30'), at(d, '12:00'), cal).status).toBe('absent');
  });
  it('records early leaving', () => {
    expect(evaluateDay(d, at(d, '09:00'), at(d, '18:00'), cal).earlyMinutes).toBe(30);
  });
  it('is provisionally present while checked in', () => {
    expect(evaluateDay(d, at(d, '09:30'), null, cal).status).toBe('present');
  });
});

describe('summarizeMonth', () => {
  const work = (date: string, extra: Partial<SummaryDay> = {}): SummaryDay => ({ date, type: 'working', status: 'present', ...extra });

  it('3 late marks convert to a half-day LOP', () => {
    const days = [
      work('2026-10-01', { isLate: true }),
      work('2026-10-02', { isLate: true }),
      work('2026-10-03', { isLate: true }),
      { date: '2026-10-04', type: 'weekoff' as const },
    ];
    const s = summarizeMonth(days, cal, '2026-11-01');
    expect(s.lateCount).toBe(3);
    expect(s.latePenaltyDays).toBe(0.5);
    expect(s.lopDays).toBe(0.5);
    expect(s.paidDays).toBe(3.5);
  });

  describe('late-mark LOP is optional and excusable', () => {
    const lates = (excused: boolean[]): SummaryDay[] =>
      excused.map((e, i) => work(`2026-10-0${i + 1}`, { isLate: true, lateExcused: e }));

    it('can be switched off: late marks are still counted but never cost pay', () => {
      const s = summarizeMonth(lates([false, false, false, false, false, false]), { ...cal, lateLopEnabled: false }, '2026-11-01');
      expect(s.lateCount).toBe(6);
      expect(s.latePenaltyDays).toBe(0);
      expect(s.lopDays).toBe(0);
      expect(s.paidDays).toBe(6);
    });

    it('excused late marks do not count towards the penalty', () => {
      // 3 lates would be ½ day LOP; excusing one leaves 2, below the threshold
      const s = summarizeMonth(lates([true, false, false]), cal, '2026-11-01');
      expect(s.lateCount).toBe(3);
      expect(s.lateExcusedCount).toBe(1);
      expect(s.latePenaltyDays).toBe(0);
    });

    it('free allowance: first N late marks each month are ignored', () => {
      const allowance = { ...cal, lateFreeAllowance: 2 };
      // 4 lates - 2 free = 2 counting → below threshold of 3
      expect(summarizeMonth(lates([false, false, false, false]), allowance, '2026-11-01').latePenaltyDays).toBe(0);
      // 5 lates - 2 free = 3 counting → ½ day
      expect(summarizeMonth(lates([false, false, false, false, false]), allowance, '2026-11-01').latePenaltyDays).toBe(0.5);
      // excused marks and allowance both reduce the count: 5 - 1 excused - 2 free = 2
      expect(summarizeMonth(lates([true, false, false, false, false]), allowance, '2026-11-01').latePenaltyDays).toBe(0);
    });

    it('penalty is by non-excused marks: 7 lates, 1 excused = 6 → 1 day', () => {
      const s = summarizeMonth(lates([true, false, false, false, false, false, false]), cal, '2026-11-01');
      expect(s.latePenaltyDays).toBe(1);
    });
  });

  it('counts missing past working days as LOP and future ones as pending', () => {
    const days = [work('2026-10-01'), { date: '2026-10-02', type: 'working' as const }, { date: '2026-10-05', type: 'working' as const }];
    const s = summarizeMonth(days, cal, '2026-10-03');
    expect(s.absentDays).toBe(1);
    expect(s.pendingDays).toBe(1);
  });

  it('handles paid, unpaid and half-day leave', () => {
    const days = [
      work('2026-10-01', { status: 'leave', leave: { paid: true, fraction: 1 } }),
      work('2026-10-02', { status: 'leave', leave: { paid: false, fraction: 1 } }),
      work('2026-10-03', { status: 'half', leave: { paid: true, fraction: 0.5 } }),
      work('2026-10-05', { status: 'half' }),
    ];
    const s = summarizeMonth(days, cal, '2026-11-01');
    expect(s.paidLeaveDays).toBe(1.5);
    expect(s.unpaidLeaveDays).toBe(1);
    expect(s.presentDays).toBe(1); // 0.5 (with half leave) + 0.5 (half day)
    expect(s.absentDays).toBe(0.5);
    expect(s.lopDays).toBe(1.5);
  });

  it('does not pay days before joining', () => {
    const days = [{ date: '2026-10-01', type: 'inactive' as const }, work('2026-10-02')];
    const s = summarizeMonth(days, cal, '2026-11-01');
    expect(s.paidDays).toBe(1);
    expect(s.totalDays).toBe(2);
  });
});
