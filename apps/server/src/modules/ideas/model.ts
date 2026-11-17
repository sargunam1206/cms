import '../../config/istPlugin';
import { Schema, model } from 'mongoose';
import { IDEA_STATUS } from '@cms/shared';

const commentSchema = new Schema(
  {
    by: { type: Schema.Types.ObjectId, ref: 'Employee' },
    byName: String,
    text: { type: String, required: true },
    replyTo: { type: Schema.Types.ObjectId, default: null }, // a top-level comment's _id; replies go one level deep (not named parent: that is a Mongoose method)
    at: { type: Date, required: true },
  },
  { _id: true },
);

const historySchema = new Schema(
  {
    at: { type: Date, required: true },
    byName: String,
    from: String,
    to: String,
    comment: String,
  },
  { _id: false },
);

const ideaSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true },
    tags: { type: [String], default: [] },
    status: { type: String, enum: IDEA_STATUS, default: 'submitted', index: true },
    author: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    voters: { type: [{ type: Schema.Types.ObjectId, ref: 'Employee' }], default: [] },
    votes: { type: Number, default: 0, index: true }, // kept equal to voters.length by the vote endpoint
    comments: { type: [commentSchema], default: [] },
    history: { type: [historySchema], default: [] },
    project: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
  },
  { timestamps: true },
);
ideaSchema.index({ createdAt: -1 });
export const Idea = model('Idea', ideaSchema);
