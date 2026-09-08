"use client";

import { useState, type FormEvent } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function ProfilPage() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [name, setName] = useState(session?.user?.name ?? "");
  const [enCours, setEnCours] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // La session met un instant a se charger cote client ; on ne pre-remplit
  // le champ qu'une fois le vrai nom disponible.
  if (status === "authenticated" && name === "" && session.user?.name) {
    setName(session.user.name);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    setEnCours(true);

    const res = await fetch("/api/profil", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });

    setEnCours(false);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setMessage(body?.error ?? "Impossible d'enregistrer.");
      return;
    }

    // Met a jour la session cote client (donc l'en-tete) sans recharger,
    // et rafraichit les Server Components qui liraient le nom.
    await update({ name });
    router.refresh();
    setMessage("Enregistré.");
  }

  if (status === "loading") return null;

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Mon profil</h1>
      <p className="mt-2 text-sm text-zinc-600">
        {session?.user?.email}
        {" · connecté avec "}
        {session?.user?.image ? "un compte externe" : "un mot de passe"}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Nom affiché
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        {message && <p className="text-sm text-zinc-600">{message}</p>}

        <button
          type="submit"
          disabled={enCours}
          className="mt-2 self-start rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {enCours ? "Enregistrement..." : "Enregistrer"}
        </button>
      </form>
    </main>
  );
}
