import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongodb";
import { HASH_BCRYPT_BIDON } from "@/lib/auth-schemas";
import { emailCompteDemo, estEmailDemo } from "@/lib/demo-email";
import { estObjectIdValide } from "@/lib/ids";
import {
  MAX_TENTATIVES_EMAIL,
  MAX_TENTATIVES_IP,
  cleEmail,
  cleIp,
  emailUtilisableCommeCle,
  extraireIp,
  reinitialiserCompteur,
  reserverTentative,
} from "@/lib/login-limiter";
import {
  doitReverifier,
  lireIntervalleReverification,
  sessionRevoquee,
} from "@/lib/session-guard";
import UserModel from "@/models/User";

/**
 * Sous-classe de CredentialsSignin : Auth.js recopie `code` dans l'URL de
 * reponse (?error=CredentialsSignin&code=...) et signIn(..., { redirect:
 * false }) le rend au client dans `res.code`. Le message ne revele rien sur
 * le compte : le blocage s'applique a n'importe quel email, existant ou non.
 */
class TropDeTentatives extends CredentialsSignin {
  code = "trop_de_tentatives";
}

/**
 * Delai maximal entre deux relectures du compte pour une session ouverte.
 * C'est aussi le delai maximal avant qu'une session revoquee (mot de passe
 * change, compte supprime) soit effectivement refusee. SESSION_RECHECK_SECONDS
 * ne sert qu'a tester avec un delai court.
 */
const INTERVALLE_REVERIFICATION_SECONDES = lireIntervalleReverification(
  process.env.SESSION_RECHECK_SECONDS
);

/**
 * Lit le strict necessaire pour decider de la revocation. null = la base n'a
 * pas repondu : l'appelant garde la session (voir le callback jwt).
 */
async function lireEtatCompte(
  id: string
): Promise<{ utilisateurExiste: boolean; passwordChangedAt: Date | null | undefined } | null> {
  // Nos jetons portent toujours un _id Mongo valide : un id mal forme ne
  // designe aucun compte (et ferait lever une CastError a Mongoose).
  if (!estObjectIdValide(id)) return { utilisateurExiste: false, passwordChangedAt: null };
  try {
    await connectDB();
    const doc = await UserModel.findById(id).select("_id passwordChangedAt").lean<{
      passwordChangedAt?: Date | null;
    }>();
    return { utilisateurExiste: !!doc, passwordChangedAt: doc?.passwordChangedAt };
  } catch (e) {
    console.error(
      `[session] vérification en base impossible, session conservée : ${e instanceof Error ? e.name : "erreur inconnue"}`
    );
    return null;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Google et GitHub lisent leurs identifiants automatiquement depuis
  // AUTH_GOOGLE_ID/SECRET et AUTH_GITHUB_ID/SECRET (convention Auth.js v5) :
  // pas besoin de les passer explicitement ici. clientId/clientSecret
  // restent auto-inferes meme quand on personnalise d'autres options.
  providers: [
    Google({
      // Sans ca, Google saute l'ecran de choix des lors qu'un compte a
      // deja autorise l'app dans ce navigateur, et reconnecte silencieusement
      // sur ce compte-la sans possibilite d'en choisir un autre.
      authorization: { params: { prompt: "select_account" } },
    }),
    GitHub,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },
      // `request` est une copie de la requete d'origine, en-tetes compris
      // (@auth/core la reconstruit avant d'appeler authorize).
      async authorize(credentials, request) {
        const email =
          typeof credentials?.email === "string"
            ? credentials.email.toLowerCase().trim()
            : null;
        const password =
          typeof credentials?.password === "string"
            ? credentials.password
            : null;
        if (!email || !password) return null;

        await connectDB();

        // Limite d'essais AVANT toute lecture du compte : la tentative est
        // comptee des son arrivee (voir reserverTentative), et la decision ne
        // depend pas de l'existence du compte. Par IP (freine qui essaie un
        // mot de passe sur beaucoup d'emails differents) PUIS par email
        // (protege un compte vise). L'IP d'abord et seule : une IP bloquee
        // n'incremente plus aucun compteur email, donc ne peut ni bloquer des
        // comptes a distance au-dela de sa propre limite, ni creer de
        // nouvelles cles.
        const ip = extraireIp(request.headers);
        if (ip) {
          const parIp = await reserverTentative(cleIp(ip), MAX_TENTATIVES_IP);
          if (!parIp.autorise) throw new TropDeTentatives();
        }

        // Pas un email : aucun compte ne peut correspondre, et on ne cree pas
        // de compteur pour une cle arbitraire (sinon un anonyme remplirait la
        // base avec des "emails" geants). L'IP a deja ete comptee ci-dessus.
        // bcrypt tourne quand meme : la reponse prend le meme temps qu'un
        // vrai echec.
        if (!emailUtilisableCommeCle(email)) {
          await bcrypt.compare(password, HASH_BCRYPT_BIDON);
          return null;
        }

        const cleDeLEmail = cleEmail(email);
        // Compte demo (mot de passe public) : pas de compteur par email, sinon
        // n'importe qui le verrouillerait pour tout le monde en ratant 5 essais.
        // Le compteur par IP, deja passe plus haut, reste actif.
        if (!estEmailDemo(email, emailCompteDemo(process.env))) {
          const parEmail = await reserverTentative(cleDeLEmail, MAX_TENTATIVES_EMAIL);
          if (!parEmail.autorise) throw new TropDeTentatives();
        }

        // provider: "credentials" explicite : un compte cree via Google ne
        // doit jamais pouvoir se connecter par mot de passe, meme s'il en
        // devinait un.
        const user = await UserModel.findOne({
          email,
          provider: "credentials",
        }).select("+passwordHash");

        // bcrypt.compare TOUJOURS execute, contre un hash bidon de meme cout
        // si le compte n'existe pas : sans ca, un email inconnu repondrait
        // en quelques ms et un email connu en environ 300 ms, et le temps de
        // reponse dirait quels comptes existent.
        const valid = await bcrypt.compare(password, user?.passwordHash ?? HASH_BCRYPT_BIDON);
        if (!user?.passwordHash || !valid) return null;

        // Cle email seulement, jamais la cle IP (voir reinitialiserCompteur).
        await reinitialiserCompteur(cleDeLEmail);

        return {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          image: user.image ?? undefined,
        };
      },
    }),
  ],

  // Le provider Credentials impose des sessions JWT (pas de sessions cote
  // base de donnees pour lui) : on l'applique donc partout, y compris pour
  // Google/GitHub, pour rester coherent.
  session: { strategy: "jwt" },

  // Sans ceci, un visiteur non connecte atterrit sur la page de connexion
  // generique de NextAuth (/api/auth/signin) plutot que sur notre vraie
  // page, aux couleurs de RoomFlow.
  pages: { signIn: "/connexion" },

  callbacks: {
    /**
     * N'est invoque QUE par proxy.ts (la couche middleware), pas par les
     * appels a auth() ailleurs dans l'app. Retourner false declenche une
     * redirection automatique vers `pages.signIn` avec l'URL d'origine
     * conservee en callbackUrl.
     */
    authorized({ auth: session }) {
      return !!session?.user;
    },

    async signIn({ user, account }) {
      if (account?.provider !== "google" && account?.provider !== "github") {
        return true; // Credentials : deja verifie dans authorize()
      }

      const email = user.email?.toLowerCase().trim();
      if (!email) return false;

      await connectDB();
      let dbUser = await UserModel.findOne({ email });

      if (dbUser && dbUser.provider !== account.provider) {
        // Meme email deja utilise avec un autre mode de connexion (ex: mot
        // de passe). On refuse plutot que de lier silencieusement les
        // comptes : n'importe qui controlant cet email Google pourrait
        // sinon prendre le controle d'un compte protege par un mot de passe
        // qu'il ne connait pas.
        return false;
      }

      if (!dbUser) {
        dbUser = await UserModel.create({
          name: user.name ?? email,
          email,
          image: user.image,
          provider: account.provider,
        });
      }

      // Propage l'_id Mongo (pas l'id du provider OAuth) vers le callback
      // jwt ci-dessous, via l'objet `user` que NextAuth lui transmet.
      user.id = dbUser._id.toString();
      return true;
    },

    /**
     * Appele par @auth/core a la connexion (avec `user`), puis a CHAQUE
     * lecture de session pour un jeton existant (sans `user`) : auth() dans
     * un Server Component ou une route, proxy.ts, /api/auth/session cote
     * client, et useSession().update() (trigger "update"). Renvoyer null
     * termine la session : @auth/core ne renvoie alors aucune session (auth()
     * donne null, le proxy redirige vers /connexion) et efface le cookie
     * quand la reponse peut en poser (proxy, /api/auth/session ; pas un
     * Server Component, qui ne peut pas ecrire de cookie, mais il recoit
     * quand meme null).
     *
     * Revocation : le JWT est stocke dans le navigateur, rien cote serveur ne
     * permet de "l'effacer". On relit donc le compte au plus tard toutes les
     * INTERVALLE_REVERIFICATION_SECONDES. Entre deux relectures, une session
     * revoquee reste utilisable : c'est le delai maximal de revocation.
     */
    async jwt({ token, user, trigger, session }) {
      const maintenant = Date.now();

      if (user?.id) {
        token.id = user.id;
        // Claims PROPRES, pas le `iat` du JWT : @auth/core re-signe le jeton
        // a chaque lecture de session (setIssuedAt), donc `iat` serait
        // toujours "maintenant" et un cookie vole prolongerait lui-meme sa
        // validite. connecteLe n'est ecrit qu'ici, a la connexion.
        token.connecteLe = maintenant;
        token.verifieLe = maintenant;
      } else if (
        token.id &&
        doitReverifier(token.verifieLe, maintenant, INTERVALLE_REVERIFICATION_SECONDES)
      ) {
        const etat = await lireEtatCompte(token.id);
        if (etat) {
          if (sessionRevoquee({ connecteLe: token.connecteLe, ...etat })) return null;
          token.verifieLe = maintenant;
          // Jeton ouvert avant l'existence de connecteLe : on pose la date de
          // cette premiere verification. Limite : pour ces jetons-la, la
          // "connexion recente" (futur ecran de suppression de compte) part
          // de cette verification et non de la vraie connexion. La
          // revocation, elle, reste juste (voir sessionRevoquee).
          if (typeof token.connecteLe !== "number") token.connecteLe = maintenant;
        }
        // etat null = panne de base : on NE revoque PAS (sinon une panne
        // deconnecterait tout le monde). verifieLe n'avance pas, donc la
        // verification est retentee a la requete suivante.
      }

      // Declenche par useSession().update({ name }) sur /profil. La donnee
      // vient du client : on la revalide plutot que de faire confiance au
      // contenu de `session` (avertissement explicite de la doc Auth.js).
      if (trigger === "update" && typeof session?.name === "string") {
        const name = session.name.trim();
        if (name) token.name = name;
      }

      return token;
    },

    async session({ session, token }) {
      if (token.id && session.user) {
        session.user.id = token.id as string;
      }
      // Pour exiger une connexion recente avant une action sensible (futur
      // ecran de suppression de compte). Absent seulement pour un ancien
      // jeton pas encore reverifie : a traiter comme "pas recent".
      if (typeof token.connecteLe === "number") session.connecteLe = token.connecteLe;
      return session;
    },
  },
});
