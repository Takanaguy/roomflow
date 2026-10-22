"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";

export default function MotDePasseOubliePage() {
  const [email, setEmail] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [envoye, setEnvoye] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);

    try {
      const res = await fetch("/api/mot-de-passe/demande", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        setErreur("Adresse email invalide.");
        return;
      }

      // Meme message que l'email existe ou non : l'API ne le dit pas, et la
      // page ne doit pas le laisser deviner.
      setEnvoye(true);
    } catch {
      setErreur("Impossible d'envoyer la demande. Réessaie dans un instant.");
    } finally {
      setEnCours(false);
    }
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Mot de passe oublié</h1>

      {envoye ? (
        <p className="mt-6 text-sm text-zinc-700">
          Si un compte existe pour cette adresse, un email vient d&apos;être envoyé. Le lien est
          valable 60 minutes.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-zinc-600">
            Indique l&apos;adresse de ton compte, on t&apos;envoie un lien pour choisir un nouveau
            mot de passe.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-md border border-zinc-300 px-3 py-2"
              />
            </label>

            {erreur && <p className="text-sm text-red-600">{erreur}</p>}

            <button
              type="submit"
              disabled={enCours}
              className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
            >
              {enCours ? "Envoi..." : "Envoyer le lien"}
            </button>
          </form>
        </>
      )}

      <p className="mt-6 text-sm text-zinc-600">
        <Link href="/connexion" className="underline">
          Retour à la connexion
        </Link>
      </p>
    </main>
  );
}
