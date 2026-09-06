import { Schema, model, models, type InferSchemaType } from "mongoose";

const shoppingItemSchema = new Schema(
  {
    householdId: { type: Schema.Types.ObjectId, ref: "Household", required: true },
    name: { type: String, required: true, trim: true },
    quantity: { type: String, trim: true },
    category: { type: String, trim: true },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    checked: { type: Boolean, required: true, default: false },
    checkedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

shoppingItemSchema.index({ householdId: 1, checked: 1 });

export type ShoppingItem = InferSchemaType<typeof shoppingItemSchema>;

export default models.ShoppingItem ?? model("ShoppingItem", shoppingItemSchema);
