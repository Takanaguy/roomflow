"use client";

import { useState, type FormEvent } from "react";
import type { TacheDetail } from "@/lib/tasks";

type Membre = { userId: string; name: string };
type Recurrence = TacheDetail["recurrence"];

/**
 * Formulaire partage entre la creation et l'edition (meme idee que
 * DepenseForm) : si `tache` est fourni, on est en edition et les champs sont
 * pre-remplis. Le formulaire fait lui-meme son fetch (declenche par le
 * submit, jamais par un effect) et rend la tache enregistree au parent, qui
 * met a jour son etat local. Pour repartir d'un etat neuf, le parent change
 * la `key` du composant plutot que de resynchroniser les champs par effect.
 */
export default function TacheForm({
  householdId,
  membres,
  tache,
  onEnregistree,
  onAnnuler,
}: {
  householdId: string;
  membres: Membre[];
  tache?: TacheDetail;
  onEnregistree: (tache: TacheDetail) => void;
  onAnnuler: () => void;
}) {
  const [titre, setTitre] = useState(tache?.title ?? "");
  const [description, setDescription] = useState(tache?.description ?? "");
  // On ne garde que les assignes encore membres : un ancien membre parti
  // serait renvoye dans assignedTo et l'API repondrait 400 sans cause visible.
  const [assignes, setAssignes] = useState<string[]>(
    () =>
      tache?.assignes
        .map((a) => a.userId)
        .filter((id) => membres.some((m) => m.userId === id)) ?? []
  );
  const [recurrence, setRecurrence] = useState<Recurrence>(tache?.recurrence ?? "none");
  const [rotation, setRotation] = useState(tache?.rotation ?? false);
  // dueDate arrive en ISO UTC a minuit : les 10 premiers caracteres sont
  // exactement la valeur attendue par <input type="date"> (yyyy-mm-dd).
  const [echeance, setEcheance] = useState(tache?.dueDate?.slice(0, 10) ?? "");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  function basculerAssigne(userId: string) {
    setAssignes((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  }

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);

    // Le champ date donne "2026-10-20" : on le fixe a minuit UTC pour
    // obtenir le datetime ISO que l'API exige, sans decalage lie au fuseau.
    const dueDate = echeance ? new Date(`${echeance}T00:00:00.000Z`).toISOString() : null;
    const corps = {
      title: titre,
      description,
      assignedTo: assignes,
      recurrence,
      // La rotation n'a de sens que pour une tache recurrente : l'API la
      // refuserait sinon, on l'envoie donc a false si la case est masquee.
      rotation: recurrence !== "none" && rotation,
      // Creation : on omet l'echeance si vide. Edition : null l'efface.
      ...(tache ? { dueDate } : dueDate ? { dueDate } : {}),
    };

    let res: Response;
    try {
      res = await fetch(
        tache
          ? `/api/colocations/${householdId}/taches/${tache.id}`
          : `/api/colocations/${householdId}/taches`,
        {
          method: tache ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corps),
        }
      );
    } catch {
      setEnCours(false);
      setErreur("Impossible de joindre le serveur.");
      return;
    }
    setEnCours(false);

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      setErreur(body?.error ?? "Impossible d'enregistrer la tâche.");
      return;
    }
    // POST renvoie la tache directement, PATCH l'enveloppe dans { tache }.
    onEnregistree(tache ? body.tache : body);
  }

  return (
    <form
      onSubmit={soumettre}
      className="flex flex-col gap-3 rounded-md border border-zinc-300 bg-white p-4"
    >
      <label className="flex flex-col gap-1 text-sm">
        Titre
        <input
          type="text"
          required
          maxLength={120}
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Description (facultatif)
        <textarea
          rows={2}
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
      </label>

      <fieldset className="text-sm">
        <legend className="mb-1">Assignée à</legend>
        <div className="flex flex-col gap-1">
          {membres.map((m) => (
            <label key={m.userId} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={assignes.includes(m.userId)}
                onChange={() => basculerAssigne(m.userId)}
              />
              {m.name}
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          Sans assigné, tout le monde peut déplacer la tâche.
        </p>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        Récurrence
        <select
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value as Recurrence)}
          className="rounded-md border border-zinc-300 px-3 py-2"
        >
          <option value="none">Aucune</option>
          <option value="weekly">Hebdomadaire</option>
          <option value="monthly">Mensuelle</option>
        </select>
      </label>

      {recurrence !== "none" && (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={rotation}
            onChange={(e) => setRotation(e.target.checked)}
            className="mt-1"
          />
          <span>
            Rotation automatique
            <span className="block text-xs text-zinc-500">
              À chaque occurrence, la tâche passe au colocataire suivant.
            </span>
          </span>
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Échéance (facultatif)
        <input
          type="date"
          value={echeance}
          onChange={(e) => setEcheance(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
      </label>

      {erreur && (
        <p role="alert" className="text-sm text-red-600">
          {erreur}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={enCours}
          className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {enCours ? "Enregistrement..." : tache ? "Enregistrer" : "Créer la tâche"}
        </button>
        <button
          type="button"
          onClick={onAnnuler}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
        >
          Annuler
        </button>
      </div>
    </form>
  );
}
