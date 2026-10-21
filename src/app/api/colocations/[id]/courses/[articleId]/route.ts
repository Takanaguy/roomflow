import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import { estObjectIdValide } from "@/lib/ids";
import {
  definirCocheArticle,
  getArticleInHousehold,
  peutSupprimerArticle,
  serializeArticles,
} from "@/lib/shopping";
import { champsArticle } from "@/lib/shopping-schemas";

// Seul champ modifiable : l'etat de coche, obligatoire. Le contenu d'un
// article (nom, quantite, categorie) ne se modifie pas : on supprime et on
// re-ajoute (decision de Tanguy).
const editSchema = z.object({
  checked: champsArticle.checked,
});

/** Charge colocation + article en renvoyant 404 pour tout id inconnu ou mal forme. */
async function charger(householdId: string, articleId: string, userId: string) {
  if (!estObjectIdValide(householdId) || !estObjectIdValide(articleId)) return null;

  const result = await getHouseholdForMember(householdId, userId);
  if (!result) return null;

  const article = await getArticleInHousehold(householdId, articleId);
  if (!article) return null;

  return { result, article };
}

/** Cocher ou decocher : tout membre. L'etat est explicite, pas un basculement. */
export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/colocations/[id]/courses/[articleId]">
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }
  const userId = session.user.id;

  const { id, articleId } = await ctx.params;
  const acces = await charger(id, articleId, userId);
  if (!acces) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = editSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  const article = await definirCocheArticle(acces.article, parsed.data.checked, userId);
  const [serialise] = await serializeArticles(
    [article],
    userId,
    isAdminMember(acces.result.membership)
  );
  return NextResponse.json(serialise);
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/colocations/[id]/courses/[articleId]">
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const { id, articleId } = await ctx.params;
  const acces = await charger(id, articleId, session.user.id);
  if (!acces) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  if (
    !peutSupprimerArticle(
      acces.article.addedBy.toString(),
      session.user.id,
      isAdminMember(acces.result.membership)
    )
  ) {
    return NextResponse.json(
      { error: "Seuls l'auteur de l'article ou l'admin peuvent le supprimer" },
      { status: 403 }
    );
  }

  await acces.article.deleteOne();
  return NextResponse.json({ ok: true });
}
