import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { connexionRecente, supprimerCompte } from "@/lib/account";
import { HASH_BCRYPT_BIDON } from "@/lib/auth-schemas";
import {
  MAX_TENTATIVES_EMAIL,
  cleEmail,
  reinitialiserCompteur,
  reserverTentative,
} from "@/lib/login-limiter";
import { connectDB } from "@/lib/mongodb";
import UserModel from "@/models/User";

// Chaque champ est optionnel (la page envoie le nom OU la preference), mais
// un corps sans aucun des deux n'a rien a enregistrer.
const profilSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Le nom ne peut pas être vide")
      .max(80, "Le nom est trop long (80 caractères max)")
      .optional(),
    notificationsEmail: z.boolean().optional(),
  })
  .refine((d) => d.name !== undefined || d.notificationsEmail !== undefined, {
    message: "Aucune modification fournie",
  });

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = profilSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  // On n'ecrit que les champs recus : sinon enregistrer la case effacerait le
  // nom (et inversement).
  const modifications: { name?: string; notificationsEmail?: boolean } = {};
  if (parsed.data.name !== undefined) modifications.name = parsed.data.name;
  if (parsed.data.notificationsEmail !== undefined) {
    modifications.notificationsEmail = parsed.data.notificationsEmail;
  }

  await connectDB();
  const user = await UserModel.findByIdAndUpdate(session.user.id, modifications, { new: true });

  if (!user) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  return NextResponse.json({
    name: user.name,
    // Absent (compte ancien) = active.
    notificationsEmail: user.notificationsEmail !== false,
  });
}

// "SUPPRIMER" tape a la main : un clic par erreur ne suffit pas a tout effacer.
const suppressionSchema = z.object({
  confirmation: z.literal("SUPPRIMER", "Tape SUPPRIMER pour confirmer"),
  motDePasse: z.string().optional(),
  accepterAbandonCreances: z.boolean().optional(),
});

type CompteLu = {
  email: string;
  provider: string;
  passwordHash?: string;
  demo?: boolean;
};

/**
 * Suppression definitive du compte. La re-authentification protege l'ACTION :
 * une session volee (cookie copie) ne doit pas suffire a supprimer le compte.
 * On redemande donc le mot de passe, ou pour un compte Google/GitHub (sans mot
 * de passe) une connexion de moins de 10 minutes. Elle ne cache rien : les
 * dettes et creances sont deja affichees sur la page /profil.
 */
export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  const parsed = suppressionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }
  const { motDePasse, accepterAbandonCreances } = parsed.data;

  await connectDB();
  // Le provider vient de la base, pas de la session : c'est lui qui decide
  // quelle preuve on exige.
  const user = await UserModel.findById(userId)
    .select("+passwordHash email provider demo")
    .lean<CompteLu>();
  if (!user) {
    return NextResponse.json({ error: "Compte introuvable" }, { status: 404 });
  }

  // Compte de demonstration (public, mot de passe dans le README) : jamais
  // supprimable. AVANT toute verification de mot de passe ou de connexion
  // recente, et lu en base (`=== true`, .lean() n'applique pas le defaut).
  if (user.demo === true) {
    return NextResponse.json(
      { error: "Le compte de démonstration ne peut pas être supprimé." },
      { status: 403 }
    );
  }

  if (user.provider === "credentials") {
    if (!motDePasse) {
      return NextResponse.json({ error: "Mot de passe requis" }, { status: 400 });
    }
    // Meme compteur que la page de connexion : sans ca, cette route
    // permettrait d'essayer des mots de passe sans limite avec une session
    // volee. Compte AVANT la verification, comme dans authorize().
    const cle = cleEmail(user.email);
    const tentative = await reserverTentative(cle, MAX_TENTATIVES_EMAIL);
    if (!tentative.autorise) {
      return NextResponse.json(
        { error: "Trop de tentatives. Réessaie dans 15 minutes." },
        { status: 429 }
      );
    }
    // Hash bidon si le compte n'en a pas : meme temps de reponse, et refus.
    const valide = await bcrypt.compare(motDePasse, user.passwordHash ?? HASH_BCRYPT_BIDON);
    if (!user.passwordHash || !valide) {
      return NextResponse.json({ error: "Mot de passe incorrect" }, { status: 403 });
    }
    // Mot de passe prouve : on remet le compteur a zero, comme apres une
    // connexion reussie.
    await reinitialiserCompteur(cle);
  } else if (!connexionRecente(session.connecteLe, Date.now())) {
    return NextResponse.json(
      {
        error: "Reconnecte-toi pour confirmer la suppression de ton compte.",
        code: "connexion_ancienne",
      },
      { status: 403 }
    );
  }

  // L'evaluation (dettes, creances) est faite DANS supprimerCompte, sous le
  // verrou : une evaluation ici serait refaite de toute facon juste apres.
  let resultat;
  try {
    resultat = await supprimerCompte(userId, accepterAbandonCreances === true);
  } catch {
    // Deja journalise par supprimerCompte (nom de l'erreur seulement).
    return NextResponse.json(
      { error: "La suppression n'a pas pu aboutir. Réessaie dans un instant." },
      { status: 500 }
    );
  }

  if (resultat.ok) return NextResponse.json({ ok: true });

  if (resultat.raison === "en_cours") {
    return NextResponse.json(
      { error: "Une suppression de ton compte est déjà en cours." },
      { status: 409 }
    );
  }
  if (resultat.raison === "dettes") {
    return NextResponse.json(
      {
        error:
          "Tu dois encore de l'argent dans une colocation : règle tes dettes avant de supprimer ton compte.",
        dettes: resultat.dettes,
      },
      { status: 409 }
    );
  }
  return NextResponse.json(
    {
      code: "creances",
      error:
        "On te doit encore de l'argent : confirme que tu abandonnes ces sommes pour supprimer ton compte.",
      creances: resultat.creances,
    },
    { status: 409 }
  );
}
