import mongoose, { Document, Schema } from 'mongoose';
import { TASK_POSTED_ROUND_ROBIN_EMAILS } from '../constants/taskAssignment';

export interface RoundRobinTeamSettingsDocument extends Document {
  key: string;
  emails: string[];
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const RoundRobinTeamSettingsSchema = new Schema<RoundRobinTeamSettingsDocument>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: 'support_team_round_robin',
    },
    emails: {
      type: [String],
      default: () => [...TASK_POSTED_ROUND_ROBIN_EMAILS],
    },
    updatedBy: { type: String },
  },
  { timestamps: true, collection: 'round_robin_team_settings' },
);

export const RoundRobinTeamSettings = mongoose.model<RoundRobinTeamSettingsDocument>(
  'RoundRobinTeamSettings',
  RoundRobinTeamSettingsSchema,
);
