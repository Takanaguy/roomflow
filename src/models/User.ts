import { Schema, model, models, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Absent pour un compte cree via Google/GitHub : ces providers n'ont pas
    // de mot de passe a verifier.
    passwordHash: { type: String, select: false },
    image: { type: String },
    provider: {
      type: String,
      enum: ["credentials", "google", "github"],
      required: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type User = InferSchemaType<typeof userSchema>;

// `models.User` evite de redeclarer le modele a chaque rechargement a chaud
// en dev (Mongoose refuse de compiler deux fois le meme nom de modele).
export default models.User ?? model("User", userSchema);
