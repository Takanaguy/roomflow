"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function RejoindreColocationPage() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);

    const res = await fetch("/api/colocations/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteCode: inviteCode.trim() }),
    });

    const body = await res.json().catch(() => null);
    setEnCours(false);

    if (!res.ok) {
      setErreur(body?.error ?? "Impossible de rejoindre.");
      return;
    }

    router.push(`/colocations/${body.id}`);
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Rejoindre une colocation</h1>
      <p className="mt-2 text-sm text-zinc-600">
        Demande le code d&apos;invitation à un membre de la colocation.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Code d&apos;invitation
          <input
            type="text"
            required
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2 font-mono"
          />
        </label>

        {erreur && <p className="text-sm text-red-600">{erreur}</p>}

        <button
          type="submit"
          disabled={enCours}
          className="mt-2 self-start rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {enCours ? "Connexion..." : "Rejoindre"}
        </button>
      </form>
    </main>
  );
}
