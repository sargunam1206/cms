import { Link } from 'react-router-dom';
import { useGet } from '@/api/hooks';
import { fmtDate } from '@/lib/utils';
import { PageHeader, Spinner } from '@/components/common/page';
import { Card, CardContent } from '@/components/ui/card';
import { Gantt, Legend, STATE_LABEL, type Row } from './Gantt';
import type { MilestoneRow } from './TimelineTab';

interface Data {
  today: string;
  projects: { _id: string; code: string; name: string; status: string; health: 'ok' | 'late' | 'at_risk'; manager?: { name: string }; baselineAt?: string; milestones: MilestoneRow[] }[];
}

export function PortfolioTimelinePage() {
  const { data } = useGet<Data>(['milestones', 'portfolio'], '/milestones/portfolio');
  if (!data) return <Spinner />;
  const withPlan = data.projects.filter((p) => p.milestones.length);
  const rows: Row[] = withPlan.map((p) => ({
    id: p._id,
    label: `${p.code} ${p.name}`,
    sub: `${p.manager?.name ?? ''}${p.health === 'late' ? ' · late' : p.health === 'at_risk' ? ' · at risk' : ''}`,
    bars: p.milestones.map((m) => ({
      id: m._id,
      start: m.plannedStart,
      end: m.plannedEnd,
      state: m.state,
      baseStart: undefined,
      title: `${p.code} · ${m.name}: ${fmtDate(m.plannedStart)} to ${fmtDate(m.plannedEnd)} · ${STATE_LABEL[m.state]}`,
    })),
  }));
  return (
    <>
      <PageHeader title="Timelines" description="Every open project's milestones. Open a project to plan its milestones." />
      {!rows.length ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">No project has milestones yet.</CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <Gantt rows={rows} today={data.today} />
          <Legend />
          <ul className="text-sm text-muted-foreground">
            {withPlan
              .filter((p) => p.health !== 'ok')
              .map((p) => (
                <li key={p._id}>
                  <Link className="text-primary underline" to={`/projects/${p._id}?tab=timeline`}>
                    {p.code}
                  </Link>{' '}
                  {p.health === 'late' ? 'has a late milestone' : 'has a milestone at risk'}
                </li>
              ))}
          </ul>
        </div>
      )}
      {data.projects.length > withPlan.length && <p className="mt-3 text-xs text-muted-foreground">{data.projects.length - withPlan.length} open project(s) have no milestones yet.</p>}
    </>
  );
}
