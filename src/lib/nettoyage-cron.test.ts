import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import {
  BUDGET_TEMPS_MS,
  DELAI_RETARD_MAX_JOURS,
  MAX_ACTIONS_PAR_PASSAGE,
  MAX_EMAILS_PAR_PASSAGE,
  actionAvertit,
  actionConsommeBudget,
  actionCronPour,
  budgetEpuise,
  echeanceEnRetard,
  peutAvertir,
  tempsEpuise,
  type ActionCron,
  domaineExpediteur,
  entreeDepuisColocation,
  envoiReelPossible,
  joursInactivite,
  plusRecenteDateValide,
  ordonnerParActiviteAncienne,
  type ColocationLue,
} from "@/lib/nettoyage-cron";
import {
  DELAI_INACTIVITE_JOURS,
  evaluerNettoyage,
  type DecisionNettoyage,
} from "@/lib/nettoyage";

// nettoyage-cron.ts importe Mongoose, les modeles et d'autres modules, mais rien
// ne s'ouvre a l'import (connexion paresseuse). On ne teste ici que les
// fonctions PURES : envoiReelPossible, domaineExpediteur,
// ordonnerParActiviteAncienne, actionConsommeBudget, budgetEpuise,
// joursInactivite et entreeDepuisColocation. executerNettoyage touche la base
// et les emails : il reste hors de ce fichier, sans mock.
//
// Ce code decide de SUPPRIMER des colocations et d'envoyer des avertissements :
// les tests sont volontairement mechants.

// Dates en ISO avec "Z" : le test ne depend jamais du fuseau de la machine.
const d = (iso: string) => new Date(iso);

// "Maintenant" fige : on ne lit jamais l'horloge reelle.
const MAINTENANT = d("2026-10-30T12:00:00.000Z");
const T = MAINTENANT.getTime();

const JOUR_MS = 24 * 60 * 60 * 1000;
const INACTIVITE_MS = DELAI_INACTIVITE_JOURS * JOUR_MS;

/** Un instant decale de `n` jours (negatif = passe) par rapport a maintenant. */
const jours = (n: number) => new Date(T + n * JOUR_MS);

const DATE_INVALIDE = new Date("x");

// Generateur congruentiel a graine fixe : reproductible, contrairement a
// Math.random (un echec doit pouvoir etre rejoue a l'identique).
function generateur(graine: number) {
  let etat = graine;
  return (max: number) => {
    etat = (etat * 1103515245 + 12345) % 2147483648;
    return etat % max;
  };
}

// ---------------------------------------------------------------------------
// domaineExpediteur
// ---------------------------------------------------------------------------

describe("domaineExpediteur", () => {
  it.each([
    ["a@b.fr", "b.fr"],
    ["Nom <a@b.fr>", "b.fr"],
    ["RoomFlow <noreply@roomflow.app>", "roomflow.app"],
    ["  a@b.fr  ", "b.fr"],
    ["  Nom <a@b.fr>  ", "b.fr"],
    ["Nom <  a@b.fr  >", "b.fr"],
    ["A@B.FR", "b.fr"],
    ["A@RESEND.DEV", "resend.dev"],
    ["Nom <a@Resend.Dev>", "resend.dev"],
    ["a@mail.exemple.fr", "mail.exemple.fr"],
    ["a@Sub.Exemple.FR", "sub.exemple.fr"],
    ["prenom.nom+tag@exemple.fr", "exemple.fr"],
    ["a@resend.dev.evil.com", "resend.dev.evil.com"],
    ["a@evil-resend.dev", "evil-resend.dev"],
  ])("%j => %j", (entree, attendu) => {
    expect(domaineExpediteur(entree)).toBe(attendu);
  });

  it("plusieurs @ : on garde ce qui suit le DERNIER (l'ancien piege « a@b.fr@resend.dev » ne passe pas pour b.fr)", () => {
    expect(domaineExpediteur("a@b.fr@resend.dev")).toBe("resend.dev");
    expect(domaineExpediteur("resend.dev@b.fr")).toBe("b.fr");
  });

  it("un nom d'affichage qui contient une adresse : seule l'adresse entre chevrons compte", () => {
    expect(domaineExpediteur("a@resend.dev <vrai@b.fr>")).toBe("b.fr");
    expect(domaineExpediteur("b@b.fr <vrai@resend.dev>")).toBe("resend.dev");
  });

  it("plusieurs paires de chevrons : la PREMIERE est lue", () => {
    expect(domaineExpediteur("Nom <a@resend.dev> <b@b.fr>")).toBe("resend.dev");
  });

  it("espaces et tabulations autour du domaine : retires", () => {
    expect(domaineExpediteur("a@ b.fr")).toBe("b.fr");
    expect(domaineExpediteur("\ta@b.fr\n")).toBe("b.fr");
  });

  it.each([
    ["undefined", undefined],
    ["chaine vide", ""],
    ["espaces seuls", "   "],
    ["tabulation et retour", "\t\n"],
    ["sans arobase", "sans-arobase"],
    ["sans arobase mais avec un point", "exemple.fr"],
    ["arobase en premier (partie locale vide)", "@b.fr"],
    ["rien apres l'arobase", "a@"],
    ["domaine sans point", "a@localhost"],
    ["domaine sans point, entre chevrons", "Nom <a@intranet>"],
    ["chevrons vides", "<>"],
    ["chevrons vides avec nom", "Nom <>"],
    ["chevrons sans arobase", "Nom <sans-arobase>"],
    ["espace dans le domaine", "a@resend .dev"],
    ["espace dans le domaine (2)", "a@resend. dev"],
    ["tabulation dans le domaine", "a@b\t.fr"],
    ["seulement un arobase", "@"],
    ["deux arobases colles", "@@"],
    ["un point seul, sans arobase", "."],
  ])("%s : null", (_nom, entree) => {
    expect(domaineExpediteur(entree)).toBeNull();
  });

  it("chaine bizarre : emojis, accents et caracteres de controle ne font pas lever d'exception", () => {
    const bizarres = ["😀@😀.fr", "é@é.fr", "a@\u0000.fr", "\u0000", "<<<>>>", "<a@b.fr", "a@b.fr>", "<@>", "<a<b>@c.fr>"];
    for (const b of bizarres) {
      expect(() => domaineExpediteur(b), JSON.stringify(b)).not.toThrow();
    }
  });

  it("tres longue chaine : pas d'exception", () => {
    expect(domaineExpediteur(`${"a".repeat(100000)}@b.fr`)).toBe("b.fr");
    expect(domaineExpediteur("x".repeat(100000))).toBeNull();
  });

  it("la fonction est pure : meme entree, meme sortie", () => {
    expect(domaineExpediteur("Nom <a@B.fr>")).toBe(domaineExpediteur("Nom <a@B.fr>"));
  });
});

// ---------------------------------------------------------------------------
// envoiReelPossible
// ---------------------------------------------------------------------------

describe("envoiReelPossible : hors production", () => {
  const ENVS_HORS_PRODUCTION: [string, { VERCEL_ENV?: string; NODE_ENV?: string }][] = [
    ["aucune variable d'environnement", {}],
    ["VERCEL_ENV=preview", { VERCEL_ENV: "preview" }],
    ["VERCEL_ENV=development", { VERCEL_ENV: "development" }],
    ["NODE_ENV=development", { NODE_ENV: "development" }],
    ["NODE_ENV=test", { NODE_ENV: "test" }],
    ["VERCEL_ENV vide et NODE_ENV=development", { VERCEL_ENV: "", NODE_ENV: "development" }],
    // Un deploiement de previsualisation Vercel a NODE_ENV=production ; c'est
    // VERCEL_ENV qui decide : preview n'est PAS de la production.
    ["VERCEL_ENV=preview et NODE_ENV=production", { VERCEL_ENV: "preview", NODE_ENV: "production" }],
  ];

  it.each(ENVS_HORS_PRODUCTION)("%s : vrai des que la cle Resend est definie", (_nom, env) => {
    expect(envoiReelPossible({ ...env, RESEND_API_KEY: "re_cle" })).toBe(true);
  });

  it.each(ENVS_HORS_PRODUCTION)("%s : faux sans cle Resend", (_nom, env) => {
    expect(envoiReelPossible({ ...env })).toBe(false);
    expect(envoiReelPossible({ ...env, RESEND_API_KEY: undefined })).toBe(false);
  });

  it.each(ENVS_HORS_PRODUCTION)("%s : cle vide ou faite d'espaces : faux", (_nom, env) => {
    expect(envoiReelPossible({ ...env, RESEND_API_KEY: "" })).toBe(false);
    expect(envoiReelPossible({ ...env, RESEND_API_KEY: "   " })).toBe(false);
    expect(envoiReelPossible({ ...env, RESEND_API_KEY: "\t\n" })).toBe(false);
  });

  it("hors production, EMAIL_FROM est sans importance (meme l'adresse de test resend.dev)", () => {
    const base = { RESEND_API_KEY: "re_cle", NODE_ENV: "development" };
    expect(envoiReelPossible({ ...base })).toBe(true);
    expect(envoiReelPossible({ ...base, EMAIL_FROM: "RoomFlow <onboarding@resend.dev>" })).toBe(true);
    expect(envoiReelPossible({ ...base, EMAIL_FROM: "n'importe quoi" })).toBe(true);
    expect(envoiReelPossible({ ...base, EMAIL_FROM: "" })).toBe(true);
  });
});

describe("envoiReelPossible : production", () => {
  const PROD = {
    VERCEL_ENV: "production",
    NODE_ENV: "production",
    RESEND_API_KEY: "re_cle",
  };
  const enProd = (surcharge: Partial<Record<"EMAIL_FROM" | "RESEND_API_KEY" | "VERCEL_ENV" | "NODE_ENV", string | undefined>>) =>
    envoiReelPossible({ ...PROD, ...surcharge });

  it("domaine propre + cle : vrai", () => {
    expect(enProd({ EMAIL_FROM: "RoomFlow <noreply@roomflow.app>" })).toBe(true);
  });

  it.each([
    ["a@b.fr", true],
    ["Nom <a@b.fr>", true],
    ["  a@b.fr  ", true],
    ["  Nom <a@b.fr>  ", true],
    ["A@B.FR", true],
    ["a@mail.exemple.fr", true],
    // Domaines DIFFERENTS de resend.dev : l'expediteur n'est pas l'adresse de
    // test de Resend, rien ne permet de les refuser.
    ["a@evil-resend.dev", true],
    ["a@notresend.dev", true],
    ["a@resend.dev.evil.com", true],
    ["a@resend.devx", true],
    ["a@resend.com", true],
    // Adresse avec nom d'affichage contenant une adresse resend.dev : l'adresse reelle est b.fr.
    ["a@resend.dev <vrai@b.fr>", true],
    // Adresse de test Resend et tous ses sous-domaines : faux, quelle que soit la casse ou l'enrobage.
    ["a@resend.dev", false],
    ["A@RESEND.DEV", false],
    ["Nom <a@Resend.Dev>", false],
    ["  a@resend.dev  ", false],
    ["  Nom <a@resend.dev>  ", false],
    ["Nom <  a@resend.dev  >", false],
    ["RoomFlow <onboarding@resend.dev>", false],
    ["a@mail.resend.dev", false],
    ["a@a.b.resend.dev", false],
    ["Nom <a@mail.RESEND.dev>", false],
    ["a@RESEND.DEV", false],
    // Partie locale qui ressemble a un autre domaine : c'est ce qui suit le dernier @ qui compte.
    ["a@b.fr@resend.dev", false],
    ["Nom <a@resend.dev> <b@b.fr>", false],
    ["b@b.fr <vrai@resend.dev>", false],
    // Pas de domaine exploitable : faux (mieux vaut refuser l'envoi que supposer).
    [undefined, false],
    ["", false],
    ["   ", false],
    ["sans-arobase", false],
    ["exemple.fr", false],
    ["@b.fr", false],
    ["a@", false],
    ["a@localhost", false],
    ["<>", false],
    ["Nom <>", false],
    ["a@resend .dev", false],
  ] as [string | undefined, boolean][])("EMAIL_FROM %j : %s", (from, attendu) => {
    expect(enProd({ EMAIL_FROM: from })).toBe(attendu);
  });

  it("EMAIL_FROM absent de l'objet (cle non definie) : faux", () => {
    expect(envoiReelPossible({ ...PROD })).toBe(false);
  });

  it("cle absente, vide ou faite d'espaces : faux, meme avec un domaine propre", () => {
    const from = "RoomFlow <noreply@roomflow.app>";
    expect(enProd({ EMAIL_FROM: from, RESEND_API_KEY: undefined })).toBe(false);
    expect(enProd({ EMAIL_FROM: from, RESEND_API_KEY: "" })).toBe(false);
    expect(enProd({ EMAIL_FROM: from, RESEND_API_KEY: "   " })).toBe(false);
  });

  describe("quand est-on en production ?", () => {
    const FROM_TEST = "RoomFlow <onboarding@resend.dev>";
    const FROM_PROPRE = "RoomFlow <noreply@roomflow.app>";

    it("VERCEL_ENV=production sans NODE_ENV : production (resend.dev refuse)", () => {
      const env = { VERCEL_ENV: "production", RESEND_API_KEY: "re_cle" };
      expect(envoiReelPossible({ ...env, EMAIL_FROM: FROM_TEST })).toBe(false);
      expect(envoiReelPossible({ ...env, EMAIL_FROM: FROM_PROPRE })).toBe(true);
    });

    it("VERCEL_ENV=production prime sur NODE_ENV=development", () => {
      const env = { VERCEL_ENV: "production", NODE_ENV: "development", RESEND_API_KEY: "re_cle" };
      expect(envoiReelPossible({ ...env, EMAIL_FROM: FROM_TEST })).toBe(false);
    });

    it("VERCEL_ENV=production prime sur NODE_ENV=test", () => {
      const env = { VERCEL_ENV: "production", NODE_ENV: "test", RESEND_API_KEY: "re_cle" };
      expect(envoiReelPossible({ ...env, EMAIL_FROM: FROM_TEST })).toBe(false);
    });

    it("NODE_ENV=production SANS VERCEL_ENV (hors Vercel) : production, resend.dev refuse", () => {
      const env = { NODE_ENV: "production", RESEND_API_KEY: "re_cle" };
      expect(envoiReelPossible({ ...env, EMAIL_FROM: FROM_TEST })).toBe(false);
      expect(envoiReelPossible({ ...env })).toBe(false);
      expect(envoiReelPossible({ ...env, EMAIL_FROM: FROM_PROPRE })).toBe(true);
    });

    it.each(["", "   ", "\t"])(
      "NODE_ENV=production avec VERCEL_ENV vide (%j) : VERCEL_ENV vide ne desarme pas la production",
      (vercel) => {
        const env = { VERCEL_ENV: vercel, NODE_ENV: "production", RESEND_API_KEY: "re_cle" };
        expect(envoiReelPossible({ ...env, EMAIL_FROM: FROM_TEST })).toBe(false);
        expect(envoiReelPossible({ ...env })).toBe(false);
      }
    );

    it("VERCEL_ENV avec espaces autour (« production ») : toujours production (trim)", () => {
      const env = { VERCEL_ENV: "  production  ", RESEND_API_KEY: "re_cle" };
      expect(envoiReelPossible({ ...env, EMAIL_FROM: FROM_TEST })).toBe(false);
    });

    it("VERCEL_ENV=preview avec NODE_ENV=production : PAS la production (voulu : la redirection de test y reste permise)", () => {
      const env = { VERCEL_ENV: "preview", NODE_ENV: "production", RESEND_API_KEY: "re_cle" };
      expect(envoiReelPossible({ ...env, EMAIL_FROM: FROM_TEST })).toBe(true);
    });

    it("comportement reel : la comparaison de VERCEL_ENV est sensible a la casse (« Production » n'est pas la production)", () => {
      // Vercel renseigne toujours "production" en minuscules, donc pas exploitable
      // sans acces aux variables du projet. Signale dans le rapport : si quelqu'un
      // ecrit « Production » a la main, le garde-fou resend.dev tombe.
      const env = { VERCEL_ENV: "Production", NODE_ENV: "production", RESEND_API_KEY: "re_cle" };
      expect(envoiReelPossible({ ...env, EMAIL_FROM: FROM_TEST })).toBe(true);
    });

    it("comportement reel : NODE_ENV=Production (casse) sans VERCEL_ENV n'est pas la production", () => {
      const env = { NODE_ENV: "Production", RESEND_API_KEY: "re_cle" };
      expect(envoiReelPossible({ ...env, EMAIL_FROM: FROM_TEST })).toBe(true);
    });
  });

  describe("failles possibles : la verification du domaine est lache (le test attend le comportement SUR)", () => {
    // Le code ne refuse que : pas de point, ou un espace. Il ne valide pas les
    // caracteres du domaine. Un domaine « resend.dev » suivi d'un caractere
    // invisible ou d'un point final est donc pris pour un AUTRE domaine, alors
    // que c'est l'adresse de test (ou un nom equivalent) de Resend.
    it.each([
      ["point final (forme FQDN)", "a@resend.dev."],
      ["point final, avec nom", "RoomFlow <a@resend.dev.>"],
      ["sous-domaine avec point final", "a@mail.resend.dev."],
      ["espace de largeur nulle U+200B colle au domaine", "a@resend.dev\u200b"],
      ["liant de mots U+2060 colle au domaine", "a@resend.dev\u2060"],
    ])("EMAIL_FROM %s (%j) : devrait etre faux en production", (_nom, from) => {
      expect(enProd({ EMAIL_FROM: from })).toBe(false);
    });
  });

  it("l'objet env n'est pas modifie", () => {
    const env = Object.freeze({ ...PROD, EMAIL_FROM: "  Nom <A@B.fr>  " });
    expect(() => envoiReelPossible(env)).not.toThrow();
    expect(env.EMAIL_FROM).toBe("  Nom <A@B.fr>  ");
  });

  it("deterministe : deux appels identiques, meme resultat", () => {
    const env = { ...PROD, EMAIL_FROM: "Nom <a@b.fr>" };
    expect(envoiReelPossible(env)).toBe(envoiReelPossible(env));
  });
});

describe("envoiReelPossible : invariants sur une grille d'environnements", () => {
  const VERCELS = [undefined, "", "   ", "production", "preview", "development"];
  const NODES = [undefined, "development", "test", "production"];
  const CLES = [undefined, "", "  ", "re_cle"];
  const EXPEDITEURS_RESEND = [
    "a@resend.dev",
    "A@RESEND.DEV",
    "Nom <a@Resend.Dev>",
    "  a@resend.dev  ",
    "RoomFlow <onboarding@resend.dev>",
    "a@mail.resend.dev",
    "a@x.y.resend.dev",
  ];
  const EXPEDITEURS_SANS_DOMAINE = [undefined, "", "   ", "sans-arobase", "a@", "@b.fr", "a@localhost", "<>"];
  const EXPEDITEURS_PROPRES = ["a@b.fr", "RoomFlow <noreply@roomflow.app>", "  A@B.FR  "];

  // Meme definition que le code, ecrite independamment : une production est
  // soit VERCEL_ENV=production, soit (VERCEL_ENV vide) NODE_ENV=production.
  const estProduction = (vercel: string | undefined, node: string | undefined) => {
    const v = vercel?.trim();
    return v ? v === "production" : node === "production";
  };

  it("jamais vrai sans cle ; jamais vrai en production avec resend.dev (ni sous-domaine) ; jamais vrai en production sans domaine exploitable", () => {
    let combinaisons = 0;
    let vraisEnProduction = 0;
    for (const vercel of VERCELS) {
      for (const node of NODES) {
        for (const cle of CLES) {
          const prod = estProduction(vercel, node);
          const tous = [...EXPEDITEURS_RESEND, ...EXPEDITEURS_SANS_DOMAINE, ...EXPEDITEURS_PROPRES];
          for (const from of tous) {
            combinaisons++;
            const env = { VERCEL_ENV: vercel, NODE_ENV: node, RESEND_API_KEY: cle, EMAIL_FROM: from };
            const res = envoiReelPossible(env);
            const contexte = JSON.stringify(env);
            if (!cle?.trim()) expect(res, `cle absente : ${contexte}`).toBe(false);
            if (prod && EXPEDITEURS_RESEND.includes(from!)) expect(res, `resend.dev en production : ${contexte}`).toBe(false);
            if (prod && EXPEDITEURS_SANS_DOMAINE.includes(from)) expect(res, `sans domaine en production : ${contexte}`).toBe(false);
            if (prod && cle?.trim() && EXPEDITEURS_PROPRES.includes(from!)) {
              expect(res, `domaine propre refuse : ${contexte}`).toBe(true);
              vraisEnProduction++;
            }
            if (!prod && cle?.trim()) expect(res, `hors production avec cle : ${contexte}`).toBe(true);
          }
        }
      }
    }
    expect(combinaisons).toBe(VERCELS.length * NODES.length * CLES.length * 18);
    expect(vraisEnProduction).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// ordonnerParActiviteAncienne
// ---------------------------------------------------------------------------

describe("ordonnerParActiviteAncienne", () => {
  type Item = { id: string; derniereActivite: Date | null; nom?: string };
  const item = (id: string, derniereActivite: Date | null, nom?: string): Item => ({ id, derniereActivite, nom });
  const ids = (liste: Item[]) => liste.map((i) => i.id);

  it("tableau vide : tableau vide, nouvelle instance", () => {
    const entree: Item[] = [];
    const sortie = ordonnerParActiviteAncienne(entree);
    expect(sortie).toEqual([]);
    expect(sortie).not.toBe(entree);
  });

  it("un seul element : le meme element", () => {
    const a = item("a", jours(-5));
    expect(ordonnerParActiviteAncienne([a])).toEqual([a]);
  });

  it("la derniere activite la plus ANCIENNE passe en premier", () => {
    const recent = item("a", jours(-1));
    const ancien = item("b", jours(-400));
    const milieu = item("c", jours(-50));
    expect(ids(ordonnerParActiviteAncienne([recent, ancien, milieu]))).toEqual(["b", "c", "a"]);
    expect(ids(ordonnerParActiviteAncienne([milieu, recent, ancien]))).toEqual(["b", "c", "a"]);
    expect(ids(ordonnerParActiviteAncienne([ancien, milieu, recent]))).toEqual(["b", "c", "a"]);
  });

  it("une difference d'une seule milliseconde suffit a ordonner", () => {
    const a = item("a", new Date(T + 1));
    const b = item("b", new Date(T));
    expect(ids(ordonnerParActiviteAncienne([a, b]))).toEqual(["b", "a"]);
  });

  it("activite absente (null) : en DERNIER, apres la plus recente", () => {
    const sans = item("a", null);
    const recent = item("z", jours(-1));
    const futur = item("y", jours(500));
    expect(ids(ordonnerParActiviteAncienne([sans, recent, futur]))).toEqual(["z", "y", "a"]);
  });

  it("date invalide : traitee comme absente, en dernier", () => {
    const invalide = item("a", DATE_INVALIDE);
    const recent = item("z", jours(-1));
    expect(ids(ordonnerParActiviteAncienne([invalide, recent]))).toEqual(["z", "a"]);
  });

  it("absente et invalide sont a egalite : departagees par id", () => {
    const resultat = ordonnerParActiviteAncienne([
      item("c", null),
      item("a", DATE_INVALIDE),
      item("b", null),
      item("d", DATE_INVALIDE),
    ]);
    expect(ids(resultat)).toEqual(["a", "b", "c", "d"]);
  });

  it("sans aucune date : ordre par id, quel que soit l'ordre d'entree", () => {
    const a = item("a", null);
    const b = item("b", null);
    const c = item("c", null);
    expect(ids(ordonnerParActiviteAncienne([c, a, b]))).toEqual(["a", "b", "c"]);
    expect(ids(ordonnerParActiviteAncienne([b, c, a]))).toEqual(["a", "b", "c"]);
  });

  it("dates identiques : departage par id croissant", () => {
    const x = item("b", jours(-10));
    const y = item("a", jours(-10));
    const z = item("c", jours(-10));
    expect(ids(ordonnerParActiviteAncienne([x, z, y]))).toEqual(["a", "b", "c"]);
  });

  it("dates egales mais instances differentes (meme instant) : departage par id", () => {
    const a = item("b", new Date(T));
    const b = item("a", new Date(T));
    expect(ids(ordonnerParActiviteAncienne([a, b]))).toEqual(["a", "b"]);
  });

  it("la date prime sur l'id : un id plus petit mais une date plus recente passe apres", () => {
    const petitId = item("a", jours(-1));
    const grandId = item("z", jours(-2));
    expect(ids(ordonnerParActiviteAncienne([petitId, grandId]))).toEqual(["z", "a"]);
  });

  it("la comparaison des id est lexicographique (« 10 » avant « 9 »), comme les ObjectId hexadecimaux de meme longueur", () => {
    const resultat = ordonnerParActiviteAncienne([item("9", null), item("10", null), item("2", null)]);
    expect(ids(resultat)).toEqual(["10", "2", "9"]);
  });

  it("identifiants hexadecimaux de 24 caracteres : ordre croissant", () => {
    const x = "64b7f0c2a1b2c3d4e5f60718";
    const y = "64b7f0c2a1b2c3d4e5f60719";
    expect(ids(ordonnerParActiviteAncienne([item(y, null), item(x, null)]))).toEqual([x, y]);
  });

  it("l'epoque (timestamp 0) et les dates avant 1970 sont des dates valides, pas des valeurs absentes", () => {
    const epoque = item("a", new Date(0));
    const avant = item("b", new Date(-1000));
    const absente = item("c", null);
    expect(ids(ordonnerParActiviteAncienne([absente, epoque, avant]))).toEqual(["b", "a", "c"]);
  });

  it("derniere activite dans le futur : en dernier parmi les dates valides (mais avant les absentes)", () => {
    const futur = item("a", jours(100));
    const passe = item("b", jours(-100));
    const absente = item("c", null);
    expect(ids(ordonnerParActiviteAncienne([absente, futur, passe]))).toEqual(["b", "a", "c"]);
  });

  it("les elements gardent leurs champs supplementaires, et ce sont les MEMES objets", () => {
    const a = item("a", jours(-5), "alpha");
    const b = item("b", jours(-9), "beta");
    const [premier, second] = ordonnerParActiviteAncienne([a, b]);
    expect(premier).toBe(b);
    expect(second).toBe(a);
    expect(premier.nom).toBe("beta");
  });

  it("elements totalement identiques (meme id, meme date) : l'ordre d'entree est garde (tri stable)", () => {
    const x = item("a", jours(-5), "premier");
    const y = item("a", jours(-5), "second");
    const z = item("a", jours(-5), "troisieme");
    expect(ordonnerParActiviteAncienne([x, y, z]).map((i) => i.nom)).toEqual(["premier", "second", "troisieme"]);
    expect(ordonnerParActiviteAncienne([z, y, x]).map((i) => i.nom)).toEqual(["troisieme", "second", "premier"]);
  });

  it("n'altere ni le tableau recu, ni ses elements, ni les dates", () => {
    const entree = [item("c", jours(-1)), item("a", null), item("b", jours(-30)), item("d", DATE_INVALIDE)];
    const copieOrdre = [...entree];
    const dates = entree.map((i) => i.derniereActivite?.getTime());
    const sortie = ordonnerParActiviteAncienne(entree);
    expect(sortie).not.toBe(entree);
    entree.forEach((el, i) => expect(el).toBe(copieOrdre[i]));
    expect(entree).toHaveLength(4);
    expect(entree.map((i) => i.derniereActivite?.getTime())).toEqual(dates);
  });

  it("accepte un tableau gele (Object.freeze) sans lever d'exception", () => {
    const entree = Object.freeze([item("b", jours(-1)), item("a", jours(-2))]) as unknown as Item[];
    expect(ids(ordonnerParActiviteAncienne(entree))).toEqual(["a", "b"]);
  });

  it("deterministe : deux appels identiques donnent le meme ordre", () => {
    const entree = [item("c", jours(-1)), item("a", null), item("b", jours(-30))];
    expect(ids(ordonnerParActiviteAncienne(entree))).toEqual(ids(ordonnerParActiviteAncienne(entree)));
  });

  it("idempotent : trier un resultat deja trie ne change rien", () => {
    const entree = [item("c", jours(-1)), item("a", null), item("b", jours(-30)), item("e", DATE_INVALIDE), item("d", jours(-30))];
    const une = ordonnerParActiviteAncienne(entree);
    expect(ids(ordonnerParActiviteAncienne(une))).toEqual(ids(une));
  });

  it("grand tableau melange de facon deterministe : conforme a un oracle independant, et le meme quel que soit le melange", () => {
    const NB = 600;
    const tirer = generateur(20261030);
    // Beaucoup d'egalites de dates (42 jours possibles seulement), des absentes et des invalides.
    const base: Item[] = [];
    for (let i = 0; i < NB; i++) {
      const id = i.toString(16).padStart(24, "0");
      const choix = tirer(46);
      const date = choix < 3 ? null : choix === 3 ? new Date(NaN) : new Date(Date.UTC(2025, 0, 1) + (choix - 4) * JOUR_MS);
      base.push(item(id, date));
    }

    const melanger = (graine: number) => {
      const t = generateur(graine);
      const copie = [...base];
      for (let i = copie.length - 1; i > 0; i--) {
        const j = t(i + 1);
        [copie[i], copie[j]] = [copie[j], copie[i]];
      }
      return copie;
    };

    // Oracle : cle numerique (Infinity si absente ou invalide), puis id.
    const cle = (i: Item) => {
      const t = i.derniereActivite?.getTime();
      return t === undefined || Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
    };
    const attendu = [...base]
      .sort((a, b) => {
        if (cle(a) < cle(b)) return -1;
        if (cle(a) > cle(b)) return 1;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })
      .map((i) => i.id);

    const un = ordonnerParActiviteAncienne(melanger(1));
    const deux = ordonnerParActiviteAncienne(melanger(987654));
    expect(un).toHaveLength(NB);
    expect(ids(un)).toEqual(attendu);
    expect(ids(deux)).toEqual(attendu);
    // Garde-fou : le tableau melange n'est pas deja dans l'ordre attendu.
    expect(ids(melanger(1))).not.toEqual(attendu);
    // Les absentes et invalides sont bien toutes a la fin.
    const premiereSansDate = un.findIndex((i) => cle(i) === Number.POSITIVE_INFINITY);
    expect(premiereSansDate).toBeGreaterThan(0);
    expect(un.slice(premiereSansDate).every((i) => cle(i) === Number.POSITIVE_INFINITY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// actionConsommeBudget et budgetEpuise
// ---------------------------------------------------------------------------

describe("actionConsommeBudget", () => {
  const ACTIONS: DecisionNettoyage["action"][] = [
    "ignorer",
    "rien",
    "planifier_vide",
    "avertir_inactive",
    "annuler",
    "supprimer",
  ];
  const CONTEXTES = [
    { envoiReel: false, suppressionAuto: false },
    { envoiReel: true, suppressionAuto: false },
    { envoiReel: false, suppressionAuto: true },
    { envoiReel: true, suppressionAuto: true },
  ];

  // Attendu, ecrit en dur : action x (envoiReel, suppressionAuto).
  const TABLE: Record<DecisionNettoyage["action"], [boolean, boolean, boolean, boolean]> = {
    //                    FF     TF     FT     TT
    ignorer: [false, false, false, false],
    rien: [false, false, false, false],
    annuler: [false, false, false, false],
    planifier_vide: [false, true, false, true],
    avertir_inactive: [false, true, false, true],
    supprimer: [false, false, true, true],
  };

  for (const action of ACTIONS) {
    CONTEXTES.forEach((contexte, i) => {
      it(`${action} avec envoiReel=${contexte.envoiReel}, suppressionAuto=${contexte.suppressionAuto} : ${TABLE[action][i]}`, () => {
        expect(actionConsommeBudget(action, contexte)).toBe(TABLE[action][i]);
      });
    });
  }

  it("ignorer, rien et annuler ne consomment jamais le budget, meme avec tout ouvert", () => {
    for (const action of ["ignorer", "rien", "annuler"] as const) {
      expect(actionConsommeBudget(action, { envoiReel: true, suppressionAuto: true })).toBe(false);
    }
  });

  it("planifier_vide ne consomme que si l'envoi reel est possible (sinon le cron ne planifie rien), quel que soit l'interrupteur de suppression", () => {
    for (const c of CONTEXTES) expect(actionConsommeBudget("planifier_vide", c)).toBe(c.envoiReel);
  });

  it("supprimer en simulation (suppressionAuto faux) ne consomme pas : la simulation ne coute rien", () => {
    expect(actionConsommeBudget("supprimer", { envoiReel: true, suppressionAuto: false })).toBe(false);
  });

  it("avertir_inactive sans envoi possible ne consomme pas : rien n'est envoye", () => {
    expect(actionConsommeBudget("avertir_inactive", { envoiReel: false, suppressionAuto: true })).toBe(false);
  });

  it("une action inconnue (donnee abimee) ne consomme rien et ne leve rien", () => {
    const inconnue = "detruire_tout" as unknown as DecisionNettoyage["action"];
    for (const c of CONTEXTES) expect(actionConsommeBudget(inconnue, c)).toBe(false);
  });

  it("le contexte n'est pas modifie", () => {
    const contexte = Object.freeze({ envoiReel: true, suppressionAuto: true });
    expect(() => actionConsommeBudget("supprimer", contexte)).not.toThrow();
    expect(contexte).toEqual({ envoiReel: true, suppressionAuto: true });
  });
});

describe("MAX_ACTIONS_PAR_PASSAGE et budgetEpuise", () => {
  it("MAX_ACTIONS_PAR_PASSAGE vaut 50", () => {
    expect(MAX_ACTIONS_PAR_PASSAGE).toBe(50);
  });

  it.each([
    [0, false],
    [1, false],
    [49, false],
    [50, true],
    [51, true],
    [1000, true],
  ])("budgetEpuise(%s) avec le maximum par defaut : %s", (deja, attendu) => {
    expect(budgetEpuise(deja)).toBe(attendu);
  });

  it("borne exacte : 49 actions faites laissent encore la place a une 50e, 50 la ferment", () => {
    expect(budgetEpuise(MAX_ACTIONS_PAR_PASSAGE - 1)).toBe(false);
    expect(budgetEpuise(MAX_ACTIONS_PAR_PASSAGE)).toBe(true);
    expect(budgetEpuise(MAX_ACTIONS_PAR_PASSAGE + 1)).toBe(true);
  });

  it.each([
    [0, 3, false],
    [2, 3, false],
    [3, 3, true],
    [4, 3, true],
    [0, 1, false],
    [1, 1, true],
    [99, 100, false],
    [100, 100, true],
  ])("budgetEpuise(%s, %s) : %s", (deja, max, attendu) => {
    expect(budgetEpuise(deja, max)).toBe(attendu);
  });

  it("maximum 0 : epuise des le depart (aucune action permise)", () => {
    expect(budgetEpuise(0, 0)).toBe(true);
  });

  it("maximum negatif : epuise (rien n'est permis)", () => {
    expect(budgetEpuise(0, -1)).toBe(true);
  });

  it("maximum infini : jamais epuise", () => {
    expect(budgetEpuise(1_000_000, Infinity)).toBe(false);
  });

  it("le maximum passe explicitement l'emporte sur la valeur par defaut", () => {
    expect(budgetEpuise(50, 51)).toBe(false);
    expect(budgetEpuise(10, 10)).toBe(true);
  });

  it("reproduit la boucle du cron : 120 planifications consecutives, seules 50 sont faites, le reste est tronque", () => {
    const contexte = { envoiReel: true, suppressionAuto: true };
    let faites = 0;
    let tronquees = 0;
    for (let i = 0; i < 120; i++) {
      if (actionConsommeBudget("planifier_vide", contexte)) {
        if (budgetEpuise(faites)) {
          tronquees++;
          continue;
        }
        faites++;
      }
    }
    expect(faites).toBe(50);
    expect(tronquees).toBe(70);
  });

  it("reproduit la boucle du cron : 1000 'rien' et 'ignorer' ne consomment aucun budget", () => {
    const contexte = { envoiReel: true, suppressionAuto: true };
    let faites = 0;
    for (let i = 0; i < 1000; i++) {
      const action = i % 2 === 0 ? "rien" : "ignorer";
      if (actionConsommeBudget(action, contexte)) faites++;
    }
    expect(faites).toBe(0);
    expect(budgetEpuise(faites)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// joursInactivite
// ---------------------------------------------------------------------------

describe("joursInactivite", () => {
  it("meme instant : 0", () => {
    expect(joursInactivite(MAINTENANT, MAINTENANT)).toBe(0);
  });

  it("exactement 90 jours : 90", () => {
    expect(joursInactivite(new Date(T - INACTIVITE_MS), MAINTENANT)).toBe(90);
  });

  it("90 jours moins 1 ms : 89 (arrondi vers le bas)", () => {
    expect(joursInactivite(new Date(T - INACTIVITE_MS + 1), MAINTENANT)).toBe(89);
  });

  it("90 jours plus 1 ms : 90", () => {
    expect(joursInactivite(new Date(T - INACTIVITE_MS - 1), MAINTENANT)).toBe(90);
  });

  it("90 jours et 23 h 59 min 59,999 s : 90 (floor, jamais 91)", () => {
    expect(joursInactivite(new Date(T - INACTIVITE_MS - JOUR_MS + 1), MAINTENANT)).toBe(90);
  });

  it("floor et non arrondi : 1,9 jour => 1", () => {
    expect(joursInactivite(new Date(T - 1.9 * JOUR_MS), MAINTENANT)).toBe(1);
  });

  it("23 h 59 : 0 jour", () => {
    expect(joursInactivite(new Date(T - JOUR_MS + 1), MAINTENANT)).toBe(0);
  });

  it("exactement 1 jour : 1", () => {
    expect(joursInactivite(new Date(T - JOUR_MS), MAINTENANT)).toBe(1);
  });

  it("jamais negatif : activite 1 ms dans le futur => 0", () => {
    expect(joursInactivite(new Date(T + 1), MAINTENANT)).toBe(0);
  });

  it("jamais negatif : activite dans un futur lointain => 0", () => {
    expect(joursInactivite(new Date(T + 5000 * JOUR_MS), MAINTENANT)).toBe(0);
    expect(joursInactivite(new Date(8.64e15), MAINTENANT)).toBe(0);
  });

  it("le resultat n'est jamais -0", () => {
    expect(Object.is(joursInactivite(new Date(T + 1), MAINTENANT), 0)).toBe(true);
    expect(Object.is(joursInactivite(MAINTENANT, MAINTENANT), 0)).toBe(true);
  });

  it("derniere activite invalide : 0", () => {
    expect(joursInactivite(DATE_INVALIDE, MAINTENANT)).toBe(0);
    expect(joursInactivite(new Date(NaN), MAINTENANT)).toBe(0);
  });

  it("maintenant invalide : 0", () => {
    expect(joursInactivite(jours(-100), DATE_INVALIDE)).toBe(0);
  });

  it("les deux dates invalides : 0", () => {
    expect(joursInactivite(DATE_INVALIDE, DATE_INVALIDE)).toBe(0);
  });

  it("comportement reel : null leve une TypeError (le type exige une Date ; entreeDepuisColocation n'en donne jamais null)", () => {
    expect(() => joursInactivite(null as unknown as Date, MAINTENANT)).toThrow(TypeError);
    expect(() => joursInactivite(undefined as unknown as Date, MAINTENANT)).toThrow(TypeError);
  });

  it("dates extremes de Date : entier fini, pas d'exception", () => {
    const n = joursInactivite(new Date(-8.64e15), new Date(8.64e15));
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBe(Math.floor(1.728e16 / JOUR_MS));
  });

  it("l'epoque : 1970-01-01 donne le nombre de jours exact jusqu'a maintenant", () => {
    expect(joursInactivite(new Date(0), MAINTENANT)).toBe(Math.floor(T / JOUR_MS));
  });

  it("dates ISO avec Z, ecart de 100 jours ronds : 100", () => {
    expect(joursInactivite(d("2026-07-22T12:00:00.000Z"), MAINTENANT)).toBe(100);
  });

  it("changement d'heure d'ete (28 mars 2026) : les jours sont des jours de 24 h en UTC, pas de decalage", () => {
    expect(joursInactivite(d("2026-03-27T12:00:00.000Z"), d("2026-03-29T12:00:00.000Z"))).toBe(2);
    expect(joursInactivite(d("2026-10-24T12:00:00.000Z"), d("2026-10-26T12:00:00.000Z"))).toBe(2);
  });

  it("ne modifie pas les dates recues", () => {
    const a = jours(-100);
    const m = new Date(T);
    joursInactivite(a, m);
    expect(a.getTime()).toBe(T - 100 * JOUR_MS);
    expect(m.getTime()).toBe(T);
  });

  it("100 ecarts pseudo-aleatoires : toujours un entier >= 0, et monotone avec l'ecart", () => {
    const tirer = generateur(424242);
    for (let i = 0; i < 100; i++) {
      const ecart = tirer(1_000_000_000) * 10; // jusqu'a ~ 115 jours, en ms
      const n = joursInactivite(new Date(T - ecart), MAINTENANT);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBe(Math.floor(ecart / JOUR_MS));
      expect(joursInactivite(new Date(T - ecart - JOUR_MS), MAINTENANT)).toBe(n + 1);
    }
  });

  it("coherence avec evaluerNettoyage : au premier instant ou une colocation est avertie (90 jours + 1 ms), le mail dit 90 jours, pas moins", () => {
    const activite = new Date(T - INACTIVITE_MS - 1);
    const decision = evaluerNettoyage(
      { nombreMembres: 2, creeLe: jours(-500), derniereActivite: activite },
      MAINTENANT
    );
    expect(decision.action).toBe("avertir_inactive");
    expect(joursInactivite(activite, MAINTENANT)).toBe(DELAI_INACTIVITE_JOURS);
  });
});

// ---------------------------------------------------------------------------
// entreeDepuisColocation
// ---------------------------------------------------------------------------

describe("entreeDepuisColocation", () => {
  const ID = new Types.ObjectId("507f1f77bcf86cd799439011");

  const colocation = (surcharge: Partial<ColocationLue> = {}): ColocationLue => ({
    _id: ID,
    name: "Les Lilas",
    createdAt: jours(-500),
    members: [{ userId: "u1" }, { userId: "u2" }],
    ...surcharge,
  });

  const estInvalide = (date: Date) => date instanceof Date && Number.isNaN(date.getTime());

  describe("membres", () => {
    it("members absent : 0 membre (comportement voulu, les filtres Mongo members.0 protegent l'ecriture)", () => {
      expect(entreeDepuisColocation(colocation({ members: undefined }), jours(-1)).nombreMembres).toBe(0);
    });

    it("members null (donnee abimee) : 0 membre", () => {
      const c = colocation({ members: null as unknown as undefined });
      expect(entreeDepuisColocation(c, jours(-1)).nombreMembres).toBe(0);
    });

    it("members vide : 0 membre", () => {
      expect(entreeDepuisColocation(colocation({ members: [] }), jours(-1)).nombreMembres).toBe(0);
    });

    it.each([1, 2, 7, 300])("%s membres : %s", (n) => {
      const members = Array.from({ length: n }, (_, i) => ({ userId: `u${i}` }));
      expect(entreeDepuisColocation(colocation({ members }), jours(-1)).nombreMembres).toBe(n);
    });

    it("nombreMembres est toujours un entier >= 0 accepte par evaluerNettoyage (jamais de RangeError)", () => {
      for (const members of [undefined, [], [{}], [{}, {}, {}]]) {
        const entree = entreeDepuisColocation(colocation({ members }), jours(-1));
        expect(() => evaluerNettoyage(entree, MAINTENANT)).not.toThrow();
      }
    });
  });

  describe("dates absentes", () => {
    it("createdAt absent : date INVALIDE (pas une date par defaut qui ressemblerait a une vraie)", () => {
      const e = entreeDepuisColocation(colocation({ createdAt: undefined }), jours(-1));
      expect(e.creeLe).toBeInstanceOf(Date);
      expect(estInvalide(e.creeLe)).toBe(true);
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
    ])("derniere activite %s : date INVALIDE", (_nom, activite) => {
      const e = entreeDepuisColocation(colocation(), activite);
      expect(e.derniereActivite).toBeInstanceOf(Date);
      expect(estInvalide(e.derniereActivite)).toBe(true);
    });

    it("derniere activite valide : recopiee telle quelle (meme instance)", () => {
      const activite = jours(-10);
      expect(entreeDepuisColocation(colocation(), activite).derniereActivite).toBe(activite);
    });

    it("derniere activite deja invalide : reste invalide, n'est pas remplacee par autre chose", () => {
      const e = entreeDepuisColocation(colocation(), DATE_INVALIDE);
      expect(e.derniereActivite).toBe(DATE_INVALIDE);
    });

    it("l'epoque (timestamp 0) comme activite est une date valide, pas une absence", () => {
      const e = entreeDepuisColocation(colocation(), new Date(0));
      expect(e.derniereActivite.getTime()).toBe(0);
    });

    it("createdAt valide : recopie telle quelle (meme instance)", () => {
      const cree = jours(-123);
      expect(entreeDepuisColocation(colocation({ createdAt: cree }), jours(-1)).creeLe).toBe(cree);
    });

    it("deux appels donnent deux dates invalides DISTINCTES (pas d'instance partagee modifiable)", () => {
      const a = entreeDepuisColocation(colocation({ createdAt: undefined }), null);
      const b = entreeDepuisColocation(colocation({ createdAt: undefined }), null);
      expect(a.creeLe).not.toBe(b.creeLe);
      expect(a.derniereActivite).not.toBe(b.derniereActivite);
      expect(a.creeLe).not.toBe(a.derniereActivite);
    });
  });

  describe("une date absente ne mene JAMAIS a une suppression sur cette seule base", () => {
    const echuInactive = {
      avertieLe: jours(-100),
      suppressionPrevueLe: jours(-70),
      motifSuppression: "inactive",
    };

    it("membres, createdAt ET activite absents, plan d'inactivite echu : rien (jamais supprimer)", () => {
      const e = entreeDepuisColocation(colocation({ createdAt: undefined, ...echuInactive }), undefined);
      expect(evaluerNettoyage(e, MAINTENANT)).toEqual({ action: "rien" });
    });

    it("membres, createdAt ET activite absents, sans plan : rien (pas d'avertissement non plus)", () => {
      const e = entreeDepuisColocation(colocation({ createdAt: undefined }), null);
      expect(evaluerNettoyage(e, MAINTENANT)).toEqual({ action: "rien" });
    });

    it("grille : plan d'inactivite echu x membres x dates absentes ou invalides : jamais supprimer", () => {
      let essais = 0;
      for (const members of [[{ userId: "u1" }], [{ userId: "u1" }, { userId: "u2" }]]) {
        for (const createdAt of [undefined, DATE_INVALIDE]) {
          for (const activite of [undefined, null, DATE_INVALIDE]) {
            for (const avertie of [undefined, null, jours(-100), jours(-31), jours(5)]) {
              for (const echeance of [undefined, null, jours(-70), jours(-1), jours(0)]) {
                for (const motif of [undefined, null, "inactive", "vide", "bizarre"]) {
                  essais++;
                  const c = colocation({
                    members,
                    createdAt,
                    avertieLe: avertie,
                    suppressionPrevueLe: echeance,
                    motifSuppression: motif,
                  });
                  const decision = evaluerNettoyage(entreeDepuisColocation(c, activite), MAINTENANT);
                  if (decision.action === "supprimer") {
                    throw new Error(`suppression sans date valide : ${JSON.stringify(c)} activite=${String(activite)}`);
                  }
                }
              }
            }
          }
        }
      }
      expect(essais).toBe(2 * 2 * 3 * 5 * 5 * 5);
    });

    it("activite absente mais createdAt connue et ancienne, sans plan : avertir_inactive (la creation compte comme activite)", () => {
      const e = entreeDepuisColocation(colocation({ createdAt: jours(-200) }), undefined);
      expect(evaluerNettoyage(e, MAINTENANT).action).toBe("avertir_inactive");
    });

    it("activite absente + creation ancienne => avertir_inactive, et le nombre de jours du mail se calcule sur la plus recente des deux dates (jamais 0)", () => {
      // executerNettoyage calcule les jours avec plusRecenteDateValide(activite,
      // creation) : meme reference que la decision, qui compte la creation.
      const entree = entreeDepuisColocation(colocation({ createdAt: jours(-200) }), undefined);
      expect(evaluerNettoyage(entree, MAINTENANT).action).toBe("avertir_inactive");
      const reference = plusRecenteDateValide(entree.derniereActivite, entree.creeLe, MAINTENANT);
      expect(joursInactivite(reference, MAINTENANT)).toBeGreaterThan(DELAI_INACTIVITE_JOURS);
    });

    describe("plusRecenteDateValide", () => {
      it("prend la plus recente des deux dates valides", () => {
        expect(plusRecenteDateValide(jours(-5), jours(-200), MAINTENANT)).toEqual(jours(-5));
        expect(plusRecenteDateValide(jours(-200), jours(-5), MAINTENANT)).toEqual(jours(-5));
      });
      it("ignore une date absente ou invalide, et se replie sur `repli` sans aucune date valide", () => {
        expect(plusRecenteDateValide(new Date("x"), jours(-30), MAINTENANT)).toEqual(jours(-30));
        expect(plusRecenteDateValide(null, undefined, MAINTENANT)).toEqual(MAINTENANT);
        expect(plusRecenteDateValide(new Date("x"), new Date("y"), MAINTENANT)).toEqual(MAINTENANT);
      });
    });

    it("activite absente mais createdAt recente : rien", () => {
      const e = entreeDepuisColocation(colocation({ createdAt: jours(-10) }), undefined);
      expect(evaluerNettoyage(e, MAINTENANT)).toEqual({ action: "rien" });
    });

    it("createdAt absente mais activite recente : rien ; activite ancienne : avertir_inactive", () => {
      expect(evaluerNettoyage(entreeDepuisColocation(colocation({ createdAt: undefined }), jours(-5)), MAINTENANT)).toEqual({
        action: "rien",
      });
      expect(
        evaluerNettoyage(entreeDepuisColocation(colocation({ createdAt: undefined }), jours(-200)), MAINTENANT).action
      ).toBe("avertir_inactive");
    });

    it("plan d'inactivite echu et coherent avec une activite connue ancienne : la chaine complete mene bien a supprimer (le test n'est pas vide)", () => {
      const e = entreeDepuisColocation(
        colocation({
          createdAt: jours(-500),
          avertieLe: jours(-30),
          suppressionPrevueLe: jours(0),
          motifSuppression: "inactive",
        }),
        jours(-130)
      );
      expect(evaluerNettoyage(e, MAINTENANT)).toEqual({ action: "supprimer", motif: "inactive" });
    });

    it("members absent sans plan : planifier_vide (jamais supprimer d'emblee) avec une echeance a 30 jours", () => {
      const e = entreeDepuisColocation(colocation({ members: undefined }), jours(-1));
      const decision = evaluerNettoyage(e, MAINTENANT);
      expect(decision.action).toBe("planifier_vide");
    });

    it("members absent avec un plan « vide » coherent et echu : supprimer motif vide (le dernier rempart est le filtre Mongo « members.0 inexistant » du verrou)", () => {
      const e = entreeDepuisColocation(
        colocation({
          members: undefined,
          videDepuis: jours(-40),
          suppressionPrevueLe: jours(-10),
          motifSuppression: "vide",
        }),
        jours(-1)
      );
      expect(evaluerNettoyage(e, MAINTENANT)).toEqual({ action: "supprimer", motif: "vide" });
    });
  });

  describe("champ demo", () => {
    it("demo absent : recopie tel quel (undefined)", () => {
      expect(entreeDepuisColocation(colocation(), jours(-1)).demo).toBeUndefined();
    });

    it("demo null : recopie tel quel (null)", () => {
      expect(entreeDepuisColocation(colocation({ demo: null }), jours(-1)).demo).toBeNull();
    });

    it("demo false : false", () => {
      expect(entreeDepuisColocation(colocation({ demo: false }), jours(-1)).demo).toBe(false);
    });

    it("demo true : true", () => {
      expect(entreeDepuisColocation(colocation({ demo: true }), jours(-1)).demo).toBe(true);
    });

    it("une colocation demo est ignoree, meme vide avec plan echu et sans aucune date", () => {
      const e = entreeDepuisColocation(
        colocation({
          demo: true,
          members: [],
          createdAt: undefined,
          videDepuis: jours(-100),
          suppressionPrevueLe: jours(-70),
          motifSuppression: "vide",
        }),
        null
      );
      expect(evaluerNettoyage(e, MAINTENANT)).toEqual({ action: "ignorer" });
    });

    it("demo absent ou false ne protege pas : une colocation vide avec plan echu est supprimable", () => {
      for (const demo of [undefined, null, false]) {
        const e = entreeDepuisColocation(
          colocation({
            demo,
            members: [],
            videDepuis: jours(-100),
            suppressionPrevueLe: jours(-70),
            motifSuppression: "vide",
          }),
          jours(-500)
        );
        expect(evaluerNettoyage(e, MAINTENANT)).toEqual({ action: "supprimer", motif: "vide" });
      }
    });
  });

  describe("champs de plan recopies tels quels", () => {
    it("les quatre champs de plan et leurs instances", () => {
      const videDepuis = jours(-40);
      const avertieLe = jours(-35);
      const suppressionPrevueLe = jours(-5);
      const e = entreeDepuisColocation(
        colocation({ videDepuis, avertieLe, suppressionPrevueLe, motifSuppression: "inactive" }),
        jours(-1)
      );
      expect(e.videDepuis).toBe(videDepuis);
      expect(e.avertieLe).toBe(avertieLe);
      expect(e.suppressionPrevueLe).toBe(suppressionPrevueLe);
      expect(e.motifSuppression).toBe("inactive");
    });

    it("champs absents : restent undefined (pas de valeur par defaut inventee)", () => {
      const e = entreeDepuisColocation(colocation(), jours(-1));
      expect(e.videDepuis).toBeUndefined();
      expect(e.avertieLe).toBeUndefined();
      expect(e.suppressionPrevueLe).toBeUndefined();
      expect(e.motifSuppression).toBeUndefined();
    });

    it("champs null : restent null", () => {
      const e = entreeDepuisColocation(
        colocation({ videDepuis: null, avertieLe: null, suppressionPrevueLe: null, motifSuppression: null }),
        jours(-1)
      );
      expect(e.videDepuis).toBeNull();
      expect(e.avertieLe).toBeNull();
      expect(e.suppressionPrevueLe).toBeNull();
      expect(e.motifSuppression).toBeNull();
    });

    it("dates de plan invalides : recopiees invalides, pas corrigees", () => {
      const e = entreeDepuisColocation(colocation({ avertieLe: DATE_INVALIDE }), jours(-1));
      expect(e.avertieLe).toBe(DATE_INVALIDE);
    });

    it("motif inconnu : recopie tel quel (c'est evaluerNettoyage qui le traite comme absent)", () => {
      const e = entreeDepuisColocation(colocation({ motifSuppression: "bizarre" }), jours(-1));
      expect(e.motifSuppression).toBe("bizarre");
    });

    it("l'entree contient EXACTEMENT les huit champs attendus : ni nom, ni identifiant, ni destructionDebut", () => {
      const e = entreeDepuisColocation(
        colocation({ destructionDebut: jours(0), name: "Secret" }),
        jours(-1)
      );
      expect(Object.keys(e).sort()).toEqual(
        [
          "avertieLe",
          "creeLe",
          "demo",
          "derniereActivite",
          "motifSuppression",
          "nombreMembres",
          "suppressionPrevueLe",
          "videDepuis",
        ].sort()
      );
      expect(JSON.stringify(e)).not.toContain("Secret");
    });

    it("destructionDebut n'est pas transmis a l'evaluation : une destruction en cours ne change pas la decision (le verrou est gere par l'ecriture Mongo)", () => {
      const sans = entreeDepuisColocation(colocation(), jours(-10));
      const avec = entreeDepuisColocation(colocation({ destructionDebut: jours(0) }), jours(-10));
      expect(evaluerNettoyage(avec, MAINTENANT)).toEqual(evaluerNettoyage(sans, MAINTENANT));
    });
  });

  describe("purete", () => {
    it("n'altere pas la colocation recue (objet et tableau gelés acceptes)", () => {
      const createdAt = jours(-300);
      const members = Object.freeze([Object.freeze({ userId: "u1" })]) as unknown as unknown[];
      const c = Object.freeze(
        colocation({
          createdAt,
          members,
          avertieLe: jours(-40),
          suppressionPrevueLe: jours(-10),
          motifSuppression: "inactive",
          demo: false,
        })
      );
      const avant = { ...c };
      const tCree = createdAt.getTime();
      const activite = jours(-5);
      const tActivite = activite.getTime();
      expect(() => entreeDepuisColocation(c, activite)).not.toThrow();
      expect({ ...c }).toEqual(avant);
      expect(c.members).toBe(members);
      expect(createdAt.getTime()).toBe(tCree);
      expect(activite.getTime()).toBe(tActivite);
    });

    it("deterministe : deux appels identiques donnent la meme entree", () => {
      const c = colocation({ avertieLe: jours(-40), suppressionPrevueLe: jours(-10), motifSuppression: "inactive" });
      const activite = jours(-130);
      expect(entreeDepuisColocation(c, activite)).toEqual(entreeDepuisColocation(c, activite));
    });
  });
});

// ===========================================================================
// AJOUTS : garde d'envoi (EMAIL_REDIRECT_TO, NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE),
// plafonds, retard d'echeance. Toujours des fonctions pures, sans base ni mock.
// ===========================================================================

// ---------------------------------------------------------------------------
// envoiReelPossible : redirection de test et exception de test reel
// ---------------------------------------------------------------------------

describe("envoiReelPossible : EMAIL_REDIRECT_TO et NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE", () => {
  const CIBLE = "test@exemple.fr";
  const FROM_TEST = "RoomFlow <onboarding@resend.dev>";
  const FROM_PROPRE = "RoomFlow <noreply@roomflow.app>";
  const HORS_PROD = { VERCEL_ENV: "development", RESEND_API_KEY: "re_cle" };
  const PROD = { VERCEL_ENV: "production", RESEND_API_KEY: "re_cle" };

  describe("hors production, sans redirection active : l'exception n'a aucun role", () => {
    it.each([
      ["EMAIL_REDIRECT_TO absent", undefined],
      ["EMAIL_REDIRECT_TO vide", ""],
      ["EMAIL_REDIRECT_TO en espaces", "   "],
      ["EMAIL_REDIRECT_TO tabulation et retour", "\t\n"],
    ])("%s : vrai avec la cle, quelle que soit la valeur de l'exception", (_nom, redirection) => {
      for (const accepter of [undefined, "", "true", "false", "TRUE", "1"]) {
        expect(
          envoiReelPossible({
            ...HORS_PROD,
            EMAIL_REDIRECT_TO: redirection,
            NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: accepter,
          }),
          `accepter=${JSON.stringify(accepter)}`
        ).toBe(true);
      }
    });

    it("sans cle Resend : faux, meme avec l'exception a \"true\"", () => {
      expect(envoiReelPossible({ VERCEL_ENV: "development", NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: "true" })).toBe(false);
      expect(envoiReelPossible({ NODE_ENV: "development", NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: "true" })).toBe(false);
    });
  });

  describe("hors production, redirection ACTIVE : vrai seulement avec \"true\" exactement", () => {
    it("exception absente : faux (un envoi redirige n'est pas un preavis)", () => {
      expect(envoiReelPossible({ ...HORS_PROD, EMAIL_REDIRECT_TO: CIBLE })).toBe(false);
      expect(
        envoiReelPossible({ ...HORS_PROD, EMAIL_REDIRECT_TO: CIBLE, NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: undefined })
      ).toBe(false);
    });

    it("exception a \"true\" exactement : vrai", () => {
      expect(
        envoiReelPossible({ ...HORS_PROD, EMAIL_REDIRECT_TO: CIBLE, NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: "true" })
      ).toBe(true);
    });

    it.each([
      ["chaine vide", ""],
      ["espaces", "   "],
      ["majuscules", "TRUE"],
      ["premiere lettre en majuscule", "True"],
      ["melange", "tRuE"],
      ["un", "1"],
      ["yes", "yes"],
      ["oui", "oui"],
      ["on", "on"],
      ["false", "false"],
      ["zero", "0"],
      ["espace devant", " true"],
      ["espace derriere", "true "],
      ["retour a la ligne derriere", "true\n"],
      ["tabulation devant", "\ttrue"],
      ["guillemets inclus", "\"true\""],
      ["apostrophes incluses", "'true'"],
      ["true suivi d'un caractere invisible U+200B", "true​"],
      ["true avec un t cyrillique (U+0442)", "тrue"],
      ["truee", "truee"],
      ["tru", "tru"],
    ])("exception %s (%j) : faux", (_nom, accepter) => {
      expect(
        envoiReelPossible({ ...HORS_PROD, EMAIL_REDIRECT_TO: CIBLE, NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: accepter })
      ).toBe(false);
    });

    it("exception \"true\" mais cle Resend absente, vide ou en espaces : faux", () => {
      for (const cle of [undefined, "", "   "]) {
        expect(
          envoiReelPossible({
            VERCEL_ENV: "development",
            RESEND_API_KEY: cle,
            EMAIL_REDIRECT_TO: CIBLE,
            NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: "true",
          })
        ).toBe(false);
      }
    });

    it("une adresse de redirection entouree d'espaces reste une redirection ACTIVE (redirectionActive la trim)", () => {
      expect(envoiReelPossible({ ...HORS_PROD, EMAIL_REDIRECT_TO: `  ${CIBLE}  ` })).toBe(false);
      expect(
        envoiReelPossible({ ...HORS_PROD, EMAIL_REDIRECT_TO: `  ${CIBLE}  `, NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: "true" })
      ).toBe(true);
    });

    it("la valeur de EMAIL_REDIRECT_TO n'est pas validee : n'importe quel texte non vide active la redirection", () => {
      // Meme choix que redirectionActive (voir email.test.ts) : prudent, une
      // valeur absurde ferme la garde plutot que de l'ouvrir.
      expect(envoiReelPossible({ ...HORS_PROD, EMAIL_REDIRECT_TO: "pas-une-adresse" })).toBe(false);
      expect(envoiReelPossible({ ...HORS_PROD, EMAIL_REDIRECT_TO: "0" })).toBe(false);
      expect(envoiReelPossible({ ...HORS_PROD, EMAIL_REDIRECT_TO: "false" })).toBe(false);
    });

    it("EMAIL_FROM n'a aucune influence hors production, avec ou sans redirection", () => {
      for (const from of [undefined, "", FROM_TEST, FROM_PROPRE, "n'importe quoi"]) {
        const env = { ...HORS_PROD, EMAIL_FROM: from, EMAIL_REDIRECT_TO: CIBLE };
        expect(envoiReelPossible(env)).toBe(false);
        expect(envoiReelPossible({ ...env, NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: "true" })).toBe(true);
      }
    });

    it.each([
      ["VERCEL_ENV=preview", { VERCEL_ENV: "preview" }],
      ["VERCEL_ENV=preview et NODE_ENV=production (preview Vercel)", { VERCEL_ENV: "preview", NODE_ENV: "production" }],
      ["VERCEL_ENV=development", { VERCEL_ENV: "development" }],
      ["NODE_ENV=development", { NODE_ENV: "development" }],
      ["NODE_ENV=test", { NODE_ENV: "test" }],
      ["aucune variable d'environnement", {}],
    ])("%s : meme regle (faux sans exception, vrai avec)", (_nom, env) => {
      const base = { ...env, RESEND_API_KEY: "re_cle", EMAIL_REDIRECT_TO: CIBLE };
      expect(envoiReelPossible(base)).toBe(false);
      expect(envoiReelPossible({ ...base, NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: "true" })).toBe(true);
    });
  });

  describe("production : les deux variables de test ne sont JAMAIS lues", () => {
    it("redirection + exception \"true\" + resend.dev : FAUX", () => {
      expect(
        envoiReelPossible({
          ...PROD,
          EMAIL_FROM: FROM_TEST,
          EMAIL_REDIRECT_TO: CIBLE,
          NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: "true",
        })
      ).toBe(false);
    });

    it("redirection + exception \"true\" + EMAIL_FROM absent : FAUX (email.ts retombe alors sur resend.dev)", () => {
      expect(
        envoiReelPossible({ ...PROD, EMAIL_REDIRECT_TO: CIBLE, NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: "true" })
      ).toBe(false);
    });

    it("vrai domaine : vrai quelle que soit la redirection et l'exception", () => {
      for (const redirection of [undefined, "", "   ", CIBLE, "n'importe quoi"]) {
        for (const accepter of [undefined, "", "true", "false", "TRUE"]) {
          expect(
            envoiReelPossible({
              ...PROD,
              EMAIL_FROM: FROM_PROPRE,
              EMAIL_REDIRECT_TO: redirection,
              NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: accepter,
            }),
            `redirection=${JSON.stringify(redirection)} accepter=${JSON.stringify(accepter)}`
          ).toBe(true);
        }
      }
    });

    it("sans cle Resend : faux, meme avec vrai domaine, redirection et exception", () => {
      expect(
        envoiReelPossible({
          VERCEL_ENV: "production",
          EMAIL_FROM: FROM_PROPRE,
          EMAIL_REDIRECT_TO: CIBLE,
          NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: "true",
        })
      ).toBe(false);
    });

    it.each([
      ["VERCEL_ENV=production", { VERCEL_ENV: "production" }],
      ["VERCEL_ENV=production et NODE_ENV=development", { VERCEL_ENV: "production", NODE_ENV: "development" }],
      ["NODE_ENV=production sans VERCEL_ENV", { NODE_ENV: "production" }],
      ["NODE_ENV=production et VERCEL_ENV vide", { NODE_ENV: "production", VERCEL_ENV: "" }],
      ["NODE_ENV=production et VERCEL_ENV en espaces", { NODE_ENV: "production", VERCEL_ENV: "   " }],
      ["VERCEL_ENV=  production  (espaces)", { VERCEL_ENV: "  production  " }],
    ])("%s : redirection + exception ne rouvrent pas resend.dev", (_nom, env) => {
      expect(
        envoiReelPossible({
          ...env,
          RESEND_API_KEY: "re_cle",
          EMAIL_FROM: "a@resend.dev",
          EMAIL_REDIRECT_TO: CIBLE,
          NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: "true",
        })
      ).toBe(false);
    });

    it("l'environnement est lu de la meme facon que redirectionActive : preview n'est pas la production", () => {
      const env = {
        VERCEL_ENV: "preview",
        NODE_ENV: "production",
        RESEND_API_KEY: "re_cle",
        EMAIL_FROM: FROM_TEST,
        EMAIL_REDIRECT_TO: CIBLE,
      };
      expect(envoiReelPossible(env)).toBe(false);
      expect(envoiReelPossible({ ...env, NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: "true" })).toBe(true);
    });
  });

  it("l'objet env n'est pas modifie (objet gele accepte)", () => {
    const env = Object.freeze({
      ...HORS_PROD,
      EMAIL_REDIRECT_TO: CIBLE,
      NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: "true",
    });
    expect(() => envoiReelPossible(env)).not.toThrow();
    expect(env.NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE).toBe("true");
  });
});

describe("envoiReelPossible : invariants avec redirection et exception (grille)", () => {
  const VERCELS = [undefined, "", "   ", "production", "  production ", "preview", "development", "Production"];
  const NODES = [undefined, "development", "test", "production", "Production"];
  const CLES = [undefined, "", "  ", "re_cle"];
  const REDIRECTIONS = [undefined, "", "   ", "\t", "test@exemple.fr", "  test@exemple.fr  ", "x"];
  const ACCEPTER = [undefined, "", "true", "false", "TRUE", "True", " true", "true ", "1", "yes", "true\n"];
  // Adresses qui, en production, ne doivent JAMAIS donner « vrai ».
  const FROMS_RESEND = [
    "a@resend.dev",
    "A@RESEND.DEV",
    "RoomFlow <onboarding@resend.dev>",
    "Nom <a@Resend.Dev>",
    "  a@resend.dev  ",
    "a@mail.resend.dev",
    "a@x.y.RESEND.dev",
    "a@resend.dev.",
    "a@mail.resend.dev.",
    "a@resend.dev​",
    "a@resend.dev⁠",
    "a@b.fr@resend.dev",
    "b@b.fr <vrai@resend.dev>",
    "Nom <a@resend.dev> <b@b.fr>",
    "RoomFlow <delivered@resend.dev>",
  ];
  const FROMS_ILLISIBLES = [undefined, "", "   ", "sans-arobase", "a@", "@b.fr", "a@localhost", "<>", "Nom <>"];
  const FROMS_PROPRES = ["a@b.fr", "RoomFlow <noreply@roomflow.app>", "  A@B.FR  "];

  // Oracle ecrit independamment du code (memes regles lues dans le CLAUDE.md et
  // dans les commentaires) : production = VERCEL_ENV "production" ; sans
  // VERCEL_ENV, NODE_ENV "production". Sensible a la casse.
  const estProduction = (vercel: string | undefined, node: string | undefined) => {
    const v = vercel?.trim();
    return v ? v === "production" : node === "production";
  };

  it("production + resend.dev (ou illisible) : jamais vrai ; hors production : conforme a l'oracle ; 5 variables croisees", () => {
    let combinaisons = 0;
    let vraisHorsProd = 0;
    let vraisProd = 0;
    const ecarts: string[] = [];
    for (const vercel of VERCELS) {
      for (const node of NODES) {
        for (const cle of CLES) {
          for (const redirection of REDIRECTIONS) {
            for (const accepter of ACCEPTER) {
              for (const from of [...FROMS_RESEND, ...FROMS_ILLISIBLES, ...FROMS_PROPRES]) {
                combinaisons++;
                const env = {
                  VERCEL_ENV: vercel,
                  NODE_ENV: node,
                  RESEND_API_KEY: cle,
                  EMAIL_FROM: from,
                  EMAIL_REDIRECT_TO: redirection,
                  NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: accepter,
                };
                const res = envoiReelPossible(env);
                const prod = estProduction(vercel, node);
                const aCle = Boolean(cle?.trim());

                // Resultat attendu selon l'oracle. Les ecarts sont collectes puis
                // verifies une seule fois : un expect par combinaison (plus de
                // 600 000) depasserait le delai du test.
                let attendu: boolean;
                if (!aCle) {
                  attendu = false;
                } else if (prod) {
                  attendu = !(FROMS_RESEND.includes(from!) || FROMS_ILLISIBLES.includes(from));
                  if (attendu) vraisProd++;
                } else {
                  const redirigee = Boolean(redirection?.trim());
                  attendu = redirigee ? accepter === "true" : true;
                  if (attendu) vraisHorsProd++;
                }
                if (res !== attendu) {
                  ecarts.push(`attendu ${attendu}, obtenu ${res} : ${JSON.stringify(env)}`);
                }
                // Invariant absolu, verifie a part : jamais vrai en production avec resend.dev.
                if (res && prod && FROMS_RESEND.includes(from!)) {
                  ecarts.push(`FAILLE : vrai en production avec resend.dev : ${JSON.stringify(env)}`);
                }
              }
            }
          }
        }
      }
    }
    const nbFroms = FROMS_RESEND.length + FROMS_ILLISIBLES.length + FROMS_PROPRES.length;
    expect(ecarts.slice(0, 5)).toEqual([]);
    expect(combinaisons).toBe(
      VERCELS.length * NODES.length * CLES.length * REDIRECTIONS.length * ACCEPTER.length * nbFroms
    );
    // Garde-fous : la grille atteint bien les deux cotes.
    expect(vraisProd).toBeGreaterThan(0);
    expect(vraisHorsProd).toBeGreaterThan(0);
  });

  it("la production ne depend jamais des deux variables de test : meme resultat pour toutes leurs valeurs", () => {
    for (const vercel of ["production", "  production "]) {
      for (const from of [...FROMS_RESEND, ...FROMS_ILLISIBLES, ...FROMS_PROPRES]) {
        const reference = envoiReelPossible({ VERCEL_ENV: vercel, RESEND_API_KEY: "re_cle", EMAIL_FROM: from });
        for (const redirection of REDIRECTIONS) {
          for (const accepter of ACCEPTER) {
            expect(
              envoiReelPossible({
                VERCEL_ENV: vercel,
                RESEND_API_KEY: "re_cle",
                EMAIL_FROM: from,
                EMAIL_REDIRECT_TO: redirection,
                NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE: accepter,
              }),
              `from=${JSON.stringify(from)} redirection=${JSON.stringify(redirection)} accepter=${JSON.stringify(accepter)}`
            ).toBe(reference);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// MAX_EMAILS_PAR_PASSAGE, peutAvertir, actionAvertit
// ---------------------------------------------------------------------------

describe("MAX_EMAILS_PAR_PASSAGE et peutAvertir", () => {
  it("MAX_EMAILS_PAR_PASSAGE vaut 30", () => {
    expect(MAX_EMAILS_PAR_PASSAGE).toBe(30);
  });

  it("aucun mail deja parti : on avertit meme une grosse colocation (exception voulue)", () => {
    expect(peutAvertir(0, 100)).toBe(true);
    expect(peutAvertir(0, 31)).toBe(true);
    expect(peutAvertir(0, 1_000_000)).toBe(true);
  });

  it.each([
    [0, 1, true],
    [0, 30, true],
    [29, 1, true],
    [29, 2, false],
    [30, 1, false],
    [30, 0, true],
    [1, 29, true],
    [1, 30, false],
    [15, 15, true],
    [15, 16, false],
    [28, 2, true],
    [28, 3, false],
    [100, 1, false],
  ])("peutAvertir(%s, %s) avec le plafond par defaut : %s", (mails, membres, attendu) => {
    expect(peutAvertir(mails, membres)).toBe(attendu);
  });

  it("borne exacte : mails + membres == plafond est permis, plafond + 1 refuse", () => {
    for (let mails = 1; mails <= MAX_EMAILS_PAR_PASSAGE; mails++) {
      const reste = MAX_EMAILS_PAR_PASSAGE - mails;
      expect(peutAvertir(mails, reste), `${mails}+${reste}`).toBe(true);
      expect(peutAvertir(mails, reste + 1), `${mails}+${reste + 1}`).toBe(false);
    }
  });

  it("plafond personnalise", () => {
    expect(peutAvertir(3, 2, 5)).toBe(true);
    expect(peutAvertir(4, 2, 5)).toBe(false);
    expect(peutAvertir(0, 50, 5)).toBe(true);
    expect(peutAvertir(1, 4, 5)).toBe(true);
    expect(peutAvertir(1, 5, 5)).toBe(false);
  });

  it("plafond 0 : seule l'exception « aucun mail parti » laisse passer ; avec 0 mail et 0 membre c'est vrai aussi", () => {
    expect(peutAvertir(0, 5, 0)).toBe(true);
    expect(peutAvertir(1, 0, 0)).toBe(false);
    expect(peutAvertir(1, 1, 0)).toBe(false);
    expect(peutAvertir(0, 0, 0)).toBe(true);
  });

  it("plafond negatif : seule l'exception laisse passer", () => {
    expect(peutAvertir(0, 1, -1)).toBe(true);
    expect(peutAvertir(1, 0, -1)).toBe(false);
  });

  it("plafond infini : toujours vrai ; membres infinis avec des mails deja partis : faux", () => {
    expect(peutAvertir(1_000_000, 1_000_000, Infinity)).toBe(true);
    expect(peutAvertir(1, Infinity)).toBe(false);
    expect(peutAvertir(0, Infinity)).toBe(true);
  });

  it("0 membre : vrai tant que le plafond n'est pas deja atteint (rien a envoyer)", () => {
    expect(peutAvertir(0, 0)).toBe(true);
    expect(peutAvertir(29, 0)).toBe(true);
    expect(peutAvertir(30, 0)).toBe(true);
    expect(peutAvertir(31, 0)).toBe(false);
  });

  it("valeurs negatives (donnee fautive) : comportement reel, calcule tel quel", () => {
    // Un nombre de membres negatif compense les mails deja partis : l'appelant
    // (entreeDepuisColocation) ne produit jamais de negatif, mais la fonction
    // elle-meme ne le refuse pas.
    expect(peutAvertir(29, -5)).toBe(true);
    expect(peutAvertir(35, -5)).toBe(true);
    expect(peutAvertir(35, -4)).toBe(false);
    // Mails negatifs : un compteur fautif donnerait de la marge en trop.
    expect(peutAvertir(-5, 34)).toBe(true);
    expect(peutAvertir(-5, 36)).toBe(false);
    // Exception « 0 mail » : seul exactement 0 la declenche.
    expect(peutAvertir(-1, 100)).toBe(false);
  });

  it("NaN : ne leve rien ; avec des mails deja partis, NaN refuse (jamais d'envoi sur une donnee inconnue)", () => {
    expect(peutAvertir(5, NaN)).toBe(false);
    expect(peutAvertir(NaN, 5)).toBe(false);
    expect(peutAvertir(NaN, NaN)).toBe(false);
    expect(peutAvertir(5, 5, NaN)).toBe(false);
  });

  it("comportement reel : avec 0 mail parti, un nombre de membres NaN passe quand meme (l'exception ne regarde pas les membres)", () => {
    expect(peutAvertir(0, NaN)).toBe(true);
    expect(peutAvertir(0, 5, NaN)).toBe(true);
  });

  it("reproduit la boucle du cron : des colocations de 10 membres, trois avertissements puis le reste attend", () => {
    let mails = 0;
    let avertis = 0;
    let reportes = 0;
    for (let i = 0; i < 10; i++) {
      if (!peutAvertir(mails, 10)) {
        reportes++;
        continue;
      }
      mails += 10;
      avertis++;
    }
    expect(avertis).toBe(3);
    expect(mails).toBe(MAX_EMAILS_PAR_PASSAGE);
    expect(reportes).toBe(7);
  });

  it("reproduit la boucle du cron : une colocation de 45 membres passe en premier, puis plus rien", () => {
    let mails = 0;
    expect(peutAvertir(mails, 45)).toBe(true);
    mails += 45;
    expect(peutAvertir(mails, 1)).toBe(false);
  });
});

describe("actionAvertit", () => {
  const TABLE: [ActionCron, boolean][] = [
    ["ignorer", false],
    ["rien", false],
    ["planifier_vide", false],
    ["avertir_inactive", true],
    ["annuler", false],
    ["supprimer", false],
    ["replanifier_inactive", true],
    ["replanifier_vide", false],
  ];

  it.each(TABLE)("%s : %s", (action, attendu) => {
    expect(actionAvertit(action)).toBe(attendu);
  });

  it("exactement deux actions avertissent", () => {
    expect(TABLE.filter(([, oui]) => oui)).toHaveLength(2);
  });

  it("une action inconnue n'avertit pas", () => {
    expect(actionAvertit("detruire_tout" as unknown as ActionCron)).toBe(false);
    expect(actionAvertit("" as unknown as ActionCron)).toBe(false);
    expect(actionAvertit(undefined as unknown as ActionCron)).toBe(false);
  });

  it("la casse compte : « AVERTIR_INACTIVE » n'avertit pas", () => {
    expect(actionAvertit("AVERTIR_INACTIVE" as unknown as ActionCron)).toBe(false);
  });

  it("coherence avec actionConsommeBudget : une action qui avertit consomme du budget quand l'envoi est reel et jamais sans", () => {
    for (const [action, avertit] of TABLE) {
      if (!avertit) continue;
      for (const suppressionAuto of [false, true]) {
        expect(actionConsommeBudget(action, { envoiReel: true, suppressionAuto })).toBe(true);
        expect(actionConsommeBudget(action, { envoiReel: false, suppressionAuto })).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// actionConsommeBudget : les deux actions « replanifier »
// (les six autres actions sont deja dans le bloc actionConsommeBudget plus haut)
// ---------------------------------------------------------------------------

describe("actionConsommeBudget : replanifier_inactive et replanifier_vide", () => {
  const CONTEXTES = [
    { envoiReel: false, suppressionAuto: false },
    { envoiReel: true, suppressionAuto: false },
    { envoiReel: false, suppressionAuto: true },
    { envoiReel: true, suppressionAuto: true },
  ];
  // Attendu, ecrit en dur : (envoiReel, suppressionAuto) = FF, TF, FT, TT.
  const TABLE: Record<"replanifier_inactive" | "replanifier_vide", [boolean, boolean, boolean, boolean]> = {
    replanifier_inactive: [false, true, false, true],
    replanifier_vide: [true, true, true, true],
  };

  for (const action of ["replanifier_inactive", "replanifier_vide"] as const) {
    CONTEXTES.forEach((contexte, i) => {
      it(`${action} avec envoiReel=${contexte.envoiReel}, suppressionAuto=${contexte.suppressionAuto} : ${TABLE[action][i]}`, () => {
        expect(actionConsommeBudget(action, contexte)).toBe(TABLE[action][i]);
      });
    });
  }

  it("replanifier_inactive ne depend que de l'envoi reel, jamais de l'interrupteur de suppression (identique avec A vrai ou faux)", () => {
    for (const envoiReel of [false, true]) {
      expect(actionConsommeBudget("replanifier_inactive", { envoiReel, suppressionAuto: true })).toBe(
        actionConsommeBudget("replanifier_inactive", { envoiReel, suppressionAuto: false })
      );
    }
  });

  it("replanifier_vide ne depend de rien : c'est une ecriture sans email, toujours comptee", () => {
    for (const c of CONTEXTES) expect(actionConsommeBudget("replanifier_vide", c)).toBe(true);
  });

  it("table complete des 8 actions : seules supprimer, planifier_vide, avertir_inactive et les deux replanifier peuvent consommer", () => {
    const ACTIONS: ActionCron[] = [
      "ignorer",
      "rien",
      "planifier_vide",
      "avertir_inactive",
      "annuler",
      "supprimer",
      "replanifier_inactive",
      "replanifier_vide",
    ];
    const jamais = new Set<ActionCron>(["ignorer", "rien", "annuler"]);
    for (const action of ACTIONS) {
      const consommeQuelquefois = CONTEXTES.some((c) => actionConsommeBudget(action, c));
      expect(consommeQuelquefois, action).toBe(!jamais.has(action));
    }
  });

  it("reproduit la boucle du cron : 80 replanifier_vide consecutifs, 50 faits, 30 tronques (meme sans envoi reel)", () => {
    const contexte = { envoiReel: false, suppressionAuto: false };
    let faites = 0;
    let tronquees = 0;
    for (let i = 0; i < 80; i++) {
      if (actionConsommeBudget("replanifier_vide", contexte)) {
        if (budgetEpuise(faites)) {
          tronquees++;
          continue;
        }
        faites++;
      }
    }
    expect(faites).toBe(50);
    expect(tronquees).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// DELAI_RETARD_MAX_JOURS et echeanceEnRetard
// ---------------------------------------------------------------------------

describe("DELAI_RETARD_MAX_JOURS et echeanceEnRetard", () => {
  const SEPT_JOURS_MS = 7 * JOUR_MS;

  it("DELAI_RETARD_MAX_JOURS vaut 7", () => {
    expect(DELAI_RETARD_MAX_JOURS).toBe(7);
  });

  it("exactement 7 jours de retard : PAS en retard (strictement plus)", () => {
    expect(echeanceEnRetard(new Date(T - SEPT_JOURS_MS), MAINTENANT)).toBe(false);
  });

  it("7 jours + 1 ms : en retard", () => {
    expect(echeanceEnRetard(new Date(T - SEPT_JOURS_MS - 1), MAINTENANT)).toBe(true);
  });

  it("7 jours - 1 ms : pas en retard", () => {
    expect(echeanceEnRetard(new Date(T - SEPT_JOURS_MS + 1), MAINTENANT)).toBe(false);
  });

  it.each([
    [0, false],
    [1, false],
    [3, false],
    [6, false],
    [7, false],
    [8, true],
    [30, true],
    [365, true],
    [100_000, true],
  ])("echeance depassee de %s jours entiers : %s", (nbJours, attendu) => {
    expect(echeanceEnRetard(jours(-nbJours), MAINTENANT)).toBe(attendu);
  });

  it("echeance exactement maintenant ou 1 ms avant : pas en retard", () => {
    expect(echeanceEnRetard(MAINTENANT, MAINTENANT)).toBe(false);
    expect(echeanceEnRetard(new Date(T - 1), MAINTENANT)).toBe(false);
  });

  it("echeance dans le futur (proche ou lointaine) : pas en retard", () => {
    expect(echeanceEnRetard(new Date(T + 1), MAINTENANT)).toBe(false);
    expect(echeanceEnRetard(jours(30), MAINTENANT)).toBe(false);
    expect(echeanceEnRetard(new Date(8.64e15), MAINTENANT)).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["date invalide", new Date("x")],
    ["date invalide (NaN)", new Date(NaN)],
  ])("echeance absente ou invalide (%s) : pas en retard", (_nom, echeance) => {
    expect(echeanceEnRetard(echeance, MAINTENANT)).toBe(false);
  });

  it("une valeur qui n'est pas une Date (chaine ISO, nombre, objet) : pas en retard, jamais d'exception", () => {
    const tresVieux = "2000-01-01T00:00:00.000Z";
    for (const v of [tresVieux, 0, -1e15, {}, [], true]) {
      expect(() => echeanceEnRetard(v as unknown as Date, MAINTENANT)).not.toThrow();
      expect(echeanceEnRetard(v as unknown as Date, MAINTENANT)).toBe(false);
    }
  });

  it("maintenant invalide : pas en retard (on ne conclut rien)", () => {
    expect(echeanceEnRetard(jours(-100), DATE_INVALIDE)).toBe(false);
    expect(echeanceEnRetard(DATE_INVALIDE, DATE_INVALIDE)).toBe(false);
  });

  it("dates extremes de Date : en retard sans exception", () => {
    expect(echeanceEnRetard(new Date(-8.64e15), new Date(8.64e15))).toBe(true);
    expect(echeanceEnRetard(new Date(8.64e15), new Date(-8.64e15))).toBe(false);
  });

  it("l'epoque (timestamp 0) est une vraie date tres ancienne : en retard", () => {
    expect(echeanceEnRetard(new Date(0), MAINTENANT)).toBe(true);
  });

  it("maximum personnalise en jours", () => {
    expect(echeanceEnRetard(jours(-3), MAINTENANT, 3)).toBe(false);
    expect(echeanceEnRetard(new Date(T - 3 * JOUR_MS - 1), MAINTENANT, 3)).toBe(true);
    expect(echeanceEnRetard(jours(-8), MAINTENANT, 10)).toBe(false);
  });

  it("maximum 0 : seul un retard strictement positif compte", () => {
    expect(echeanceEnRetard(MAINTENANT, MAINTENANT, 0)).toBe(false);
    expect(echeanceEnRetard(new Date(T - 1), MAINTENANT, 0)).toBe(true);
  });

  it("maximum infini ou NaN : jamais en retard (une valeur absurde n'invente pas de retard)", () => {
    expect(echeanceEnRetard(jours(-100_000), MAINTENANT, Infinity)).toBe(false);
    expect(echeanceEnRetard(jours(-100_000), MAINTENANT, NaN)).toBe(false);
  });

  it("comportement reel : un maximum NEGATIF rend « en retard » une echeance meme future (non expose : seul le defaut est utilise par le cron)", () => {
    expect(echeanceEnRetard(MAINTENANT, MAINTENANT, -1)).toBe(true);
    expect(echeanceEnRetard(jours(0.5), MAINTENANT, -1)).toBe(true);
    expect(echeanceEnRetard(jours(2), MAINTENANT, -1)).toBe(false);
  });

  it("le maximum par defaut est bien celui de la constante", () => {
    const juste = new Date(T - DELAI_RETARD_MAX_JOURS * JOUR_MS);
    expect(echeanceEnRetard(juste, MAINTENANT)).toBe(echeanceEnRetard(juste, MAINTENANT, DELAI_RETARD_MAX_JOURS));
    expect(echeanceEnRetard(new Date(juste.getTime() - 1), MAINTENANT)).toBe(true);
  });

  it("dates ISO avec Z : echeance du 22 octobre 12:00 (8 jours) en retard, du 23 octobre 12:00 (7 jours pile) non", () => {
    expect(echeanceEnRetard(d("2026-10-22T12:00:00.000Z"), MAINTENANT)).toBe(true);
    expect(echeanceEnRetard(d("2026-10-23T12:00:00.000Z"), MAINTENANT)).toBe(false);
    expect(echeanceEnRetard(d("2026-10-23T11:59:59.999Z"), MAINTENANT)).toBe(true);
  });

  it("changement d'heure (25 octobre 2026) : les jours sont des jours de 24 h UTC, sans decalage", () => {
    expect(echeanceEnRetard(d("2026-10-18T12:00:00.000Z"), d("2026-10-25T12:00:00.000Z"))).toBe(false);
    expect(echeanceEnRetard(d("2026-10-18T11:59:59.999Z"), d("2026-10-25T12:00:00.000Z"))).toBe(true);
  });

  it("ne modifie pas les dates recues", () => {
    const echeance = new Date(T - 10 * JOUR_MS);
    const maintenant = new Date(T);
    echeanceEnRetard(echeance, maintenant);
    expect(echeance.getTime()).toBe(T - 10 * JOUR_MS);
    expect(maintenant.getTime()).toBe(T);
  });

  it("monotone : si une echeance est en retard, toute echeance plus ancienne l'est aussi (200 tirages de graine fixe)", () => {
    const tirer = generateur(7_000_007);
    for (let i = 0; i < 200; i++) {
      const retard = tirer(20 * JOUR_MS);
      const echeance = new Date(T - retard);
      const attendu = retard > SEPT_JOURS_MS;
      expect(echeanceEnRetard(echeance, MAINTENANT), `retard=${retard} ms`).toBe(attendu);
      if (attendu) expect(echeanceEnRetard(new Date(echeance.getTime() - 1), MAINTENANT)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// actionCronPour
// ---------------------------------------------------------------------------

describe("actionCronPour", () => {
  const SEPT_JOURS_MS = 7 * JOUR_MS;
  const decisionDe = (action: DecisionNettoyage["action"], motif: "inactive" | "vide" = "inactive"): DecisionNettoyage => {
    switch (action) {
      case "ignorer":
        return { action: "ignorer" };
      case "rien":
        return { action: "rien" };
      case "annuler":
        return { action: "annuler" };
      case "planifier_vide":
        return { action: "planifier_vide", videDepuis: jours(0), suppressionPrevueLe: jours(30) };
      case "avertir_inactive":
        return { action: "avertir_inactive", avertieLe: jours(0), suppressionPrevueLe: jours(30) };
      case "supprimer":
        return { action: "supprimer", motif };
    }
  };

  describe("supprimer", () => {
    it("motif inactive, echeance en retard : replanifier_inactive", () => {
      const e = new Date(T - SEPT_JOURS_MS - 1);
      expect(actionCronPour(decisionDe("supprimer", "inactive"), e, MAINTENANT)).toBe("replanifier_inactive");
    });

    it("motif vide, echeance en retard : replanifier_vide", () => {
      const e = new Date(T - SEPT_JOURS_MS - 1);
      expect(actionCronPour(decisionDe("supprimer", "vide"), e, MAINTENANT)).toBe("replanifier_vide");
    });

    it.each(["inactive", "vide"] as const)("motif %s, retard de EXACTEMENT 7 jours : reste supprimer", (motif) => {
      expect(actionCronPour(decisionDe("supprimer", motif), new Date(T - SEPT_JOURS_MS), MAINTENANT)).toBe("supprimer");
    });

    it.each(["inactive", "vide"] as const)("motif %s, echeance atteinte a l'instant meme : supprimer", (motif) => {
      expect(actionCronPour(decisionDe("supprimer", motif), MAINTENANT, MAINTENANT)).toBe("supprimer");
    });

    it.each(["inactive", "vide"] as const)("motif %s, retard de 1 a 6 jours : supprimer", (motif) => {
      for (const n of [1, 2, 6]) {
        expect(actionCronPour(decisionDe("supprimer", motif), jours(-n), MAINTENANT), `${n} j`).toBe("supprimer");
      }
    });

    it.each(["inactive", "vide"] as const)("motif %s, 7 jours + 1 ms : replanifie (la borne est a la milliseconde)", (motif) => {
      const attendu = motif === "inactive" ? "replanifier_inactive" : "replanifier_vide";
      expect(actionCronPour(decisionDe("supprimer", motif), new Date(T - SEPT_JOURS_MS - 1), MAINTENANT)).toBe(attendu);
      expect(actionCronPour(decisionDe("supprimer", motif), new Date(T - SEPT_JOURS_MS + 1), MAINTENANT)).toBe("supprimer");
    });

    it.each(["inactive", "vide"] as const)("motif %s, tres en retard (1 an, 100 ans, l'epoque) : replanifie", (motif) => {
      const attendu = motif === "inactive" ? "replanifier_inactive" : "replanifier_vide";
      for (const e of [jours(-365), jours(-36500), new Date(0), new Date(-8.64e15)]) {
        expect(actionCronPour(decisionDe("supprimer", motif), e, MAINTENANT)).toBe(attendu);
      }
    });

    it("echeance absente ou invalide : la decision passe inchangee (la decision `supprimer` suppose deja une echeance valide)", () => {
      for (const e of [undefined, null, DATE_INVALIDE]) {
        expect(actionCronPour(decisionDe("supprimer", "inactive"), e, MAINTENANT)).toBe("supprimer");
      }
    });

    it("maintenant invalide : la decision passe inchangee (pas de retard calculable)", () => {
      expect(actionCronPour(decisionDe("supprimer", "inactive"), jours(-100), DATE_INVALIDE)).toBe("supprimer");
    });
  });

  describe("les autres actions passent inchangees, meme avec une echeance tres en retard", () => {
    const AUTRES: DecisionNettoyage["action"][] = ["ignorer", "rien", "planifier_vide", "avertir_inactive", "annuler"];
    const ECHEANCES: (Date | null | undefined)[] = [undefined, null, DATE_INVALIDE, jours(10), jours(-1), jours(-8), jours(-3650)];

    for (const action of AUTRES) {
      it(`${action} : inchangee pour toutes les echeances`, () => {
        for (const e of ECHEANCES) {
          expect(actionCronPour(decisionDe(action), e, MAINTENANT)).toBe(action);
        }
      });
    }

    it("jamais de replanifier produit a partir d'une autre action que supprimer", () => {
      for (const action of AUTRES) {
        for (const e of ECHEANCES) {
          const r = actionCronPour(decisionDe(action), e, MAINTENANT);
          expect(r.startsWith("replanifier"), `${action}`).toBe(false);
        }
      }
    });
  });

  describe("propriete de securite : jamais supprimer pour une echeance en retard de plus de 7 jours", () => {
    it("grille deterministe motifs x dates x actions : un resultat `supprimer` implique un retard <= 7 jours (oracle independant)", () => {
      const ACTIONS: DecisionNettoyage["action"][] = ["ignorer", "rien", "planifier_vide", "avertir_inactive", "annuler", "supprimer"];
      const MOTIFS = ["inactive", "vide"] as const;
      const ECHEANCES: (Date | null | undefined)[] = [
        undefined,
        null,
        DATE_INVALIDE,
        jours(100),
        jours(1),
        MAINTENANT,
        jours(-1),
        jours(-6.99),
        new Date(T - 604_800_000),
        new Date(T - 604_800_000 - 1),
        new Date(T - 604_800_000 - 1000),
        jours(-7.01),
        jours(-8),
        jours(-30),
        jours(-365),
        new Date(0),
        new Date(-8.64e15),
      ];
      let essais = 0;
      let suppressions = 0;
      let remplacements = 0;
      for (const action of ACTIONS) {
        for (const motif of MOTIFS) {
          for (const e of ECHEANCES) {
            essais++;
            const r = actionCronPour(decisionDe(action, motif), e, MAINTENANT);
            // Oracle : retard en ms, en dur (604 800 000 = 7 jours), sans la fonction testee.
            const retardMs = e instanceof Date ? T - e.getTime() : NaN;
            const enRetard = Number.isFinite(retardMs) && retardMs > 604_800_000;
            if (r === "supprimer") {
              suppressions++;
              expect(enRetard, `FAILLE : supprimer pour retard ${retardMs} ms (motif ${motif})`).toBe(false);
            }
            if (action === "supprimer" && enRetard) {
              remplacements++;
              expect(r, `motif ${motif}, retard ${retardMs} ms`).toBe(
                motif === "inactive" ? "replanifier_inactive" : "replanifier_vide"
              );
            }
          }
        }
      }
      expect(essais).toBe(ACTIONS.length * MOTIFS.length * ECHEANCES.length);
      // Garde-fous : la grille atteint bien les deux cotes.
      expect(suppressions).toBeGreaterThan(0);
      expect(remplacements).toBeGreaterThan(0);
    });

    // Chaine complete : evaluerNettoyage PUIS actionCronPour, sur des plans reels
    // (inactive ou vide) dont l'echeance est plus ou moins depassee.
    const decisionComplete = (motif: "inactive" | "vide", retardMs: number) => {
      const echeance = new Date(T - retardMs);
      const plan =
        motif === "inactive"
          ? {
              nombreMembres: 2,
              derniereActivite: jours(-1000),
              avertieLe: new Date(echeance.getTime() - 30 * JOUR_MS),
              suppressionPrevueLe: echeance,
              motifSuppression: "inactive",
            }
          : {
              nombreMembres: 0,
              derniereActivite: jours(-1000),
              videDepuis: new Date(echeance.getTime() - 30 * JOUR_MS),
              suppressionPrevueLe: echeance,
              motifSuppression: "vide",
            };
      const decision = evaluerNettoyage({ creeLe: jours(-2000), ...plan }, MAINTENANT);
      return { decision, echeance, action: actionCronPour(decision, echeance, MAINTENANT) };
    };

    it.each(["inactive", "vide"] as const)(
      "chaine complete, motif %s : evaluerNettoyage dit supprimer, le cron ne supprime que jusqu'a 7 jours de retard",
      (motif) => {
        const retards = [0, 1, 1000, JOUR_MS, 6 * JOUR_MS, 7 * JOUR_MS, 7 * JOUR_MS + 1, 7 * JOUR_MS + 1000, 8 * JOUR_MS, 40 * JOUR_MS, 400 * JOUR_MS];
        for (const retard of retards) {
          const { decision, action } = decisionComplete(motif, retard);
          // La decision est bien `supprimer` : evaluerNettoyage ne connait pas la notion de retard.
          expect(decision, `retard ${retard} ms`).toEqual({ action: "supprimer", motif });
          if (retard <= 7 * JOUR_MS) {
            expect(action, `retard ${retard} ms`).toBe("supprimer");
          } else {
            expect(action, `retard ${retard} ms`).toBe(motif === "inactive" ? "replanifier_inactive" : "replanifier_vide");
          }
        }
      }
    );

    it("chaine complete : 5000 retards pseudo-aleatoires (graine fixe), deux motifs : jamais supprimer au-dela de 7 jours", () => {
      const tirer = generateur(31_102_026);
      let supprimer = 0;
      let replanifier = 0;
      for (let i = 0; i < 5000; i++) {
        const motif = i % 2 === 0 ? "inactive" : "vide";
        // Retards de 0 a ~ 60 jours, avec beaucoup de valeurs autour de 7 jours.
        const retard = i % 3 === 0 ? 7 * JOUR_MS + (tirer(2001) - 1000) : tirer(60 * JOUR_MS);
        const { action } = decisionComplete(motif, retard);
        if (action === "supprimer") {
          supprimer++;
          expect(retard, `FAILLE : supprimer avec ${retard} ms de retard`).toBeLessThanOrEqual(7 * JOUR_MS);
        } else {
          replanifier++;
          expect(retard).toBeGreaterThan(7 * JOUR_MS);
        }
      }
      expect(supprimer).toBeGreaterThan(0);
      expect(replanifier).toBeGreaterThan(0);
    });

    it("avec le motif de la decision : un motif qui n'est ni inactive ni vide est traite comme vide (comportement reel : tout ce qui n'est pas inactive)", () => {
      const decision = { action: "supprimer", motif: "bizarre" } as unknown as DecisionNettoyage;
      expect(actionCronPour(decision, jours(-30), MAINTENANT)).toBe("replanifier_vide");
    });
  });

  it("une action inconnue (donnee abimee) passe inchangee et ne leve rien", () => {
    const decision = { action: "detruire_tout" } as unknown as DecisionNettoyage;
    expect(actionCronPour(decision, jours(-100), MAINTENANT)).toBe("detruire_tout");
  });

  it("n'altere ni la decision, ni les dates recues (objets geles acceptes)", () => {
    const decision = Object.freeze({ action: "supprimer", motif: "inactive" } as const);
    const echeance = new Date(T - 20 * JOUR_MS);
    const maintenant = new Date(T);
    expect(() => actionCronPour(decision, echeance, maintenant)).not.toThrow();
    expect(decision).toEqual({ action: "supprimer", motif: "inactive" });
    expect(echeance.getTime()).toBe(T - 20 * JOUR_MS);
    expect(maintenant.getTime()).toBe(T);
  });

  it("deterministe : meme entree, meme sortie", () => {
    const decision = decisionDe("supprimer", "vide");
    const e = jours(-9);
    expect(actionCronPour(decision, e, MAINTENANT)).toBe(actionCronPour(decision, e, MAINTENANT));
  });
});

// ---------------------------------------------------------------------------
// BUDGET_TEMPS_MS et tempsEpuise
// ---------------------------------------------------------------------------

describe("BUDGET_TEMPS_MS et tempsEpuise", () => {
  it("BUDGET_TEMPS_MS vaut 45000 (marge sous les 60 s de la route)", () => {
    expect(BUDGET_TEMPS_MS).toBe(45_000);
  });

  it.each([
    [0, 0, false],
    [0, 1, false],
    [0, 44_999, false],
    [0, 45_000, false],
    [0, 45_001, true],
    [0, 60_000, true],
    [1_000, 46_000, false],
    [1_000, 46_001, true],
    [1_700_000_000_000, 1_700_000_045_000, false],
    [1_700_000_000_000, 1_700_000_045_001, true],
  ])("tempsEpuise(%s, %s) avec le budget par defaut : %s", (debut, maintenant, attendu) => {
    expect(tempsEpuise(debut, maintenant)).toBe(attendu);
  });

  it("strictement superieur : a exactement le budget, il reste du temps", () => {
    expect(tempsEpuise(100, 100 + BUDGET_TEMPS_MS)).toBe(false);
    expect(tempsEpuise(100, 100 + BUDGET_TEMPS_MS + 1)).toBe(true);
  });

  it("budget personnalise", () => {
    expect(tempsEpuise(0, 10, 10)).toBe(false);
    expect(tempsEpuise(0, 11, 10)).toBe(true);
    expect(tempsEpuise(0, 50_000, 60_000)).toBe(false);
  });

  it("budget 0 : epuise des la premiere milliseconde, pas a l'instant 0", () => {
    expect(tempsEpuise(5, 5, 0)).toBe(false);
    expect(tempsEpuise(5, 6, 0)).toBe(true);
  });

  it("budget negatif : epuise des l'instant de depart (rien n'est permis)", () => {
    expect(tempsEpuise(5, 5, -1)).toBe(true);
  });

  it("budget infini : jamais epuise", () => {
    expect(tempsEpuise(0, Number.MAX_SAFE_INTEGER, Infinity)).toBe(false);
  });

  it("horloge qui recule (maintenant avant le debut) : pas epuise, jamais d'exception", () => {
    expect(tempsEpuise(10_000, 5_000)).toBe(false);
    expect(tempsEpuise(10_000, -1e12)).toBe(false);
    expect(tempsEpuise(10_000, 0)).toBe(false);
  });

  it("NaN : comparaison fausse, donc jamais epuise (comportement reel : une horloge cassee ne coupe pas le passage)", () => {
    expect(tempsEpuise(NaN, 1_000_000)).toBe(false);
    expect(tempsEpuise(0, NaN)).toBe(false);
    expect(tempsEpuise(0, 1_000_000, NaN)).toBe(false);
  });

  it("valeurs infinies : Infinity - Infinity est NaN, donc pas epuise ; Infinity - 0 depasse tout budget fini", () => {
    expect(tempsEpuise(0, Infinity)).toBe(true);
    expect(tempsEpuise(Infinity, Infinity)).toBe(false);
    expect(tempsEpuise(-Infinity, 0)).toBe(true);
  });

  it("monotone : une fois epuise, le reste epuise tant que l'horloge avance (200 tirages de graine fixe)", () => {
    const tirer = generateur(45_000);
    for (let i = 0; i < 200; i++) {
      const debut = tirer(1_000_000);
      const ecart = tirer(90_000);
      const epuise = tempsEpuise(debut, debut + ecart);
      expect(epuise, `ecart ${ecart}`).toBe(ecart > 45_000);
      if (epuise) expect(tempsEpuise(debut, debut + ecart + 1)).toBe(true);
    }
  });
});
