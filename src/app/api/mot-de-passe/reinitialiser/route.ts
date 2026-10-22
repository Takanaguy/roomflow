import { NextResponse } from "next/server";
import { z } from "zod";
import { motDePasseSchema } from "@/lib/auth-schemas";
import { reinitialiserMotDePasse } from "@/lib/password-reset";

const LIEN_INVALIDE = "Lien invalide ou expiré";

const corpsSchema = z.object({
  // Un vrai jeton fait 43 caracteres ; la borne evite de hacher un corps geant.
  jeton: z.string().min(1).max(200),
  motDePasse: motDePasseSchema,
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  // Jeton absent ou mal forme : meme reponse generique qu'un jeton inconnu.
  const jeton = (body as { jeton?: unknown } | null)?.jeton;
  if (typeof jeton !== "string" || jeton.length < 1 || jeton.length > 200) {
    return NextResponse.json({ error: LIEN_INVALIDE }, { status: 400 });
  }

  // ORDRE : on valide le mot de passe AVANT de toucher au jeton, pour deux
  // raisons. 1) Les regles du mot de passe sont publiques (page d'inscription)
  // et ne dependent pas du jeton : repondre "8 caracteres minimum" ne revele
  // donc rien sur la validite du lien, que le jeton soit bon ou non. 2) Le
  // jeton est a usage unique et consomme par reinitialiserMotDePasse : valider
  // apres le brulerait pour une simple faute de frappe, et la personne devrait
  // refaire une demande par mail.
  const parsed = corpsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  const resultat = await reinitialiserMotDePasse(parsed.data.jeton, parsed.data.motDePasse);
  if (!resultat.ok) {
    return NextResponse.json({ error: LIEN_INVALIDE }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
