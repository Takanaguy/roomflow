"use client";

import { useState, type FormEvent, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";

const CATEGORIES = [
  { value: "courses", label: "Courses" },
  { value: "factures", label: "Factures" },
  { value: "loyer", label: "Loyer" },
  { value: "sorties", label: "Sorties" },
  { value: "autre", label: "Autre" },
] as const;

type Membre = { userId: string; name: string };
type Part = { userId: string; amount: number };

type DepenseInitiale = {
  id: string;
  amount: number;
  description: string;
  category: string;
  date: string;
  payeurs: Part[];
  splitType: "equal" | "custom";
  splits: Part[];
};

/**
 * Etat d'une repartition (montant total distribue entre des membres). Meme
 * forme utilisee pour "qui a paye" et "qui doit quoi" : structurellement le
 * meme probleme des deux cotes (demande de Tanguy le 23/09/2026 : un resto
 * peut etre avance par plusieurs personnes, pas toujours une seule).
 */
type EtatRepartition = {
  type: "equal" | "custom";
  participantsEgal: Set<string>;
  modePersonnalise: "montants" | "pourcentages";
  valeurs: Record<string, string>;
};

function etatDepuisParts(parts: Part[] | undefined, defaut: string[]): EtatRepartition {
  if (!parts || parts.length === 0) {
    return {
      type: "equal",
      participantsEgal: new Set(defaut),
      modePersonnalise: "montants",
      valeurs: {},
    };
  }
  return {
    type: "custom",
    participantsEgal: new Set(defaut),
    modePersonnalise: "montants",
    valeurs: Object.fromEntries(parts.map((p) => [p.userId, String(p.amount)])),
  };
}

/** Construit le morceau de corps de requete (memberIds / splits / pourcentages) a partir d'un EtatRepartition. */
function corpsRepartition(etat: EtatRepartition) {
  if (etat.type === "equal") {
    return { memberIds: [...etat.participantsEgal] };
  }
  if (etat.modePersonnalise === "pourcentages") {
    return {
      pourcentages: Object.entries(etat.valeurs)
        .filter(([, v]) => parseFloat(v) > 0)
        .map(([userId, v]) => ({ userId, pourcentage: parseFloat(v) })),
    };
  }
  return {
    splits: Object.entries(etat.valeurs)
      .filter(([, v]) => parseFloat(v) > 0)
      .map(([userId, v]) => ({ userId, amount: parseFloat(v) })),
  };
}

/**
 * Editeur d'une repartition : bascule "egale" (cases a cocher) / "personnalisee"
 * (montants ou pourcentages, avec le reste a repartir affiche en direct).
 */
function RepartitionEditor({
  membres,
  moi,
  montantNombre,
  etat,
  setEtat,
}: {
  membres: Membre[];
  moi: string;
  montantNombre: number;
  etat: EtatRepartition;
  setEtat: Dispatch<SetStateAction<EtatRepartition>>;
}) {
  const sommeSaisie = Object.values(etat.valeurs).reduce(
    (s, v) => s + (parseFloat(v) || 0),
    0
  );
  const reste =
    etat.modePersonnalise === "montants" ? montantNombre - sommeSaisie : 100 - sommeSaisie;

  function toggleParticipant(userId: string) {
    setEtat((prev) => {
      const next = new Set(prev.participantsEgal);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return { ...prev, participantsEgal: next };
    });
  }

  return (
    <div>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={etat.type === "equal"}
            onChange={() => setEtat((p) => ({ ...p, type: "equal" }))}
          />
          Égale
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={etat.type === "custom"}
            onChange={() => setEtat((p) => ({ ...p, type: "custom" }))}
          />
          Personnalisée
        </label>
      </div>

      {etat.type === "equal" ? (
        <div className="mt-3 flex flex-col gap-1">
          {membres.map((m) => (
            <label key={m.userId} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={etat.participantsEgal.has(m.userId)}
                onChange={() => toggleParticipant(m.userId)}
              />
              {m.userId === moi ? "Moi" : m.name}
            </label>
          ))}
          {montantNombre > 0 && etat.participantsEgal.size > 0 && (
            <p className="mt-1 text-xs text-zinc-500">
              {(montantNombre / etat.participantsEgal.size).toFixed(2)} € chacun
              (arrondi au centime près)
            </p>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <div className="mb-2 flex gap-4 text-xs text-zinc-500">
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={etat.modePersonnalise === "montants"}
                onChange={() =>
                  setEtat((p) => ({ ...p, modePersonnalise: "montants", valeurs: {} }))
                }
              />
              En euros
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={etat.modePersonnalise === "pourcentages"}
                onChange={() =>
                  setEtat((p) => ({ ...p, modePersonnalise: "pourcentages", valeurs: {} }))
                }
              />
              En %
            </label>
          </div>
          <div className="flex flex-col gap-2">
            {membres.map((m) => (
              <div key={m.userId} className="flex items-center gap-2">
                <span className="flex-1 text-sm">{m.userId === moi ? "Moi" : m.name}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={etat.valeurs[m.userId] ?? ""}
                  onChange={(e) =>
                    setEtat((p) => ({
                      ...p,
                      valeurs: { ...p.valeurs, [m.userId]: e.target.value },
                    }))
                  }
                  className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-sm"
                  placeholder="0"
                />
                <span className="text-xs text-zinc-400">
                  {etat.modePersonnalise === "montants" ? "€" : "%"}
                </span>
              </div>
            ))}
          </div>
          <p
            className={`mt-2 text-xs ${
              Math.abs(reste) < 0.01 ? "text-zinc-400" : "text-amber-600"
            }`}
          >
            Reste à répartir : {reste.toFixed(2)}
            {etat.modePersonnalise === "montants" ? " €" : " %"}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Formulaire partage creation/modification (memes champs, meme calcul de
 * repartition). En edition, `initial` porte les valeurs de depart et le
 * bouton "Enregistrer" fait un PATCH au lieu d'un POST.
 */
export default function DepenseForm({
  householdId,
  membres,
  moi,
  initial,
}: {
  householdId: string;
  membres: Membre[];
  moi: string;
  initial?: DepenseInitiale;
}) {
  const router = useRouter();

  const [montant, setMontant] = useState(initial ? String(initial.amount) : "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [categorie, setCategorie] = useState(initial?.category ?? "courses");
  const [date, setDate] = useState(
    initial ? initial.date.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );

  // "Une personne" reste le cas par defaut (le plus courant) : simple menu
  // deroulant. "Plusieurs" revele le meme editeur que "qui doit quoi".
  const [typePayeurs, setTypePayeurs] = useState<"une" | "plusieurs">(
    initial && initial.payeurs.length > 1 ? "plusieurs" : "une"
  );
  const [payeurUnique, setPayeurUnique] = useState(
    initial?.payeurs[0]?.userId ?? moi
  );
  const [etatPayeurs, setEtatPayeurs] = useState<EtatRepartition>(() =>
    initial && initial.payeurs.length > 1
      ? etatDepuisParts(initial.payeurs, membres.map((m) => m.userId))
      : { type: "equal", participantsEgal: new Set(membres.map((m) => m.userId)), modePersonnalise: "montants", valeurs: {} }
  );

  const [etatParticipants, setEtatParticipants] = useState<EtatRepartition>(() =>
    initial?.splitType === "custom"
      ? etatDepuisParts(initial.splits, membres.map((m) => m.userId))
      : {
          type: "equal",
          participantsEgal: new Set(
            initial ? initial.splits.map((s) => s.userId) : membres.map((m) => m.userId)
          ),
          modePersonnalise: "montants",
          valeurs: {},
        }
  );

  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const montantNombre = parseFloat(montant) || 0;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);

    if (typePayeurs === "une" && !payeurUnique) {
      setErreur("Sélectionne qui a payé.");
      return;
    }
    if (typePayeurs === "plusieurs" && etatPayeurs.type === "equal" && etatPayeurs.participantsEgal.size === 0) {
      setErreur("Sélectionne au moins un payeur.");
      return;
    }
    if (etatParticipants.type === "equal" && etatParticipants.participantsEgal.size === 0) {
      setErreur("Sélectionne au moins un participant.");
      return;
    }

    const body: Record<string, unknown> = {
      amount: montantNombre,
      description,
      category: categorie,
      date: new Date(date).toISOString(),
      splitType: etatParticipants.type,
      ...(typePayeurs === "une"
        ? { payerMemberIds: [payeurUnique] }
        : corpsRepartitionPrefixee(etatPayeurs)),
      ...corpsRepartition(etatParticipants),
    };

    setEnCours(true);
    const url = initial
      ? `/api/colocations/${householdId}/depenses/${initial.id}`
      : `/api/colocations/${householdId}/depenses`;
    const res = await fetch(url, {
      method: initial ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setEnCours(false);

    if (!res.ok) {
      const b = await res.json().catch(() => null);
      setErreur(b?.error ?? "Impossible d'enregistrer la dépense.");
      return;
    }

    const saved = await res.json();
    router.push(`/colocations/${householdId}/depenses/${saved.id}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Montant (€)
          <input
            type="number"
            step="0.01"
            min="0.01"
            required
            value={montant}
            onChange={(e) => setMontant(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Date
          <input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Description
        <input
          type="text"
          required
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2"
          placeholder="Ex : Courses Carrefour"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Catégorie
        <select
          value={categorie}
          onChange={(e) => setCategorie(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2"
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <div>
        <p className="text-sm font-medium">Payé par</p>
        <div className="mt-2 flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={typePayeurs === "une"}
              onChange={() => setTypePayeurs("une")}
            />
            Une personne
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={typePayeurs === "plusieurs"}
              onChange={() => setTypePayeurs("plusieurs")}
            />
            Plusieurs personnes
          </label>
        </div>

        {typePayeurs === "une" ? (
          <select
            value={payeurUnique}
            onChange={(e) => setPayeurUnique(e.target.value)}
            className="mt-2 rounded-md border border-zinc-300 px-3 py-2 text-sm"
          >
            {membres.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.userId === moi ? "Moi" : m.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="mt-3">
            <RepartitionEditor
              membres={membres}
              moi={moi}
              montantNombre={montantNombre}
              etat={etatPayeurs}
              setEtat={setEtatPayeurs}
            />
          </div>
        )}
      </div>

      <div>
        <p className="text-sm font-medium">Qui doit quoi</p>
        <div className="mt-2">
          <RepartitionEditor
            membres={membres}
            moi={moi}
            montantNombre={montantNombre}
            etat={etatParticipants}
            setEtat={setEtatParticipants}
          />
        </div>
      </div>

      {erreur && <p className="text-sm text-red-600">{erreur}</p>}

      <button
        type="submit"
        disabled={enCours}
        className="mt-2 self-start rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {enCours ? "Enregistrement..." : initial ? "Enregistrer" : "Ajouter la dépense"}
      </button>
    </form>
  );
}

/** corpsRepartition, mais avec les cles prefixees "payer" attendues cote payeurs. */
function corpsRepartitionPrefixee(etat: EtatRepartition) {
  const c = corpsRepartition(etat) as {
    memberIds?: string[];
    splits?: Part[];
    pourcentages?: { userId: string; pourcentage: number }[];
  };
  return {
    payerMemberIds: c.memberIds,
    payerSplits: c.splits,
    payerPourcentages: c.pourcentages,
  };
}
