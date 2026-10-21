import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { connectDB } from "@/lib/mongodb";
import { getHouseholdForMember, isAdminMember } from "@/lib/households";
import { estObjectIdValide } from "@/lib/ids";
import { serializeArticles } from "@/lib/shopping";
import { champsArticle } from "@/lib/shopping-schemas";
import ShoppingItemModel from "@/models/ShoppingItem";

const createSchema = z.object({
  name: champsArticle.name,
  quantity: champsArticle.quantity.optional(),
  category: champsArticle.category.optional(),
});

/**
 * Ajout d'un article : tout membre peut en ajouter un. Pas de GET ici, les
 * pages lisent directement la base (listerArticles), comme pour les taches :
 * les routes ne servent qu'aux modifications.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<"/api/colocations/[id]/courses">
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const { id } = await ctx.params;
  // Id mal forme : meme reponse qu'une colocation inconnue, sans CastError.
  if (!estObjectIdValide(id)) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  const result = await getHouseholdForMember(id, session.user.id);
  if (!result) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }
  const data = parsed.data;

  await connectDB();
  // Les doublons de nom sont autorises (decision de Tanguy) : aucune
  // verification d'unicite.
  const article = await ShoppingItemModel.create({
    householdId: id,
    name: data.name,
    // Une quantite vide n'est pas stockee : "" et "pas de quantite" doivent
    // etre la meme chose a l'affichage.
    ...(data.quantity ? { quantity: data.quantity } : {}),
    ...(data.category ? { category: data.category } : {}),
    addedBy: session.user.id,
    checked: false,
  });

  const [serialise] = await serializeArticles(
    [article],
    session.user.id,
    isAdminMember(result.membership)
  );
  return NextResponse.json(serialise, { status: 201 });
}
