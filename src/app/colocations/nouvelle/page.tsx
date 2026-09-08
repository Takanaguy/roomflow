"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function NouvelleColocationPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);

    const res = await fetch("/api/colocations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: description || undefined }),
    });

    const body = await res.json().catch(() => null);
    setEnCours(false);

    if (!res.ok) {
      setErreur(body?.error ?? "Impossible de créer la colocation.");
      return;
    }

    router.push(`/colocations/${body.id}`);
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Créer une colocation</h1>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Nom
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2"
            placeholder="Ex : Appart rue des Lilas"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Description (facultatif)
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2"
            rows={3}
          />
        </label>

        {erreur && <p className="text-sm text-red-600">{erreur}</p>}

        <button
          type="submit"
          disabled={enCours}
          className="mt-2 self-start rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {enCours ? "Création..." : "Créer"}
        </button>
      </form>
    </main>
  );
}
