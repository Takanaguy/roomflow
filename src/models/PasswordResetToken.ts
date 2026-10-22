import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * Jeton de reinitialisation de mot de passe (lot 9). On ne stocke JAMAIS le
 * jeton lui-meme, seulement son hash SHA-256 : une fuite de la base ne donne
 * ainsi aucun lien utilisable. Le jeton en clair n'existe que dans le mail.
 */
const passwordResetTokenSchema = new Schema(
  {
    // unique : un seul jeton valide par personne a la fois. Une nouvelle
    // demande supprime l'ancien, et si deux demandes arrivent en meme temps,
    // la base refuse la seconde creation au lieu de laisser deux liens valides.
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    // unique aussi : sert a la recherche au moment de l'usage (index obligatoire)
    // et garantit qu'un hash ne designe jamais deux utilisateurs.
    tokenHash: { type: String, required: true, unique: true },
    // Index TTL : Mongo supprime le document des que la date est passee
    // (expireAfterSeconds: 0 = "a la date exacte"). Menage seulement : son
    // passage peut avoir jusqu'a 60 s de retard, donc l'expiration est AUSSI
    // verifiee a la main au moment de l'usage (jetonExpire).
    expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  },
  // createdAt sert a la limitation de frequence (une demande par minute).
  { timestamps: { createdAt: true, updatedAt: false } }
);

export type PasswordResetToken = InferSchemaType<typeof passwordResetTokenSchema>;

export default models.PasswordResetToken ?? model("PasswordResetToken", passwordResetTokenSchema);
