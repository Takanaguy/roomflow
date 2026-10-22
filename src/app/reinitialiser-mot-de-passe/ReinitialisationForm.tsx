"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function ReinitialisationForm({ jeton }: { jeton: string }) {
  const [motDePasse, setMotDePasse] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [termine, setTermine] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);

    if (motDePasse !== confirmation) {
      setErreur("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setEnCours(true);
    try {
      const res = await fetch("/api/mot-de-passe/reinitialiser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jeton, motDePasse }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setErreur(body?.error ?? "Impossible de changer le mot de passe.");
        return;
      }

      setTermine(true);
    } catch {
      setErreur("Impossible de changer le mot de passe. Réessaie dans un instant.");
    } finally {
      setEnCours(false);
    }
  }

  if (termine) {
    return (
      <>
        <p className="mt-6 text-sm text-zinc-700">Ton mot de passe a bien été changé.</p>
        <p className="mt-6 text-sm text-zinc-600">
          <Link href="/connexion" className="underline">
            Se connecter
          </Link>
        </p>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Nouveau mot de passe
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
        <span className="text-xs text-zinc-400">8 caractères minimum</span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Confirmation
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-2"
        />
      </label>

      {erreur && <p className="text-sm text-red-600">{erreur}</p>}

      <button
        type="submit"
        disabled={enCours}
        className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {enCours ? "Enregistrement..." : "Changer le mot de passe"}
      </button>
    </form>
  );
}
