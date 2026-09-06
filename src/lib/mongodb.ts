import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;

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
