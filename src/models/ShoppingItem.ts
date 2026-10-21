import { Schema, model, models, type InferSchemaType } from "mongoose";
import { VALEURS_CATEGORIES } from "@/lib/shopping-constants";

const shoppingItemSchema = new Schema(
  {
    householdId: { type: Schema.Types.ObjectId, ref: "Household", required: true },
    name: { type: String, required: true, trim: true },
    quantity: { type: String, trim: true },
    // Liste fixe (et non du texte libre) pour pouvoir regrouper l'affichage
    // par rayon. Optionnelle : un enum Mongoose ne valide pas une valeur
    // absente, un article peut donc n'avoir aucune categorie.
    category: { type: String, enum: [...VALEURS_CATEGORIES] },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    checked: { type: Boolean, required: true, default: false },
    checkedBy: { type: Schema.Types.ObjectId, ref: "User" },
    // Quand l'article a ete coche : sert a l'historique et a la regle des 7
    // jours (un article coche depuis plus longtemps ne reste que dans la page
    // d'historique). Efface si on decoche.
    checkedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

shoppingItemSchema.index({ householdId: 1, checked: 1 });

export type ShoppingItem = InferSchemaType<typeof shoppingItemSchema>;

export default models.ShoppingItem ?? model("ShoppingItem", shoppingItemSchema);
