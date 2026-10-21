"use client";

import {
  useEffect,
  useOptimistic,
  useRef,
  useState,
  startTransition,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
// Types seulement depuis shopping.ts : une valeur importee embarquerait Mongoose
// dans le navigateur. Les valeurs viennent du fichier pur shopping-constants.
import type { ArticleDetail } from "@/lib/shopping";
import type { PersonneNommee } from "@/lib/tasks";
import { CATEGORIES_COURSES, grouperParCategorie } from "@/lib/shopping-constants";

/** Delai entre deux rafraichissements automatiques (cahier des charges : voir les ajouts des autres). */
const INTERVALLE_REFRESH_MS = 15_000;

/** Prefixe des ids provisoires d'articles ajoutes en optimiste (pas encore connus du serveur). */
const PREFIXE_TEMP = "temp-";

/**
 * Modifications optimistes. Chaque action decrit ce que l'utilisateur vient de
 * demander ; le reducer l'applique par-dessus les donnees du serveur le temps
 * que la requete (et le rafraichissement qui suit) se termine.
 */
type Action =
  | { type: "ajout"; article: ArticleDetail }
  | { type: "coche"; id: string; checked: boolean; par: PersonneNommee; quand: string }
  | { type: "suppression"; id: string };

function appliquerAction(articles: ArticleDetail[], action: Action): ArticleDetail[] {
  switch (action.type) {
    case "ajout":
      return [...articles, action.article];
    case "coche":
      return articles.map((a) =>
        a.id === action.id
          ? {
              ...a,
              checked: action.checked,
              checkedAt: action.checked ? action.quand : null,
              cochePar: action.checked ? action.par : null,
            }
          : a
      );
    case "suppression":
      return articles.filter((a) => a.id !== action.id);
  }
}

async function lireErreur(res: Response | null, parDefaut: string): Promise<string> {
  const body = res ? await res.json().catch(() => null) : null;
  return typeof body?.error === "string" ? body.error : parDefaut;
}

/**
 * Les donnees viennent des props (page.tsx) et sont renouvelees par
 * router.refresh() : toutes les 15 s et au retour sur l'onglet. Pas de copie
 * des props dans un useState (elle ignorerait les nouvelles props apres un
 * refresh) : useOptimistic affiche "props + modifications en cours" et revient
 * tout seul aux props quand la transition se termine, y compris en cas d'echec.
 */
export default function CoursesClient({
  householdId,
  moi,
  aAcheter,
  achetes,
  joursAchetes,
}: {
  householdId: string;
  moi: PersonneNommee;
  aAcheter: ArticleDetail[];
  achetes: ArticleDetail[];
  joursAchetes: number;
}) {
  const router = useRouter();
  const [articles, appliquer] = useOptimistic([...aAcheter, ...achetes], appliquerAction);
  const [erreur, setErreur] = useState<string | null>(null);
  // Articles dont une requete est en vol : verrouilles, pas de double envoi.
  const [enCours, setEnCours] = useState<ReadonlySet<string>>(new Set());

  const [nom, setNom] = useState("");
  const [quantite, setQuantite] = useState("");
  const [categorie, setCategorie] = useState("");
  const nomRef = useRef<HTMLInputElement>(null);

  // Compteur de mutations en vol, lu par le rafraichissement automatique. Une
  // ref et non un state : l'intervalle ne doit pas etre reinstalle a chaque
  // changement, et ce compteur n'est jamais affiche.
  const mutationsEnCours = useRef(0);
  const compteurTemp = useRef(0);

  useEffect(() => {
    function rafraichir() {
      // Pas de refresh pendant une mutation (il pourrait ecraser l'etat
      // optimiste avec des donnees d'avant la modification), ni onglet cache
      // (inutile de solliciter le serveur pour personne).
      if (mutationsEnCours.current > 0 || document.visibilityState !== "visible") return;
      router.refresh();
    }
    const minuteur = setInterval(rafraichir, INTERVALLE_REFRESH_MS);
    // Au retour sur l'onglet (ou l'appli au telephone), on n'attend pas les 15 s.
    document.addEventListener("visibilitychange", rafraichir);
    return () => {
      clearInterval(minuteur);
      document.removeEventListener("visibilitychange", rafraichir);
    };
  }, [router]);

  /**
   * Une mutation = affichage optimiste + requete + refresh. Tout se passe dans
   * une transition asynchrone : React garde l'etat optimiste jusqu'a la fin de
   * la fonction, puis revient aux props. Si l'API refuse, rien n'est a
   * annuler a la main : l'article reprend simplement sa place d'avant.
   */
  function executer(
    action: Action,
    requete: () => Promise<Response>,
    messageErreur: string,
    options: { idVerrou?: string; onEchec?: () => void } = {}
  ) {
    const { idVerrou, onEchec } = options;
    setErreur(null);
    mutationsEnCours.current += 1;
    if (idVerrou) setEnCours((prev) => new Set(prev).add(idVerrou));

    startTransition(async () => {
      appliquer(action);
      let res: Response | null = null;
      try {
        res = await requete();
      } catch {
        res = null;
      }

      try {
        if (res?.ok) {
          // Appele pendant l'action : le rafraichissement se termine avec elle,
          // l'ecran passe donc de "optimiste" a "serveur" sans clignoter.
          router.refresh();
        } else {
          setErreur(await lireErreur(res, messageErreur));
          onEchec?.();
          // Un refus (404 : article supprime par quelqu'un d'autre) veut souvent
          // dire que l'ecran est perime : on resynchronise sans attendre les 15 s.
          router.refresh();
        }
      } finally {
        mutationsEnCours.current -= 1;
        if (idVerrou) {
          setEnCours((prev) => {
            const suivant = new Set(prev);
            suivant.delete(idVerrou);
            return suivant;
          });
        }
      }
    });
  }

  function ajouter(e: FormEvent) {
    e.preventDefault();
    const nomSaisi = nom.trim();
    if (!nomSaisi) return;
    const quantiteSaisie = quantite.trim();
    const categorieSaisie = categorie;

    compteurTemp.current += 1;
    const article: ArticleDetail = {
      id: `${PREFIXE_TEMP}${compteurTemp.current}`,
      name: nomSaisi,
      quantity: quantiteSaisie || null,
      category: categorieSaisie || null,
      checked: false,
      checkedAt: null,
      ajoutePar: moi,
      cochePar: null,
      peuxSupprimer: true,
    };

    // Le champ est vide et re-focus tout de suite pour enchainer les ajouts
    // (surtout au telephone, ou le clavier reste ouvert). La categorie est
    // conservee : on ajoute souvent plusieurs articles du meme rayon d'affilee.
    setNom("");
    setQuantite("");
    nomRef.current?.focus();

    executer(
      { type: "ajout", article },
      // L'API refuse "" et null : on omet les champs vides.
      () =>
        fetch(`/api/colocations/${householdId}/courses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: nomSaisi,
            ...(quantiteSaisie ? { quantity: quantiteSaisie } : {}),
            ...(categorieSaisie ? { category: categorieSaisie } : {}),
          }),
        }),
      "Impossible d'ajouter l'article.",
      {
        // L'ajout a echoue : on rend la saisie, sauf si l'utilisateur a deja
        // commence a taper autre chose.
        onEchec: () => {
          setNom((prev) => (prev === "" ? nomSaisi : prev));
          setQuantite((prev) => (prev === "" ? quantiteSaisie : prev));
        },
      }
    );
  }

  function cocher(article: ArticleDetail, checked: boolean) {
    if (enCours.has(article.id) || article.id.startsWith(PREFIXE_TEMP)) return;
    executer(
      { type: "coche", id: article.id, checked, par: moi, quand: new Date().toISOString() },
      () =>
        fetch(`/api/colocations/${householdId}/courses/${article.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checked }),
        }),
      checked ? "Impossible de cocher l'article." : "Impossible de décocher l'article.",
      { idVerrou: article.id }
    );
  }

  function supprimer(article: ArticleDetail) {
    if (enCours.has(article.id) || article.id.startsWith(PREFIXE_TEMP)) return;
    executer(
      { type: "suppression", id: article.id },
      () => fetch(`/api/colocations/${householdId}/courses/${article.id}`, { method: "DELETE" }),
      "Impossible de supprimer l'article.",
      { idVerrou: article.id }
    );
  }

  const aAcheterAffiches = articles.filter((a) => !a.checked);
  // Le dernier coche en premier, comme cote serveur (un article qu'on vient de
  // cocher doit remonter en tete de la section).
  const achetesAffiches = articles
    .filter((a) => a.checked)
    .sort((a, b) => (b.checkedAt ?? "").localeCompare(a.checkedAt ?? ""));
  const groupes = grouperParCategorie(aAcheterAffiches);

  const estVerrouille = (id: string) => enCours.has(id) || id.startsWith(PREFIXE_TEMP);

  return (
    <div className="mt-6">
      <form onSubmit={ajouter} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Article
          <input
            ref={nomRef}
            type="text"
            required
            maxLength={100}
            value={nom}
            onChange={(e) => setNom(e.target.value)}
            placeholder="Lait, pâtes, papier toilette..."
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-24 flex-1 flex-col gap-1 text-xs text-zinc-500">
            Quantité (facultatif)
            <input
              type="text"
              maxLength={30}
              value={quantite}
              onChange={(e) => setQuantite(e.target.value)}
              placeholder="2, 500 g..."
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900"
            />
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-xs text-zinc-500">
            Catégorie (facultatif)
            <select
              value={categorie}
              onChange={(e) => setCategorie(e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
            >
              <option value="">Sans catégorie</option>
              {CATEGORIES_COURSES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          type="submit"
          className="self-start rounded-md bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-700"
        >
          Ajouter
        </button>
      </form>

      {erreur && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {erreur}
        </p>
      )}

      <section aria-label="À acheter" className="mt-8">
        <h2 className="text-sm font-medium text-zinc-700">
          À acheter ({aAcheterAffiches.length})
        </h2>
        {aAcheterAffiches.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">Rien à acheter pour l&apos;instant.</p>
        ) : (
          groupes.map((g) => (
            <div key={g.category ?? "sans-categorie"} className="mt-4">
              <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                {g.label}
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {g.articles.map((a) => (
                  <LigneArticle
                    key={a.id}
                    article={a}
                    verrouille={estVerrouille(a.id)}
                    onCocher={cocher}
                    onSupprimer={supprimer}
                  />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      {achetesAffiches.length > 0 && (
        <section aria-label="Achetés" className="mt-10">
          <h2 className="text-sm font-medium text-zinc-700">
            Achetés ({achetesAffiches.length})
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {achetesAffiches.map((a) => (
              <LigneArticle
                key={a.id}
                article={a}
                verrouille={estVerrouille(a.id)}
                onCocher={cocher}
                onSupprimer={supprimer}
              />
            ))}
          </ul>
        </section>
      )}

      <p className="mt-8 text-xs text-zinc-500">
        Les articles achetés restent {joursAchetes} jours sur cette page, puis passent dans{" "}
        <Link
          href={`/colocations/${householdId}/courses/historique`}
          className="text-zinc-700 hover:underline"
        >
          l&apos;historique complet
        </Link>
        . La liste se met à jour toute seule.
      </p>
    </div>
  );
}

/** Une ligne, a acheter ou achetee : seule la case cochee et le texte changent. */
function LigneArticle({
  article,
  verrouille,
  onCocher,
  onSupprimer,
}: {
  article: ArticleDetail;
  verrouille: boolean;
  onCocher: (article: ArticleDetail, checked: boolean) => void;
  onSupprimer: (article: ArticleDetail) => void;
}) {
  const [confirmerSuppression, setConfirmerSuppression] = useState(false);

  return (
    <li
      className={`flex items-center gap-2 rounded-md border border-zinc-200 bg-white ${
        verrouille ? "opacity-60" : ""
      }`}
    >
      {/* Tout le label est cliquable (min-h-12 : cible tactile confortable), pas
          seulement la case de 20 px. */}
      <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 px-3 py-2">
        <input
          type="checkbox"
          checked={article.checked}
          disabled={verrouille}
          onChange={(e) => onCocher(article, e.target.checked)}
          className="size-5 shrink-0 accent-zinc-900"
        />
        <span className="min-w-0">
          <span
            className={`block break-words text-sm ${
              article.checked ? "text-zinc-500 line-through" : "font-medium text-zinc-900"
            }`}
          >
            {article.name}
            {article.quantity && (
              <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-normal text-zinc-600">
                {article.quantity}
              </span>
            )}
          </span>
          <span className="block text-xs text-zinc-500">
            {article.checked && article.cochePar
              ? `acheté par ${article.cochePar.name}`
              : `ajouté par ${article.ajoutePar.name}`}
          </span>
        </span>
      </label>

      {article.peuxSupprimer && (
        <div className="shrink-0 pr-3">
          {confirmerSuppression ? (
            <span className="flex gap-3 text-xs">
              <button
                type="button"
                disabled={verrouille}
                onClick={() => onSupprimer(article)}
                className="py-2 text-red-600 hover:underline disabled:opacity-50"
              >
                Confirmer
              </button>
              <button
                type="button"
                onClick={() => setConfirmerSuppression(false)}
                className="py-2 text-zinc-500 hover:underline"
              >
                Annuler
              </button>
            </span>
          ) : (
            <button
              type="button"
              disabled={verrouille}
              onClick={() => setConfirmerSuppression(true)}
              className="py-2 text-xs text-red-600 hover:underline disabled:opacity-50"
            >
              Supprimer
            </button>
          )}
        </div>
      )}
    </li>
  );
}
