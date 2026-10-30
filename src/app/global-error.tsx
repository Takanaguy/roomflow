"use client";

/**
 * Remplace le layout racine quand celui-ci plante : ni Tailwind ni les polices
 * ne sont garantis, d'ou les styles inline et des couleurs explicites (le
 * globals.css passe en fond sombre selon l'OS, ici on garde un contraste sur).
 * Lien en <a> classique : il recharge toute la page, ce qui est voulu apres un
 * plantage du layout.
 */
export default function ErreurGlobale({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest !== ""
      ? error.digest
      : null;

  const bouton = {
    padding: "0.5rem 1rem",
    borderRadius: "0.375rem",
    fontSize: "0.875rem",
    fontFamily: "inherit",
    cursor: "pointer",
  } as const;

  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "0 1.5rem",
          textAlign: "center",
          fontFamily: "Arial, Helvetica, sans-serif",
          background: "#ffffff",
          color: "#18181b",
        }}
      >
        <title>Une erreur est survenue</title>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Une erreur est survenue</h1>
        <p style={{ margin: 0, maxWidth: "28rem", color: "#52525b" }}>
          Ce n&apos;est pas de ta faute, et tes données ne sont pas perdues. Tu peux
          réessayer, ou revenir à l&apos;accueil.
        </p>
        {digest && (
          <p style={{ margin: 0, fontSize: "0.75rem", color: "#52525b" }}>
            Référence : {digest}
          </p>
        )}
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "0.5rem" }}>
          <button
            type="button"
            onClick={() => retry()}
            style={{ ...bouton, background: "#18181b", color: "#ffffff", border: "1px solid #18181b" }}
          >
            Réessayer
          </button>
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- navigation complete voulue, le routeur client peut etre dans un etat douteux */}
          <a
            href="/"
            style={{
              ...bouton,
              background: "#ffffff",
              color: "#18181b",
              border: "1px solid #a1a1aa",
              textDecoration: "none",
            }}
          >
            Retour à l&apos;accueil
          </a>
        </div>
      </body>
    </html>
  );
}
