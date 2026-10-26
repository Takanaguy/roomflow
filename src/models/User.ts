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
    // Preference "Recevoir les notifications par email" (profil). Les mails de
    // securite (mot de passe oublie) l'ignorent. Les comptes crees avant ce
    // champ ne l'ont pas en base : a la lecture, on traite "absent" comme true
    // (`!== false`), car une requete .lean() n'applique pas le default.
    notificationsEmail: { type: Boolean, default: true },
    // Date de la derniere demande "mot de passe oublie". Sert de verrou de
    // frequence pour TOUS les comptes (email, Google, GitHub), y compris ceux
    // qui n'ont pas de jeton : elle est posee par un seul findOneAndUpdate
    // conditionnel, donc deux demandes simultanees ne passent pas toutes les
    // deux. Absente tant que la personne n'a jamais fait de demande.
    derniereDemandeMdpAt: { type: Date },
    // Date du dernier changement de mot de passe. Les sessions JWT ne sont
    // stockees nulle part cote serveur : c'est ce champ qui permet de les
    // revoquer. Toute session ouverte AVANT cette date est refusee a sa
    // prochaine reverification (callback jwt de src/auth.ts). Absent tant que
    // le mot de passe n'a jamais change.
    passwordChangedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type User = InferSchemaType<typeof userSchema>;

// `models.User` evite de redeclarer le modele a chaque rechargement a chaud
// en dev (Mongoose refuse de compiler deux fois le meme nom de modele).
export default models.User ?? model("User", userSchema);
