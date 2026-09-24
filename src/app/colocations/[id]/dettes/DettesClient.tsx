"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DetteSimplifiee } from "@/lib/settlements";

/**
 * Recoit la liste deja calculee cote serveur (page.tsx), meme pattern que
 * ColocationClient : pas de fetch au montage. "Confirmer reception" n'est
 * visible que sur les lignes ou le membre connecte est le CREDITEUR
 * (toUserId) - jamais le debiteur, voir confirmerReglement() pour le
 * pourquoi.
 */
export default function DettesClient({
  householdId,
  viewerId,
  initial,
}: {
  householdId: string;
  viewerId: string;
  initial: DetteSimplifiee[];
}) {
  const router = useRouter();
  const [dettes, setDettes] = useState(initial);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  async function confirmer(fromUserId: string) {
    setEnCours(fromUserId);
    setErreur(null);
    const res = await fetch(`/api/colocations/${householdId}/dettes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromUserId }),
    });
    setEnCours(null);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setErreur(body?.error ?? "Impossible de confirmer ce remboursement.");
      return;
    }
    setDettes((d) => d.filter((x) => x.fromUserId !== fromUserId));
    router.refresh();
  }

  if (dettes.length === 0) {
    return (
      <p className="mt-8 text-sm text-zinc-600">
        Tout le monde est à jour, aucune dette en cours.
      </p>
    );
  }

  return (
    <div className="mt-6">
      {erreur && <p className="mb-4 text-sm text-red-600">{erreur}</p>}
      <ul className="flex flex-col gap-2">
        {dettes.map((d) => {
          const jeDois = d.fromUserId === viewerId;
          const onMeDoit = d.toUserId === viewerId;
          return (
            <li
              key={`${d.fromUserId}-${d.toUserId}`}
              className="flex items-center justify-between rounded-md border border-zinc-200 px-4 py-3"
            >
              <span className="text-sm">
                {jeDois && (
                  <>
                    Tu dois <span className="font-mono">{d.amount.toFixed(2)} €</span> à{" "}
                    <span className="font-medium">{d.toName}</span>
                  </>
                )}
                {onMeDoit && (
                  <>
                    <span className="font-medium">{d.fromName}</span> te doit{" "}
                    <span className="font-mono">{d.amount.toFixed(2)} €</span>
                  </>
                )}
                {!jeDois && !onMeDoit && (
                  <>
                    <span className="font-medium">{d.fromName}</span> doit{" "}
                    <span className="font-mono">{d.amount.toFixed(2)} €</span> à{" "}
                    <span className="font-medium">{d.toName}</span>
                  </>
                )}
              </span>
              {onMeDoit && (
                <button
                  type="button"
                  onClick={() => confirmer(d.fromUserId)}
                  disabled={enCours === d.fromUserId}
                  className="shrink-0 rounded-md bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 disabled:opacity-50"
                >
                  {enCours === d.fromUserId ? "..." : "Confirmer réception"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
