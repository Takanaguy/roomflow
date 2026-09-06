import { Schema, model, models, type InferSchemaType } from "mongoose";

const taskSchema = new Schema(
  {
    householdId: { type: Schema.Types.ObjectId, ref: "Household", required: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    assignedTo: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    status: {
      type: String,
      enum: ["todo", "in_progress", "done"],
      required: true,
      default: "todo",
    },
    recurrence: {
      type: String,
      enum: ["none", "weekly", "monthly"],
      required: true,
      default: "none",
    },
    dueDate: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// La vue Kanban (section 4.5) groupe par statut au sein d'une colocation.
taskSchema.index({ householdId: 1, status: 1 });

export type Task = InferSchemaType<typeof taskSchema>;

export default models.Task ?? model("Task", taskSchema);
