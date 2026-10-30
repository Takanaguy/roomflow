import { describe, expect, it } from "vitest";
import {
  boutonHtml,
  echapperHtml,
  emailBienvenue,
  emailColocationInactive,
  emailColocationVidee,
  emailCompteExterne,
  emailDepense,
  emailMotDePasse,
  emailRappelTache,
  formaterEuros,
  habillerEmail,
  type EmailRendu,
} from "@/lib/email-templates";

// Generateur congruentiel a graine fixe : reproductible, contrairement a
// Math.random (un echec doit pouvoir etre rejoue a l'identique).
function generateur(graine: number) {
  let etat = graine;
  return (max: number) => {
    etat = (etat * 1103515245 + 12345) % 2147483648;
    return etat % max;
  };
}

const LIEN = "https://app.test/colocations/abc";
const LIEN_PROFIL = "https://app.test/profil";

// Les deux injections demandees, plus quelques variantes qui visent les
// attributs (guillemets) et les gestionnaires d'evenements.
const CHARGES_UTILES = [
  "<script>alert(1)</script>",
  '"><img src=x onerror=alert(1)>',
  "' onmouseover='alert(1)",
  "</title><script>alert(1)</script>",
  "&lt;script&gt;alert(1)&lt;/script&gt;",
];

// ---------------------------------------------------------------------------
// echapperHtml
// ---------------------------------------------------------------------------

describe("echapperHtml : les 5 caracteres dangereux", () => {
  it.each([
    ["&", "&amp;"],
    ["<", "&lt;"],
    [">", "&gt;"],
    ['"', "&quot;"],
    ["'", "&#39;"],
  ])("%s devient %s", (entree, attendu) => {
    expect(echapperHtml(entree)).toBe(attendu);
  });

  it("chaine vide : reste vide", () => {
    expect(echapperHtml("")).toBe("");
  });

  it("texte sans caractere dangereux : inchange (accents compris)", () => {
    expect(echapperHtml("Colocation des étudiants 42")).toBe("Colocation des étudiants 42");
  });

  it("melange : tous les caracteres sont traites dans le bon ordre", () => {
    expect(echapperHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;"
    );
  });

  it("deja echappe : double echappement attendu (la fonction ne devine rien)", () => {
    expect(echapperHtml("&lt;")).toBe("&amp;lt;");
    expect(echapperHtml(echapperHtml("<"))).toBe("&amp;lt;");
  });

  it("plusieurs occurrences du meme caractere sont toutes remplacees", () => {
    expect(echapperHtml("<<>>")).toBe("&lt;&lt;&gt;&gt;");
  });

  it("200 chaines pseudo-aleatoires (graine fixe) : jamais de < > \" ' ni de & orphelin, et l'echappement est reversible", () => {
    const alphabet = ["a", "Z", "é", " ", "&", "<", ">", '"', "'", "#", ";", "x", "\n"];
    const tirer = generateur(20261021);
    for (let i = 0; i < 200; i++) {
      const longueur = tirer(41);
      let entree = "";
      for (let j = 0; j < longueur; j++) entree += alphabet[tirer(alphabet.length)];

      const sortie = echapperHtml(entree);
      expect(sortie, `entree ${JSON.stringify(entree)}`).not.toMatch(/[<>"']/);
      // Tout & restant doit ouvrir une des 5 entites que la fonction produit.
      expect(sortie, `entree ${JSON.stringify(entree)}`).not.toMatch(/&(?!(?:amp|lt|gt|quot|#39);)/);
      // Un seul passage de remplacement : c'est l'inverse exact de l'echappement.
      const retour = sortie.replace(
        /&(amp|lt|gt|quot|#39);/g,
        (_, nom: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[nom]!
      );
      expect(retour).toBe(entree);
    }
  });
});

// ---------------------------------------------------------------------------
// formaterEuros
// ---------------------------------------------------------------------------

describe("formaterEuros", () => {
  it.each([
    [6.66, "6,66 €"],
    [26.67, "26,67 €"],
    [0, "0,00 €"],
    [1234.5, "1 234,50 €"],
    [100, "100,00 €"],
    [999.99, "999,99 €"],
    [1000, "1 000,00 €"],
    [1234567.89, "1 234 567,89 €"],
  ])("%s => %s", (montant, attendu) => {
    expect(formaterEuros(montant)).toBe(attendu);
  });

  it("1.005 => 1,01 € (le bruit binaire du flottant ne fait pas arrondir vers le bas)", () => {
    expect(formaterEuros(1.005)).toBe("1,01 €");
  });

  it("0.1 + 0.2 => 0,30 €", () => {
    expect(formaterEuros(0.1 + 0.2)).toBe("0,30 €");
  });

  it("negatif : -2.5 => -2,50 €", () => {
    expect(formaterEuros(-2.5)).toBe("-2,50 €");
  });

  it("negatif avec arrondi symetrique : -1.005 => -1,01 €", () => {
    expect(formaterEuros(-1.005)).toBe("-1,01 €");
  });

  it("negatif groupe : -1234.5 => -1 234,50 €", () => {
    expect(formaterEuros(-1234.5)).toBe("-1 234,50 €");
  });

  it("-0.001 => 0,00 € (jamais -0,00)", () => {
    expect(formaterEuros(-0.001)).toBe("0,00 €");
    expect(formaterEuros(-0)).toBe("0,00 €");
    expect(formaterEuros(-0.004)).toBe("0,00 €");
  });

  it("un demi-centime s'arrondit vers le haut en valeur absolue : 0.005 => 0,01 €", () => {
    expect(formaterEuros(0.005)).toBe("0,01 €");
  });

  it("valeur non finie : 0,00 € plutot qu'une exception", () => {
    expect(formaterEuros(NaN)).toBe("0,00 €");
    expect(formaterEuros(Infinity)).toBe("0,00 €");
    expect(formaterEuros(-Infinity)).toBe("0,00 €");
  });

  it("tres grand montant : 9 999 999 999,99 € et un billion d'euros", () => {
    expect(formaterEuros(9999999999.99)).toBe("9 999 999 999,99 €");
    expect(formaterEuros(1e12)).toBe("1 000 000 000 000,00 €");
  });

  it("le separateur de milliers est un espace simple placé tous les 3 chiffres", () => {
    expect(formaterEuros(12345678)).toBe("12 345 678,00 €");
  });

  it("100 montants pseudo-aleatoires en centimes entiers (graine fixe) : le texte relu redonne exactement le montant", () => {
    const tirer = generateur(777);
    for (let i = 0; i < 100; i++) {
      // Jusqu'a ~ 10 millions d'euros, en centimes entiers.
      const centimes = tirer(1_000_000_000);
      const montant = centimes / 100;
      const texte = formaterEuros(montant);
      const relu = Number(texte.replace(/\s/g, "").replace("€", "").replace(",", "."));
      expect(relu, `centimes ${centimes} => ${texte}`).toBe(montant);
    }
  });
});

// ---------------------------------------------------------------------------
// boutonHtml
// ---------------------------------------------------------------------------

describe("boutonHtml", () => {
  it("le lien et le libelle sont echappes, le lien apparait aussi en clair", () => {
    const html = boutonHtml('Ouvrir <b>"x"</b>', "https://app.test/a?x=1&y=2");
    expect(html).toContain('href="https://app.test/a?x=1&amp;y=2"');
    expect(html).toContain("Ouvrir &lt;b&gt;&quot;x&quot;&lt;/b&gt;");
    expect(html).toContain(">https://app.test/a?x=1&amp;y=2</a>");
    expect(html).not.toContain("<b>");
  });

  it("un guillemet dans le lien ne peut pas fermer l'attribut href", () => {
    const html = boutonHtml("Ok", 'https://x.fr/"><script>alert(1)</script>');
    expect(html).not.toContain("<script");
    // Le guillemet est echappe : l'attribut href contient tout le texte piege.
    expect(html).toContain('href="https://x.fr/&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"');
  });
});

// ---------------------------------------------------------------------------
// habillerEmail
// ---------------------------------------------------------------------------

describe("habillerEmail", () => {
  it("le titre est echappe dans <title> et dans le <h1>", () => {
    const { html } = habillerEmail({
      titre: '<b>"T"</b>',
      corpsHtml: "<p>x</p>",
      corpsTexte: "x",
    });
    const echappe = "&lt;b&gt;&quot;T&quot;&lt;/b&gt;";
    expect(html).toContain(`<title>${echappe}</title>`);
    expect(html).toContain(`>${echappe}</h1>`);
    expect(html).not.toContain("<b>");
  });

  it("le pied est echappe", () => {
    const { html } = habillerEmail({
      titre: "T",
      corpsHtml: "<p>x</p>",
      corpsTexte: "x",
      pied: "<script>alert(1)</script> & co",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; co");
  });

  it("seule l'URL du pied listee dans liensAutorises est cliquable (l'URL est echappee dans href)", () => {
    const { html } = habillerEmail({
      titre: "T",
      corpsHtml: "<p>x</p>",
      corpsTexte: "x",
      pied: "Voir https://app.test/a?b=1&c=2 ou http://app.test/z merci",
      liensAutorises: ["https://app.test/a?b=1&c=2"],
    });
    expect(html).toContain('<a href="https://app.test/a?b=1&amp;c=2"');
    expect(html).toContain('>https://app.test/a?b=1&amp;c=2</a>');
    // L'autre URL n'est pas autorisee : texte echappe, pas de lien.
    expect(html).not.toContain('<a href="http://app.test/z"');
    expect(html).toContain("ou http://app.test/z merci");
  });

  it("un protocole autre que http(s) n'est pas transforme en lien", () => {
    const { html } = habillerEmail({
      titre: "T",
      corpsHtml: "<p>x</p>",
      corpsTexte: "x",
      pied: "javascript:alert(1) ftp://x.fr",
    });
    expect(html).not.toContain("<a href=");
  });

  it("un guillemet dans un lien du pied ne casse pas l'attribut href", () => {
    const { html } = habillerEmail({
      titre: "T",
      corpsHtml: "<p>x</p>",
      corpsTexte: "x",
      pied: 'https://x.fr/"onmouseover="alert(1)',
    });
    expect(html).not.toContain('"onmouseover=');
    expect(html).not.toContain("<script");
  });

  it("version texte : titre, ligne vide, corps, puis separateur -- avant le pied", () => {
    const { text } = habillerEmail({
      titre: "Titre",
      corpsHtml: "<p>x</p>",
      corpsTexte: "Corps",
      pied: "Pied de page",
    });
    expect(text).toBe("Titre\n\nCorps\n\n--\nPied de page");
  });

  it("la version texte garde le texte brut (pas d'entites HTML)", () => {
    const { text } = habillerEmail({
      titre: "A & B",
      corpsHtml: "<p>x</p>",
      corpsTexte: "x",
    });
    expect(text.startsWith("A & B")).toBe(true);
    expect(text).not.toContain("&amp;");
  });

  it("sans pied : ni separateur dans le texte, ni bloc de pied dans le HTML", () => {
    const { html, text } = habillerEmail({
      titre: "Titre",
      corpsHtml: "<p>x</p>",
      corpsTexte: "Corps",
    });
    expect(text).toBe("Titre\n\nCorps");
    expect(text).not.toContain("--");
    expect(html).not.toContain("margin:16px 0 0 0");
  });

  it("pied vide : traite comme absent", () => {
    const { html, text } = habillerEmail({
      titre: "Titre",
      corpsHtml: "<p>x</p>",
      corpsTexte: "Corps",
      pied: "",
    });
    expect(text).toBe("Titre\n\nCorps");
    expect(html).not.toContain("margin:16px 0 0 0");
  });

  it("structure : document complet en francais avec le nom RoomFlow", () => {
    const { html } = habillerEmail({ titre: "T", corpsHtml: "<p>x</p>", corpsTexte: "x" });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="fr">');
    expect(html).toContain("<body");
    expect(html).toContain(">RoomFlow</p>");
    expect(html.endsWith("</html>")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// emailBienvenue
// ---------------------------------------------------------------------------

describe("emailBienvenue", () => {
  const mail = emailBienvenue({
    nomColocation: "Les Lilas",
    lien: LIEN,
    lienProfil: LIEN_PROFIL,
  });

  it("sujet exact", () => {
    expect(mail.subject).toBe("RoomFlow : tu as rejoint Les Lilas");
  });

  it("le HTML et le texte contiennent le lien et le nom de la colocation", () => {
    expect(mail.html).toContain(`href="${LIEN}"`);
    expect(mail.text).toContain(`Ouvrir la colocation : ${LIEN}`);
    expect(mail.html).toContain("<strong>Les Lilas</strong>");
    expect(mail.text).toContain("Tu fais maintenant partie de la colocation Les Lilas sur RoomFlow.");
  });

  it("pied de notification present avec le lien du profil (HTML et texte)", () => {
    expect(mail.text).toContain(
      `--\nTu reçois cet email car tu fais partie de la colocation Les Lilas. Tu peux désactiver les notifications dans ton profil : ${LIEN_PROFIL}`
    );
    expect(mail.html).toContain("Tu reçois cet email car tu fais partie de la colocation Les Lilas.");
    expect(mail.html).toContain(`<a href="${LIEN_PROFIL}"`);
  });

  it("sujet tronque a 90 caracteres avec …", () => {
    const long = emailBienvenue({
      nomColocation: "x".repeat(200),
      lien: LIEN,
      lienProfil: LIEN_PROFIL,
    });
    expect(long.subject).toHaveLength(90);
    expect(long.subject.endsWith("…")).toBe(true);
    expect(long.subject.startsWith("RoomFlow : tu as rejoint xxx")).toBe(true);
  });

  it("sujet de exactement 90 caracteres : pas de troncature", () => {
    const prefixe = "RoomFlow : tu as rejoint ";
    const exact = emailBienvenue({
      nomColocation: "y".repeat(90 - prefixe.length),
      lien: LIEN,
      lienProfil: LIEN_PROFIL,
    });
    expect(exact.subject).toHaveLength(90);
    expect(exact.subject.endsWith("…")).toBe(false);
  });

  it("sujet de 91 caracteres : tronque", () => {
    const prefixe = "RoomFlow : tu as rejoint ";
    const trop = emailBienvenue({
      nomColocation: "y".repeat(91 - prefixe.length),
      lien: LIEN,
      lienProfil: LIEN_PROFIL,
    });
    expect(trop.subject).toHaveLength(90);
    expect(trop.subject.endsWith("y…")).toBe(true);
  });

  it("espaces et retours a la ligne aplatis dans le sujet", () => {
    const m = emailBienvenue({
      nomColocation: "  Les\n\n  Lilas\t\tdu   Sud  ",
      lien: LIEN,
      lienProfil: LIEN_PROFIL,
    });
    expect(m.subject).toBe("RoomFlow : tu as rejoint Les Lilas du Sud");
  });
});

// ---------------------------------------------------------------------------
// emailDepense
// ---------------------------------------------------------------------------

describe("emailDepense", () => {
  const base = {
    auteur: "Alice",
    description: "Courses",
    montant: 100,
    nomColocation: "Les Lilas",
    lien: LIEN,
    lienProfil: LIEN_PROFIL,
  };

  it("sujet exact", () => {
    expect(emailDepense({ ...base, remboursements: [] }).subject).toBe(
      "RoomFlow : nouvelle dépense dans Les Lilas"
    );
  });

  it("phrase principale : auteur, colocation, description et montant total formate", () => {
    const m = emailDepense({ ...base, remboursements: [] });
    expect(m.text).toContain("Alice a ajouté une dépense dans la colocation Les Lilas : Courses (100,00 €).");
    expect(m.html).toContain("<strong>Alice</strong> a ajouté une dépense dans la colocation <strong>Les Lilas</strong> : Courses (100,00 €).");
  });

  it("le montant total utilise le groupement des milliers : 1234.5 => 1 234,50 €", () => {
    const m = emailDepense({ ...base, montant: 1234.5, remboursements: [] });
    expect(m.text).toContain("(1 234,50 €)");
  });

  it("sans remboursement : tu ne dois rien (HTML et texte)", () => {
    const m = emailDepense({ ...base, remboursements: [] });
    expect(m.text).toContain("Pour cette dépense, tu ne dois rien.");
    expect(m.html).toContain("Pour cette dépense, tu ne dois rien.");
    expect(m.text).not.toContain("tu dois ");
  });

  it("1 remboursement : « a »", () => {
    const m = emailDepense({
      ...base,
      remboursements: [{ versNom: "Test 1", montant: 6.66 }],
    });
    expect(m.text).toContain("Pour cette dépense, tu dois 6,66 € à Test 1.");
    expect(m.html).toContain("Pour cette dépense, tu dois <strong>6,66 €</strong> à Test 1.");
  });

  it("2 remboursements : « a et b »", () => {
    const m = emailDepense({
      ...base,
      remboursements: [
        { versNom: "Test 1", montant: 6.66 },
        { versNom: "Test 2", montant: 26.67 },
      ],
    });
    expect(m.text).toContain("Pour cette dépense, tu dois 6,66 € à Test 1 et 26,67 € à Test 2.");
    expect(m.html).toContain(
      "tu dois <strong>6,66 €</strong> à Test 1 et <strong>26,67 €</strong> à Test 2."
    );
  });

  it("3 remboursements : « a, b et c » avec montants formates", () => {
    const m = emailDepense({
      ...base,
      remboursements: [
        { versNom: "Test 1", montant: 6.66 },
        { versNom: "Test 2", montant: 1234.5 },
        { versNom: "Test 3", montant: 0.1 + 0.2 },
      ],
    });
    expect(m.text).toContain(
      "Pour cette dépense, tu dois 6,66 € à Test 1, 1 234,50 € à Test 2 et 0,30 € à Test 3."
    );
  });

  it("4 remboursements : virgules puis « et » devant le dernier seulement", () => {
    const m = emailDepense({
      ...base,
      remboursements: [
        { versNom: "A", montant: 1 },
        { versNom: "B", montant: 2 },
        { versNom: "C", montant: 3 },
        { versNom: "D", montant: 4 },
      ],
    });
    expect(m.text).toContain("tu dois 1,00 € à A, 2,00 € à B, 3,00 € à C et 4,00 € à D.");
  });

  it("le HTML et le texte contiennent le lien", () => {
    const m = emailDepense({ ...base, remboursements: [] });
    expect(m.html).toContain(`href="${LIEN}"`);
    expect(m.text).toContain(`Voir la dépense : ${LIEN}`);
  });

  it("pied de notification present avec le lien du profil", () => {
    const m = emailDepense({ ...base, remboursements: [] });
    expect(m.text).toContain("Tu reçois cet email car tu fais partie de la colocation Les Lilas.");
    expect(m.text).toContain(LIEN_PROFIL);
    expect(m.html).toContain(`<a href="${LIEN_PROFIL}"`);
  });

  it("sujet tronque a 90 caracteres, retours a la ligne aplatis", () => {
    const m = emailDepense({
      ...base,
      nomColocation: `${"z".repeat(150)}\nBcc: x@y.z`,
      remboursements: [],
    });
    expect(m.subject).toHaveLength(90);
    expect(m.subject.endsWith("…")).toBe(true);
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});

// ---------------------------------------------------------------------------
// emailRappelTache
// ---------------------------------------------------------------------------

describe("emailRappelTache", () => {
  const base = {
    titre: "Sortir les poubelles",
    nomColocation: "Les Lilas",
    echeance: new Date("2026-10-22T00:00:00Z"),
    lien: LIEN,
    lienProfil: LIEN_PROFIL,
  };

  it("sujet exact", () => {
    expect(emailRappelTache(base).subject).toBe("RoomFlow : rappel de tâche, Sortir les poubelles");
  });

  it("echeance 2026-10-22T00:00:00Z => jeudi 22 octobre 2026", () => {
    const m = emailRappelTache(base);
    expect(m.text).toContain("Échéance : jeudi 22 octobre 2026.");
    expect(m.html).toContain("Échéance : <strong>jeudi 22 octobre 2026</strong>.");
  });

  it("echeance tardive 2026-10-22T23:30:00Z : reste le 22 (affichage en UTC)", () => {
    const m = emailRappelTache({ ...base, echeance: new Date("2026-10-22T23:30:00Z") });
    expect(m.text).toContain("jeudi 22 octobre 2026");
    expect(m.text).not.toContain("vendredi");
  });

  it("une seconde apres minuit UTC le lendemain : bascule bien au 23", () => {
    const m = emailRappelTache({ ...base, echeance: new Date("2026-10-23T00:00:00Z") });
    expect(m.text).toContain("vendredi 23 octobre 2026");
  });

  it("date invalide : « date inconnue » sans exception", () => {
    let m: EmailRendu | undefined;
    expect(() => {
      m = emailRappelTache({ ...base, echeance: new Date("pas une date") });
    }).not.toThrow();
    expect(m!.text).toContain("Échéance : date inconnue.");
    expect(m!.html).toContain("<strong>date inconnue</strong>");
  });

  it("le HTML et le texte contiennent le lien, le titre et la colocation", () => {
    const m = emailRappelTache(base);
    expect(m.html).toContain(`href="${LIEN}"`);
    expect(m.text).toContain(`Voir la tâche : ${LIEN}`);
    expect(m.text).toContain("La tâche Sortir les poubelles de la colocation Les Lilas t'est assignée.");
    expect(m.html).toContain("<strong>Sortir les poubelles</strong>");
  });

  it("pied de notification present", () => {
    const m = emailRappelTache(base);
    expect(m.text).toContain("Tu reçois cet email car tu fais partie de la colocation Les Lilas.");
    expect(m.text).toContain(LIEN_PROFIL);
  });

  it("injection d'en-tetes : un titre avec \\r\\nBcc: ne cree jamais de saut de ligne dans le sujet", () => {
    const m = emailRappelTache({ ...base, titre: "Vaisselle\r\nBcc: x@y.z" });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toBe("RoomFlow : rappel de tâche, Vaisselle Bcc: x@y.z");
  });

  it.each(["\n", "\r", "\r\n", "\t", "\u2028", "\u2029", "\v", "\f"])(
    "separateur de ligne %j dans le titre : aplati dans le sujet",
    (sep) => {
      const m = emailRappelTache({ ...base, titre: `a${sep}Bcc: x@y.z${sep}${sep}b` });
      expect(m.subject).not.toMatch(new RegExp("[\\r\\n\\u2028\\u2029]"));
      expect(m.subject).toBe("RoomFlow : rappel de tâche, a Bcc: x@y.z b");
    }
  );

  it("sujet tronque a 90 caracteres avec …", () => {
    const m = emailRappelTache({ ...base, titre: "t".repeat(300) });
    expect(m.subject).toHaveLength(90);
    expect(m.subject.endsWith("…")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// emailMotDePasse
// ---------------------------------------------------------------------------

describe("emailMotDePasse", () => {
  it("sujet exact", () => {
    expect(emailMotDePasse({ lien: LIEN, dureeMinutes: 30 }).subject).toBe(
      "RoomFlow : réinitialise ton mot de passe"
    );
  });

  it("1 minute (singulier)", () => {
    const m = emailMotDePasse({ lien: LIEN, dureeMinutes: 1 });
    expect(m.text).toContain("Ce lien est valable 1 minute :");
    expect(m.text).not.toContain("1 minutes");
    expect(m.html).toContain("Ce lien est valable 1 minute.");
    expect(m.html).not.toContain("1 minutes");
  });

  it("N minutes (pluriel)", () => {
    const m = emailMotDePasse({ lien: LIEN, dureeMinutes: 30 });
    expect(m.text).toContain("Ce lien est valable 30 minutes :");
    expect(m.html).toContain("Ce lien est valable 30 minutes.");
  });

  it("2 minutes : deja au pluriel", () => {
    expect(emailMotDePasse({ lien: LIEN, dureeMinutes: 2 }).text).toContain("2 minutes");
  });

  it("le HTML et le texte contiennent le lien", () => {
    const m = emailMotDePasse({ lien: LIEN, dureeMinutes: 30 });
    expect(m.html).toContain(`href="${LIEN}"`);
    expect(m.text).toContain(`\n${LIEN}\n`);
  });

  it("PAS de pied de notification (mail de securite)", () => {
    const m = emailMotDePasse({ lien: LIEN, dureeMinutes: 30 });
    expect(m.text).not.toContain("Tu reçois cet email");
    expect(m.text).not.toContain("\n--\n");
    expect(m.html).not.toContain("Tu reçois cet email");
    expect(m.html).not.toContain("désactiver");
    expect(m.html).not.toContain("margin:16px 0 0 0");
  });
});

// ---------------------------------------------------------------------------
// emailCompteExterne
// ---------------------------------------------------------------------------

describe("emailCompteExterne", () => {
  it("google => Google, sujet exact", () => {
    const m = emailCompteExterne({ provider: "google", lien: LIEN });
    expect(m.subject).toBe("RoomFlow : connecte-toi avec Google");
    expect(m.html).toContain("<strong>Google</strong>");
    expect(m.text).toContain("Ton compte utilise la connexion Google");
  });

  it("github => GitHub", () => {
    const m = emailCompteExterne({ provider: "github", lien: LIEN });
    expect(m.subject).toBe("RoomFlow : connecte-toi avec GitHub");
    expect(m.html).toContain("Se connecter avec GitHub");
  });

  it("insensible a la casse et aux espaces autour : « GOOGLE » et « github  »", () => {
    expect(emailCompteExterne({ provider: " GOOGLE", lien: LIEN }).subject).toBe(
      "RoomFlow : connecte-toi avec Google"
    );
    expect(emailCompteExterne({ provider: "github  ", lien: LIEN }).subject).toBe(
      "RoomFlow : connecte-toi avec GitHub"
    );
  });

  it("autre fournisseur : tel quel", () => {
    const m = emailCompteExterne({ provider: "gitlab", lien: LIEN });
    expect(m.subject).toBe("RoomFlow : connecte-toi avec gitlab");
    expect(m.html).toContain("<strong>gitlab</strong>");
  });

  it("le titre du mail reprend le fournisseur", () => {
    const m = emailCompteExterne({ provider: "google", lien: LIEN });
    expect(m.text.startsWith("Connecte-toi avec Google\n")).toBe(true);
    expect(m.html).toContain(">Connecte-toi avec Google</h1>");
  });

  it("le HTML et le texte contiennent le lien", () => {
    const m = emailCompteExterne({ provider: "google", lien: LIEN });
    expect(m.html).toContain(`href="${LIEN}"`);
    expect(m.text).toContain(`\n${LIEN}\n`);
  });

  it("PAS de pied de notification (mail de securite)", () => {
    const m = emailCompteExterne({ provider: "google", lien: LIEN });
    expect(m.text).not.toContain("Tu reçois cet email");
    expect(m.text).not.toContain("\n--\n");
    expect(m.html).not.toContain("Tu reçois cet email");
    expect(m.html).not.toContain("margin:16px 0 0 0");
  });

  it("injection d'en-tetes via le fournisseur : aucun saut de ligne dans le sujet", () => {
    const m = emailCompteExterne({ provider: "x\r\nBcc: x@y.z", lien: LIEN });
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it("sujet tronque a 90 caracteres", () => {
    const m = emailCompteExterne({ provider: "p".repeat(200), lien: LIEN });
    expect(m.subject).toHaveLength(90);
    expect(m.subject.endsWith("…")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Injection HTML : aucun champ texte utilisateur ne ressort brut
// ---------------------------------------------------------------------------

describe("injection HTML dans tous les modeles", () => {
  // Chaque entree place la charge utile dans UN champ utilisateur a la fois,
  // les autres champs restant normaux : un oubli d'echappement sur un seul
  // champ est ainsi detecte, et le nom du champ sort dans le message d'echec.
  type Cas = { champ: string; rendre: (p: string) => EmailRendu };
  const normal = {
    nomColocation: "Coloc",
    auteur: "Alice",
    description: "Courses",
    titre: "Tache",
    versNom: "Bob",
  };
  const cas: Cas[] = [
    {
      champ: "bienvenue.nomColocation",
      rendre: (p) =>
        emailBienvenue({ nomColocation: p, lien: LIEN, lienProfil: LIEN_PROFIL }),
    },
    {
      champ: "depense.auteur",
      rendre: (p) =>
        emailDepense({
          auteur: p,
          description: normal.description,
          montant: 10,
          nomColocation: normal.nomColocation,
          remboursements: [{ versNom: normal.versNom, montant: 5 }],
          lien: LIEN,
          lienProfil: LIEN_PROFIL,
        }),
    },
    {
      champ: "depense.description",
      rendre: (p) =>
        emailDepense({
          auteur: normal.auteur,
          description: p,
          montant: 10,
          nomColocation: normal.nomColocation,
          remboursements: [{ versNom: normal.versNom, montant: 5 }],
          lien: LIEN,
          lienProfil: LIEN_PROFIL,
        }),
    },
    {
      champ: "depense.nomColocation",
      rendre: (p) =>
        emailDepense({
          auteur: normal.auteur,
          description: normal.description,
          montant: 10,
          nomColocation: p,
          remboursements: [{ versNom: normal.versNom, montant: 5 }],
          lien: LIEN,
          lienProfil: LIEN_PROFIL,
        }),
    },
    {
      champ: "depense.versNom",
      rendre: (p) =>
        emailDepense({
          auteur: normal.auteur,
          description: normal.description,
          montant: 10,
          nomColocation: normal.nomColocation,
          remboursements: [
            { versNom: p, montant: 5 },
            { versNom: p, montant: 2 },
          ],
          lien: LIEN,
          lienProfil: LIEN_PROFIL,
        }),
    },
    {
      champ: "rappel.titre",
      rendre: (p) =>
        emailRappelTache({
          titre: p,
          nomColocation: normal.nomColocation,
          echeance: new Date("2026-10-22T00:00:00Z"),
          lien: LIEN,
          lienProfil: LIEN_PROFIL,
        }),
    },
    {
      champ: "rappel.nomColocation",
      rendre: (p) =>
        emailRappelTache({
          titre: normal.titre,
          nomColocation: p,
          echeance: new Date("2026-10-22T00:00:00Z"),
          lien: LIEN,
          lienProfil: LIEN_PROFIL,
        }),
    },
    {
      champ: "compteExterne.provider",
      rendre: (p) => emailCompteExterne({ provider: p, lien: LIEN }),
    },
  ];

  for (const payload of CHARGES_UTILES) {
    for (const c of cas) {
      it(`${c.champ} avec ${JSON.stringify(payload)} : jamais brut dans le HTML`, () => {
        const { html } = c.rendre(payload);
        expect(html).not.toContain(payload);
        expect(html).not.toMatch(/<script/i);
        expect(html).not.toMatch(/<img/i);
        // La version echappee est bien la, donc le texte n'a pas ete supprime.
        expect(html).toContain(echapperHtml(payload));
      });
    }
  }

  it("lien piege dans tous les modeles : le guillemet ne sort pas de l'attribut href", () => {
    const piege = 'https://app.test/"><script>alert(1)</script>';
    const rendus = [
      emailBienvenue({ nomColocation: "C", lien: piege, lienProfil: piege }),
      emailDepense({
        auteur: "A",
        description: "d",
        montant: 1,
        nomColocation: "C",
        remboursements: [],
        lien: piege,
        lienProfil: piege,
      }),
      emailRappelTache({
        titre: "t",
        nomColocation: "C",
        echeance: new Date("2026-10-22T00:00:00Z"),
        lien: piege,
        lienProfil: piege,
      }),
      emailMotDePasse({ lien: piege, dureeMinutes: 5 }),
      emailCompteExterne({ provider: "google", lien: piege }),
    ];
    for (const { html } of rendus) {
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toContain('"><script');
      // Un href n'est jamais interrompu par le guillemet du lien piege.
      expect(html).toContain('href="https://app.test/&quot;&gt;&lt;script&gt;');
    }
  });

  it("le sujet n'est pas du HTML : la charge utile y reste telle quelle, sans retour a la ligne", () => {
    const m = emailBienvenue({
      nomColocation: "<script>alert(1)</script>",
      lien: LIEN,
      lienProfil: LIEN_PROFIL,
    });
    expect(m.subject).toBe("RoomFlow : tu as rejoint <script>alert(1)</script>");
  });
});

// ---------------------------------------------------------------------------
// Liens cliquables : liensAutorises et mails de notification (securite)
// ---------------------------------------------------------------------------

// Balises <a ...> d'un HTML, et leurs href. Reperer les liens par analyse
// (et pas seulement par "contient / ne contient pas") permet de compter
// exactement combien de liens existent et vers ou ils menent.
const balisesA = (html: string) => [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]);
const hrefs = (html: string) =>
  balisesA(html).map((balise) => /href="([^"]*)"/.exec(balise)?.[1] ?? null);

const PIEGE = "https://site-piege.example";

describe("habillerEmail : liensAutorises dans le pied", () => {
  const rendre = (pied: string, liensAutorises?: string[]) =>
    habillerEmail({
      titre: "T",
      corpsHtml: "<p>x</p>",
      corpsTexte: "x",
      pied,
      ...(liensAutorises === undefined ? {} : { liensAutorises }),
    });

  // (a)
  it("(a) seule l'URL listee est cliquable : l'autre URL du pied reste du texte echappe", () => {
    const { html } = rendre(
      `Profil : ${LIEN_PROFIL} ou ${PIEGE} merci`,
      [LIEN_PROFIL]
    );
    expect(hrefs(html)).toStrictEqual([LIEN_PROFIL]);
    expect(html).toContain(`<a href="${LIEN_PROFIL}"`);
    // L'URL non listee est bien presente, mais en simple texte.
    expect(html).toContain(`ou ${PIEGE} merci`);
    expect(html).not.toMatch(/href="[^"]*site-piege/);
  });

  it("(a) plusieurs URL autorisees : toutes cliquables, les autres non", () => {
    const { html } = rendre(`${LIEN_PROFIL} ${LIEN} ${PIEGE}`, [LIEN_PROFIL, LIEN]);
    expect(hrefs(html)).toStrictEqual([LIEN_PROFIL, LIEN]);
  });

  it("(a) une URL autorisee presente deux fois dans le pied : les deux occurrences sont cliquables", () => {
    const { html } = rendre(`${LIEN_PROFIL} puis encore ${LIEN_PROFIL}`, [LIEN_PROFIL]);
    expect(hrefs(html)).toStrictEqual([LIEN_PROFIL, LIEN_PROFIL]);
  });

  it("(a) comparaison EXACTE : une URL qui prolonge l'URL autorisee n'est pas cliquable", () => {
    const { html } = rendre(`Voir ${LIEN_PROFIL}/autre-page merci`, [LIEN_PROFIL]);
    expect(balisesA(html)).toHaveLength(0);
  });

  it("(a) comparaison EXACTE : une URL plus courte que l'URL autorisee n'est pas cliquable", () => {
    const { html } = rendre("Voir https://app.test merci", [LIEN_PROFIL]);
    expect(balisesA(html)).toHaveLength(0);
  });

  it("(a) comparaison sensible a la casse : HTTPS://APP.TEST/profil n'est pas cliquable", () => {
    const { html } = rendre("Voir HTTPS://APP.TEST/profil merci", [LIEN_PROFIL]);
    // Le motif de detection est en minuscules : le texte n'est meme pas reconnu
    // comme une URL, donc il ne peut pas devenir un lien.
    expect(balisesA(html)).toHaveLength(0);
  });

  it("(a) http et https sont deux URL differentes", () => {
    const { html } = rendre("Voir http://app.test/profil merci", ["https://app.test/profil"]);
    expect(balisesA(html)).toHaveLength(0);
  });

  it("(a) ponctuation collee : « profil. » absorbe le point, donc le lien n'est PAS cliquable (comportement actuel)", () => {
    // La detection prend tout jusqu'au prochain espace, point final compris,
    // puis compare avec la liste : "https://app.test/profil." n'est pas dans la
    // liste. Sans danger (fail-closed : on perd un lien, on n'en cree pas),
    // et le pied reel place le lien en toute fin, sans ponctuation.
    const { html } = rendre(`Voir ${LIEN_PROFIL}. Merci`, [LIEN_PROFIL]);
    expect(balisesA(html)).toHaveLength(0);
    expect(html).toContain(`${LIEN_PROFIL}. Merci`);
  });

  it("(a) une URL autorisee qui contient un espace n'est jamais cliquable (detection arretee au premier espace)", () => {
    const avecEspace = "https://app.test/mon profil";
    const { html } = rendre(`Voir ${avecEspace} merci`, [avecEspace]);
    expect(balisesA(html)).toHaveLength(0);
  });

  it("(a) URL listee mais absente du pied : aucun lien, aucune erreur", () => {
    const { html } = rendre("Un pied sans adresse", [LIEN_PROFIL]);
    expect(balisesA(html)).toHaveLength(0);
    expect(html).toContain("Un pied sans adresse");
  });

  it("(a) la version texte brut n'est pas touchee par liensAutorises", () => {
    const { text } = rendre(`Voir ${LIEN_PROFIL} et ${PIEGE}`, [LIEN_PROFIL]);
    expect(text).toBe(`T\n\nx\n\n--\nVoir ${LIEN_PROFIL} et ${PIEGE}`);
  });

  // (c)
  it("(c) sans liensAutorises : aucun lien du pied n'est cliquable", () => {
    const { html } = rendre(`Voir ${LIEN_PROFIL} et ${PIEGE}`);
    expect(balisesA(html)).toHaveLength(0);
    expect(html).toContain(`Voir ${LIEN_PROFIL} et ${PIEGE}`);
  });

  // (d)
  it("(d) liensAutorises vide : aucun lien cliquable, meme resultat que sans la propriete", () => {
    const sans = rendre(`Voir ${LIEN_PROFIL} et ${PIEGE}`);
    const vide = rendre(`Voir ${LIEN_PROFIL} et ${PIEGE}`, []);
    expect(balisesA(vide.html)).toHaveLength(0);
    expect(vide.html).toBe(sans.html);
    expect(vide.text).toBe(sans.text);
  });

  it("(d) liensAutorises contenant une chaine vide : aucun lien, aucune erreur", () => {
    const { html } = rendre(`Voir ${PIEGE}`, [""]);
    expect(balisesA(html)).toHaveLength(0);
  });

  // (e)
  it("(e) URL autorisee avec & \" < > ' : href echappe, texte du lien echappe, aucun caractere brut", () => {
    const speciale = `https://app.test/p?a=1&b="x"<y>'z`;
    const echappee = "https://app.test/p?a=1&amp;b=&quot;x&quot;&lt;y&gt;&#39;z";
    const { html } = rendre(`Lien : ${speciale}`, [speciale]);

    expect(hrefs(html)).toStrictEqual([echappee]);
    expect(html).toContain(`<a href="${echappee}"`);
    expect(html).toContain(`>${echappee}</a>`);
    // Rien de brut : ni guillemet qui fermerait l'attribut, ni balise ouverte.
    expect(html).not.toContain(speciale);
    expect(html).not.toContain('"x"');
    expect(html).not.toContain("<y>");
  });

  it("(e) URL autorisee qui tente de sortir de l'attribut href : reste dans l'attribut, rien ne s'injecte", () => {
    const piege = 'https://app.test/"onmouseover="alert(1)"><script>alert(2)</script>';
    const { html } = rendre(`Voir ${piege} fin`, [piege]);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('"onmouseover=');
    // Une seule balise <a>, avec un seul attribut href (pas d'attribut ajoute).
    const [balise] = balisesA(html);
    expect(balisesA(html)).toHaveLength(1);
    expect(balise.match(/\b[a-z-]+="/gi)).toStrictEqual(['href="', 'style="']);
  });

  it("(e) une URL non listee mais piegee ne devient jamais cliquable ni ne s'injecte", () => {
    const piege = 'https://x.fr/"onmouseover="alert(1)"><script>alert(2)</script>';
    const { html } = rendre(`Voir ${piege} fin`, [LIEN_PROFIL]);
    expect(balisesA(html)).toHaveLength(0);
    expect(html).not.toMatch(/<script/i);
  });

  it("javascript: et data: ne sont jamais cliquables, meme listes", () => {
    const { html } = rendre("javascript:alert(1) data:text/html,x", [
      "javascript:alert(1)",
      "data:text/html,x",
    ]);
    expect(balisesA(html)).toHaveLength(0);
  });
});

describe("mails de notification : un nom saisi par un utilisateur n'est jamais un lien", () => {
  const maintenant = new Date("2026-10-22T00:00:00Z");

  // Les trois modeles de notification, avec le meme nom de colocation.
  const rendus = (nomColocation: string) => ({
    emailBienvenue: emailBienvenue({ nomColocation, lien: LIEN, lienProfil: LIEN_PROFIL }),
    emailDepense: emailDepense({
      auteur: "Alice",
      description: "Courses",
      montant: 10,
      nomColocation,
      remboursements: [{ versNom: "Bob", montant: 5 }],
      lien: LIEN,
      lienProfil: LIEN_PROFIL,
    }),
    emailRappelTache: emailRappelTache({
      titre: "Poubelles",
      nomColocation,
      echeance: maintenant,
      lien: LIEN,
      lienProfil: LIEN_PROFIL,
    }),
  });

  const NOMS_PIEGES = [
    PIEGE,
    `${PIEGE}/connexion`,
    `Ma coloc ${PIEGE} (cliquez ici)`,
    `Ma coloc ${PIEGE}.`,
    "http://site-piege.example",
    `${PIEGE}?a=1&b=2`,
    `${PIEGE}" onclick="alert(1)`,
  ];

  // (b)
  const MODELES = ["emailBienvenue", "emailDepense", "emailRappelTache"] as const;
  for (const nomModele of MODELES) {
    describe(nomModele, () => {
      it.each(NOMS_PIEGES)(
        "(b) nom de colocation %j : aucune balise <a> ni aucun href vers site-piege",
        (nom) => {
          const { html } = rendus(nom)[nomModele];
          expect(html).not.toMatch(/href="[^"]*site-piege/i);
          for (const balise of balisesA(html)) {
            expect(balise).not.toContain("site-piege");
          }
          // Le seul texte qui suit un <a> est le sien : aucun lien ne contient le piege.
          expect(html).not.toMatch(/<a\b[^>]*>[^<]*site-piege/i);
        }
      );

      it("(b) nom de colocation egal a une URL : les seuls liens sont le bouton (2 fois) et le profil", () => {
        const { html } = rendus(PIEGE)[nomModele];
        expect(hrefs(html)).toStrictEqual([LIEN, LIEN, LIEN_PROFIL]);
      });

      it("(b) le lienProfil, lui, reste cliquable, avec un nom normal comme avec un nom piege", () => {
        for (const nom of ["Les Lilas", PIEGE]) {
          const { html } = rendus(nom)[nomModele];
          expect(html).toContain(`<a href="${LIEN_PROFIL}"`);
        }
      });

      it("(b) le nom piege reste visible comme texte dans le HTML (rien n'est supprime)", () => {
        const { html, text } = rendus(PIEGE)[nomModele];
        expect(html).toContain(PIEGE);
        expect(text).toContain(PIEGE);
      });
    });
  }

  it("(b) le nom piege dans le pied : texte simple, juste avant le point de la phrase", () => {
    const { html } = emailBienvenue({ nomColocation: PIEGE, lien: LIEN, lienProfil: LIEN_PROFIL });
    expect(html).toContain(`fais partie de la colocation ${PIEGE}. Tu peux`);
  });

  it("(b) autres champs saisis par un utilisateur (auteur, description, titre, nom du creancier) : jamais un lien", () => {
    const depense = emailDepense({
      auteur: PIEGE,
      description: `${PIEGE}/description`,
      montant: 10,
      nomColocation: "Les Lilas",
      remboursements: [{ versNom: `${PIEGE}/bob`, montant: 5 }],
      lien: LIEN,
      lienProfil: LIEN_PROFIL,
    });
    const rappel = emailRappelTache({
      titre: `${PIEGE}/titre`,
      nomColocation: "Les Lilas",
      echeance: maintenant,
      lien: LIEN,
      lienProfil: LIEN_PROFIL,
    });
    for (const { html } of [depense, rappel]) {
      expect(html).not.toMatch(/href="[^"]*site-piege/i);
      expect(hrefs(html)).toStrictEqual([LIEN, LIEN, LIEN_PROFIL]);
    }
  });

  it("(b) nom avec balise et URL melangees : echappe, et aucun lien vers le piege", () => {
    const nom = `<a href="${PIEGE}">clique</a>`;
    const { html } = emailBienvenue({ nomColocation: nom, lien: LIEN, lienProfil: LIEN_PROFIL });
    expect(html).not.toContain(nom);
    expect(hrefs(html)).toStrictEqual([LIEN, LIEN, LIEN_PROFIL]);
  });

  it("mails normaux : exactement 3 liens (bouton, son lien de secours, profil)", () => {
    for (const { html } of Object.values(rendus("Les Lilas"))) {
      expect(hrefs(html)).toStrictEqual([LIEN, LIEN, LIEN_PROFIL]);
    }
  });

  // (f)
  describe("(f) nom de colocation qui contient l'URL du profil", () => {
    it("nom egal a l'URL du profil : l'occurrence dans le nom n'est PAS cliquable (le point final la rend differente)", () => {
      // Dans le pied, le nom est suivi de ". Tu peux..." : la detection
      // attrape « https://app.test/profil. » (point compris), ce qui n'est pas
      // l'URL autorisee. Seule l'occurrence finale, voulue, est un lien.
      for (const { html } of Object.values(rendus(LIEN_PROFIL))) {
        expect(hrefs(html)).toStrictEqual([LIEN, LIEN, LIEN_PROFIL]);
        expect(html).toContain(`fais partie de la colocation ${LIEN_PROFIL}. Tu peux`);
      }
    });

    it("nom « <URL du profil> » suivi d'un espace : l'occurrence dans le nom DEVIENT cliquable (comportement actuel)", () => {
      // Le nom n'est pas nettoye (trim) avant d'entrer dans le pied. Avec un
      // espace apres l'URL, la detection s'arrete avant le point et trouve
      // exactement l'URL autorisee : un deuxieme lien apparait dans le pied.
      // Pas un trou de securite, car c'est le VRAI lien du profil et jamais
      // une adresse choisie par l'utilisateur, mais le nom d'une colocation
      // peut donc produire un lien cliquable.
      for (const { html } of Object.values(rendus(`${LIEN_PROFIL} `))) {
        expect(hrefs(html)).toStrictEqual([LIEN, LIEN, LIEN_PROFIL, LIEN_PROFIL]);
      }
    });

    it("nom « Ma coloc <URL du profil> top » : l'URL au milieu du nom devient cliquable, vers le vrai profil seulement", () => {
      for (const { html } of Object.values(rendus(`Ma coloc ${LIEN_PROFIL} top`))) {
        expect(hrefs(html)).toStrictEqual([LIEN, LIEN, LIEN_PROFIL, LIEN_PROFIL]);
      }
    });

    it("invariant de securite : quel que soit le nom, tout href du mail est le bouton ou le profil", () => {
      const noms = [
        LIEN_PROFIL,
        `${LIEN_PROFIL} `,
        `Ma coloc ${LIEN_PROFIL} top`,
        `${LIEN_PROFIL}/../admin `,
        `${LIEN_PROFIL}?x=1 `,
        `${PIEGE} ${LIEN_PROFIL} ${PIEGE} `,
        `x${LIEN_PROFIL} `,
      ];
      for (const nom of noms) {
        for (const { html } of Object.values(rendus(nom))) {
          for (const href of hrefs(html)) {
            expect([LIEN, LIEN_PROFIL], `nom ${JSON.stringify(nom)}`).toContain(href);
          }
        }
      }
    });

    it("nom qui prolonge l'URL du profil (« .../profil/admin ») : jamais cliquable", () => {
      const { html } = emailBienvenue({
        nomColocation: `${LIEN_PROFIL}/admin `,
        lien: LIEN,
        lienProfil: LIEN_PROFIL,
      });
      expect(hrefs(html)).toStrictEqual([LIEN, LIEN, LIEN_PROFIL]);
    });
  });

  it("lienProfil avec caracteres speciaux (& \" < >) dans un mail reel : href echappe, un seul lien de profil", () => {
    const profil = `https://app.test/profil?a=1&b="2"<3>`;
    const echappe = "https://app.test/profil?a=1&amp;b=&quot;2&quot;&lt;3&gt;";
    const { html } = emailBienvenue({ nomColocation: "Les Lilas", lien: LIEN, lienProfil: profil });
    expect(hrefs(html)).toStrictEqual([LIEN, LIEN, echappe]);
    expect(html).not.toContain('"2"');
    expect(html).not.toContain("<3>");
  });
});

// (g)
describe("(g) mails de securite : le lien principal reste un bouton cliquable", () => {
  const securite = [
    ["emailMotDePasse", () => emailMotDePasse({ lien: LIEN, dureeMinutes: 60 })],
    ["emailCompteExterne (google)", () => emailCompteExterne({ provider: "google", lien: LIEN })],
    ["emailCompteExterne (github)", () => emailCompteExterne({ provider: "github", lien: LIEN })],
  ] as const;

  it.each(securite)("%s : le bouton et son lien de secours pointent vers le lien", (_nom, rendre) => {
    const { html } = rendre();
    expect(hrefs(html)).toStrictEqual([LIEN, LIEN]);
    expect(html).toContain(`<a href="${LIEN}" style="display:inline-block;`);
    expect(html).toContain(`>${LIEN}</a>`);
  });

  it.each(securite)("%s : toujours pas de pied de notification", (_nom, rendre) => {
    const { html, text } = rendre();
    expect(html).not.toContain("margin:16px 0 0 0");
    expect(html).not.toContain("Tu reçois cet email");
    expect(text).not.toContain("\n--\n");
  });

  it("emailMotDePasse : lien avec parametres (& et %) correctement echappe dans le href", () => {
    const lien = "https://app.test/reinitialiser-mot-de-passe?token=ab%2Bc&x=1";
    const { html } = emailMotDePasse({ lien, dureeMinutes: 60 });
    const echappe = "https://app.test/reinitialiser-mot-de-passe?token=ab%2Bc&amp;x=1";
    expect(hrefs(html)).toStrictEqual([echappe, echappe]);
  });

  it("emailCompteExterne : un fournisseur qui est une URL n'ajoute aucun lien (texte echappe seulement)", () => {
    const { html } = emailCompteExterne({ provider: PIEGE, lien: LIEN });
    expect(hrefs(html)).toStrictEqual([LIEN, LIEN]);
    expect(html).not.toMatch(/href="[^"]*site-piege/i);
  });

  it("les mails de securite n'utilisent pas liensAutorises : leur nombre de liens ne depend d'aucune donnee saisie", () => {
    const a = emailMotDePasse({ lien: LIEN, dureeMinutes: 1 });
    const b = emailMotDePasse({ lien: LIEN, dureeMinutes: 9999 });
    expect(hrefs(a.html)).toStrictEqual(hrefs(b.html));
  });
});

// ---------------------------------------------------------------------------
// emailColocationVidee (et formaterDateSansJour, non exporte : teste via le mail)
// ---------------------------------------------------------------------------

describe("emailColocationVidee", () => {
  const LIEN_REJOINDRE = "https://app.test/colocations/rejoindre";
  const SUPPRESSION = new Date("2026-11-29T00:00:00Z");

  const base = {
    nomColocation: "Les Lilas",
    suppressionPrevueLe: SUPPRESSION,
    codeInvitation: "AB12CD34",
    lien: LIEN_REJOINDRE,
  };
  const rendre = (surcharge: Partial<typeof base> = {}) =>
    emailColocationVidee({ ...base, ...surcharge });

  // Liste des balises HTML (ouvrantes, fermantes, doctype) dans l'ordre. Une
  // donnee saisie ne doit JAMAIS changer cette liste : sinon elle a ajoute,
  // retire ou modifie une balise, donc elle a ete interpretee comme du HTML.
  const balises = (html: string) => html.match(/<[^>]*>/g) ?? [];
  // Compte les attributs href des VRAIES balises : un nom echappe peut contenir
  // le texte « href= » sans que ce soit un lien (ex. &lt;a href=...).
  const nbHref = (html: string) => balises(html).filter((b) => /\shref=/.test(b)).length;

  // ----- Contenu nominal ----------------------------------------------------

  describe("contenu nominal", () => {
    const mail = rendre();

    it("sujet exact, avec le nom de la colocation", () => {
      expect(mail.subject).toBe("RoomFlow : la colocation Les Lilas n'a plus de membre");
    });

    it("le HTML contient le nom (en gras), la date, le code et le lien", () => {
      expect(mail.html).toContain("<strong>Les Lilas</strong>");
      expect(mail.html).toContain("<strong>le 29 novembre 2026</strong>");
      expect(mail.html).toContain("AB12CD34");
      expect(mail.html).toContain(`href="${LIEN_REJOINDRE}"`);
      expect(mail.html).toContain("Rejoindre la colocation");
    });

    it("le titre (h1 et <title>) reprend le nom, apostrophe echappee", () => {
      const titre = "La colocation Les Lilas n&#39;a plus de membre";
      expect(mail.html).toContain(`<title>${titre}</title>`);
      expect(mail.html).toContain(`>${titre}</h1>`);
    });

    it("version texte brut exacte", () => {
      expect(mail.text).toBe(
        [
          "La colocation Les Lilas n'a plus de membre",
          "",
          "Tu es la dernière personne à avoir quitté la colocation Les Lilas : elle n'a plus aucun membre.",
          "Si personne ne la rejoint, elle sera supprimée définitivement le 29 novembre 2026, avec ses données (dépenses, tâches, courses et remboursements).",
          "Pour la garder, il suffit de la rejoindre avant cette date avec le code d'invitation AB12CD34.",
          "",
          `Rejoindre la colocation : ${LIEN_REJOINDRE}`,
          "",
          "Si tu ne souhaites pas la garder, tu n'as rien à faire.",
          "",
          "--",
          "Tu reçois cet email car tu viens de quitter la colocation Les Lilas. Il concerne la suppression de données : il est envoyé même si tu as désactivé les notifications.",
        ].join("\n")
      );
    });

    it("le texte brut contient nom, date, code et lien", () => {
      expect(mail.text).toContain("Les Lilas");
      expect(mail.text).toContain("le 29 novembre 2026");
      expect(mail.text).toContain("AB12CD34");
      expect(mail.text).toContain(LIEN_REJOINDRE);
    });

    it("le HTML dit que les donnees seront supprimees (depenses, taches, courses, remboursements)", () => {
      expect(mail.html).toContain("supprimée définitivement");
      expect(mail.html).toContain("(dépenses, tâches, courses et remboursements)");
    });

    it("liens : exactement le bouton et son lien de secours, tous deux vers le lien fourni", () => {
      expect(hrefs(mail.html)).toStrictEqual([LIEN_REJOINDRE, LIEN_REJOINDRE]);
      expect(nbHref(mail.html)).toBe(2);
    });

    it("structure : document HTML complet en francais", () => {
      expect(mail.html.startsWith("<!DOCTYPE html>")).toBe(true);
      expect(mail.html).toContain('<html lang="fr">');
      expect(mail.html.endsWith("</html>")).toBe(true);
    });
  });

  // ----- Date (formaterDateSansJour) ---------------------------------------

  describe("date de suppression", () => {
    const dateDansMail = (iso: string) => rendre({ suppressionPrevueLe: new Date(iso) });

    it.each([
      ["2026-01-15T12:00:00Z", "le 15 janvier 2026"],
      ["2026-02-15T12:00:00Z", "le 15 février 2026"],
      ["2026-03-15T12:00:00Z", "le 15 mars 2026"],
      ["2026-04-15T12:00:00Z", "le 15 avril 2026"],
      ["2026-05-15T12:00:00Z", "le 15 mai 2026"],
      ["2026-06-15T12:00:00Z", "le 15 juin 2026"],
      ["2026-07-15T12:00:00Z", "le 15 juillet 2026"],
      ["2026-08-15T12:00:00Z", "le 15 août 2026"],
      ["2026-09-15T12:00:00Z", "le 15 septembre 2026"],
      ["2026-10-15T12:00:00Z", "le 15 octobre 2026"],
      ["2026-11-15T12:00:00Z", "le 15 novembre 2026"],
      ["2026-12-15T12:00:00Z", "le 15 décembre 2026"],
    ])("%s => %s (HTML et texte), accents conserves", (iso, attendu) => {
      const m = dateDansMail(iso);
      expect(m.html).toContain(`<strong>${attendu}</strong>`);
      expect(m.text).toContain(`supprimée définitivement ${attendu}, avec`);
    });

    it("pas de jour de la semaine : « le 29 novembre 2026 », pas « dimanche 29 ... »", () => {
      const m = dateDansMail("2026-11-29T00:00:00Z");
      expect(m.text).not.toMatch(/dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi/);
    });

    it("23:30Z le 31 decembre : reste le 31 decembre (affichage en UTC)", () => {
      const m = dateDansMail("2026-12-31T23:30:00Z");
      expect(m.text).toContain("le 31 décembre 2026");
      expect(m.text).not.toContain("janvier");
    });

    it("23:59:59.999Z le 31 decembre : reste le 31 decembre", () => {
      expect(dateDansMail("2026-12-31T23:59:59.999Z").text).toContain("le 31 décembre 2026");
    });

    it("00:00Z le 1er janvier : bascule au 1er janvier de l'annee suivante", () => {
      // Comportement reel : Intl fr-FR affiche « 1 janvier », sans « er ».
      // Typographiquement le francais attend « 1er janvier » (ecart signale
      // dans le rapport, a ne pas confondre avec un bug de fuseau).
      const m = dateDansMail("2027-01-01T00:00:00Z");
      expect(m.text).toContain("le 1 janvier 2027");
      expect(m.text).not.toContain("décembre");
    });

    it("jour de fin de mois bissextile : 29 fevrier 2028, et 28 fevrier 2026", () => {
      expect(dateDansMail("2028-02-29T10:00:00Z").text).toContain("le 29 février 2028");
      expect(dateDansMail("2026-02-28T10:00:00Z").text).toContain("le 28 février 2026");
    });

    it("l'heure n'influence pas la date tant qu'on reste dans la meme journee UTC", () => {
      const a = dateDansMail("2026-06-10T00:00:00Z");
      const b = dateDansMail("2026-06-10T23:59:59Z");
      expect(a.html).toBe(b.html);
      expect(a.text).toBe(b.text);
    });

    it("date invalide (new Date('pas une date')) : « une date à venir » sans exception", () => {
      let m: EmailRendu | undefined;
      expect(() => {
        m = dateDansMail("pas une date");
      }).not.toThrow();
      expect(m!.html).toContain("<strong>une date à venir</strong>");
      expect(m!.text).toContain("une date à venir");
      expect(m!.text).not.toContain("NaN");
      expect(m!.html).not.toContain("Invalid");
    });

    it("date invalide (new Date(NaN)) : meme repli, le reste du mail est intact", () => {
      const m = rendre({ suppressionPrevueLe: new Date(NaN) });
      expect(m.text).toContain("supprimée définitivement une date à venir, avec ses données");
      expect(m.text).toContain("AB12CD34");
      expect(m.subject).toBe("RoomFlow : la colocation Les Lilas n'a plus de membre");
    });

    it("date extreme valide (bornes de Date) : pas d'exception", () => {
      expect(() => rendre({ suppressionPrevueLe: new Date(8.64e15) })).not.toThrow();
      expect(() => rendre({ suppressionPrevueLe: new Date(-8.64e15) })).not.toThrow();
      expect(() => rendre({ suppressionPrevueLe: new Date(0) })).not.toThrow();
      expect(rendre({ suppressionPrevueLe: new Date(0) }).text).toContain("le 1 janvier 1970");
    });
  });

  // ----- Echappement HTML ---------------------------------------------------

  describe("echappement HTML du nom de colocation", () => {
    const benin = rendre({ nomColocation: "Coloc" });

    const CHARGES = [
      "<script>alert(1)</script>",
      '"><img src=x onerror=alert(1)>',
      "&",
      "L'appart",
      'Les "Lilas"',
      `Tom & Jerry's "coloc" <3`,
      "</title><script>alert(1)</script>",
      "</strong><script>alert(1)</script>",
      "' onmouseover='alert(1)",
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    ];

    it.each(CHARGES)("%j : jamais de balise brute, la liste des balises ne change pas", (nom) => {
      const { html } = rendre({ nomColocation: nom });
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<img/i);
      // Un nom qui contient < ou " ne ressort jamais tel quel.
      if (/[<"]/.test(nom)) expect(html).not.toContain(nom);
      // Aucune balise ajoutee, retiree ou modifiee par rapport a un nom banal.
      expect(balises(html)).toStrictEqual(balises(benin.html));
    });

    it("attribut onerror= : absent de toute balise du HTML (il ne reste que du texte echappe)", () => {
      const { html } = rendre({ nomColocation: '"><img src=x onerror=alert(1)>' });
      for (const balise of balises(html)) {
        expect(balise).not.toMatch(/onerror/i);
      }
      // Le texte echappe est bien la, et inoffensif (pas de < ni de " ouvrant).
      expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    });

    it("tout « < » du HTML ouvre une balise connue du gabarit (aucune autre balise)", () => {
      const autorisees = new Set(
        balises(benin.html).map((b) => /^<\/?([a-z0-9!]+)/i.exec(b)![1].toLowerCase())
      );
      for (const nom of CHARGES) {
        const { html } = rendre({ nomColocation: nom, codeInvitation: nom });
        for (const b of balises(html)) {
          expect(autorisees.has(/^<\/?([a-z0-9!]+)/i.exec(b)![1].toLowerCase()), `${nom} : ${b}`).toBe(true);
        }
      }
    });

    it("le nom echappe est present a chaque endroit du HTML (titre, <title>, corps, pied)", () => {
      const nom = `Tom & Jerry's "coloc" <3`;
      const echappe = "Tom &amp; Jerry&#39;s &quot;coloc&quot; &lt;3";
      const { html } = rendre({ nomColocation: nom });
      expect(html).toContain(`<title>La colocation ${echappe} n&#39;a plus de membre</title>`);
      expect(html).toContain(`<strong>${echappe}</strong>`);
      expect(html).toContain(`quitter la colocation ${echappe}. Il concerne`);
      // 4 occurrences : <title>, <h1>, corps, pied.
      expect(html.split(echappe)).toHaveLength(5);
    });

    it("version texte brut : le nom reste tel quel (pas d'entites HTML)", () => {
      const nom = `<script>alert(1)</script> & l'amie "Zoe"`;
      const { text } = rendre({ nomColocation: nom });
      expect(text).toContain(`La colocation ${nom} n'a plus de membre`);
      expect(text).toContain(`la colocation ${nom} : elle n'a plus aucun membre.`);
      expect(text).toContain(`quitter la colocation ${nom}. Il concerne`);
      expect(text).not.toContain("&amp;");
      expect(text).not.toContain("&lt;");
      expect(text).not.toContain("&quot;");
    });

    it("le sujet n'est pas du HTML : la charge utile y reste telle quelle", () => {
      const m = rendre({ nomColocation: "<script>alert(1)</script>" });
      expect(m.subject).toBe("RoomFlow : la colocation <script>alert(1)</script> n'a plus de membre");
    });

    it("un nom qui est deja une entite (« &lt; ») est double-echappe, jamais interprete", () => {
      const { html } = rendre({ nomColocation: "&lt;b&gt;" });
      expect(html).toContain("<strong>&amp;lt;b&amp;gt;</strong>");
    });
  });

  describe("echappement HTML du code d'invitation", () => {
    const benin = rendre();

    it.each([
      "<script>alert(1)</script>",
      '"><img src=x onerror=alert(1)>',
      `<b>"A&B"</b>`,
      "x'y",
    ])("code %j : echappe, aucune balise ajoutee", (code) => {
      const { html, text } = rendre({ codeInvitation: code });
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<img/i);
      expect(html).not.toContain("<b>");
      expect(balises(html)).toStrictEqual(balises(benin.html));
      const span = [...html.matchAll(/<span style="([^"]*)">([^<]*)<\/span>/g)];
      expect(span).toHaveLength(1);
      expect(span[0][2]).toBe(echapperHtml(code));
      // Texte brut : le code est garde tel quel.
      expect(text).toContain(`avec le code d'invitation ${code}.`);
    });

    it("le code ne se retrouve ni dans le sujet ni dans le titre", () => {
      const m = rendre({ codeInvitation: "SECRET99" });
      expect(m.subject).not.toContain("SECRET99");
      expect(m.html).not.toMatch(/<(h1|title)>[^<]*SECRET99/);
    });

    it("le code est dans un element monospace, et lui seul", () => {
      const spans = [...benin.html.matchAll(/<span style="([^"]*)">([^<]*)<\/span>/g)];
      expect(spans).toHaveLength(1);
      expect(spans[0][1]).toMatch(/font-family:[^;]*monospace/);
      expect(spans[0][2]).toBe("AB12CD34");
    });
  });

  // ----- Injection d'en-tete -----------------------------------------------

  describe("injection d'en-tete dans le sujet", () => {
    it("nom avec \\r\\nBcc: x@evil.com : aucun \\r ni \\n dans le sujet", () => {
      const m = rendre({ nomColocation: "Mon coloc\r\nBcc: x@evil.com" });
      expect(m.subject).not.toMatch(/[\r\n]/);
      expect(m.subject).toBe("RoomFlow : la colocation Mon coloc Bcc: x@evil.com n'a plus de membre");
    });

    it.each(["\n", "\r", "\r\n", "\t", "\u2028", "\u2029", "\v", "\f"])(
      "separateur %j dans le nom : aplati dans le sujet, rien ne commence une nouvelle ligne",
      (sep) => {
        const m = rendre({ nomColocation: `a${sep}Bcc: x@evil.com${sep}${sep}b` });
        expect(m.subject).not.toMatch(/[\r\n\u2028\u2029]/);
        expect(m.subject).toBe("RoomFlow : la colocation a Bcc: x@evil.com b n'a plus de membre");
      }
    );

    it("nom fait uniquement de retours a la ligne : sujet sur une seule ligne", () => {
      const m = rendre({ nomColocation: "\r\n\r\n\n" });
      expect(m.subject).toBe("RoomFlow : la colocation n'a plus de membre");
    });

    it("l'injection dans le code d'invitation ou le lien ne touche pas le sujet", () => {
      const m = rendre({ codeInvitation: "A\r\nBcc: x@evil.com", lien: "https://x.fr/\r\nBcc: y@evil.com" });
      expect(m.subject).toBe("RoomFlow : la colocation Les Lilas n'a plus de membre");
    });
  });

  // ----- Longueur du sujet --------------------------------------------------

  describe("sujet tres long", () => {
    it("nom de 5000 caracteres : sujet tronque a 90 caracteres avec …, sans exception", () => {
      const nom = "x".repeat(5000);
      let m: EmailRendu | undefined;
      expect(() => {
        m = rendre({ nomColocation: nom });
      }).not.toThrow();
      expect(m!.subject).toHaveLength(90);
      expect(m!.subject.endsWith("…")).toBe(true);
      expect(m!.subject.startsWith("RoomFlow : la colocation xxx")).toBe(true);
      // Seul le sujet est tronque : le corps garde le nom en entier.
      expect(m!.html).toContain(nom);
      expect(m!.text).toContain(`La colocation ${nom} n'a plus de membre`);
    });

    it("sujet de exactement 90 caracteres : pas de troncature ; 91 : tronque", () => {
      // "RoomFlow : la colocation " (25) + nom + " n'a plus de membre" (19)
      const exact = rendre({ nomColocation: "y".repeat(90 - 25 - 19) });
      expect(exact.subject).toHaveLength(90);
      expect(exact.subject.endsWith("membre")).toBe(true);
      const trop = rendre({ nomColocation: "y".repeat(91 - 25 - 19) });
      expect(trop.subject).toHaveLength(90);
      expect(trop.subject.endsWith("…")).toBe(true);
    });

    it("troncature au milieu d'un emoji : le sujet ne doit pas contenir de demi-caractere (surrogate isole)", () => {
      // 25 caracteres de prefixe + 63 « x » = 88, puis des emojis (2 unites
      // UTF-16 chacun) : la coupe a 89 unites tombe entre les deux moities
      // d'un emoji.
      const m = rendre({ nomColocation: `${"x".repeat(63)}${"😀".repeat(50)}` });
      expect(m.subject.isWellFormed()).toBe(true);
    });
  });

  // ----- Cas limites du nom -------------------------------------------------

  describe("nom vide, unicode, URL", () => {
    it("nom vide : pas d'exception, espaces doubles aplatis dans le sujet, <strong> vide dans le corps", () => {
      let m: EmailRendu | undefined;
      expect(() => {
        m = rendre({ nomColocation: "" });
      }).not.toThrow();
      expect(m!.subject).toBe("RoomFlow : la colocation n'a plus de membre");
      expect(m!.html).toContain("<strong></strong>");
      expect(m!.text).toContain("La colocation  n'a plus de membre");
    });

    it("nom d'espaces seuls : meme sujet que le nom vide", () => {
      expect(rendre({ nomColocation: "     " }).subject).toBe(rendre({ nomColocation: "" }).subject);
    });

    it("nom unicode (cyrillique, emoji, accents) conserve partout", () => {
      const nom = "Коммуналка 🏠 Éàü ñ 日本";
      const m = rendre({ nomColocation: nom });
      expect(m.subject).toBe(`RoomFlow : la colocation ${nom} n'a plus de membre`);
      expect(m.html).toContain(`<strong>${nom}</strong>`);
      expect(m.text).toContain(`La colocation ${nom} n'a plus de membre`);
    });

    it("code unicode conserve", () => {
      const m = rendre({ codeInvitation: "Ж-é-🔑" });
      expect(m.html).toContain(">Ж-é-🔑</span>");
      expect(m.text).toContain("Ж-é-🔑");
    });

    it.each([
      PIEGE,
      `${PIEGE}/connexion`,
      `Ma coloc ${PIEGE} (cliquez ici)`,
      "http://site-piege.example",
      `${PIEGE}?a=1&b=2`,
      LIEN_PROFIL,
      LIEN,
    ])("nom qui ressemble a une URL (%j) : aucun lien cliquable en plus du bouton", (nom) => {
      const { html } = rendre({ nomColocation: nom });
      expect(hrefs(html)).toStrictEqual(["https://app.test/colocations/rejoindre", "https://app.test/colocations/rejoindre"]);
      expect(nbHref(html)).toBe(2);
      expect(html).not.toMatch(/href="[^"]*site-piege/i);
    });

    it("code qui ressemble a une URL : pas de lien cliquable non plus", () => {
      const { html } = rendre({ codeInvitation: PIEGE });
      expect(nbHref(html)).toBe(2);
    });

    it("nom contenant une balise <a> : echappee, pas de lien", () => {
      const { html } = rendre({ nomColocation: `<a href="${PIEGE}">clique</a>` });
      expect(nbHref(html)).toBe(2);
      expect(html).not.toMatch(/<a\b[^>]*site-piege/);
    });
  });

  // ----- Lien ---------------------------------------------------------------

  describe("lien", () => {
    it("le lien fourni est echappe dans les href et dans le texte du lien de secours", () => {
      const lien = 'https://app.test/colocations/rejoindre?a=1&b="x"';
      const echappe = "https://app.test/colocations/rejoindre?a=1&amp;b=&quot;x&quot;";
      const { html, text } = rendre({ lien });
      expect(hrefs(html)).toStrictEqual([echappe, echappe]);
      expect(html).not.toContain('"x"');
      expect(text).toContain(`Rejoindre la colocation : ${lien}`);
    });

    it("lien piege avec guillemet et script : reste dans l'attribut href", () => {
      const { html } = rendre({ lien: 'https://app.test/"><script>alert(1)</script>' });
      expect(html).not.toMatch(/<script/i);
      expect(nbHref(html)).toBe(2);
    });
  });

  // ----- Notifications desactivees -----------------------------------------

  describe("mail envoye meme si les notifications sont desactivees", () => {
    const mail = rendre();

    it("le pied le dit explicitement (HTML et texte)", () => {
      expect(mail.text).toContain("il est envoyé même si tu as désactivé les notifications");
      expect(mail.html).toContain("il est envoyé même si tu as désactivé les notifications");
    });

    it("pas de pied de notification classique : ni « désactiver les notifications dans ton profil » ni lien de profil", () => {
      expect(mail.html).not.toContain("Tu peux désactiver");
      expect(mail.text).not.toContain("Tu peux désactiver");
      expect(mail.html).not.toContain("/profil");
      expect(mail.text).not.toContain("/profil");
      expect(mail.html).not.toContain("fais partie de la colocation");
    });

    it("le pied explique pourquoi la personne recoit le mail (elle vient de partir)", () => {
      expect(mail.html).toContain("Tu reçois cet email car tu viens de quitter la colocation Les Lilas.");
    });
  });

  // ----- Donnees affichees --------------------------------------------------

  describe("donnees affichees", () => {
    it("aucune donnee en dehors des 4 parametres : deux mails de parametres differents sont identiques une fois les parametres retires", () => {
      const A = {
        nomColocation: "Zorglub",
        suppressionPrevueLe: new Date("2026-03-05T00:00:00Z"),
        codeInvitation: "AAAA1111",
        lien: "https://a.test/x",
      };
      const B = {
        nomColocation: "Wapiti",
        suppressionPrevueLe: new Date("2027-07-09T00:00:00Z"),
        codeInvitation: "BBBB2222",
        lien: "https://b.test/y",
      };
      const neutre = (texte: string, p: typeof A, date: string) =>
        texte
          .split(p.nomColocation).join("{NOM}")
          .split(p.codeInvitation).join("{CODE}")
          .split(p.lien).join("{LIEN}")
          .split(date).join("{DATE}");
      const a = emailColocationVidee(A);
      const b = emailColocationVidee(B);
      for (const champ of ["subject", "html", "text"] as const) {
        expect(neutre(b[champ], B, "le 9 juillet 2027")).toBe(neutre(a[champ], A, "le 5 mars 2026"));
      }
      // Et les valeurs ont bien ete remplacees (le test n'est pas vide).
      expect(neutre(a.html, A, "le 5 mars 2026")).toContain("{NOM}");
      expect(neutre(a.html, A, "le 5 mars 2026")).toContain("{CODE}");
      expect(neutre(a.html, A, "le 5 mars 2026")).toContain("{LIEN}");
      expect(neutre(a.html, A, "le 5 mars 2026")).toContain("{DATE}");
    });

    it("jamais « undefined », « null », « NaN » ni « [object » dans le mail", () => {
      for (const m of [rendre(), rendre({ suppressionPrevueLe: new Date(NaN) })]) {
        for (const champ of [m.subject, m.html, m.text]) {
          expect(champ).not.toMatch(/undefined|null|NaN|\[object/);
        }
      }
    });

    it("pas d'adresse email dans le mail (aucune donnee personnelle ajoutee)", () => {
      const m = rendre();
      expect(m.html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(m.text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    });
  });

  // ----- Pureté -------------------------------------------------------------

  describe("purete", () => {
    it("deterministe : deux appels avec les memes entrees donnent exactement le meme resultat", () => {
      expect(rendre()).toStrictEqual(rendre());
    });

    it("n'est pas modifie par les appels : parametres gelés acceptes, Date inchangee", () => {
      const date = new Date("2026-11-29T00:00:00Z");
      const avant = date.getTime();
      const params = Object.freeze({
        nomColocation: "Les Lilas",
        suppressionPrevueLe: date,
        codeInvitation: "AB12CD34",
        lien: LIEN_REJOINDRE,
      });
      const m = emailColocationVidee(params);
      expect(date.getTime()).toBe(avant);
      expect(params.nomColocation).toBe("Les Lilas");
      expect(m.text).toContain("le 29 novembre 2026");
    });

    it("renvoie bien les trois champs sous forme de chaines non vides", () => {
      const m = rendre();
      expect(Object.keys(m).sort()).toStrictEqual(["html", "subject", "text"]);
      for (const champ of [m.subject, m.html, m.text]) {
        expect(typeof champ).toBe("string");
        expect(champ.length).toBeGreaterThan(0);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// emailColocationInactive (et formaterDateSansJour, non exporte : teste via le mail)
// ---------------------------------------------------------------------------

describe("emailColocationInactive", () => {
  const LIEN_COLOC = "https://app.test/colocations/abc123";
  const SUPPRESSION = new Date("2026-11-29T00:00:00Z");

  const base = {
    nomColocation: "Les Lilas",
    joursInactivite: 100,
    suppressionPrevueLe: SUPPRESSION,
    lien: LIEN_COLOC,
  };
  const rendre = (surcharge: Partial<typeof base> = {}) =>
    emailColocationInactive({ ...base, ...surcharge });

  // Liste des balises HTML (ouvrantes, fermantes, doctype) dans l'ordre. Une
  // donnee saisie ne doit JAMAIS changer cette liste : sinon elle a ajoute,
  // retire ou modifie une balise, donc elle a ete interpretee comme du HTML.
  const balises = (html: string) => html.match(/<[^>]*>/g) ?? [];
  // Compte les attributs href des VRAIES balises : un nom echappe peut contenir
  // le texte « href= » sans que ce soit un lien.
  const nbHref = (html: string) => balises(html).filter((b) => /\shref=/.test(b)).length;

  const PREFIXE_SUJET = "RoomFlow : la colocation ";
  const SUFFIXE_SUJET = " sera supprimée faute d'activité";

  // ----- Contenu nominal ----------------------------------------------------

  describe("contenu nominal", () => {
    const mail = rendre();

    it("sujet exact, avec le nom de la colocation", () => {
      expect(mail.subject).toBe("RoomFlow : la colocation Les Lilas sera supprimée faute d'activité");
    });

    it("le HTML contient le nom (en gras), la duree, la date et le lien", () => {
      expect(mail.html).toContain("<strong>Les Lilas</strong>");
      expect(mail.html).toContain("depuis environ 100 jours.");
      expect(mail.html).toContain("<strong>le 29 novembre 2026</strong>");
      expect(mail.html).toContain(`href="${LIEN_COLOC}"`);
      expect(mail.html).toContain("Ouvrir la colocation");
    });

    it("le titre (h1 et <title>) reprend le nom", () => {
      const titre = "La colocation Les Lilas est inactive";
      expect(mail.html).toContain(`<title>${titre}</title>`);
      expect(mail.html).toContain(`>${titre}</h1>`);
    });

    it("version texte brut exacte", () => {
      expect(mail.text).toBe(
        [
          "La colocation Les Lilas est inactive",
          "",
          "Personne n'a rien ajouté dans la colocation Les Lilas depuis environ 100 jours.",
          "Sans activité d'ici le 29 novembre 2026, elle sera supprimée définitivement, avec ses données (dépenses, tâches, courses et remboursements).",
          "Pour la garder, il suffit d'y ajouter une dépense, une tâche ou un article de courses (ou d'y revenir avec un nouveau membre).",
          "",
          `Ouvrir la colocation : ${LIEN_COLOC}`,
          "",
          "Si tu ne souhaites pas la garder, tu n'as rien à faire.",
          "",
          "--",
          "Tu reçois cet email car tu fais partie de la colocation Les Lilas. Il concerne la suppression de données : il est envoyé même si tu as désactivé les notifications.",
        ].join("\n")
      );
    });

    it("le texte brut contient nom, duree, date et lien", () => {
      expect(mail.text).toContain("Les Lilas");
      expect(mail.text).toContain("depuis environ 100 jours");
      expect(mail.text).toContain("le 29 novembre 2026");
      expect(mail.text).toContain(LIEN_COLOC);
    });

    it("dit que les donnees seront supprimees definitivement (depenses, taches, courses, remboursements), en HTML et en texte", () => {
      for (const contenu of [mail.html, mail.text]) {
        expect(contenu).toContain("supprimée définitivement");
        expect(contenu).toContain("(dépenses, tâches, courses et remboursements)");
      }
    });

    it("liens : exactement le bouton et son lien de secours, tous deux vers le lien fourni", () => {
      expect(hrefs(mail.html)).toStrictEqual([LIEN_COLOC, LIEN_COLOC]);
      expect(nbHref(mail.html)).toBe(2);
    });

    it("structure : document HTML complet en francais", () => {
      expect(mail.html.startsWith("<!DOCTYPE html>")).toBe(true);
      expect(mail.html).toContain('<html lang="fr">');
      expect(mail.html.endsWith("</html>")).toBe(true);
    });

    it("ne reprend rien du mail de colocation vide (pas de code d'invitation, pas de « dernier membre »)", () => {
      for (const contenu of [mail.html, mail.text, mail.subject]) {
        expect(contenu).not.toContain("code d'invitation");
        expect(contenu).not.toContain("plus aucun membre");
        expect(contenu).not.toContain("dernière personne");
        expect(contenu).not.toContain("viens de quitter");
      }
    });
  });

  // ----- Comment garder la colocation --------------------------------------

  describe("explication pour garder la colocation", () => {
    const mail = rendre();
    const PHRASE = "il suffit d'y ajouter une dépense, une tâche ou un article de courses";

    it("le HTML explique qu'une depense, une tache ou un article de courses suffit", () => {
      expect(mail.html).toContain(PHRASE);
      expect(mail.html).toContain("(ou d'y revenir avec un nouveau membre)");
    });

    it("le texte brut l'explique aussi", () => {
      expect(mail.text).toContain(PHRASE);
      expect(mail.text).toContain("(ou d'y revenir avec un nouveau membre)");
    });

    it("la phrase vient AVANT le bouton, et le message final rassure : rien a faire si on ne la garde pas", () => {
      expect(mail.html.indexOf(PHRASE)).toBeLessThan(mail.html.indexOf("Ouvrir la colocation"));
      expect(mail.html).toContain("Si tu ne souhaites pas la garder, tu n'as rien à faire.");
      expect(mail.text).toContain("Si tu ne souhaites pas la garder, tu n'as rien à faire.");
    });

    it("la date limite est annoncee avec « Sans activité d'ici » (HTML et texte)", () => {
      expect(mail.html).toContain("Sans activité d'ici <strong>le 29 novembre 2026</strong>, elle sera supprimée définitivement");
      expect(mail.text).toContain("Sans activité d'ici le 29 novembre 2026, elle sera supprimée définitivement");
    });
  });

  // ----- Duree d'inactivite -------------------------------------------------

  describe("duree d'inactivite (pluriel, arrondi, valeurs aberrantes)", () => {
    const duree = (jours: number) => rendre({ joursInactivite: jours });

    it.each([
      [0, "0 jour"],
      [1, "1 jour"],
      [2, "2 jours"],
      [3, "3 jours"],
      [30, "30 jours"],
      [90, "90 jours"],
      [100, "100 jours"],
      [365, "365 jours"],
      [3650, "3650 jours"],
    ])("joursInactivite %s => « %s » (HTML et texte)", (jours, attendu) => {
      const m = duree(jours);
      expect(m.html).toContain(`depuis environ ${attendu}.`);
      expect(m.text).toContain(`depuis environ ${attendu}.`);
    });

    it("singulier : « 1 jour », jamais « 1 jours »", () => {
      const m = duree(1);
      expect(m.html).not.toContain("1 jours");
      expect(m.text).not.toContain("1 jours");
    });

    it("pluriel : « 2 jours », jamais « 2 jour. »", () => {
      const m = duree(2);
      expect(m.text).toContain("2 jours.");
      expect(m.text).not.toContain("2 jour.");
    });

    it("zero : « 0 jour » (singulier, comme en francais)", () => {
      const m = duree(0);
      expect(m.text).toContain("depuis environ 0 jour.");
      expect(m.text).not.toContain("0 jours");
    });

    it.each([
      [0.4, "0 jour"],
      [0.5, "1 jour"],
      [1.4, "1 jour"],
      [1.49999, "1 jour"],
      [1.5, "2 jours"],
      [2.5, "3 jours"],
      [89.6, "90 jours"],
    ])("nombre non entier %s : arrondi au plus proche => « %s »", (jours, attendu) => {
      expect(duree(jours).text).toContain(`depuis environ ${attendu}.`);
    });

    it.each([-1, -0.4, -0.6, -90, -1e9, -Infinity])("joursInactivite negatif (%s) : « 0 jour », jamais de nombre negatif", (jours) => {
      const m = duree(jours);
      expect(m.text).toContain("depuis environ 0 jour.");
      expect(m.html).toContain("depuis environ 0 jour.");
      expect(m.text).not.toMatch(/depuis environ -/);
    });

    it("-0 : « 0 jour »", () => {
      expect(duree(-0).text).toContain("depuis environ 0 jour.");
    });

    it.each([
      ["NaN", NaN],
      ["Infinity", Infinity],
    ])("%s : « 0 jour », sans exception et sans le mot %s dans le mail", (nom, jours) => {
      let m: EmailRendu | undefined;
      expect(() => {
        m = duree(jours);
      }).not.toThrow();
      expect(m!.text).toContain("depuis environ 0 jour.");
      expect(m!.html).toContain("depuis environ 0 jour.");
      for (const champ of [m!.subject, m!.html, m!.text]) {
        expect(champ).not.toContain(nom);
      }
    });

    it("tres grand nombre entier sur : ecrit en chiffres, sans separateur ni exception", () => {
      expect(duree(1e9).text).toContain("depuis environ 1000000000 jours.");
      expect(duree(Number.MAX_SAFE_INTEGER).text).toContain("depuis environ 9007199254740991 jours.");
    });

    it("valeur d'un autre type (undefined, null, chaine) : traitee comme non finie, « 0 jour », sans exception", () => {
      for (const mauvais of [undefined, null, "12", {}, []]) {
        let m: EmailRendu | undefined;
        expect(() => {
          m = duree(mauvais as unknown as number);
        }, JSON.stringify(mauvais)).not.toThrow();
        expect(m!.text).toContain("depuis environ 0 jour.");
      }
    });

    it("la duree n'apparait ni dans le sujet ni dans le titre", () => {
      const m = duree(123);
      expect(m.subject).not.toContain("123");
      expect(m.html).not.toMatch(/<(h1|title)>[^<]*123/);
    });

    it("la duree change seulement le paragraphe qui la porte", () => {
      const a = duree(10);
      const b = duree(200);
      expect(b.text.replace("200 jours", "10 jours")).toBe(a.text);
      expect(b.html.replace("200 jours", "10 jours")).toBe(a.html);
      expect(b.subject).toBe(a.subject);
    });
  });

  // ----- Date (formaterDateSansJour) ---------------------------------------

  describe("date de suppression", () => {
    const dateDansMail = (iso: string) => rendre({ suppressionPrevueLe: new Date(iso) });

    it.each([
      ["2026-01-15T12:00:00Z", "le 15 janvier 2026"],
      ["2026-02-15T12:00:00Z", "le 15 février 2026"],
      ["2026-03-15T12:00:00Z", "le 15 mars 2026"],
      ["2026-04-15T12:00:00Z", "le 15 avril 2026"],
      ["2026-05-15T12:00:00Z", "le 15 mai 2026"],
      ["2026-06-15T12:00:00Z", "le 15 juin 2026"],
      ["2026-07-15T12:00:00Z", "le 15 juillet 2026"],
      ["2026-08-15T12:00:00Z", "le 15 août 2026"],
      ["2026-09-15T12:00:00Z", "le 15 septembre 2026"],
      ["2026-10-15T12:00:00Z", "le 15 octobre 2026"],
      ["2026-11-15T12:00:00Z", "le 15 novembre 2026"],
      ["2026-12-15T12:00:00Z", "le 15 décembre 2026"],
    ])("%s => %s (HTML et texte), accents conserves", (iso, attendu) => {
      const m = dateDansMail(iso);
      expect(m.html).toContain(`<strong>${attendu}</strong>`);
      expect(m.text).toContain(`Sans activité d'ici ${attendu}, elle sera`);
    });

    it("pas de jour de la semaine : « le 29 novembre 2026 », pas « dimanche 29 ... »", () => {
      const m = dateDansMail("2026-11-29T00:00:00Z");
      expect(m.text).not.toMatch(/dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi/);
    });

    it("23:30Z le 31 decembre : reste le 31 decembre (affichage en UTC)", () => {
      const m = dateDansMail("2026-12-31T23:30:00Z");
      expect(m.text).toContain("le 31 décembre 2026");
      expect(m.text).not.toContain("janvier");
    });

    it("23:59:59.999Z le 31 decembre : reste le 31 decembre", () => {
      expect(dateDansMail("2026-12-31T23:59:59.999Z").text).toContain("le 31 décembre 2026");
    });

    it("00:00Z le 1er janvier : bascule au 1er janvier de l'annee suivante", () => {
      // Comportement reel : Intl fr-FR affiche « 1 janvier », sans « er ».
      const m = dateDansMail("2027-01-01T00:00:00Z");
      expect(m.text).toContain("le 1 janvier 2027");
      expect(m.text).not.toContain("décembre");
    });

    it("jour de fin de mois bissextile : 29 fevrier 2028, et 28 fevrier 2026", () => {
      expect(dateDansMail("2028-02-29T10:00:00Z").text).toContain("le 29 février 2028");
      expect(dateDansMail("2026-02-28T10:00:00Z").text).toContain("le 28 février 2026");
    });

    it("l'heure n'influence pas la date tant qu'on reste dans la meme journee UTC", () => {
      const a = dateDansMail("2026-06-10T00:00:00Z");
      const b = dateDansMail("2026-06-10T23:59:59Z");
      expect(a.html).toBe(b.html);
      expect(a.text).toBe(b.text);
    });

    it("date invalide (new Date('pas une date')) : « une date à venir » sans exception", () => {
      let m: EmailRendu | undefined;
      expect(() => {
        m = dateDansMail("pas une date");
      }).not.toThrow();
      expect(m!.html).toContain("<strong>une date à venir</strong>");
      expect(m!.text).toContain("Sans activité d'ici une date à venir, elle sera supprimée définitivement");
      expect(m!.text).not.toContain("NaN");
      expect(m!.html).not.toContain("Invalid");
    });

    it("date invalide (new Date(NaN)) : meme repli, le reste du mail est intact", () => {
      const m = rendre({ suppressionPrevueLe: new Date(NaN) });
      expect(m.text).toContain("depuis environ 100 jours");
      expect(m.text).toContain(LIEN_COLOC);
      expect(m.subject).toBe("RoomFlow : la colocation Les Lilas sera supprimée faute d'activité");
    });

    it("date extreme valide (bornes de Date) : pas d'exception", () => {
      expect(() => rendre({ suppressionPrevueLe: new Date(8.64e15) })).not.toThrow();
      expect(() => rendre({ suppressionPrevueLe: new Date(-8.64e15) })).not.toThrow();
      expect(rendre({ suppressionPrevueLe: new Date(0) }).text).toContain("le 1 janvier 1970");
    });

    it("la date n'apparait pas dans le sujet", () => {
      expect(rendre().subject).not.toMatch(/2026|novembre/);
    });
  });

  // ----- Echappement HTML ---------------------------------------------------

  describe("echappement HTML du nom de colocation", () => {
    const benin = rendre({ nomColocation: "Coloc" });

    const CHARGES = [
      "<script>alert(1)</script>",
      '"><img src=x onerror=alert(1)>',
      "&",
      "L'appart",
      'Les "Lilas"',
      `Tom & Jerry's "coloc" <3`,
      "</title><script>alert(1)</script>",
      "</strong><script>alert(1)</script>",
      "' onmouseover='alert(1)",
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    ];

    it.each(CHARGES)("%j : jamais de balise brute, la liste des balises ne change pas", (nom) => {
      const { html } = rendre({ nomColocation: nom });
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<img/i);
      if (/[<"]/.test(nom)) expect(html).not.toContain(nom);
      expect(balises(html)).toStrictEqual(balises(benin.html));
    });

    it.each(CHARGES)("%j : le nombre de « < » et de « > » du HTML est celui d'un nom banal (rien d'ouvert)", (nom) => {
      const { html } = rendre({ nomColocation: nom });
      expect(html.split("<").length).toBe(benin.html.split("<").length);
      expect(html.split(">").length).toBe(benin.html.split(">").length);
    });

    it("attribut onerror= : absent de toute balise du HTML (il ne reste que du texte echappe)", () => {
      const { html } = rendre({ nomColocation: '"><img src=x onerror=alert(1)>' });
      for (const balise of balises(html)) {
        expect(balise).not.toMatch(/onerror/i);
      }
      expect(html).toContain("&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
    });

    it("le nom echappe est present a chaque endroit du HTML (titre, <title>, corps, pied)", () => {
      const nom = `Tom & Jerry's "coloc" <3`;
      const echappe = "Tom &amp; Jerry&#39;s &quot;coloc&quot; &lt;3";
      const { html } = rendre({ nomColocation: nom });
      expect(html).toContain(`<title>La colocation ${echappe} est inactive</title>`);
      expect(html).toContain(`<strong>${echappe}</strong>`);
      expect(html).toContain(`tu fais partie de la colocation ${echappe}. Il concerne`);
      // 4 occurrences : <title>, <h1>, corps, pied.
      expect(html.split(echappe)).toHaveLength(5);
    });

    it("version texte brut : le nom reste tel quel (pas d'entites HTML)", () => {
      const nom = `<script>alert(1)</script> & l'amie "Zoe"`;
      const { text } = rendre({ nomColocation: nom });
      expect(text).toContain(`La colocation ${nom} est inactive`);
      expect(text).toContain(`dans la colocation ${nom} depuis environ`);
      expect(text).toContain(`fais partie de la colocation ${nom}. Il concerne`);
      expect(text).not.toContain("&amp;");
      expect(text).not.toContain("&lt;");
      expect(text).not.toContain("&quot;");
    });

    it("le sujet n'est pas du HTML : la charge utile y reste telle quelle", () => {
      const m = rendre({ nomColocation: "<script>alert(1)</script>" });
      expect(m.subject).toBe(
        "RoomFlow : la colocation <script>alert(1)</script> sera supprimée faute d'activité"
      );
    });

    it("un nom qui est deja une entite (« &lt; ») est double-echappe, jamais interprete", () => {
      const { html } = rendre({ nomColocation: "&lt;b&gt;" });
      expect(html).toContain("<strong>&amp;lt;b&amp;gt;</strong>");
    });

    it("le lien et la duree sont les seuls autres champs : un nom n'ajoute aucun attribut ni aucune balise a la duree ou a la date", () => {
      const { html } = rendre({ nomColocation: '"><b onmouseover=alert(1)>' });
      expect(html).not.toMatch(/<b[\s>]/i);
      expect(html).toContain("<strong>le 29 novembre 2026</strong>");
    });
  });

  // ----- Injection d'en-tete -----------------------------------------------

  describe("injection d'en-tete dans le sujet", () => {
    it("nom avec \\r\\nBcc: x@evil.com : aucun \\r ni \\n dans le sujet", () => {
      const m = rendre({ nomColocation: "Mon coloc\r\nBcc: x@evil.com" });
      expect(m.subject).not.toMatch(/[\r\n]/);
      expect(m.subject).toBe(
        "RoomFlow : la colocation Mon coloc Bcc: x@evil.com sera supprimée faute d'activité"
      );
    });

    it.each(["\n", "\r", "\r\n", "\t", "\u2028", "\u2029", "\v", "\f"])(
      "separateur %j dans le nom : aplati dans le sujet, rien ne commence une nouvelle ligne",
      (sep) => {
        const m = rendre({ nomColocation: `a${sep}Bcc: x@evil.com${sep}${sep}b` });
        expect(m.subject).not.toMatch(/[\r\n\u2028\u2029]/);
        expect(m.subject).toBe(
          "RoomFlow : la colocation a Bcc: x@evil.com b sera supprimée faute d'activité"
        );
      }
    );

    it("retours a la ligne repetes et melanges : un seul espace entre les mots", () => {
      const m = rendre({ nomColocation: "a\r\n\r\n\n \t b" });
      expect(m.subject).toBe("RoomFlow : la colocation a b sera supprimée faute d'activité");
    });

    it("nom fait uniquement de retours a la ligne : sujet sur une seule ligne", () => {
      const m = rendre({ nomColocation: "\r\n\r\n\n" });
      expect(m.subject).toBe("RoomFlow : la colocation sera supprimée faute d'activité");
    });

    it("injection tres tot dans un nom tres long : toujours une seule ligne apres troncature", () => {
      const m = rendre({ nomColocation: `x\r\nBcc: x@evil.com\r\n${"y".repeat(500)}` });
      expect(m.subject).not.toMatch(/[\r\n]/);
      expect(m.subject).toHaveLength(90);
    });

    it("l'injection dans le lien ou dans la duree ne touche pas le sujet", () => {
      const m = rendre({ lien: "https://x.fr/\r\nBcc: y@evil.com", joursInactivite: NaN });
      expect(m.subject).toBe("RoomFlow : la colocation Les Lilas sera supprimée faute d'activité");
    });

    it("texte brut : le nom est recopie tel quel, retours a la ligne compris (c'est un corps de message, pas un en-tete)", () => {
      // Le texte brut est un CORPS de message, pas un en-tete : un retour a la
      // ligne du nom y est inoffensif pour les en-tetes, mais le test fixe le
      // comportement reel (le nom est recopie tel quel).
      const m = rendre({ nomColocation: "Mon\r\nBcc: x@evil.com" });
      expect(m.text.startsWith("La colocation Mon\r\nBcc: x@evil.com est inactive\n")).toBe(true);
    });

    it("durcissement : aucun caractere de controle (NUL, ESC, DEL, NEL U+0085...) ne survit dans le sujet", () => {
      // nettoyerSujet n'aplatit que les espaces (\\s). Les autres caracteres de
      // controle restent. Pas une injection d'en-tete SMTP (seuls CR et LF
      // comptent), mais un nom piege peut y glisser du NUL ou de l'ESC.
      for (const c of ["\u0000", "\u0007", "\u001b", "\u007f", "\u0085", "\u009b"]) {
        const m = rendre({ nomColocation: `a${c}b` });
        expect(m.subject, `caractere U+${c.charCodeAt(0).toString(16).padStart(4, "0")}`).not.toMatch(
          /[\u0000-\u001f\u007f-\u009f]/
        );
      }
    });
  });

  // ----- Longueur du sujet --------------------------------------------------

  describe("sujet tres long", () => {
    it("nom de 5000 caracteres : sujet tronque a 90 caracteres avec …, sans exception", () => {
      const nom = "x".repeat(5000);
      let m: EmailRendu | undefined;
      expect(() => {
        m = rendre({ nomColocation: nom });
      }).not.toThrow();
      expect(m!.subject).toHaveLength(90);
      expect(m!.subject.endsWith("…")).toBe(true);
      expect(m!.subject.startsWith(`${PREFIXE_SUJET}xxx`)).toBe(true);
      // Seul le sujet est tronque : le corps garde le nom en entier.
      expect(m!.html).toContain(nom);
      expect(m!.text).toContain(`La colocation ${nom} est inactive`);
    });

    it("sujet de exactement 90 caracteres : pas de troncature ; 91 : tronque", () => {
      const exact = rendre({ nomColocation: "y".repeat(90 - PREFIXE_SUJET.length - SUFFIXE_SUJET.length) });
      expect(exact.subject).toHaveLength(90);
      expect(exact.subject.endsWith("faute d'activité")).toBe(true);
      expect(exact.subject.endsWith("…")).toBe(false);
      const trop = rendre({ nomColocation: "y".repeat(91 - PREFIXE_SUJET.length - SUFFIXE_SUJET.length) });
      expect(trop.subject).toHaveLength(90);
      expect(trop.subject.endsWith("…")).toBe(true);
    });

    it("les constantes du test sont les bonnes : prefixe 25 caracteres, suffixe 32", () => {
      expect(PREFIXE_SUJET).toHaveLength(25);
      expect(SUFFIXE_SUJET).toHaveLength(32);
    });

    it("troncature au milieu d'un emoji : le sujet ne contient pas de demi-caractere (surrogate isole)", () => {
      // 25 caracteres de prefixe + 63 « x » = 88, puis des emojis (2 unites
      // UTF-16 chacun) : une coupe a 89 unites tomberait entre les deux moities.
      const m = rendre({ nomColocation: `${"x".repeat(63)}${"😀".repeat(50)}` });
      expect(m.subject.isWellFormed()).toBe(true);
      // Coupe par points de code : 90 caracteres visibles, l'emoji entier est garde.
      expect([...m.subject]).toHaveLength(90);
      expect(m.subject.endsWith("😀…")).toBe(true);
    });

    it("emojis partout dans un tres long nom : sujet toujours bien forme", () => {
      for (let decalage = 0; decalage < 4; decalage++) {
        const m = rendre({ nomColocation: `${"x".repeat(60 + decalage)}${"🏠".repeat(80)}` });
        expect(m.subject.isWellFormed(), `decalage ${decalage}`).toBe(true);
        expect([...m.subject].length).toBeLessThanOrEqual(90);
      }
    });
  });

  // ----- Cas limites du nom -------------------------------------------------

  describe("nom vide, unicode, URL", () => {
    it("nom vide : pas d'exception, espaces doubles aplatis dans le sujet, <strong> vide dans le corps", () => {
      let m: EmailRendu | undefined;
      expect(() => {
        m = rendre({ nomColocation: "" });
      }).not.toThrow();
      expect(m!.subject).toBe("RoomFlow : la colocation sera supprimée faute d'activité");
      expect(m!.html).toContain("<strong></strong>");
      expect(m!.text).toContain("La colocation  est inactive");
    });

    it("nom d'espaces seuls : meme sujet que le nom vide", () => {
      expect(rendre({ nomColocation: "     " }).subject).toBe(rendre({ nomColocation: "" }).subject);
    });

    it("nom unicode (cyrillique, emoji, accents) conserve partout", () => {
      const nom = "Коммуналка 🏠 Éàü ñ 日本";
      const m = rendre({ nomColocation: nom });
      expect(m.subject).toBe(`RoomFlow : la colocation ${nom} sera supprimée faute d'activité`);
      expect(m.html).toContain(`<strong>${nom}</strong>`);
      expect(m.text).toContain(`La colocation ${nom} est inactive`);
    });

    it.each([
      PIEGE,
      `${PIEGE}/connexion`,
      `Ma coloc ${PIEGE} (cliquez ici)`,
      "http://site-piege.example",
      `${PIEGE}?a=1&b=2`,
      `${PIEGE} `,
      LIEN_PROFIL,
      `${LIEN_PROFIL} `,
      LIEN,
      "https://app.test/colocations/abc123",
      "https://app.test/colocations/abc123 ",
    ])("nom qui ressemble a une URL (%j) : aucun lien cliquable en plus du bouton", (nom) => {
      const { html } = rendre({ nomColocation: nom });
      expect(hrefs(html)).toStrictEqual([LIEN_COLOC, LIEN_COLOC]);
      expect(nbHref(html)).toBe(2);
      expect(html).not.toMatch(/href="[^"]*site-piege/i);
    });

    it("nom contenant une balise <a> : echappee, pas de lien", () => {
      const { html } = rendre({ nomColocation: `<a href="${PIEGE}">clique</a>` });
      expect(nbHref(html)).toBe(2);
      expect(html).not.toMatch(/<a\b[^>]*site-piege/);
    });

    it("le nom piege reste visible comme texte, rien n'est supprime", () => {
      const { html, text } = rendre({ nomColocation: PIEGE });
      expect(html).toContain(PIEGE);
      expect(text).toContain(PIEGE);
    });
  });

  // ----- Lien ---------------------------------------------------------------

  describe("lien", () => {
    it("le lien fourni est echappe dans les href et dans le texte du lien de secours", () => {
      const lien = 'https://app.test/colocations/abc?a=1&b="x"';
      const echappe = "https://app.test/colocations/abc?a=1&amp;b=&quot;x&quot;";
      const { html, text } = rendre({ lien });
      expect(hrefs(html)).toStrictEqual([echappe, echappe]);
      expect(html).not.toContain('"x"');
      expect(text).toContain(`Ouvrir la colocation : ${lien}`);
    });

    it("lien piege avec guillemet et script : reste dans l'attribut href", () => {
      const { html } = rendre({ lien: 'https://app.test/"><script>alert(1)</script>' });
      expect(html).not.toMatch(/<script/i);
      expect(nbHref(html)).toBe(2);
    });

    it("lien piege avec attribut injecte (« onclick ») : aucun attribut ajoute a la balise <a>", () => {
      const { html } = rendre({ lien: 'https://x.fr/" onclick="alert(1)' });
      // Le texte « onclick= » peut apparaitre DANS la valeur du href (echappee),
      // mais jamais comme un attribut de plus : on compte les vrais attributs.
      const liens = balises(html).filter((b) => /^<a\b/.test(b));
      expect(liens).toHaveLength(2);
      for (const balise of liens) {
        expect(balise.match(/\s[a-z-]+="/gi)?.map((a) => a.trim())).toStrictEqual(['href="', 'style="']);
      }
    });
  });

  // ----- Notifications desactivees -----------------------------------------

  describe("mail envoye meme si les notifications sont desactivees", () => {
    const mail = rendre();

    it("le pied le dit explicitement (HTML et texte)", () => {
      expect(mail.text).toContain("il est envoyé même si tu as désactivé les notifications");
      expect(mail.html).toContain("il est envoyé même si tu as désactivé les notifications");
    });

    it("pas de pied de notification classique : ni « Tu peux désactiver » ni lien de profil", () => {
      expect(mail.html).not.toContain("Tu peux désactiver");
      expect(mail.text).not.toContain("Tu peux désactiver");
      expect(mail.html).not.toContain("/profil");
      expect(mail.text).not.toContain("/profil");
    });

    it("le pied explique pourquoi la personne recoit le mail (elle fait partie de la colocation) et que le mail concerne la suppression de donnees", () => {
      expect(mail.html).toContain("Tu reçois cet email car tu fais partie de la colocation Les Lilas.");
      expect(mail.html).toContain("Il concerne la suppression de données");
      expect(mail.text).toContain("\n--\nTu reçois cet email car tu fais partie de la colocation Les Lilas.");
    });

    it("le pied n'a pas de lien cliquable (aucune URL autorisee)", () => {
      const pied = /margin:16px 0 0 0[^>]*>([\s\S]*?)<\/p>/.exec(mail.html);
      expect(pied).not.toBeNull();
      expect(pied![1]).not.toContain("<a");
    });
  });

  // ----- Donnees affichees --------------------------------------------------

  describe("donnees affichees", () => {
    it("aucune donnee en dehors des 4 parametres : deux mails de parametres differents sont identiques une fois les parametres retires", () => {
      const A = {
        nomColocation: "Zorglub",
        joursInactivite: 100,
        suppressionPrevueLe: new Date("2026-03-05T00:00:00Z"),
        lien: "https://a.test/x",
      };
      const B = {
        nomColocation: "Wapiti",
        joursInactivite: 45,
        suppressionPrevueLe: new Date("2027-07-09T00:00:00Z"),
        lien: "https://b.test/y",
      };
      const neutre = (texte: string, p: typeof A, date: string) =>
        texte
          .split(p.nomColocation).join("{NOM}")
          .split(`${p.joursInactivite} jours`).join("{DUREE}")
          .split(p.lien).join("{LIEN}")
          .split(date).join("{DATE}");
      const a = emailColocationInactive(A);
      const b = emailColocationInactive(B);
      for (const champ of ["subject", "html", "text"] as const) {
        expect(neutre(b[champ], B, "le 9 juillet 2027")).toBe(neutre(a[champ], A, "le 5 mars 2026"));
      }
      // Et les valeurs ont bien ete remplacees (le test n'est pas vide).
      const neutreA = neutre(a.html, A, "le 5 mars 2026");
      for (const marque of ["{NOM}", "{DUREE}", "{LIEN}", "{DATE}"]) {
        expect(neutreA).toContain(marque);
      }
    });

    it("jamais « undefined », « null », « NaN », « Infinity » ni « [object » dans le mail, meme avec des valeurs aberrantes", () => {
      const rendus = [
        rendre(),
        rendre({ suppressionPrevueLe: new Date(NaN) }),
        rendre({ joursInactivite: NaN }),
        rendre({ joursInactivite: Infinity }),
        rendre({ joursInactivite: -Infinity }),
        rendre({ joursInactivite: undefined as unknown as number }),
      ];
      for (const m of rendus) {
        for (const champ of [m.subject, m.html, m.text]) {
          expect(champ).not.toMatch(/undefined|null|NaN|Infinity|\[object/);
        }
      }
    });

    it("pas d'adresse email dans le mail (aucune donnee personnelle ajoutee)", () => {
      const m = rendre();
      expect(m.html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
      expect(m.text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    });

    it("aucun nom de membre, aucun montant, aucun code : le mail ne porte que le nom de la colocation, la duree, la date et le lien", () => {
      const m = rendre();
      expect(m.text).not.toMatch(/€|\d+,\d{2}/);
      expect(m.html).not.toMatch(/€/);
    });
  });

  // ----- Pureté -------------------------------------------------------------

  describe("purete", () => {
    it("deterministe : deux appels avec les memes entrees donnent exactement le meme resultat", () => {
      expect(rendre()).toStrictEqual(rendre());
    });

    it("n'est pas modifie par les appels : parametres geles acceptes, Date inchangee", () => {
      const date = new Date("2026-11-29T00:00:00Z");
      const avant = date.getTime();
      const params = Object.freeze({
        nomColocation: "Les Lilas",
        joursInactivite: 100,
        suppressionPrevueLe: date,
        lien: LIEN_COLOC,
      });
      const m = emailColocationInactive(params);
      expect(date.getTime()).toBe(avant);
      expect(params.nomColocation).toBe("Les Lilas");
      expect(params.joursInactivite).toBe(100);
      expect(m.text).toContain("le 29 novembre 2026");
    });

    it("renvoie bien les trois champs sous forme de chaines non vides", () => {
      const m = rendre();
      expect(Object.keys(m).sort()).toStrictEqual(["html", "subject", "text"]);
      for (const champ of [m.subject, m.html, m.text]) {
        expect(typeof champ).toBe("string");
        expect(champ.length).toBeGreaterThan(0);
      }
    });

    it("n'a pas d'etat cache : un appel avec un nom pieges ne change pas le suivant", () => {
      const avant = rendre();
      rendre({ nomColocation: "<script>alert(1)</script>\r\nBcc: x@evil.com", joursInactivite: NaN });
      expect(rendre()).toStrictEqual(avant);
    });
  });
});
