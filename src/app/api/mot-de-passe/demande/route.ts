import { NextResponse, after } from "next/server";
import { z } from "zod";
import { traiterDemandeReinitialisation } from "@/lib/password-reset";

// Meme forme d'email que l'inscription (trim + minuscules), avec une borne
// de longueur : une adresse ne depasse pas 254 caracteres.
const demandeSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email("Email invalide"),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = demandeSchema.safeParse(body);

  // Seul cas d'erreur : l'adresse n'a pas la forme d'un email. Cela ne dit
  // rien sur l'existence d'un compte.
  if (!parsed.success) {
    return NextResponse.json({ error: "Email invalide" }, { status: 400 });
  }

  // Tout le travail (recherche en base, creation du jeton, envoi du mail)
  // part APRES la reponse. Sinon un email connu repondrait plus lentement
  // qu'un email inconnu, et on pourrait deviner qui a un compte en
  // chronometrant. La reponse est identique dans tous les cas.
  after(() => traiterDemandeReinitialisation(parsed.data.email));

  return NextResponse.json({ ok: true });
}
