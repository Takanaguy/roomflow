"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const CATEGORIES = [
  { value: "courses", label: "Courses" },
  { value: "factures", label: "Factures" },
  { value: "loyer", label: "Loyer" },
  { value: "sorties", label: "Sorties" },
  { value: "autre", label: "Autre" },
] as const;

type Membre = { userId: string; name: string };

type DepenseInitiale = {
  id: string;
  amount: number;
  description: string;
  category: string;
  date: string;
  payeur: { userId: string };
  splitType: "equal" | "custom";
  splits: { userId: string; amount: number }[];
};

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
  const [payeurId, setPayeurId] = useState(initial?.payeur.userId ?? moi);

  const [typeRepartition, setTypeRepartition] = useState<"equal" | "custom">(
    initial?.splitType ?? "equal"
  );
  const [participantsEgal, setParticipantsEgal] = useState<Set<string>>(
    () =>
      new Set(
        initial?.splitType === "equal"
          ? initial.splits.map((s) => s.userId)
          : membres.map((m) => m.userId)
      )
  );

  const [modePersonnalise, setModePersonnalise] = useState<"montants" | "pourcentages">(
    "montants"
  );
  const [valeurs, setValeurs] = useState<Record<string, string>>(() => {
    if (initial?.splitType === "custom") {
      return Object.fromEntries(
        initial.splits.map((s) => [s.userId, String(s.amount)])
      );
    }
    return {};
  });

  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  const montantNombre = parseFloat(montant) || 0;

  // Feedback immediat avant meme d'essayer d'envoyer : combien reste-t-il a
  // repartir, dans l'unite du mode actif.
  const sommeSaisie = Object.values(valeurs).reduce(
    (s, v) => s + (parseFloat(v) || 0),
    0
  );
  const reste =
    modePersonnalise === "montants"
      ? montantNombre - sommeSaisie
      : 100 - sommeSaisie;

  function toggleParticipant(userId: string) {
    setParticipantsEgal((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);

    if (typeRepartition === "equal" && participantsEgal.size === 0) {
      setErreur("Sélectionne au moins un participant.");
      return;
    }

    const body: Record<string, unknown> = {
      amount: montantNombre,
      description,
      category: categorie,
      date: new Date(date).toISOString(),
      payerId: payeurId,
      splitType: typeRepartition,
    };

    if (typeRepartition === "equal") {
      body.memberIds = [...participantsEgal];
    } else if (modePersonnalise === "pourcentages") {
      body.pourcentages = Object.entries(valeurs)
        .filter(([, v]) => parseFloat(v) > 0)
        .map(([userId, v]) => ({ userId, pourcentage: parseFloat(v) }));
    } else {
      body.splits = Object.entries(valeurs)
        .filter(([, v]) => parseFloat(v) > 0)
        .map(([userId, v]) => ({ userId, amount: parseFloat(v) }));
    }

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

      <div className="grid grid-cols-2 gap-3">
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
        <label className="flex flex-col gap-1 text-sm">
          Payé par
          <select
            value={payeurId}
            onChange={(e) => setPayeurId(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2"
          >
            {membres.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.userId === moi ? "Moi" : m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div>
        <p className="text-sm font-medium">Répartition</p>
        <div className="mt-2 flex gap-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={typeRepartition === "equal"}
              onChange={() => setTypeRepartition("equal")}
            />
            Égale
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={typeRepartition === "custom"}
              onChange={() => setTypeRepartition("custom")}
            />
            Personnalisée
          </label>
        </div>

        {typeRepartition === "equal" ? (
          <div className="mt-3 flex flex-col gap-1">
            {membres.map((m) => (
              <label key={m.userId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={participantsEgal.has(m.userId)}
                  onChange={() => toggleParticipant(m.userId)}
                />
                {m.userId === moi ? "Moi" : m.name}
              </label>
            ))}
            {montantNombre > 0 && participantsEgal.size > 0 && (
              <p className="mt-1 text-xs text-zinc-500">
                {(montantNombre / participantsEgal.size).toFixed(2)} € chacun
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
                  checked={modePersonnalise === "montants"}
                  onChange={() => {
                    setModePersonnalise("montants");
                    setValeurs({});
                  }}
                />
                En euros
              </label>
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={modePersonnalise === "pourcentages"}
                  onChange={() => {
                    setModePersonnalise("pourcentages");
                    setValeurs({});
                  }}
                />
                En %
              </label>
            </div>
            <div className="flex flex-col gap-2">
              {membres.map((m) => (
                <div key={m.userId} className="flex items-center gap-2">
                  <span className="flex-1 text-sm">
                    {m.userId === moi ? "Moi" : m.name}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={valeurs[m.userId] ?? ""}
                    onChange={(e) =>
                      setValeurs((v) => ({ ...v, [m.userId]: e.target.value }))
                    }
                    className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-sm"
                    placeholder="0"
                  />
                  <span className="text-xs text-zinc-400">
                    {modePersonnalise === "montants" ? "€" : "%"}
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
              {modePersonnalise === "montants" ? " €" : " %"}
            </p>
          </div>
        )}
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
