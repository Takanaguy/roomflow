import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getHouseholdForMember } from "@/lib/households";
import { donneesRecapMensuel, nomFichierRecap } from "@/lib/recap-mensuel";
import { genererPdfRecap } from "@/lib/recap-mensuel-pdf";

// react-pdf (pdfkit) a besoin des API Node, il ne tourne pas en Edge.
export const runtime = "nodejs";

// Un export au plafond de dépenses (MAX_DEPENSES_EXPORT) prend quelques secondes à
// rendre ; la marge couvre la base lente et le démarrage à froid de la fonction.
export const maxDuration = 30;

/**
 * Telecharge le recapitulatif mensuel de la colocation en PDF.
 * ?mois=AAAA-MM, comme le dashboard ; absent ou invalide : mois courant.
 * Pas de `export const dynamic` : un GET est dynamique par defaut depuis Next 15,
 * et auth() lit les cookies.
 */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/colocations/[id]/export">
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  }

  const { id } = await ctx.params;

  // get() renvoie la premiere valeur si ?mois= est repete ; parserMois ignore
  // tout ce qui n'est pas AAAA-MM.
  const moisParam = new URL(request.url).searchParams.get("mois") ?? undefined;

  // Le try couvre aussi la verification d'appartenance : une base injoignable donne le
  // meme 500 JSON propre. 'etape' dit OU ca a echoue (base ou react-pdf) dans le journal.
  let etape: "lecture" | "rendu" = "lecture";
  try {
    // Meme 404 pour une colocation inconnue, un id mal forme ou un non-membre :
    // on ne revele pas l'existence d'une colocation a qui n'en fait pas partie.
    const result = await getHouseholdForMember(id, session.user.id);
    if (!result) {
      return NextResponse.json({ error: "Colocation introuvable" }, { status: 404 });
    }

    const resultat = await donneesRecapMensuel(id, moisParam);
    if (resultat.statut === "introuvable") {
      return NextResponse.json({ error: "Colocation introuvable" }, { status: 404 });
    }
    if (resultat.statut === "trop_de_depenses") {
      // 422 : la requete est bien formee mais ce mois-la est trop gros pour un PDF.
      return NextResponse.json(
        {
          error: `Trop de dépenses ce mois-ci pour un export PDF (maximum ${resultat.maximum}).`,
        },
        { status: 422 }
      );
    }
    const { recap } = resultat;
    etape = "rendu";
    const pdf = await genererPdfRecap(recap);

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nomFichierRecap(recap.colocation.nom, recap.mois)}"`,
        "Content-Length": String(pdf.length),
        // Document personnel : jamais dans un cache partage.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    // Le nom de l'erreur seulement : le message pourrait contenir des donnees.
    console.error(
      `[export] génération du PDF impossible (étape ${etape}) : ${e instanceof Error ? e.name : "erreur inconnue"}`
    );
    return NextResponse.json(
      { error: "L'export n'a pas pu être généré. Réessaie dans un instant." },
      { status: 500 }
    );
  }
}
