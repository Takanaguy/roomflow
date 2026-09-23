import { Schema, model, models, type InferSchemaType } from "mongoose";

// Reutilise pour `payers` ET `splits` : structurellement identique (qui,
// combien), la seule difference est le sens (qui a avance l'argent vs qui
// le doit). Demande de Tanguy le 23/09/2026 : plusieurs personnes peuvent
// avancer une meme depense (ex. un resto ou un membre n'a pas d'argent sur
// lui, deux ou trois autres avancent sa part entre eux).
const partSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const expenseSchema = new Schema(
  {
    householdId: { type: Schema.Types.ObjectId, ref: "Household", required: true },
    // Remplace l'ancien payerId (unique) : la somme des payers doit
    // toujours egaler `amount`, comme pour splits. Le cas courant "une
    // seule personne paye" reste juste `payers` a un seul element.
    payers: { type: [partSchema], required: true },
    // Distinct des payers : le cahier des charges (4.3) permet de saisir une
    // depense payee par quelqu'un d'autre ("payeur par defaut soi-meme").
    // "auteur" (droit de modifier/supprimer, 4.3) = qui a saisi, pas
    // forcement qui a paye.
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true, min: 0 },
    description: { type: String, required: true, trim: true },
    category: {
      type: String,
      enum: ["courses", "factures", "loyer", "sorties", "autre"],
      required: true,
    },
    date: { type: Date, required: true, default: Date.now },
    splitType: { type: String, enum: ["equal", "custom"], required: true },
    // La somme des splits doit toujours egaler `amount` : verifie a
    // l'ecriture (route API), pas ici, Mongoose ne validant pas facilement
    // a travers plusieurs champs d'un sous-document.
    splits: { type: [partSchema], required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// Les listes filtrees (section 4.3 : par categorie, periode, membre) sont la
// requete la plus frequente sur cette collection -> un index compose evite
// un scan complet a chaque affichage du tableau de bord.
expenseSchema.index({ householdId: 1, date: -1 });

export type Expense = InferSchemaType<typeof expenseSchema>;

export default models.Expense ?? model("Expense", expenseSchema);
