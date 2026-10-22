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
    // Meme raison que Expense.createdBy : le droit de modifier/supprimer
    // une tache appartient a son createur (ou a l'admin), pas aux assignes,
    // qui n'ont que le droit de changer le statut.
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Rotation optionnelle, activee tache par tache. N'a de sens que si
    // recurrence != "none" : la rotation joue a la creation de l'occurrence
    // suivante.
    rotation: { type: Boolean, default: false },
    dueDate: { type: Date },
    completedAt: { type: Date },
    // Qui a marque la tache faite (historique, section 4.5). Peut differer
    // des assignes : l'admin ou un coloc peut la terminer a leur place.
    completedBy: { type: Schema.Types.ObjectId, ref: "User" },
    // Verrou anti-doublon : une tache repassee de "fait" a "a faire" puis de
    // nouveau a "fait" ne doit pas fabriquer une 2e occurrence suivante. Reste
    // a true meme si la tache sort de "fait".
    occurrenceGeneree: { type: Boolean, default: false },
    // Une tache n'est rappelee par email qu'UNE fois (Cron quotidien, lot 9).
    // Passe a true AVANT l'envoi (voir lib/rappels.ts) et remis a false si
    // l'echeance est modifiee, pour que le rappel reparte. Les taches
    // anterieures au champ ne l'ont pas en base : "absent" vaut false, d'ou les
    // filtres `{ $ne: true }` plutot que `false`.
    rappelEnvoye: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// La vue Kanban (section 4.5) groupe par statut au sein d'une colocation.
taskSchema.index({ householdId: 1, status: 1 });

export type Task = InferSchemaType<typeof taskSchema>;

export default models.Task ?? model("Task", taskSchema);
