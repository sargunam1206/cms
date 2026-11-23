import { z } from 'zod';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
const id = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const MEETING_TYPES = ['internal', 'client', 'interior_site_visit', 'other'] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];
export const MEETING_TYPE_LABEL: Record<MeetingType, string> = {
  internal: 'Internal',
  client: 'Client',
  interior_site_visit: 'Interior / site visit',
  other: 'Other',
};

export const MEETING_STATUS = ['scheduled', 'completed', 'cancelled'] as const;
export type MeetingStatus = (typeof MEETING_STATUS)[number];

export const meetingActionSchema = z.object({
  _id: id.optional(),
  text: z.string().trim().min(1, 'Describe the action').max(300),
  owner: id.nullable().optional(),
  dueDate: day.nullable().optional().or(z.literal('')),
  done: z.boolean().default(false),
});

export const meetingSchema = z
  .object({
    title: z.string().trim().min(2, 'Give the meeting a title').max(150),
    type: z.enum(MEETING_TYPES),
    date: day,
    start: time,
    end: time,
    location: z.string().trim().max(200).optional().or(z.literal('')),
    link: z.string().trim().max(500).optional().or(z.literal('')),
    attendees: z.array(id).max(100).default([]),
    guests: z.string().trim().max(500).optional().or(z.literal('')), // people from outside the company, free text
    agenda: z.string().max(5000).optional().or(z.literal('')),
    minutes: z.string().max(20000).optional().or(z.literal('')),
    project: id.nullable().optional().or(z.literal('')),
    client: id.nullable().optional().or(z.literal('')),
    actions: z.array(meetingActionSchema).max(50).default([]),
  })
  .refine((m) => m.end > m.start, { message: 'End time must be after the start time', path: ['end'] });
export type MeetingInput = z.infer<typeof meetingSchema>;

/** How long before the start the reminder goes out. */
export const MEETING_REMINDER_MINUTES = 15;
