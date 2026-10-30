import { describe, expect, it } from "vitest";
import {
  MAX_COLOCATIONS_ADMIN,
  estAdminSite,
  etatColocation,
  type EntreeEtat,
  type EtatColocation,
} from "@/lib/admin";
import { DELAI_INACTIVITE_JOURS, DELAI_SUPPRESSION_JOURS } from "@/lib/nettoyage";

// admin.ts importe Mongoose, les modeles et nettoyage.ts, mais rien ne s'ouvre
// a l'import : la connexion est paresseuse (connectDB) et @/auth est charge en
// import dynamique dans lireAdminSite. On ne teste ici que les fonctions
// pures (estAdminSite, etatColocation) et la constante MAX_COLOCATIONS_ADMIN,
// sans base ni mock. lireAdminSite et listerColocationsAdmin touchent la base
// ou la session : elles restent hors de ce fichier.
//
// estAdminSite decide QUI peut ouvrir le panneau admin de toute la plateforme.
// Les tests sont donc volontairement mechants : on cherche tout moyen de passer
// admin avec un email ou un provider qui ne devrait pas.

// Dates en ISO avec "Z" : le test ne depend jamais du fuseau de la machine.
const d = (iso: string) => new Date(iso);

// "Maintenant" fige : on ne lit jamais l'horloge reelle.
const MAINTENANT = d("2026-10-30T12:00:00.000Z");
const T = MAINTENANT.getTime();

const JOUR_MS = 24 * 60 * 60 * 1000;

// Construits a partir des constantes du code, pas de "90" ou "30" ecrits en
// dur : si un delai change, les tests de frontiere suivent.
const INACTIVITE_MS = DELAI_INACTIVITE_JOURS * JOUR_MS;

/** Un instant decale de `n` jours (negatif = passe) par rapport a maintenant. */
const jours = (n: number) => new Date(T + n * JOUR_MS);

/** Un instant decale de `n` millisecondes par rapport a maintenant. */
const ms = (n: number) => new Date(T + n);

const DATE_INVALIDE = new Date("x");

// ---------------------------------------------------------------------------
// MAX_COLOCATIONS_ADMIN
// ---------------------------------------------------------------------------

describe("MAX_COLOCATIONS_ADMIN", () => {
  it("vaut 200", () => {
    expect(MAX_COLOCATIONS_ADMIN).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// estAdminSite
// ---------------------------------------------------------------------------

// Fabrique l'appel : par defaut un admin legitime (google, adresse presente).
const ADMIN = "admin@x.fr";
// Attention : on distingue "argument omis" (liste = ADMIN) de "undefined passe
// exprès" (variable d'environnement absente), d'ou le test sur la longueur de `reste`.
function admin(
  utilisateur: { email?: unknown; provider?: unknown } = {},
  ...reste: [liste?: string | undefined]
): boolean {
  const liste = reste.length === 0 ? ADMIN : reste[0];
  return estAdminSite(
    { email: ADMIN, provider: "google", ...utilisateur } as {
      email?: string | null;
      provider?: string | null;
    },
    { SITE_ADMIN_EMAILS: liste }
  );
}

describe("estAdminSite : cas nominal", () => {
  it("accepte google avec un email de la liste", () => {
    expect(admin({ provider: "google" })).toBe(true);
  });

  it("accepte github avec un email de la liste", () => {
    expect(admin({ provider: "github" })).toBe(true);
  });

  it("refuse un email qui n'est pas dans la liste", () => {
    expect(admin({ email: "autre@x.fr" })).toBe(false);
  });

  it("accepte le premier, un du milieu et le dernier d'une liste de plusieurs", () => {
    const liste = "a@x.fr,b@x.fr,c@x.fr";
    expect(admin({ email: "a@x.fr" }, liste)).toBe(true);
    expect(admin({ email: "b@x.fr" }, liste)).toBe(true);
    expect(admin({ email: "c@x.fr" }, liste)).toBe(true);
    expect(admin({ email: "d@x.fr" }, liste)).toBe(false);
  });

  it("accepte une liste d'une seule adresse", () => {
    expect(admin({}, "admin@x.fr")).toBe(true);
  });
});

describe("estAdminSite : provider", () => {
  it("refuse credentials, meme avec le bon email (email non verifie)", () => {
    expect(admin({ provider: "credentials" })).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["chaine vide", ""],
    ["espaces seuls", "   "],
    ["Google (casse)", "Google"],
    ["GOOGLE (casse)", "GOOGLE"],
    ["GitHub (casse)", "GitHub"],
    ["google avec espace final", "google "],
    ["google avec espace initial", " google"],
    ["google avec saut de ligne", "google\n"],
    ["google avec caractere nul", "google\0"],
    ["google suivi d'un suffixe", "google-oauth2"],
    ["facebook", "facebook"],
    ["gitlab", "gitlab"],
    ["nombre", 1],
    ["booleen true", true],
    ["objet", {}],
    ["objet avec toString", { toString: () => "google" }],
    ["tableau vide", []],
    ["tableau contenant google", ["google"]],
  ])("refuse le provider : %s", (_nom, provider) => {
    expect(admin({ provider })).toBe(false);
  });

  it("refuse quand le provider est absent de l'objet", () => {
    expect(
      estAdminSite({ email: ADMIN } as { email: string }, { SITE_ADMIN_EMAILS: ADMIN })
    ).toBe(false);
  });
});

describe("estAdminSite : email de l'utilisateur", () => {
  it("ignore la casse de l'email", () => {
    expect(admin({ email: "ADMIN@X.FR" })).toBe(true);
    expect(admin({ email: "Admin@X.fr" })).toBe(true);
  });

  it("ignore les espaces autour de l'email", () => {
    expect(admin({ email: "  admin@x.fr  " })).toBe(true);
    expect(admin({ email: "\tadmin@x.fr\n" })).toBe(true);
  });

  it("refuse un espace a l'interieur de l'email", () => {
    expect(admin({ email: "ad min@x.fr" })).toBe(false);
    expect(admin({ email: "admin @x.fr" })).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["chaine vide", ""],
    ["espaces seuls", "   "],
    ["tabulation et saut de ligne", "\t\n"],
    ["nombre", 42],
    ["booleen", true],
    ["objet", {}],
    ["objet avec toString", { toString: () => ADMIN }],
    ["tableau contenant l'adresse", [ADMIN]],
    ["tableau vide", []],
  ])("refuse l'email : %s", (_nom, email) => {
    expect(admin({ email })).toBe(false);
  });

  it("refuse quand l'email est absent de l'objet", () => {
    expect(
      estAdminSite({ provider: "google" } as { provider: string }, { SITE_ADMIN_EMAILS: ADMIN })
    ).toBe(false);
  });

  it("refuse un objet utilisateur vide", () => {
    expect(estAdminSite({}, { SITE_ADMIN_EMAILS: ADMIN })).toBe(false);
  });
});

describe("estAdminSite : liste SITE_ADMIN_EMAILS", () => {
  it("ignore la casse et les espaces autour des elements de la liste", () => {
    expect(admin({ email: "admin@x.fr" }, "  ADMIN@X.FR  ")).toBe(true);
    expect(admin({ email: "b@x.fr" }, "a@x.fr ,  B@X.fr\t, c@x.fr")).toBe(true);
  });

  it("ignore les elements vides et les espaces seuls", () => {
    const liste = "a@x.fr, ,b@x.fr,,";
    expect(admin({ email: "a@x.fr" }, liste)).toBe(true);
    expect(admin({ email: "b@x.fr" }, liste)).toBe(true);
    expect(admin({ email: "c@x.fr" }, liste)).toBe(false);
  });

  it("ne reconnait que la virgule comme separateur", () => {
    // Un point-virgule ou un espace collent les adresses : aucune ne correspond.
    expect(admin({ email: "a@x.fr" }, "a@x.fr;b@x.fr")).toBe(false);
    expect(admin({ email: "b@x.fr" }, "a@x.fr;b@x.fr")).toBe(false);
    expect(admin({ email: "a@x.fr" }, "a@x.fr b@x.fr")).toBe(false);
    expect(admin({ email: "a@x.fr" }, "a@x.fr\nb@x.fr")).toBe(false);
  });

  it.each([
    ["absente (undefined)", undefined],
    ["chaine vide", ""],
    ["espaces seuls", "   "],
    ["une virgule seule", ","],
    ["des virgules et des espaces", " , , ,"],
  ])("variable %s : personne n'est admin", (_nom, liste) => {
    expect(admin({}, liste)).toBe(false);
    expect(admin({ provider: "github" }, liste)).toBe(false);
    expect(admin({ email: "autre@x.fr" }, liste)).toBe(false);
  });

  it("variable absente (objet env sans la cle) : personne n'est admin", () => {
    expect(estAdminSite({ email: ADMIN, provider: "google" }, {})).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["chaine vide", ""],
    ["espaces seuls", "   "],
    ["une virgule", ","],
    ["la liste contient un vide", "a@x.fr,,b@x.fr"],
    ["la liste est une virgule entouree d'espaces", "  ,  "],
  ])("un email vide ne correspond jamais a un element vide de la liste (liste : %s)", (_nom, liste) => {
    // Piege classique : "".split(",") donne [""], et "" === "" serait vrai.
    for (const email of ["", "   ", "\t"]) {
      expect(admin({ email }, liste)).toBe(false);
      expect(admin({ email, provider: "github" }, liste)).toBe(false);
    }
  });

  it("un joker dans la liste ne donne droit a personne", () => {
    for (const joker of ["*", ".*", "*@x.fr", "@x.fr", "x.fr", ".*@.*", "%", "?", "admin@*"]) {
      expect(admin({ email: "admin@x.fr" }, joker)).toBe(false);
      expect(admin({ email: "n-importe-qui@y.com" }, joker)).toBe(false);
      expect(admin({ email: joker }, "autre@x.fr")).toBe(false);
    }
  });

  it("un email egal a un joker n'est admin que si le joker est mot pour mot dans la liste", () => {
    // Comparaison de chaines exacte, jamais de motif : "*" en liste ne vaut que pour "*".
    expect(admin({ email: "*" }, "*")).toBe(true);
    expect(admin({ email: "x" }, "*")).toBe(false);
  });

  it("une liste tres longue reste exacte", () => {
    const liste = Array.from({ length: 5000 }, (_, i) => `u${i}@x.fr`).join(",") + ",admin@x.fr";
    expect(admin({ email: "admin@x.fr" }, liste)).toBe(true);
    expect(admin({ email: "u4999@x.fr" }, liste)).toBe(true);
    expect(admin({ email: "u5000@x.fr" }, liste)).toBe(false);
  });
});

describe("estAdminSite : pieges sur l'email", () => {
  it.each([
    ["prefixe (evil-admin@x.fr)", "evil-admin@x.fr"],
    ["prefixe collé (xadmin@x.fr)", "xadmin@x.fr"],
    ["domaine rallonge (admin@x.fr.evil.com)", "admin@x.fr.evil.com"],
    ["double arobase (admin@x.fr@evil.com)", "admin@x.fr@evil.com"],
    ["suffixe (admin@x.frx)", "admin@x.frx"],
    ["sous-domaine (admin@sub.x.fr)", "admin@sub.x.fr"],
    ["partie locale seule (admin)", "admin"],
    ["sans partie locale (@x.fr)", "@x.fr"],
    ["sans domaine (admin@)", "admin@"],
    ["points ajoutes (a.dmin@x.fr)", "a.dmin@x.fr"],
    ["adresse entre chevrons", "<admin@x.fr>"],
    ["nom affiche", "Admin <admin@x.fr>"],
    ["plusieurs adresses collees par virgule", "admin@x.fr,evil@y.com"],
    ["adresse suivie d'un point-virgule", "admin@x.fr;evil@y.com"],
    ["adresse entre guillemets", "\"admin@x.fr\""],
    ["commentaire RFC", "admin@x.fr(commentaire)"],
  ])("refuse : %s", (_nom, email) => {
    expect(admin({ email })).toBe(false);
  });

  it("refuse un email avec une virgule meme si les deux moities sont admin", () => {
    // Si la virgule n'etait pas interdite dans l'email, l'egalite exacte
    // continuerait de refuser : la chaine entiere n'est pas dans la liste.
    expect(admin({ email: "a@x.fr,b@x.fr" }, "a@x.fr,b@x.fr")).toBe(false);
  });

  it("refuse un email avec un plus s'il n'est pas dans la liste", () => {
    expect(admin({ email: "admin+test@x.fr" })).toBe(false);
    expect(admin({ email: "admin+@x.fr" })).toBe(false);
  });

  it("accepte un email avec un plus s'il est mot pour mot dans la liste", () => {
    expect(admin({ email: "admin+test@x.fr" }, "admin+test@x.fr")).toBe(true);
    // Et ne donne pas droit a la forme sans plus.
    expect(admin({ email: "admin@x.fr" }, "admin+test@x.fr")).toBe(false);
  });

  it("le caractere nul n'est pas ignore", () => {
    expect(admin({ email: "admin@x.fr\0" })).toBe(false);
    expect(admin({ email: "\0admin@x.fr" })).toBe(false);
    expect(admin({ email: "admin\0@x.fr" })).toBe(false);
    expect(admin({ email: "admin@x.fr\0evil.com" })).toBe(false);
    expect(admin({ email: "\0" })).toBe(false);
    // Et un nul dans la liste ne cree pas de correspondance.
    expect(admin({ email: "admin@x.fr" }, "admin@x.fr\0")).toBe(false);
    expect(admin({ email: "admin@x.fr\0" }, "admin@x.fr\0")).toBe(true);
  });

  it("ignore la casse des lettres ASCII seulement : une majuscule accentuee n'egale pas sa minuscule", () => {
    // Choix de securite (signe Kelvin U+212A) : pas de minuscules Unicode complet.
    expect(admin({ email: "ÉLODIE@X.FR" }, "élodie@x.fr")).toBe(false);
    expect(admin({ email: "élodie@x.fr" }, "ÉLODIE@X.FR")).toBe(false);
    expect(admin({ email: "ÉLODIE@x.fr" }, "ÉLODIE@X.FR")).toBe(true);
    // Forme composee contre forme decomposee : deux chaines differentes, pas de normalisation.
    expect(admin({ email: "élodie@x.fr" }, "élodie@x.fr")).toBe(false);
    // Accent absent ou different : refuse.
    expect(admin({ email: "elodie@x.fr" }, "élodie@x.fr")).toBe(false);
    expect(admin({ email: "èlodie@x.fr" }, "élodie@x.fr")).toBe(false);
  });

  it("refuse les caracteres qui ressemblent au latin (homoglyphes)", () => {
    // "а" cyrillique (U+0430) a la place du "a" latin.
    expect(admin({ email: "аdmin@x.fr" })).toBe(false);
    // "ｘ" pleine largeur (U+FF58) a la place du "x".
    expect(admin({ email: "admin@ｘ.fr" })).toBe(false);
    // "ı" turc sans point (U+0131) a la place du "i".
    expect(admin({ email: "admın@x.fr" })).toBe(false);
    // "İ" turc avec point (U+0130) : en minuscules donne "i" + point combinant, pas "i".
    expect(admin({ email: "admİn@x.fr" })).toBe(false);
    // "ſ" s long (U+017F).
    expect(admin({ email: "admin@ſ.fr" }, "admin@s.fr")).toBe(false);
  });

  it("refuse le signe Kelvin (U+212A) pour un 'k' d'une adresse de la liste", () => {
    // toLowerCase() transforme U+212A en "k" ASCII : deux chaines differentes
    // sont alors comparees comme egales. Pour un controle d'acces, on s'attend
    // a ce que seule la casse ASCII (et les majuscules du meme caractere)
    // soit ignoree. Voir le rapport : ce test revele cette normalisation.
    expect(admin({ email: "Kevin@x.fr" }, "kevin@x.fr")).toBe(false);
  });

  it("refuse un espace insecable ou un espace Unicode a l'interieur", () => {
    expect(admin({ email: "admin @x.fr" })).toBe(false);
    expect(admin({ email: "admin @x.fr" })).toBe(false);
    expect(admin({ email: "admin​@x.fr" })).toBe(false); // espace de largeur nulle
    expect(admin({ email: "admin@x.fr​" })).toBe(false);
  });

  it("refuse un email tres long qui contient l'adresse admin", () => {
    const long = "a".repeat(100_000);
    expect(admin({ email: `${long}@x.fr` })).toBe(false);
    expect(admin({ email: `${long}admin@x.fr` })).toBe(false);
    expect(admin({ email: `admin@x.fr${long}` })).toBe(false);
  });

  it("accepte un email tres long s'il est mot pour mot dans la liste", () => {
    const long = `${"a".repeat(100_000)}@x.fr`;
    expect(admin({ email: long }, `${ADMIN},${long}`)).toBe(true);
    expect(admin({ email: long.toUpperCase() }, `${ADMIN},${long}`)).toBe(true);
  });

  it("les retours a la ligne ne permettent pas de glisser une seconde adresse", () => {
    expect(admin({ email: "evil@y.com\nadmin@x.fr" })).toBe(false);
    expect(admin({ email: "admin@x.fr\r\nBcc: evil@y.com" })).toBe(false);
  });
});

describe("estAdminSite : proprietes generales", () => {
  it("ne modifie ni l'utilisateur ni l'environnement", () => {
    const utilisateur = Object.freeze({ email: "  Admin@X.fr ", provider: "google" });
    const env = Object.freeze({ SITE_ADMIN_EMAILS: " a@x.fr , ADMIN@x.fr ," });
    const avant = JSON.stringify({ utilisateur, env });
    expect(estAdminSite(utilisateur, env)).toBe(true);
    expect(JSON.stringify({ utilisateur, env })).toBe(avant);
  });

  it("est deterministe : meme entree, meme sortie, appels repetes", () => {
    for (let i = 0; i < 20; i++) {
      expect(admin()).toBe(true);
      expect(admin({ provider: "credentials" })).toBe(false);
    }
  });

  it("ne garde aucun etat entre deux appels (la liste ne fuit pas d'un appel a l'autre)", () => {
    expect(admin({ email: "a@x.fr" }, "a@x.fr")).toBe(true);
    expect(admin({ email: "a@x.fr" }, "b@x.fr")).toBe(false);
    expect(admin({ email: "a@x.fr" }, "a@x.fr")).toBe(true);
    expect(admin({ email: "a@x.fr" }, undefined)).toBe(false);
  });

  it("ignore les champs supplementaires de l'utilisateur (role, isAdmin...)", () => {
    expect(
      estAdminSite(
        { email: "autre@x.fr", provider: "google", isAdmin: true, role: "admin" } as {
          email: string;
          provider: string;
        },
        { SITE_ADMIN_EMAILS: ADMIN }
      )
    ).toBe(false);
  });

  it("grille : vrai implique provider google ou github ET email present apres normalisation", () => {
    const providers: unknown[] = [
      "google",
      "github",
      "credentials",
      undefined,
      null,
      "",
      "Google",
      "google ",
      "facebook",
      1,
      {},
      [],
    ];
    const emails: unknown[] = [
      "admin@x.fr",
      "ADMIN@X.FR",
      "  admin@x.fr ",
      "autre@x.fr",
      "evil-admin@x.fr",
      "admin@x.fr.evil.com",
      "admin+test@x.fr",
      "",
      "   ",
      undefined,
      null,
      42,
      {},
      [ADMIN],
      "Kevin@x.fr",
    ];
    const listes: (string | undefined)[] = [
      undefined,
      "",
      "   ",
      ",",
      "admin@x.fr",
      " ADMIN@x.fr ",
      "a@x.fr, ,admin@x.fr,,",
      "a@x.fr,b@x.fr",
      "*",
      ".*",
      "kevin@x.fr",
    ];

    let combinaisons = 0;
    let vrais = 0;
    for (const provider of providers) {
      for (const email of emails) {
        for (const liste of listes) {
          combinaisons++;
          const resultat = admin({ provider, email }, liste);
          if (resultat) {
            vrais++;
            // Le provider doit etre exactement "google" ou "github".
            expect(provider === "google" || provider === "github").toBe(true);
            // L'email doit etre une chaine, non vide apres normalisation.
            expect(typeof email).toBe("string");
            const normalise = (email as string).trim().toLowerCase();
            expect(normalise).not.toBe("");
            // Et present, tel quel, dans la liste normalisee.
            const elements = (liste ?? "")
              .split(",")
              .map((e) => e.trim().toLowerCase())
              .filter((e) => e !== "");
            expect(elements).toContain(normalise);
          }
        }
      }
    }
    expect(combinaisons).toBe(providers.length * emails.length * listes.length);
    // Garde-fou : la grille contient bien des cas vrais (sinon la propriete serait vide).
    expect(vrais).toBeGreaterThan(0);
  });

  it("grille : sans liste exploitable, aucune combinaison n'est admin", () => {
    const providers: unknown[] = ["google", "github", "credentials", undefined, null, ""];
    const emails: unknown[] = ["admin@x.fr", "", "   ", undefined, null, "a@x.fr"];
    const listesVides: (string | undefined)[] = [undefined, "", "   ", ",", " , ,, "];
    for (const provider of providers) {
      for (const email of emails) {
        for (const liste of listesVides) {
          expect(admin({ provider, email }, liste)).toBe(false);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// etatColocation
// ---------------------------------------------------------------------------

// Fabrique une entree : 3 membres, creee il y a 500 jours, activite il y a
// 10 jours (donc saine, donc "active"). Chaque test ne precise que ce qui
// l'interesse.
function entree(surcharge: Partial<EntreeEtat> = {}): EntreeEtat {
  return {
    nombreMembres: 3,
    creeLe: jours(-500),
    derniereActivite: jours(-10),
    ...surcharge,
  };
}

const etat = (e: EntreeEtat) => etatColocation(e, MAINTENANT);

// Un plan d'inactivite COHERENT en cours : 2 membres, inactive depuis 100 j,
// avertie il y a 20 j, echeance dans 10 j (= avertie + 30 j exactement).
function planInactif(surcharge: Partial<EntreeEtat> = {}): EntreeEtat {
  return entree({
    nombreMembres: 2,
    derniereActivite: jours(-100),
    avertieLe: jours(-20),
    suppressionPrevueLe: jours(10),
    motifSuppression: "inactive",
    ...surcharge,
  });
}

// Un plan "vide" COHERENT en cours : 0 membre, vide depuis 10 j, echeance dans 20 j.
function planVide(surcharge: Partial<EntreeEtat> = {}): EntreeEtat {
  return entree({
    nombreMembres: 0,
    derniereActivite: jours(-500),
    videDepuis: jours(-10),
    suppressionPrevueLe: jours(20),
    motifSuppression: "vide",
    ...surcharge,
  });
}

describe("etatColocation : demo (premiere ligne, gagne toujours)", () => {
  it("rend demo pour une colocation demo saine", () => {
    expect(etat(entree({ demo: true }))).toEqual({ code: "demo" });
  });

  it("rend demo meme sans membre", () => {
    expect(etat(entree({ demo: true, nombreMembres: 0 }))).toEqual({ code: "demo" });
  });

  it("rend demo meme inactive depuis longtemps", () => {
    expect(etat(entree({ demo: true, derniereActivite: jours(-1000) }))).toEqual({ code: "demo" });
  });

  it("rend demo meme avec un plan d'inactivite coherent", () => {
    expect(etat(planInactif({ demo: true }))).toEqual({ code: "demo" });
  });

  it("rend demo meme avec un plan vide coherent et une echeance passee", () => {
    expect(etat(planVide({ demo: true, suppressionPrevueLe: jours(-5), videDepuis: jours(-40) }))).toEqual({
      code: "demo",
    });
  });

  it("rend demo meme avec des donnees de plan incoherentes ou des dates invalides", () => {
    expect(
      etat(
        entree({
          demo: true,
          suppressionPrevueLe: DATE_INVALIDE,
          avertieLe: DATE_INVALIDE,
          motifSuppression: "n-importe-quoi",
        })
      )
    ).toEqual({ code: "demo" });
  });

  it("ne rend demo que pour demo === true strictement", () => {
    for (const demo of [false, null, undefined]) {
      expect(etat(entree({ demo })).code).not.toBe("demo");
    }
    // Valeurs "truthy" mais pas true : pas demo (le typage les interdit, la base pourrait les contenir).
    for (const demo of [1, "true", {}] as unknown[]) {
      expect(etat(entree({ demo: demo as boolean })).code).not.toBe("demo");
    }
  });

  it("rend demo sans meme valider la colocation (membres invalides) ni la date de reference", () => {
    // Comportement reel : la ligne 1 sort avant toute validation.
    expect(etat(entree({ demo: true, nombreMembres: -1 }))).toEqual({ code: "demo" });
    expect(etatColocation(entree({ demo: true }), DATE_INVALIDE)).toEqual({ code: "demo" });
  });
});

describe("etatColocation : suppression_prevue (plan coherent)", () => {
  it("rend suppression_prevue avec la date et le motif pour un plan d'inactivite coherent", () => {
    const e = planInactif();
    expect(etat(e)).toEqual({
      code: "suppression_prevue",
      suppressionPrevueLe: jours(10),
      motif: "inactive",
    });
  });

  it("rend suppression_prevue avec la date et le motif pour un plan vide coherent", () => {
    expect(etat(planVide())).toEqual({
      code: "suppression_prevue",
      suppressionPrevueLe: jours(20),
      motif: "vide",
    });
  });

  it("echeance deja passee mais plan coherent : toujours suppression_prevue", () => {
    // avertie il y a 40 j, echeance il y a 10 j : le cron supprimera, l'etat reste "prevue".
    const inactif = planInactif({ avertieLe: jours(-40), suppressionPrevueLe: jours(-10) });
    expect(etat(inactif)).toEqual({
      code: "suppression_prevue",
      suppressionPrevueLe: jours(-10),
      motif: "inactive",
    });
    const videPasse = planVide({ videDepuis: jours(-60), suppressionPrevueLe: jours(-30) });
    expect(etat(videPasse)).toEqual({
      code: "suppression_prevue",
      suppressionPrevueLe: jours(-30),
      motif: "vide",
    });
  });

  it("echeance exactement atteinte : suppression_prevue", () => {
    const e = planInactif({ avertieLe: jours(-30), suppressionPrevueLe: MAINTENANT });
    expect(etat(e)).toMatchObject({ code: "suppression_prevue", motif: "inactive" });
  });

  it("l'echeance est exactement avertie + 30 j : accepte ; une milliseconde de moins : incoherent", () => {
    const limite = planInactif({
      avertieLe: jours(-5),
      suppressionPrevueLe: jours(DELAI_SUPPRESSION_JOURS - 5),
    });
    expect(etat(limite).code).toBe("suppression_prevue");

    const raccourcie = planInactif({
      avertieLe: jours(-5),
      suppressionPrevueLe: ms(DELAI_SUPPRESSION_JOURS * JOUR_MS - 5 * JOUR_MS - 1),
    });
    // Delai de 30 j raccourci d'une ms : plan incoherent, etat deduit des faits (inactive).
    expect(etat(raccourcie)).toEqual({ code: "inactive" });
  });

  it("rend la meme date que celle de l'entree", () => {
    const resultat = etat(planInactif()) as Extract<EtatColocation, { code: "suppression_prevue" }>;
    expect(resultat.suppressionPrevueLe.getTime()).toBe(jours(10).getTime());
  });
});

describe("etatColocation : plan perime (deduit des faits)", () => {
  it("un membre a rejoint une colocation vide : plus de plan, l'etat vient des faits", () => {
    // Plan "vide" mais maintenant 1 membre, activite recente : active.
    const e = planVide({ nombreMembres: 1, derniereActivite: jours(-2) });
    expect(etat(e)).toEqual({ code: "active" });
  });

  it("un membre a rejoint mais la colocation est ancienne et inactive : inactive", () => {
    const e = planVide({ nombreMembres: 1, derniereActivite: jours(-200) });
    expect(etat(e)).toEqual({ code: "inactive" });
  });

  it("activite posterieure a l'avertissement : plan perime, active", () => {
    const e = planInactif({ derniereActivite: jours(-5) });
    expect(etat(e)).toEqual({ code: "active" });
  });

  it("activite posterieure a l'avertissement ET echeance passee : pas de suppression_prevue", () => {
    const e = planInactif({
      avertieLe: jours(-40),
      suppressionPrevueLe: jours(-10),
      derniereActivite: jours(-3),
    });
    expect(etat(e)).toEqual({ code: "active" });
  });

  it("colocation devenue vide avec un ancien plan d'inactivite : etat 'vide' (pas suppression_prevue)", () => {
    const e = planInactif({ nombreMembres: 0 });
    expect(etat(e)).toEqual({ code: "vide" });
  });

  it("plan d'inactivite coherent mais la colocation n'est plus inactive : active", () => {
    // Activite il y a 50 j (posterieure a avertie = -60), donc plus de raison de supprimer.
    const e = planInactif({
      avertieLe: jours(-60),
      suppressionPrevueLe: jours(-30),
      derniereActivite: jours(-50),
    });
    expect(etat(e)).toEqual({ code: "active" });
  });
});

describe("etatColocation : plan incoherent (deduit des faits)", () => {
  it("echeance sans motif ni avertissement : etat des faits", () => {
    expect(etat(entree({ suppressionPrevueLe: jours(10) }))).toEqual({ code: "active" });
    expect(etat(entree({ suppressionPrevueLe: jours(10), derniereActivite: jours(-100) }))).toEqual({
      code: "inactive",
    });
  });

  it("motif sans date : etat des faits", () => {
    expect(etat(entree({ motifSuppression: "inactive" }))).toEqual({ code: "active" });
    expect(etat(entree({ motifSuppression: "vide", nombreMembres: 0 }))).toEqual({ code: "vide" });
  });

  it("avertieLe sans echeance : etat des faits", () => {
    expect(etat(planInactif({ suppressionPrevueLe: null }))).toEqual({ code: "inactive" });
  });

  it("echeance qui raccourcit le delai de 30 j : etat des faits", () => {
    const e = planInactif({ avertieLe: jours(-20), suppressionPrevueLe: jours(5) });
    expect(etat(e)).toEqual({ code: "inactive" });
  });

  it("motif inconnu avec une echeance et un avertissement : etat des faits", () => {
    const e = planInactif({ motifSuppression: "autre-chose" });
    expect(etat(e)).toEqual({ code: "inactive" });
    expect(etat(planInactif({ motifSuppression: "" }))).toEqual({ code: "inactive" });
    expect(etat(planInactif({ motifSuppression: "INACTIVE" }))).toEqual({ code: "inactive" });
    expect(etat(planInactif({ motifSuppression: "Vide" }))).toEqual({ code: "inactive" });
  });

  it("motif vide alors que des membres sont presents : etat des faits", () => {
    const e = entree({
      nombreMembres: 2,
      suppressionPrevueLe: jours(10),
      motifSuppression: "vide",
      videDepuis: jours(-20),
    });
    expect(etat(e)).toEqual({ code: "active" });
  });

  it("motif inactive sur une colocation sans membre : etat 'vide'", () => {
    const e = entree({
      nombreMembres: 0,
      avertieLe: jours(-20),
      suppressionPrevueLe: jours(10),
      motifSuppression: "inactive",
    });
    expect(etat(e)).toEqual({ code: "vide" });
  });

  it("plan vide dont l'echeance raccourcit le delai : etat 'vide' (pas suppression_prevue)", () => {
    const e = planVide({ videDepuis: jours(-10), suppressionPrevueLe: jours(15) });
    expect(etat(e)).toEqual({ code: "vide" });
  });

  it("plan vide avec videDepuis dans le futur : etat 'vide'", () => {
    const e = planVide({ videDepuis: jours(5), suppressionPrevueLe: jours(40) });
    expect(etat(e)).toEqual({ code: "vide" });
  });

  it("avertieLe dans le futur avec un plan incoherent (motif inconnu) : etat des faits, pas suppression_prevue", () => {
    // Le commentaire de etatColocation dit : plan incoherent -> etat des faits.
    // Ici le motif est inconnu et l'echeance raccourcit le delai : le plan est
    // incoherent. Mais evaluerNettoyage rend "rien" quand avertieLe est dans le
    // futur (avant tout controle de coherence), et etatColocation y voit un plan
    // valide. Voir le rapport.
    const e = entree({
      nombreMembres: 2,
      derniereActivite: jours(-100),
      avertieLe: jours(5),
      suppressionPrevueLe: jours(6),
      motifSuppression: "autre-chose",
    });
    expect(etat(e)).toEqual({ code: "inactive" });
  });
});

describe("etatColocation : dates invalides et motif inconnu", () => {
  it("suppressionPrevueLe invalide : ignoree, etat des faits", () => {
    expect(etat(planInactif({ suppressionPrevueLe: DATE_INVALIDE }))).toEqual({ code: "inactive" });
    expect(etat(planVide({ suppressionPrevueLe: DATE_INVALIDE }))).toEqual({ code: "vide" });
  });

  it("suppressionPrevueLe qui n'est pas une Date (chaine, nombre) : ignoree, etat des faits", () => {
    const chaine = planInactif({ suppressionPrevueLe: jours(10).toISOString() as unknown as Date });
    expect(etat(chaine)).toEqual({ code: "inactive" });
    const nombre = planInactif({ suppressionPrevueLe: jours(10).getTime() as unknown as Date });
    expect(etat(nombre)).toEqual({ code: "inactive" });
  });

  it("avertieLe invalide : plan incoherent, etat des faits", () => {
    expect(etat(planInactif({ avertieLe: DATE_INVALIDE }))).toEqual({ code: "inactive" });
  });

  it("videDepuis invalide : plan vide incoherent, etat 'vide'", () => {
    expect(etat(planVide({ videDepuis: DATE_INVALIDE }))).toEqual({ code: "vide" });
  });

  it("derniereActivite invalide : la creation tient lieu d'activite via evaluerNettoyage", () => {
    // creeLe il y a 500 j et derniereActivite invalide : activite = creation = inactive.
    expect(etat(entree({ derniereActivite: DATE_INVALIDE }))).toEqual({ code: "inactive" });
    // creeLe recente : active.
    expect(etat(entree({ creeLe: jours(-10), derniereActivite: DATE_INVALIDE }))).toEqual({
      code: "active",
    });
  });

  it("creeLe invalide avec derniereActivite valide : l'activite valide sert", () => {
    expect(etat(entree({ creeLe: DATE_INVALIDE, derniereActivite: jours(-10) }))).toEqual({
      code: "active",
    });
    expect(etat(entree({ creeLe: DATE_INVALIDE, derniereActivite: jours(-200) }))).toEqual({
      code: "inactive",
    });
  });

  it("aucune date d'activite valide : on ne juge pas, active (jamais inactive ni suppression)", () => {
    const e = entree({ creeLe: DATE_INVALIDE, derniereActivite: DATE_INVALIDE });
    expect(etat(e)).toEqual({ code: "active" });
    expect(etat(entree({ creeLe: DATE_INVALIDE, derniereActivite: null }))).toEqual({ code: "active" });
  });

  it("sans membre et sans date valide : 'vide' (le nombre de membres suffit)", () => {
    const e = entree({ nombreMembres: 0, creeLe: DATE_INVALIDE, derniereActivite: DATE_INVALIDE });
    expect(etat(e)).toEqual({ code: "vide" });
  });

  it("date de reference invalide : leve une RangeError (bug de l'appelant)", () => {
    expect(() => etatColocation(entree(), DATE_INVALIDE)).toThrow(RangeError);
  });

  it("nombre de membres negatif ou non entier : leve une RangeError (bug de l'appelant)", () => {
    expect(() => etat(entree({ nombreMembres: -1 }))).toThrow(RangeError);
    expect(() => etat(entree({ nombreMembres: 1.5 }))).toThrow(RangeError);
    expect(() => etat(entree({ nombreMembres: Number.NaN }))).toThrow(RangeError);
    expect(() => etat(entree({ nombreMembres: Number.POSITIVE_INFINITY }))).toThrow(RangeError);
  });
});

describe("etatColocation : faits seuls (sans plan)", () => {
  it("0 membre : vide", () => {
    expect(etat(entree({ nombreMembres: 0 }))).toEqual({ code: "vide" });
  });

  it("0 membre : vide, meme avec une activite toute recente", () => {
    expect(etat(entree({ nombreMembres: 0, derniereActivite: ms(-1) }))).toEqual({ code: "vide" });
  });

  it("1 membre avec activite recente : active", () => {
    expect(etat(entree({ nombreMembres: 1 }))).toEqual({ code: "active" });
  });

  it("membres et activite il y a 200 jours : inactive", () => {
    expect(etat(entree({ derniereActivite: jours(-200) }))).toEqual({ code: "inactive" });
  });

  it("90 jours exactement : active (comparaison stricte)", () => {
    expect(etat(entree({ derniereActivite: new Date(T - INACTIVITE_MS) }))).toEqual({ code: "active" });
  });

  it("90 jours + 1 ms : inactive", () => {
    expect(etat(entree({ derniereActivite: new Date(T - INACTIVITE_MS - 1) }))).toEqual({
      code: "inactive",
    });
  });

  it("90 jours - 1 ms : active", () => {
    expect(etat(entree({ derniereActivite: new Date(T - INACTIVITE_MS + 1) }))).toEqual({
      code: "active",
    });
  });

  it("activite dans le futur : active", () => {
    expect(etat(entree({ derniereActivite: jours(5) }))).toEqual({ code: "active" });
    expect(etat(entree({ derniereActivite: jours(5000) }))).toEqual({ code: "active" });
  });

  it("derniereActivite plus ancienne que la creation : la creation compte (max des deux)", () => {
    const e = entree({ creeLe: jours(-5), derniereActivite: jours(-300) });
    expect(etat(e)).toEqual({ code: "active" });
  });

  it("beaucoup de membres : le nombre n'influence pas le resultat tant qu'il est > 0", () => {
    expect(etat(entree({ nombreMembres: 1_000_000 }))).toEqual({ code: "active" });
    expect(etat(entree({ nombreMembres: 1_000_000, derniereActivite: jours(-200) }))).toEqual({
      code: "inactive",
    });
  });
});

describe("etatColocation : derniereActivite null (la creation tient lieu d'activite)", () => {
  it("creee il y a 10 jours : active", () => {
    expect(etat(entree({ creeLe: jours(-10), derniereActivite: null }))).toEqual({ code: "active" });
  });

  it("creee il y a 200 jours : inactive", () => {
    expect(etat(entree({ creeLe: jours(-200), derniereActivite: null }))).toEqual({ code: "inactive" });
  });

  it("creee il y a exactement 90 jours : active ; 90 jours + 1 ms : inactive", () => {
    expect(etat(entree({ creeLe: new Date(T - INACTIVITE_MS), derniereActivite: null }))).toEqual({
      code: "active",
    });
    expect(etat(entree({ creeLe: new Date(T - INACTIVITE_MS - 1), derniereActivite: null }))).toEqual({
      code: "inactive",
    });
  });

  it("sans membre : vide", () => {
    expect(etat(entree({ nombreMembres: 0, creeLe: jours(-10), derniereActivite: null }))).toEqual({
      code: "vide",
    });
  });

  it("donne le meme resultat que derniereActivite = creeLe", () => {
    for (const creeLe of [jours(-1), jours(-90), ms(-INACTIVITE_MS - 1), jours(-400), jours(3)]) {
      expect(etat(entree({ creeLe, derniereActivite: null }))).toEqual(
        etat(entree({ creeLe, derniereActivite: creeLe }))
      );
    }
  });

  it("avec un plan d'inactivite coherent : suppression_prevue (la creation ancienne ne l'annule pas)", () => {
    const e = planInactif({ creeLe: jours(-500), derniereActivite: null });
    expect(etat(e).code).toBe("suppression_prevue");
  });
});

describe("etatColocation : proprietes generales", () => {
  it("ne modifie pas l'entree", () => {
    const e = planInactif({ demo: false });
    const copie = {
      ...e,
      creeLe: new Date(e.creeLe.getTime()),
      derniereActivite: e.derniereActivite && new Date(e.derniereActivite.getTime()),
      avertieLe: e.avertieLe && new Date(e.avertieLe.getTime()),
      suppressionPrevueLe: e.suppressionPrevueLe && new Date(e.suppressionPrevueLe.getTime()),
    };
    const gelee = Object.freeze({ ...e });
    const maintenant = new Date(T);
    etatColocation(gelee, maintenant);
    expect(gelee).toEqual(copie);
    expect(maintenant.getTime()).toBe(T);
  });

  it("ne modifie pas une entree sans derniereActivite (null reste null)", () => {
    const e = Object.freeze(entree({ derniereActivite: null }));
    etat(e);
    expect(e.derniereActivite).toBeNull();
  });

  it("est deterministe : meme entree, meme sortie", () => {
    const entrees = [
      entree(),
      entree({ nombreMembres: 0 }),
      entree({ derniereActivite: jours(-200) }),
      planInactif(),
      planVide(),
      entree({ demo: true }),
    ];
    for (const e of entrees) {
      expect(etat(e)).toEqual(etat(e));
      expect(etat(e)).toEqual(etat({ ...e }));
    }
  });

  it("la date de reference decide : meme colocation, deux instants, deux etats", () => {
    const e = entree({ derniereActivite: new Date(T - INACTIVITE_MS) });
    expect(etatColocation(e, MAINTENANT)).toEqual({ code: "active" });
    expect(etatColocation(e, ms(1))).toEqual({ code: "inactive" });
  });

  it("grille : jamais d'exception pour des entrees valides, code toujours parmi les 5 attendus", () => {
    const CODES = ["demo", "suppression_prevue", "vide", "inactive", "active"];
    const membres = [0, 1, 3];
    const demos: (boolean | null | undefined)[] = [true, false, null, undefined];
    const creations = [jours(-500), jours(-10), jours(2)];
    const activites: (Date | null)[] = [null, jours(-5), jours(-100), jours(5), DATE_INVALIDE];
    // Plans : absent, vide coherent, inactif coherent, echeance passee, incoherents, invalides.
    const plans: Partial<EntreeEtat>[] = [
      {},
      { videDepuis: jours(-10), suppressionPrevueLe: jours(20), motifSuppression: "vide" },
      { avertieLe: jours(-20), suppressionPrevueLe: jours(10), motifSuppression: "inactive" },
      { avertieLe: jours(-40), suppressionPrevueLe: jours(-10), motifSuppression: "inactive" },
      { videDepuis: jours(-60), suppressionPrevueLe: jours(-30), motifSuppression: "vide" },
      { suppressionPrevueLe: jours(10) },
      { motifSuppression: "inactive" },
      { avertieLe: jours(-20), suppressionPrevueLe: jours(5), motifSuppression: "inactive" },
      { avertieLe: jours(5), suppressionPrevueLe: jours(40), motifSuppression: "inactive" },
      { suppressionPrevueLe: DATE_INVALIDE, motifSuppression: "inactive", avertieLe: jours(-20) },
      { avertieLe: DATE_INVALIDE, suppressionPrevueLe: jours(10), motifSuppression: "inactive" },
      { suppressionPrevueLe: jours(10), avertieLe: jours(-20), motifSuppression: "inconnu" },
      { suppressionPrevueLe: null, avertieLe: null, videDepuis: null, motifSuppression: null },
    ];

    let combinaisons = 0;
    const comptes: Record<string, number> = {};
    for (const nombreMembres of membres) {
      for (const demo of demos) {
        for (const creeLe of creations) {
          for (const derniereActivite of activites) {
            for (const plan of plans) {
              const e: EntreeEtat = { nombreMembres, creeLe, derniereActivite, demo, ...plan };
              let resultat: EtatColocation | undefined;
              expect(() => {
                resultat = etat(e);
              }).not.toThrow();
              combinaisons++;
              expect(CODES).toContain(resultat!.code);
              comptes[resultat!.code] = (comptes[resultat!.code] ?? 0) + 1;

              // Demo l'emporte sur tout.
              if (demo === true) expect(resultat).toEqual({ code: "demo" });
              // suppression_prevue ne sort JAMAIS avec demo true.
              if (resultat!.code === "suppression_prevue") {
                expect(demo).not.toBe(true);
                expect(resultat!.suppressionPrevueLe).toBeInstanceOf(Date);
                expect(Number.isNaN(resultat!.suppressionPrevueLe.getTime())).toBe(false);
                expect(["vide", "inactive"]).toContain(resultat!.motif);
              }
              // vide <=> 0 membre (hors demo et hors plan prevu).
              if (resultat!.code === "vide") expect(nombreMembres).toBe(0);
              if (resultat!.code === "inactive" || resultat!.code === "active") {
                expect(nombreMembres).toBeGreaterThan(0);
              }
              // Deterministe sur toute la grille.
              expect(etat(e)).toEqual(resultat);
            }
          }
        }
      }
    }

    expect(combinaisons).toBe(
      membres.length * demos.length * creations.length * activites.length * plans.length
    );
    // Garde-fou : chacun des 5 codes est bien atteint par la grille (sinon elle ne prouverait rien).
    for (const code of CODES) expect(comptes[code]).toBeGreaterThan(0);
  });

  it("grille : suppression_prevue seulement si le plan est coherent avec les faits", () => {
    // Sans plan d'aucune sorte, jamais suppression_prevue, quelle que soit l'activite.
    for (const nombreMembres of [0, 1, 3]) {
      for (const derniereActivite of [null, jours(-1), jours(-89), jours(-91), jours(-1000), jours(10)]) {
        for (const creeLe of [jours(-1), jours(-500)]) {
          expect(etat({ nombreMembres, creeLe, derniereActivite }).code).not.toBe("suppression_prevue");
        }
      }
    }
  });
});
