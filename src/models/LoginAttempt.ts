import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * Compteur de tentatives de connexion par mot de passe, pour une cle
 * ("email:..." ou "ip:...", voir src/lib/login-limiter.ts). Stocke en base et
 * non en memoire : sur Vercel, chaque requete peut tomber sur une instance
 * differente, un compteur en memoire serait remis a zero au hasard.
 */
const loginAttemptSchema = new Schema({
  // unique : une seule ligne par cle, sinon deux tentatives simultanees
  // pourraient creer deux compteurs et chacun croirait etre le premier.
  // L'index sert aussi a la recherche, faite a chaque tentative.
  cle: { type: String, required: true, unique: true },
  // Nombre de tentatives depuis `debut`, la tentative en cours comprise.
  n: { type: Number, required: true },
  // Debut de la fenetre en cours. La fenetre est fixe (elle ne glisse pas a
  // chaque essai) : un blocage dure au plus la duree de la fenetre.
  debut: { type: Date, required: true },
  // Index TTL : Mongo supprime le compteur une fois la fenetre terminee
  // (expireAfterSeconds: 0 = "a la date exacte"). Menage seulement : le
  // passage du TTL peut avoir du retard, donc la fin de fenetre est AUSSI
  // verifiee dans la mise a jour elle-meme (reserverTentative).
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
});

export type LoginAttempt = InferSchemaType<typeof loginAttemptSchema>;

export default models.LoginAttempt ?? model("LoginAttempt", loginAttemptSchema);
