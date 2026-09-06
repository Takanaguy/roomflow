import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * Un remboursement pointe manuellement comme fait (section 4.4 : pas de
 * vrai paiement en ligne). Cree quand quelqu'un clique "j'ai rembourse" sur
 * une dette calculee par l'algorithme de simplification.
 */
const settlementSchema = new Schema(
  {
    householdId: { type: Schema.Types.ObjectId, ref: "Household", required: true },
    fromUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    toUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 0 },
    settledAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export type Settlement = InferSchemaType<typeof settlementSchema>;

export default models.Settlement ?? model("Settlement", settlementSchema);
