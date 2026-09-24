"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ColocationDetail } from "@/lib/households";

/**
 * Recoit les donnees deja chargees cote serveur (page.tsx) : pas de fetch au
 * montage, donc pas de setState dans un effect. Les rechargements apres une
 * action (retirer un membre, transferer l'admin) partent d'un gestionnaire
 * de clic, pas d'un effect - ce n'est plus le meme cas de figure pour le
 * linter.
 */
export default function ColocationClient({ initial }: { initial: ColocationDetail }) {
  const router = useRouter();
  const [detail, setDetail] = useState<ColocationDetail>(initial);
  const [erreur, setErreur] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);
  const [avertissementDepart, setAvertissementDepart] = useState<string | null>(null);
  const [enCoursDepart, setEnCoursDepart] = useState(false);

  const [edition, setEdition] = useState(false);
  const [nomEdit, setNomEdit] = useState(detail.name);
  const [descriptionEdit, setDescriptionEdit] = useState(detail.description ?? "");
  const [enCoursEdition, setEnCoursEdition] = useState(false);

  const [confirmerDestruction, setConfirmerDestruction] = useState(false);
  const [enCoursDestruction, setEnCoursDestruction] = useState(false);

  async function recharger() {
    const res = await fetch(`/api/colocations/${detail.id}`);
    if (res.ok) setDetail(await res.json());
  }

  async function copierCode() {
    try {
      await navigator.clipboard.writeText(detail.inviteCode);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      // Certains contextes (http non securise, permissions navigateur)
      // refusent l'API clipboard : le code reste affiche a l'ecran, la
      // personne peut toujours le copier a la main.
    }
  }

  async function quitter(force: boolean) {
    setEnCoursDepart(true);
    const res = await fetch(`/api/colocations/${detail.id}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    setEnCoursDepart(false);

    if (res.status === 409) {
      const body = await res.json();
      setAvertissementDepart(body.warning);
      return;
    }
    if (!res.ok) {
      setErreur("Impossible de quitter la colocation.");
      return;
    }
    router.push("/tableau-de-bord");
  }

  async function retirer(userId: string) {
    const res = await fetch(`/api/colocations/${detail.id}/members/${userId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setErreur(body?.error ?? "Impossible de retirer ce membre.");
      return;
    }
    recharger();
  }

  async function nommerAdmin(userId: string) {
    const res = await fetch(`/api/colocations/${detail.id}/members/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setErreur(body?.error ?? "Impossible de transférer le rôle admin.");
      return;
    }
    // Je viens de me retrograder en tant qu'admin : recharger() renvoie donc
    // aussi monRole a jour, pas seulement la liste des membres.
    recharger();
  }

  async function enregistrerEdition(e: React.FormEvent) {
    e.preventDefault();
    setEnCoursEdition(true);
    const res = await fetch(`/api/colocations/${detail.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nomEdit, description: descriptionEdit }),
    });
    setEnCoursEdition(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setErreur(body?.error ?? "Impossible d'enregistrer les modifications.");
      return;
    }
    setDetail(await res.json());
    setEdition(false);
  }

  async function detruire() {
    setEnCoursDestruction(true);
    const res = await fetch(`/api/colocations/${detail.id}`, { method: "DELETE" });
    setEnCoursDestruction(false);

    if (!res.ok) {
      setErreur("Impossible de détruire la colocation.");
      return;
    }
    router.push("/tableau-de-bord");
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="flex items-start justify-between gap-4">
        {edition ? (
          <form onSubmit={enregistrerEdition} className="flex-1 flex flex-col gap-2">
            <input
              type="text"
              required
              value={nomEdit}
              onChange={(e) => setNomEdit(e.target.value)}
              className="rounded-md border border-zinc-300 px-3 py-2 text-lg font-semibold"
            />
            <textarea
              value={descriptionEdit}
              onChange={(e) => setDescriptionEdit(e.target.value)}
              placeholder="Description (facultatif)"
              rows={2}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={enCoursEdition}
                className="self-start rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
              >
                {enCoursEdition ? "Enregistrement..." : "Enregistrer"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEdition(false);
                  setNomEdit(detail.name);
                  setDescriptionEdit(detail.description ?? "");
                }}
                className="self-start rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
              >
                Annuler
              </button>
            </div>
          </form>
        ) : (
          <div>
            <h1 className="text-2xl font-semibold">{detail.name}</h1>
            {detail.description && (
              <p className="mt-1 text-zinc-600">{detail.description}</p>
            )}
          </div>
        )}

        {detail.monRole === "admin" && !edition && (
          <button
            type="button"
            onClick={() => setEdition(true)}
            className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-50"
          >
            Modifier
          </button>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Link
          href={`/colocations/${detail.id}/depenses`}
          className="block rounded-md border border-zinc-200 px-4 py-3 text-sm font-medium hover:bg-zinc-50"
        >
          Voir les dépenses →
        </Link>
        <Link
          href={`/colocations/${detail.id}/dettes`}
          className="block rounded-md border border-zinc-200 px-4 py-3 text-sm font-medium hover:bg-zinc-50"
        >
          Qui doit quoi →
        </Link>
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-md border border-zinc-200 px-4 py-3">
        <span className="text-sm text-zinc-500">Code d&apos;invitation</span>
        <code className="font-mono text-sm">{detail.inviteCode}</code>
        <button
          type="button"
          onClick={copierCode}
          className="ml-auto rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50"
        >
          {copie ? "Copié !" : "Copier"}
        </button>
      </div>

      <h2 className="mt-8 text-sm font-medium text-zinc-500">
        Membres ({detail.members.length})
      </h2>
      <ul className="mt-2 flex flex-col gap-1">
        {detail.members.map((m) => (
          <li
            key={m.userId}
            className="flex items-center justify-between rounded-md px-3 py-2 hover:bg-zinc-50"
          >
            <span>
              {m.name}
              {m.role === "admin" && (
                <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500">
                  admin
                </span>
              )}
            </span>
            {detail.monRole === "admin" && m.role !== "admin" && (
              <span className="flex gap-3">
                <button
                  type="button"
                  onClick={() => nommerAdmin(m.userId)}
                  className="text-xs text-zinc-500 hover:underline"
                >
                  Nommer admin
                </button>
                <button
                  type="button"
                  onClick={() => retirer(m.userId)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Retirer
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>

      {erreur && <p className="mt-4 text-sm text-red-600">{erreur}</p>}

      <div className="mt-10 border-t border-zinc-200 pt-6">
        {avertissementDepart ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm text-amber-800">{avertissementDepart}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => quitter(true)}
                disabled={enCoursDepart}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
              >
                Quitter quand même
              </button>
              <button
                type="button"
                onClick={() => setAvertissementDepart(null)}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
              >
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => quitter(false)}
            disabled={enCoursDepart}
            className="text-sm text-red-600 hover:underline disabled:opacity-50"
          >
            Quitter cette colocation
          </button>
        )}
      </div>

      {detail.monRole === "admin" && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">Zone de danger</p>
          {confirmerDestruction ? (
            <div className="mt-2">
              <p className="text-sm text-red-700">
                Cette action est définitive : la colocation et son code
                d&apos;invitation disparaissent pour tout le monde. Confirmer ?
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={detruire}
                  disabled={enCoursDestruction}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {enCoursDestruction ? "Destruction..." : "Détruire définitivement"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmerDestruction(false)}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmerDestruction(true)}
              className="mt-2 text-sm text-red-600 hover:underline"
            >
              Détruire la colocation
            </button>
          )}
        </div>
      )}
    </main>
  );
}
