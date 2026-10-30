import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_EMAIL_PAR_DEFAUT,
  DOMAINE_COLOCATAIRES_DEMO,
  emailCompteDemo,
  estAdresseSimple,
  estEmailDemo,
} from "@/lib/demo-email";

// demo-email.ts n'a AUCUN import : pas de base, pas de modele, rien a simuler.
//
// Ces deux fonctions protegent un compte PUBLIC partage : estEmailDemo decide
// qu'une adresse ne recevra jamais d'email (envoyerEmail) et ne pourra pas etre
// reservee a l'inscription. Les tests sont donc volontairement mechants : on
// cherche (1) toute adresse de la demo qui ne serait PAS reconnue comme telle
// (un mail partirait), et (2) toute adresse d'un vrai utilisateur qui serait
// prise pour une adresse de la demo.

// Caracteres "piege" construits par code point : le fichier reste lisible et
// ne depend pas de l'encodage de l'editeur.
const KELVIN = "\u212A"; // signe Kelvin, minuscule ASCII "k" pour toLowerCase()
const CYR_E = "\u0435"; // "\u0435" cyrillique, identique a "e" a l'ecran
const CYR_O = "\u043E"; // "\u043E" cyrillique
const CYR_A = "\u0430"; // "\u0430" cyrillique
const NUL = "\u0000";

const DOMAINE = DOMAINE_COLOCATAIRES_DEMO;

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

describe("constantes de la demo", () => {
  it("l'email par defaut et le domaine des colocataires sont en .invalid (RFC 2606)", () => {
    expect(DEMO_EMAIL_PAR_DEFAUT).toBe("demo@roomflow.invalid");
    expect(DOMAINE).toBe("demo.roomflow.invalid");
    expect(DEMO_EMAIL_PAR_DEFAUT.endsWith(".invalid")).toBe(true);
    expect(DOMAINE.endsWith(".invalid")).toBe(true);
  });

  it("aucun tiret cadratin dans les constantes", () => {
    expect(DEMO_EMAIL_PAR_DEFAUT + DOMAINE).not.toMatch(/[\u2013\u2014]/);
  });
});

// ---------------------------------------------------------------------------
// estEmailDemo
// ---------------------------------------------------------------------------

describe("estEmailDemo : adresses reconnues comme demo", () => {
  it.each([
    ["l'email par defaut", "demo@roomflow.invalid"],
    ["le domaine des colocataires", "lea@demo.roomflow.invalid"],
    ["un autre colocataire fictif", "hugo@demo.roomflow.invalid"],
    ["un nom quelconque sur le domaine fictif", "nimporte.qui+tag@demo.roomflow.invalid"],
    ["majuscules ASCII (email par defaut)", "DEMO@ROOMFLOW.INVALID"],
    ["majuscules ASCII (colocataire)", "Lea@Demo.RoomFlow.Invalid"],
    ["espaces autour", "   demo@roomflow.invalid   "],
    ["espaces autour (colocataire)", "  camille@demo.roomflow.invalid  "],
    ["tabulation autour", "\tdemo@roomflow.invalid\t"],
  ])("vrai pour %s", (_nom, email) => {
    expect(estEmailDemo(email)).toBe(true);
  });

  it("l'email par defaut est reconnu quand on ne passe pas le 2e argument", () => {
    expect(estEmailDemo(DEMO_EMAIL_PAR_DEFAUT)).toBe(true);
  });

  it("l'email par defaut est reconnu quand on passe explicitement undefined", () => {
    expect(estEmailDemo(DEMO_EMAIL_PAR_DEFAUT, undefined)).toBe(true);
  });
});

describe("estEmailDemo : adresses qui NE doivent PAS etre prises pour la demo", () => {
  it.each([
    ["sous-domaine pose avant le domaine", "a@evil.demo.roomflow.invalid"],
    ["domaine suivi d'un autre domaine", "a@demo.roomflow.invalid.evil.com"],
    ["domaine precede d'une lettre", "a@xdemo.roomflow.invalid"],
    ["domaine puis @ puis autre domaine", "a@demo.roomflow.invalid@evil.com"],
    ["email par defaut suivi d'un domaine", "demo@roomflow.invalid.evil.com"],
    ["email par defaut suivi de @", "demo@roomflow.invalid@evil.com"],
    ["nom colle a l'email par defaut", "xdemo@roomflow.invalid"],
    ["vrai TLD voisin", "demo@roomflow.invalidd"],
    ["vrai domaine .com", "demo@roomflow.com"],
    ["vrai domaine .fr", "demo@roomflow.fr"],
    ["domaine fictif dans la partie locale", "demo.roomflow.invalid@gmail.com"],
    ["partie locale = domaine fictif, vrai domaine", "x@demo.roomflow.invalid.gmail.com"],
    ["email d'un vrai utilisateur", "tanguy@gmail.com"],
    ["autre vrai utilisateur", "alice.martin@hotmail.fr"],
    ["domaine sans le sous-domaine demo", "lea@roomflow.invalid"],
    ["domaine .invalid generique", "lea@exemple.invalid"],
  ])("faux pour %s", (_nom, email) => {
    expect(estEmailDemo(email)).toBe(false);
  });

  it("faux pour un signe Kelvin (U+212A) quand l'adresse perso contient un k", () => {
    // toLowerCase() Unicode ramenerait KELVIN sur "k" : adresse personnalisee
    // avec un k, comparee a la meme adresse ecrite avec le signe Kelvin.
    expect(estEmailDemo(`${KELVIN}evin@exemple.fr`, "kevin@exemple.fr")).toBe(false);
    expect(estEmailDemo("kevin@exemple.fr", `${KELVIN}evin@exemple.fr`)).toBe(false);
    // Controle : le vrai k, lui, est reconnu (y compris en majuscule).
    expect(estEmailDemo("KEVIN@EXEMPLE.FR", "kevin@exemple.fr")).toBe(true);
  });

  it("faux pour des homoglyphes cyrilliques dans le domaine", () => {
    expect(estEmailDemo(`a@d${CYR_E}mo.roomflow.invalid`)).toBe(false);
    expect(estEmailDemo(`a@demo.ro${CYR_O}mflow.invalid`)).toBe(false);
    expect(estEmailDemo(`a@demo.roomflow.inv${CYR_A}lid`)).toBe(false);
    expect(estEmailDemo(`d${CYR_E}mo@roomflow.invalid`)).toBe(false);
    expect(estEmailDemo(`demo@r${CYR_O}${CYR_O}mflow.invalid`)).toBe(false);
  });

  it("faux pour des lettres pleine chasse (fullwidth) dans le domaine", () => {
    expect(estEmailDemo("a@\uFF44\uFF45\uFF4D\uFF4F.roomflow.invalid")).toBe(false);
  });

  it("une majuscule Unicode (I point en chef) ne devient pas un i ASCII", () => {
    expect(estEmailDemo("a@demo.roomflow.\u0130nvalid")).toBe(false);
  });

  it("faux pour une chaine vide ou faite d'espaces", () => {
    expect(estEmailDemo("")).toBe(false);
    expect(estEmailDemo("   ")).toBe(false);
    expect(estEmailDemo("\t\n ")).toBe(false);
  });

  it("faux pour un vrai utilisateur qui se termine par un retour a la ligne ou un NUL", () => {
    expect(estEmailDemo("tanguy@gmail.com\n")).toBe(false);
    expect(estEmailDemo("tanguy@gmail.com\r\n")).toBe(false);
    expect(estEmailDemo(`tanguy@gmail.com${NUL}`)).toBe(false);
    expect(estEmailDemo(`${NUL}tanguy@gmail.com`)).toBe(false);
  });
});

describe("estEmailDemo : valeurs qui ne sont pas des chaines", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["un nombre", 42],
    ["NaN", Number.NaN],
    ["un booleen", true],
    ["un objet vide", {}],
    ["un tableau vide", []],
    ["un tableau qui contient l'email demo", ["demo@roomflow.invalid"]],
    ["un objet dont toString rend l'email demo", { toString: () => "demo@roomflow.invalid" }],
    ["un objet String", new String("demo@roomflow.invalid")],
    ["un symbole", Symbol("demo@roomflow.invalid")],
    ["un bigint", BigInt(1)],
    ["une fonction", () => "demo@roomflow.invalid"],
  ])("faux pour %s, sans lever d'exception", (_nom, valeur) => {
    expect(() => estEmailDemo(valeur)).not.toThrow();
    expect(estEmailDemo(valeur)).toBe(false);
  });
});

// Decision de l'equipe : estEmailDemo sert a BLOQUER (envoi d'emails, inscription).
// Mieux vaut sur-bloquer que laisser passer. trim() retire donc espaces,
// tabulations et retours a la ligne (\n, \r) en DEBUT et en FIN : l'adresse est
// alors reconnue comme demo (vrai). C'est le comportement voulu.
describe("estEmailDemo : espaces et retours a la ligne en bordure (ignores, donc vrai)", () => {
  it.each([
    ["retour a la ligne final", "demo@roomflow.invalid\n"],
    ["retour chariot + saut de ligne final", "lea@demo.roomflow.invalid\r\n"],
    ["espace initial et CRLF final", " demo@roomflow.invalid\r\n"],
    ["retour a la ligne initial", "\nlea@demo.roomflow.invalid"],
    ["tabulations et sauts de ligne des deux cotes", "\t\nhugo@demo.roomflow.invalid\n\t"],
  ])("vrai pour %s", (_nom, email) => {
    expect(estEmailDemo(email)).toBe(true);
  });

  it("le NUL n'est PAS retire par trim() : un NUL final casse la reconnaissance (faux)", () => {
    expect(estEmailDemo(`demo@roomflow.invalid${NUL}`)).toBe(false);
    expect(estEmailDemo(`lea@demo.roomflow.invalid${NUL}`)).toBe(false);
    expect(estEmailDemo(`${NUL}demo@roomflow.invalid`)).toBe(false);
  });
});

// Ces cas sont des adresses qui se TERMINENT par le domaine fictif mais
// contiennent un caractere de controle AU MILIEU (ou un NUL en bordure de la
// partie locale). Attendu par la consigne : faux (pas une adresse valable). Le
// code actuel ne controle que la fin de chaine (endsWith) : il repond VRAI. Ces
// tests echouent donc volontairement, voir le rapport. Le sens est SUR pour
// l'envoi (sur-blocage), mais le garde-fou est plus laxiste que la consigne.
describe("estEmailDemo : caracteres de controle au milieu de l'adresse", () => {
  it.each([
    ["retour a la ligne au milieu de la partie locale", "le\na@demo.roomflow.invalid"],
    ["retour a la ligne avant le domaine", "tanguy@gmail.com\n@demo.roomflow.invalid"],
    ["NUL dans la partie locale", `le${NUL}a@demo.roomflow.invalid`],
    ["NUL en tete de la partie locale", `${NUL}lea@demo.roomflow.invalid`],
    ["NUL avant le domaine", `tanguy@gmail.com${NUL}@demo.roomflow.invalid`],
  ])("faux pour %s", (_nom, email) => {
    expect(estEmailDemo(email)).toBe(false);
  });
});

// Ces cas montrent ce que le code fait REELLEMENT aujourd'hui sur des formes
// d'adresse non strictes. Ils ne sont pas des exigences : si le code devient
// plus strict, ce bloc est a mettre a jour. Ils sont la pour que l'ecart soit
// visible (voir le rapport) : un destinataire ecrit autrement que
// "xxx@domaine" echappe au garde-fou, meme si le TLD .invalid garantit que rien
// n'est livrable.
describe("estEmailDemo : formes non strictes (comportement actuel, a connaitre)", () => {
  it("un point final (FQDN absolu) echappe au garde-fou", () => {
    expect(estEmailDemo("lea@demo.roomflow.invalid.")).toBe(false);
  });

  it("une adresse avec nom affiche echappe au garde-fou", () => {
    expect(estEmailDemo("Lea <lea@demo.roomflow.invalid>")).toBe(false);
  });

  it("une liste d'adresses n'est jamais une adresse demo, dans aucun ordre (elle est refusee en amont par estAdresseSimple)", () => {
    expect(estEmailDemo("tanguy@gmail.com,lea@demo.roomflow.invalid")).toBe(false);
    expect(estEmailDemo("lea@demo.roomflow.invalid,tanguy@gmail.com")).toBe(false);
    expect(estAdresseSimple("tanguy@gmail.com,lea@demo.roomflow.invalid")).toBe(false);
    expect(estAdresseSimple("lea@demo.roomflow.invalid,tanguy@gmail.com")).toBe(false);
    expect(estAdresseSimple("Lea <lea@demo.roomflow.invalid>")).toBe(false);
    expect(estAdresseSimple("a@b.fr;c@d.fr")).toBe(false);
  });

  it("l'espace insecable (U+00A0) est enleve par trim()", () => {
    expect(estEmailDemo("\u00A0demo@roomflow.invalid\u00A0")).toBe(true);
  });
});

describe("estEmailDemo : adresse de demo personnalisee", () => {
  const PERSO = "moi@exemple.fr";

  it("reconnait l'adresse personnalisee (casse et espaces compris)", () => {
    expect(estEmailDemo("moi@exemple.fr", PERSO)).toBe(true);
    expect(estEmailDemo("  MOI@Exemple.FR ", PERSO)).toBe(true);
    expect(estEmailDemo("moi@exemple.fr", "  MOI@EXEMPLE.FR  ")).toBe(true);
  });

  it("l'email par defaut n'est PLUS reconnu quand une adresse personnalisee est donnee", () => {
    // Lu dans le code : seule l'adresse passee en 2e argument (ou le domaine des
    // colocataires) compte, DEMO_EMAIL_PAR_DEFAUT n'est pas ajoute.
    expect(estEmailDemo(DEMO_EMAIL_PAR_DEFAUT, PERSO)).toBe(false);
  });

  it("les colocataires fictifs restent reconnus avec une adresse personnalisee", () => {
    expect(estEmailDemo("lea@demo.roomflow.invalid", PERSO)).toBe(true);
  });

  it("une adresse proche de l'adresse personnalisee n'est pas reconnue", () => {
    expect(estEmailDemo("xmoi@exemple.fr", PERSO)).toBe(false);
    expect(estEmailDemo("moi@exemple.fr.evil.com", PERSO)).toBe(false);
    expect(estEmailDemo("moi@exemple.com", PERSO)).toBe(false);
  });

  it("une adresse personnalisee vide ne reconnait jamais la chaine vide ni un inconnu", () => {
    expect(estEmailDemo("", "")).toBe(false);
    expect(estEmailDemo("   ", "   ")).toBe(false);
    expect(estEmailDemo("tanguy@gmail.com", "")).toBe(false);
    expect(estEmailDemo("tanguy@gmail.com", "   ")).toBe(false);
  });

  it("un vrai utilisateur n'est pas pris pour la demo, avec ou sans adresse personnalisee", () => {
    expect(estEmailDemo("tanguy@gmail.com", PERSO)).toBe(false);
    expect(estEmailDemo("tanguy@gmail.com")).toBe(false);
  });
});

describe("estEmailDemo : determinisme", () => {
  const GRILLE: [unknown, boolean][] = [
    ["demo@roomflow.invalid", true],
    ["LEA@DEMO.ROOMFLOW.INVALID", true],
    ["a@evil.demo.roomflow.invalid", false],
    ["tanguy@gmail.com", false],
    ["", false],
    [null, false],
    [{}, false],
  ];

  it("meme entree, meme sortie, sur 3 passes dans des ordres differents", () => {
    const passes = [GRILLE, [...GRILLE].reverse(), [...GRILLE].sort(() => 0)];
    for (const pass of passes) {
      for (const [entree, attendu] of pass) {
        expect(estEmailDemo(entree)).toBe(attendu);
      }
    }
  });

  it("ne garde aucun etat entre deux appels (pas de regex globale)", () => {
    for (let i = 0; i < 50; i++) {
      expect(estEmailDemo("lea@demo.roomflow.invalid")).toBe(true);
      expect(estEmailDemo("tanguy@gmail.com")).toBe(false);
    }
  });

  it("est insensible a la valeur de process.env (n'utilise que ses arguments)", () => {
    vi.stubEnv("DEMO_EMAIL", "moi@exemple.fr");
    try {
      expect(estEmailDemo("moi@exemple.fr")).toBe(false);
      expect(estEmailDemo(DEMO_EMAIL_PAR_DEFAUT)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// ---------------------------------------------------------------------------
// emailCompteDemo
// ---------------------------------------------------------------------------

describe("emailCompteDemo", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    ["variable absente", {}],
    ["variable undefined", { DEMO_EMAIL: undefined }],
    ["chaine vide", { DEMO_EMAIL: "" }],
    ["espaces seulement", { DEMO_EMAIL: "     " }],
    ["tabulation et retour a la ligne", { DEMO_EMAIL: "\t\n" }],
    ["sans arobase", { DEMO_EMAIL: "pas-un-email" }],
    ["arobase final seulement", { DEMO_EMAIL: "moi@" }],
    ["arobase initial seulement", { DEMO_EMAIL: "@exemple.fr" }],
    ["arobase seule", { DEMO_EMAIL: "@" }],
    ["deux arobases", { DEMO_EMAIL: "a@b@exemple.fr" }],
    ["espace au milieu de la partie locale", { DEMO_EMAIL: "mo i@exemple.fr" }],
    ["espace dans le domaine", { DEMO_EMAIL: "moi@exemple .fr" }],
    ["deux adresses separees par un saut de ligne", { DEMO_EMAIL: "a@b.fr\nc@d.fr" }],
    ["autres variables seulement", { AUTRE: "moi@exemple.fr" }],
  ])("retombe sur l'adresse par defaut : %s", (_nom, env) => {
    expect(emailCompteDemo(env)).toBe(DEMO_EMAIL_PAR_DEFAUT);
  });

  it("reprend une adresse valable, en minuscules ASCII et sans espaces autour", () => {
    expect(emailCompteDemo({ DEMO_EMAIL: "moi@exemple.fr" })).toBe("moi@exemple.fr");
    expect(emailCompteDemo({ DEMO_EMAIL: "  Moi@Exemple.FR  " })).toBe("moi@exemple.fr");
    expect(emailCompteDemo({ DEMO_EMAIL: "\tmoi@exemple.fr\n" })).toBe("moi@exemple.fr");
  });

  it("accepte une adresse sans point dans le domaine (forme minimale x@y)", () => {
    expect(emailCompteDemo({ DEMO_EMAIL: "a@b" })).toBe("a@b");
  });

  it("ne remplace pas le signe Kelvin par un k (minuscules ASCII seulement)", () => {
    expect(emailCompteDemo({ DEMO_EMAIL: `${KELVIN}evin@exemple.fr` })).toBe(`${KELVIN}evin@exemple.fr`);
  });

  it("ne leve jamais d'exception, quelle que soit la valeur de DEMO_EMAIL", () => {
    const valeurs: unknown[] = [
      null, 42, {}, [], ["moi@exemple.fr"], true, Symbol("x"), BigInt(7),
      "x".repeat(100_000), `${"a".repeat(50_000)}@${"b".repeat(50_000)}`,
      "\u0000", "\uD800", "😀@😀", "é@é", `a@b${NUL}`,
    ];
    for (const v of valeurs) {
      const env = { DEMO_EMAIL: v } as unknown as { DEMO_EMAIL?: string };
      expect(() => emailCompteDemo(env)).not.toThrow();
      expect(typeof emailCompteDemo(env)).toBe("string");
    }
  });

  it("une valeur qui n'est pas une chaine donne l'adresse par defaut", () => {
    for (const v of [null, 42, {}, [], ["moi@exemple.fr"], true]) {
      const env = { DEMO_EMAIL: v } as unknown as { DEMO_EMAIL?: string };
      expect(emailCompteDemo(env)).toBe(DEMO_EMAIL_PAR_DEFAUT);
    }
  });

  it("accepte process.env tel quel (objet avec beaucoup de variables) et ne le modifie pas", () => {
    vi.stubEnv("DEMO_EMAIL", "Env@Exemple.fr");
    const avant = JSON.stringify(process.env);
    expect(emailCompteDemo(process.env)).toBe("env@exemple.fr");
    expect(JSON.stringify(process.env)).toBe(avant);
  });

  it("ne modifie pas l'objet env recu", () => {
    const env = Object.freeze({ DEMO_EMAIL: "  Moi@Exemple.FR " });
    expect(emailCompteDemo(env)).toBe("moi@exemple.fr");
    expect(env.DEMO_EMAIL).toBe("  Moi@Exemple.FR ");
  });

  it("le resultat est toujours reconnu par estEmailDemo (le garde-fou couvre le compte demo)", () => {
    const entrees = [
      {}, { DEMO_EMAIL: "" }, { DEMO_EMAIL: "moi@exemple.fr" }, { DEMO_EMAIL: " X@Y.Z " },
      { DEMO_EMAIL: "n'importe quoi" }, { DEMO_EMAIL: `${KELVIN}@x.fr` },
    ];
    for (const env of entrees) {
      const adresse = emailCompteDemo(env);
      expect(estEmailDemo(adresse, adresse)).toBe(true);
    }
  });

  it("par defaut, le compte demo est reconnu comme demo (chaine envoyerEmail, sans DEMO_EMAIL)", () => {
    expect(estEmailDemo(DEMO_EMAIL_PAR_DEFAUT, emailCompteDemo({}))).toBe(true);
  });

  it("DEMO_EMAIL personnalisee : le compte demo est reconnu, l'adresse par defaut ne l'est plus", () => {
    const env = { DEMO_EMAIL: "Moi@Exemple.fr" };
    expect(estEmailDemo("moi@exemple.fr", emailCompteDemo(env))).toBe(true);
    expect(estEmailDemo(DEMO_EMAIL_PAR_DEFAUT, emailCompteDemo(env))).toBe(false);
  });

  it("DEMO_EMAIL invalide ne desactive pas le garde-fou (retombe sur le defaut)", () => {
    expect(estEmailDemo(DEMO_EMAIL_PAR_DEFAUT, emailCompteDemo({ DEMO_EMAIL: "n'importe quoi" }))).toBe(true);
  });
});
