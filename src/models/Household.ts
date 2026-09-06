import { Schema, model, models, Types, type InferSchemaType } from "mongoose";
import { randomBytes } from "crypto";

const memberSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: ["admin", "member"], required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const householdSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    members: { type: [memberSchema], default: [] },
    // Code court partage aux colocataires pour rejoindre (section 4.2 et
    // parcours 2 du cahier des charges). Genere par defaut a la creation.
    inviteCode: {
      type: String,
      required: true,
      unique: true,
      default: () => randomBytes(4).toString("hex"), // ex: "a1b2c3d4"
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type Household = InferSchemaType<typeof householdSchema>;
export type HouseholdMember = InferSchemaType<typeof memberSchema> & {
  userId: Types.ObjectId;
};

export default models.Household ?? model("Household", householdSchema);
