"use client";

import { useState, type KeyboardEventHandler, type PointerEventHandler } from "react";
import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { StatutTache, TacheDetail } from "@/lib/tasks";
import TacheForm from "./TacheForm";

type Membre = { userId: string; name: string };

const COLONNES: { statut: StatutTache; label: string }[] = [
  { statut: "todo", label: "À faire" },
  { statut: "in_progress", label: "En cours" },
  { statut: "done", label: "Fait" },
];

const LABEL_STATUT: Record<StatutTache, string> = {
  todo: "À faire",
  in_progress: "En cours",
  done: "Fait",
};

const LABEL_RECURRENCE = { weekly: "Hebdomadaire", monthly: "Mensuelle" } as const;

function estStatut(valeur: unknown): valeur is StatutTache {
  return valeur === "todo" || valeur === "in_progress" || valeur === "done";
}

/**
 * Une echeance est saisie comme un JOUR (stockee a minuit UTC) : on l'affiche
 * en UTC, sinon un navigateur a l'ouest de Greenwich montrerait la veille.
 */
function formaterEcheance(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-FR", { timeZone: "UTC" });
}

/**
 * Recoit les taches deja chargees cote serveur (page.tsx) : pas de fetch au
 * montage. `aujourdhui` (yyyy-mm-dd, UTC) vient aussi du serveur : calculer
 * "maintenant" pendant le rendu d'un composant client donnerait une valeur
 * differente entre le rendu serveur et l'hydratation.
 */
export default function KanbanClient({
  householdId,
  membres,
  initial,
  aujourdhui,
  joursFaitDansKanban,
}: {
  householdId: string;
  membres: Membre[];
  initial: TacheDetail[];
  aujourdhui: string;
  joursFaitDansKanban: number;
}) {
  const [taches, setTaches] = useState(initial);
  const [erreur, setErreur] = useState<string | null>(null);
  const [creationOuverte, setCreationOuverte] = useState(false);
  // Une seule carte en edition a la fois ; ouvrir l'une ferme l'autre.
  const [editionId, setEditionId] = useState<string | null>(null);
  // Cartes dont un deplacement est en vol. Tant qu'une carte y est, elle est
  // verrouillee : deux deplacements rapides ou des reponses dans le desordre
  // desynchroniseraient l'etat local et le serveur.
  const [enCours, setEnCours] = useState<ReadonlySet<string>>(new Set());

  // Contrainte de distance : un simple clic (sur Modifier, Supprimer, le
  // menu) ne doit pas etre pris pour le debut d'un glisser.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  async function deplacer(id: string, statut: StatutTache) {
    const avant = taches.find((t) => t.id === id);
    if (!avant || avant.status === statut || enCours.has(id)) return;
    setErreur(null);
    setEnCours((prev) => new Set(prev).add(id));

    // Mise a jour optimiste : la carte bouge tout de suite, le serveur
    // confirme (ou refuse) ensuite.
    setTaches((prev) =>
      prev.map((t) =>
        t.id === id
          ? {
              ...t,
              status: statut,
              completedAt: statut === "done" ? new Date().toISOString() : null,
            }
          : t
      )
    );

    let res: Response | null = null;
    try {
      res = await fetch(`/api/colocations/${householdId}/taches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: statut }),
      });
    } catch {
      res = null;
    }

    // Deverrouille la carte, quelle que soit l'issue.
    const liberer = () =>
      setEnCours((prev) => {
        const suivant = new Set(prev);
        suivant.delete(id);
        return suivant;
      });

    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      // On ne restaure que CETTE carte : d'autres ont pu bouger entre-temps.
      setTaches((prev) => prev.map((t) => (t.id === id ? avant : t)));
      setErreur(body?.error ?? "Impossible de déplacer la tâche.");
      liberer();
      return;
    }

    const data: { tache: TacheDetail; nouvelleOccurrence: TacheDetail | null } =
      await res.json().catch(() => null);
    if (!data) {
      setTaches((prev) => prev.map((t) => (t.id === id ? avant : t)));
      setErreur("Réponse inattendue du serveur.");
      liberer();
      return;
    }
    // La version du serveur fait foi (completedAt, faitPar...). Une tache
    // recurrente terminee fait apparaitre sa suite dans "A faire".
    setTaches((prev) => {
      const maj = prev.map((t) => (t.id === id ? data.tache : t));
      const occ = data.nouvelleOccurrence;
      return occ && !maj.some((t) => t.id === occ.id) ? [...maj, occ] : maj;
    });
    liberer();
  }

  function onDragEnd(event: DragEndEvent) {
    const cible = event.over?.id;
    if (estStatut(cible)) void deplacer(String(event.active.id), cible);
  }

  async function supprimer(id: string) {
    setErreur(null);
    let res: Response | null = null;
    try {
      res = await fetch(`/api/colocations/${householdId}/taches/${id}`, {
        method: "DELETE",
      });
    } catch {
      res = null;
    }
    if (!res || !res.ok) {
      const body = res ? await res.json().catch(() => null) : null;
      setErreur(body?.error ?? "Impossible de supprimer la tâche.");
      return;
    }
    setTaches((prev) => prev.filter((t) => t.id !== id));
  }

  function tacheEnregistree(tache: TacheDetail) {
    setTaches((prev) =>
      prev.some((t) => t.id === tache.id)
        ? prev.map((t) => (t.id === tache.id ? tache : t))
        : [...prev, tache]
    );
    setCreationOuverte(false);
    setEditionId(null);
  }

  // Annonces lues par les lecteurs d'ecran pendant un glisser au clavier
  // (dnd-kit les fournit en anglais par defaut).
  const titreDe = (id: string | number) =>
    taches.find((t) => t.id === String(id))?.title ?? "tâche";
  const colonneDe = (id: string | number) =>
    estStatut(id) ? LABEL_STATUT[id] : "une zone non valide";
  const annonces: Announcements = {
    onDragStart: ({ active }) => `Tâche « ${titreDe(active.id)} » saisie.`,
    onDragOver: ({ active, over }) =>
      over
        ? `« ${titreDe(active.id)} » est au-dessus de la colonne ${colonneDe(over.id)}.`
        : `« ${titreDe(active.id)} » n'est plus au-dessus d'une colonne.`,
    onDragEnd: ({ active, over }) =>
      over
        ? `« ${titreDe(active.id)} » déposée dans la colonne ${colonneDe(over.id)}.`
        : `« ${titreDe(active.id)} » relâchée hors d'une colonne, rien n'a changé.`,
    onDragCancel: ({ active }) => `Déplacement de « ${titreDe(active.id)} » annulé.`,
  };

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            setCreationOuverte((v) => !v);
            setEditionId(null);
          }}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm text-white hover:bg-zinc-700"
        >
          {creationOuverte ? "Fermer" : "Nouvelle tâche"}
        </button>
        <Link
          href={`/colocations/${householdId}/taches/historique`}
          className="text-sm text-zinc-600 hover:underline"
        >
          Historique des tâches terminées →
        </Link>
      </div>

      {creationOuverte && (
        <div className="mt-4 max-w-xl">
          <TacheForm
            householdId={householdId}
            membres={membres}
            onEnregistree={tacheEnregistree}
            onAnnuler={() => setCreationOuverte(false)}
          />
        </div>
      )}

      {erreur && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {erreur}
        </p>
      )}

      {/* L'id fixe evite un ecart d'attributs aria entre rendu serveur et client. */}
      <DndContext
        id="kanban-taches"
        sensors={sensors}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: annonces,
          screenReaderInstructions: {
            draggable:
              "Pour déplacer cette tâche, appuyez sur espace, puis utilisez les flèches pour la placer au-dessus d'une colonne, et appuyez à nouveau sur espace pour la déposer. Échap annule.",
          },
        }}
      >
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {COLONNES.map((c) => (
            <Colonne
              key={c.statut}
              statut={c.statut}
              label={c.label}
              taches={taches.filter((t) => t.status === c.statut)}
              aujourdhui={aujourdhui}
              editionId={editionId}
              enCours={enCours}
              householdId={householdId}
              membres={membres}
              onDeplacer={deplacer}
              onSupprimer={supprimer}
              onModifier={(id) => {
                setEditionId(id);
                setCreationOuverte(false);
              }}
              onEnregistree={tacheEnregistree}
              onAnnulerEdition={() => setEditionId(null)}
            />
          ))}
        </div>
      </DndContext>

      <p className="mt-6 text-xs text-zinc-500">
        La colonne « Fait » n&apos;affiche que les tâches terminées depuis moins de{" "}
        {joursFaitDansKanban} jours ; les autres sont dans l&apos;historique.
      </p>
    </div>
  );
}

function Colonne({
  statut,
  label,
  taches,
  aujourdhui,
  editionId,
  enCours,
  householdId,
  membres,
  onDeplacer,
  onSupprimer,
  onModifier,
  onEnregistree,
  onAnnulerEdition,
}: {
  statut: StatutTache;
  label: string;
  taches: TacheDetail[];
  aujourdhui: string;
  editionId: string | null;
  enCours: ReadonlySet<string>;
  householdId: string;
  membres: Membre[];
  onDeplacer: (id: string, statut: StatutTache) => void;
  onSupprimer: (id: string) => void;
  onModifier: (id: string) => void;
  onEnregistree: (tache: TacheDetail) => void;
  onAnnulerEdition: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: statut });

  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      className={`rounded-md border p-3 transition-colors ${
        isOver ? "border-zinc-900 bg-zinc-100" : "border-zinc-200 bg-zinc-50"
      }`}
    >
      <h2 className="mb-3 flex items-center justify-between text-sm font-medium text-zinc-700">
        {label}
        <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs text-zinc-600">
          {taches.length}
        </span>
      </h2>
      {/* min-h : une colonne vide reste une cible de depot confortable. */}
      <ul className="flex min-h-24 flex-col gap-2">
        {taches.map((t) => (
          <li key={t.id}>
            {t.id === editionId ? (
              <TacheForm
                key={t.id}
                householdId={householdId}
                membres={membres}
                tache={t}
                onEnregistree={onEnregistree}
                onAnnuler={onAnnulerEdition}
              />
            ) : (
              <CarteTache
                tache={t}
                enRetard={
                  t.status !== "done" && !!t.dueDate && t.dueDate.slice(0, 10) < aujourdhui
                }
                verrouillee={enCours.has(t.id)}
                onDeplacer={onDeplacer}
                onSupprimer={onSupprimer}
                onModifier={onModifier}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function CarteTache({
  tache,
  enRetard,
  verrouillee,
  onDeplacer,
  onSupprimer,
  onModifier,
}: {
  tache: TacheDetail;
  enRetard: boolean;
  verrouillee: boolean;
  onDeplacer: (id: string, statut: StatutTache) => void;
  onSupprimer: (id: string) => void;
  onModifier: (id: string) => void;
}) {
  const [confirmerSuppression, setConfirmerSuppression] = useState(false);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, isDragging } =
    useDraggable({ id: tache.id, disabled: !tache.peuxChangerStatut || verrouillee });

  // Droit de deplacer (sert a l'affichage) ; "verrouillee" ne bloque que
  // temporairement, le temps de la requete en cours.
  const deplacable = tache.peuxChangerStatut;
  // dnd-kit type ses ecouteurs en `Function` : on precise le vrai type pour
  // pouvoir les poser sur des elements.
  const auPointeur = listeners?.onPointerDown as PointerEventHandler<HTMLElement> | undefined;
  const auClavier = listeners?.onKeyDown as KeyboardEventHandler<HTMLButtonElement> | undefined;

  return (
    <article
      ref={setNodeRef}
      // Le glisser a la souris/au doigt part de toute la carte...
      onPointerDown={deplacable ? auPointeur : undefined}
      style={{ transform: CSS.Translate.toString(transform) }}
      title={
        deplacable
          ? undefined
          : "Seuls les assignés ou l'admin peuvent déplacer cette tâche"
      }
      className={`relative rounded-md border border-zinc-200 bg-white p-3 text-sm ${
        !deplacable
          ? "cursor-not-allowed opacity-70"
          : verrouillee
            ? "cursor-wait opacity-70"
            : "cursor-grab"
      } ${isDragging ? "z-10 cursor-grabbing shadow-lg" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium">{tache.title}</h3>
        {deplacable && (
          // ...mais le glisser au clavier a besoin d'un element focalisable
          // dedie : la poignee. touch-none l'empeche de faire defiler la page
          // quand on la saisit au doigt.
          <button
            type="button"
            ref={setActivatorNodeRef}
            onKeyDown={auClavier}
            {...attributes}
            aria-label={`Déplacer la tâche ${tache.title}`}
            className="shrink-0 touch-none rounded px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
          >
            ⠿
          </button>
        )}
      </div>

      {tache.description && (
        <p className="mt-1 whitespace-pre-line text-xs text-zinc-600">{tache.description}</p>
      )}

      <p className="mt-2 text-xs text-zinc-500">
        {tache.assignes.length > 0
          ? tache.assignes.map((a) => a.name).join(", ")
          : "Personne d'assigné"}
      </p>

      {tache.dueDate && (
        <p className={`mt-1 text-xs ${enRetard ? "font-medium text-red-600" : "text-zinc-500"}`}>
          Échéance : {formaterEcheance(tache.dueDate)}
          {enRetard && " (en retard)"}
        </p>
      )}

      {tache.recurrence !== "none" && (
        <p className="mt-2 flex flex-wrap gap-1">
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
            {LABEL_RECURRENCE[tache.recurrence]}
          </span>
          {tache.rotation && (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">
              rotation
            </span>
          )}
        </p>
      )}

      {/* Alternative au glisser-deposer, utilisable au clavier et sur mobile. */}
      {deplacable && (
        <label className="mt-3 flex items-center gap-2 text-xs text-zinc-500">
          Statut
          <select
            value={tache.status}
            disabled={verrouillee}
            onChange={(e) => onDeplacer(tache.id, e.target.value as StatutTache)}
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-800"
          >
            {COLONNES.map((c) => (
              <option key={c.statut} value={c.statut}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {tache.peuxModifier && (
        <div className="mt-3 flex gap-3">
          <button
            type="button"
            onClick={() => onModifier(tache.id)}
            className="text-xs text-zinc-600 hover:underline"
          >
            Modifier
          </button>
          {confirmerSuppression ? (
            <span className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => onSupprimer(tache.id)}
                className="text-red-600 hover:underline"
              >
                Confirmer la suppression
              </button>
              <button
                type="button"
                onClick={() => setConfirmerSuppression(false)}
                className="text-zinc-500 hover:underline"
              >
                Annuler
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmerSuppression(true)}
              className="text-xs text-red-600 hover:underline"
            >
              Supprimer
            </button>
          )}
        </div>
      )}
    </article>
  );
}
