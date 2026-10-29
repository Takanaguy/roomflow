import dns from "node:dns";
import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

/**
 * Contournement OPTIONNEL pour certains reseaux (box, wifi public, VPN) dont
 * le resolveur DNS local refuse les requetes SRV : l'URI mongodb+srv:// de
 * Atlas en a besoin, et la connexion echoue alors avec "querySrv
 * ECONNREFUSED" meme si Atlas autorise bien l'IP. Si MONGODB_DNS_SERVERS est
 * defini (ex. "1.1.1.1,8.8.8.8"), Node utilise ces resolveurs a la place de
 * ceux du systeme. Sans la variable, rien ne change.
 *
 * Ignoree en production Vercel, par le code et pas seulement par discipline
 * (meme principe que EMAIL_REDIRECT_TO) : une variable oubliee dans Vercel
 * ne doit pas remplacer les resolveurs de l'hebergeur.
 */
const serveursDns =
  process.env.VERCEL_ENV === "production"
    ? undefined
    : process.env.MONGODB_DNS_SERVERS?.split(",")
        .map((s) => s.trim())
        .filter(Boolean);
if (serveursDns?.length) {
  try {
    dns.setServers(serveursDns);
  } catch {
    console.warn("[mongodb] MONGODB_DNS_SERVERS invalide : resolveurs du système conservés");
  }
}

/**
 * En dev, Next.js recharge les modules à chaud à chaque modification de
 * fichier. Sans ce cache sur `globalThis`, chaque rechargement ouvrirait une
 * nouvelle connexion Mongoose sans jamais fermer les précédentes, jusqu'à
 * épuiser le pool de connexions MongoDB. Le cache survit au rechargement de
 * module (contrairement à une simple variable de module), mais pas au
 * redémarrage complet du process.
 */
type MongooseCache = {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
};

declare global {
  var _mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global._mongooseCache ?? {
  conn: null,
  promise: null,
};
global._mongooseCache = cache;

export async function connectDB() {
  if (cache.conn) return cache.conn;

  if (!MONGODB_URI) {
    throw new Error(
      "MONGODB_URI manquant dans les variables d'environnement. Voir .env.example."
    );
  }

  if (!cache.promise) {
    cache.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (err) {
    // Un echec de connexion ne doit pas rester en cache : sinon toute
    // requete suivante echouerait immediatement sans jamais retenter.
    cache.promise = null;
    throw err;
  }

  return cache.conn;
}
