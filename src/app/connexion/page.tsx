"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function ConnexionPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);

    // redirect:false pour rester sur la page et afficher notre propre
    // message d'erreur, plutot que de renvoyer sur /connexion?error=...
    const res = await signIn("credentials", { email, password, redirect: false });

    setEnCours(false);

    if (res?.error) {
      setErreur("Email ou mot de passe incorrect.");
      return;
    }

    // push (pas window.location) evite un rechargement complet ; refresh
    // force les Server Components (dont /tableau-de-bord) et useSession() a
    // relire la session fraichement posee par signIn ci-dessus.
    router.push("/tableau-de-bord");
    router.refresh();
  }

  return (
    <main className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold">Connexion</h1>

      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/tableau-de-bord" })}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
        >
          Continuer avec Google
        </button>
        <button
          type="button"
          onClick={() => signIn("github", { callbackUrl: "/tableau-de-bord" })}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
        >
          Continuer avec GitHub
        </button>
      </div>

      <div className="my-6 flex items-center gap-3 text-xs text-zinc-400">
        <div className="h-px flex-1 bg-zinc-200" />
        ou
        <div className="h-px flex-1 bg-zinc-200" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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

        <label className="flex flex-col gap-1 text-sm">
          Mot de passe
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-zinc-300 px-3 py-2"
          />
        </label>

        {erreur && <p className="text-sm text-red-600">{erreur}</p>}

        <button
          type="submit"
          disabled={enCours}
          className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {enCours ? "Connexion..." : "Se connecter"}
        </button>
      </form>

      <p className="mt-6 text-sm text-zinc-600">
        Pas encore de compte ?{" "}
        <Link href="/inscription" className="underline">
          Créer un compte
        </Link>
      </p>
    </main>
  );
}
