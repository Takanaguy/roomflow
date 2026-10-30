import { NextResponse } from "next/server";
import { reinitialiserDemoPourCron } from "@/lib/demo";
import { executerNettoyage, type RapportNettoyage } from "@/lib/nettoyage-cron";
import { secretCronValide } from "@/lib/rappels";

// Un passage plafonne a 50 actions (envois d'emails, suppressions) peut depasser
// la duree par defaut d'une fonction. La reinitialisation de la demo, qui passe
// avant, compte dans ce meme budget mais reste courte (quelques secondes).
export const maxDuration = 60;

/**
 * Appelee chaque jour par Vercel Cron (voir vercel.json), meme protection que
 * /api/cron/rappels-taches : fermee par defaut sans CRON_SECRET, meme reponse
 * 401 quel que soit le motif. La reponse ne contient que des compteurs.
 *
 * La remise a zero de la demo est faite ICI, et non dans un troisieme cron : le
 * plan gratuit de Vercel n'en autorise que deux (rappels de taches et
 * nettoyage). Elle passe AVANT le nettoyage : c'est le travail court, et le
 * nettoyage, le plus long, a son propre budget de temps (BUDGET_TEMPS_MS) qu'il
 * mesure depuis son propre depart. Les deux travaux sont independants : chacun a
 * son propre try/catch, l'echec de l'un n'empeche jamais l'autre.
 */
export async function GET(request: Request) {
  if (!secretCronValide(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  // Ne leve jamais (son propre try/catch est dans la fonction).
  const demo = await reinitialiserDemoPourCron({
    env: process.env,
    maintenant: new Date(),
  });

  let rapport: RapportNettoyage | null = null;
  try {
    rapport = await executerNettoyage();
  } catch (e) {
    console.error(
      `[nettoyage] échec du passage : ${e instanceof Error ? e.name : "erreur inconnue"}`
    );
  }

  if (!rapport) {
    return NextResponse.json({ error: "Échec du nettoyage", demo }, { status: 500 });
  }
  return NextResponse.json({ ...rapport, demo });
}
