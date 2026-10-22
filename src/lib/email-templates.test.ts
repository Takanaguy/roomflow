import { describe, expect, it } from "vitest";
import {
  boutonHtml,
  echapperHtml,
  emailBienvenue,
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
