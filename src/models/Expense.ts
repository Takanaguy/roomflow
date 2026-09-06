import { Schema, model, models, type InferSchemaType } from "mongoose";

const splitSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Montant que CETTE personne doit sur la depense (pas ce qu'elle a
    // paye). La somme des splits doit toujours egaler `amount` : c'est
    // verifie a l'ecriture (route API), pas ici, Mongoose ne validant pas
    // facilement a travers plusieurs champs d'un sous-document.
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const expenseSchema = new Schema(
  {
    householdId: { type: Schema.Types.ObjectId, ref: "Household", required: true },
    payerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 0 },
    description: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["courses", "factures", "loyer", "sorties", "autre"],
      required: true,
    },
    date: { type: Date, required: true, default: Date.now },
    splitType: { type: String, enum: ["equal", "custom"], required: true },
    splits: { type: [splitSchema], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Les listes filtrees (section 4.3 : par categorie, periode, membre) sont la
// requete la plus frequente sur cette collection -> un index compose evite
// un scan complet a chaque affichage du tableau de bord.
expenseSchema.index({ householdId: 1, date: -1 });

export type Expense = InferSchemaType<typeof expenseSchema>;

export default models.Expense ?? model("Expense", expenseSchema);
