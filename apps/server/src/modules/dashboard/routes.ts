import { Router } from 'express';
import { PERMISSIONS } from '@cms/shared';
import { hasPermission } from '../../middleware/auth';
import { ah } from '../../utils/asyncHandler';
import { todayStr } from '../../utils/time';
import { AttendanceDay, RegularizationRequest } from '../attendance/model';
import { Employee, teamIds } from '../employees/model';
import { LeaveRequest } from '../leave/model';

export const dashboardRouter = Router();

/** Counts shown on the home page; each block appears only if the user can act on it. */
dashboardRouter.get(
  '/',
  ah(async (req, res) => {
    const out: Record<string, unknown> = {};
    const me = req.user!.employeeId;
    const today = todayStr();

    if (me) {
      out.myPending = {
        leave: await LeaveRequest.countDocuments({ employee: me, status: 'pending' }),
        regularization: await RegularizationRequest.countDocuments({ employee: me, status: 'pending' }),
      };
      out.myMissedCheckouts = await AttendanceDay.find({ employee: me, missedCheckout: true, date: { $gte: today.slice(0, 8) + '01' } })
        .select('date')
        .lean();
    }

    const allScope = hasPermission(req, PERMISSIONS.ATTENDANCE_ALL);
    if (allScope || hasPermission(req, PERMISSIONS.ATTENDANCE_TEAM)) {
      const scope = allScope ? {} : { employee: { $in: me ? await teamIds(me) : [] } };
      const notMe = me ? { employee: { $ne: me } } : {};
      const filter = allScope ? notMe : scope;
      const headcount = allScope ? await Employee.countDocuments({ status: { $ne: 'exited' } }) : (scope.employee as { $in: unknown[] }).$in.length;
      const todays = await AttendanceDay.find({ ...scope, date: today }).select('checkIn isLate leave').lean();
      out.today = {
        headcount,
        checkedIn: todays.filter((d) => d.checkIn).length,
        late: todays.filter((d) => d.isLate).length,
        onLeave: todays.filter((d) => d.leave?.fraction).length,
      };
      out.approvals = {
        leave: hasPermission(req, PERMISSIONS.LEAVE_APPROVE) ? await LeaveRequest.countDocuments({ ...filter, status: 'pending' }) : 0,
        regularization: hasPermission(req, PERMISSIONS.REGULARIZATION_APPROVE)
          ? await RegularizationRequest.countDocuments({ ...filter, status: 'pending' })
          : 0,
      };
    }
    res.json(out);
  }),
);
