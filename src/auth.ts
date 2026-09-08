import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import GitHub from "next-auth/providers/github";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongodb";
import UserModel from "@/models/User";

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
      async authorize(credentials) {
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

        // provider: "credentials" explicite : un compte cree via Google ne
        // doit jamais pouvoir se connecter par mot de passe, meme s'il en
        // devinait un.
        const user = await UserModel.findOne({
          email,
          provider: "credentials",
        }).select("+passwordHash");
        if (!user?.passwordHash) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

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

    async jwt({ token, user, trigger, session }) {
      if (user?.id) token.id = user.id;

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
      return session;
    },
  },
});
