import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Types } from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExpenseModel from "@/models/Expense";
import SettlementModel from "@/models/Settlement";
import ShoppingItemModel from "@/models/ShoppingItem";
import TaskModel from "@/models/Task";
import {
  COLOCATAIRES_DEMO,
  DEMO_EMAIL_PAR_DEFAUT,
  DESCRIPTION_COLOCATION_DEMO,
  NOM_COLOCATION_DEMO,
  NOM_COMPTE_DEMO,
  construireDonneesDemo,
  demoActive,
  estEmailDemo,
  motDePasseDemo,
  type DonneesDemo,
  type IdsDemo,
} from "@/lib/demo";
import * as demoEmail from "@/lib/demo-email";
import { VALEURS_CATEGORIES } from "@/lib/shopping-constants";

// demo.ts importe Mongoose, les modeles, bcrypt et la couche base, mais rien ne
// s'ouvre a l'import : connectDB est paresseuse et n'est appelee que par
// reinitialiserDemo. On ne teste ici que la partie PURE (constantes,
// motDePasseDemo, demoActive, construireDonneesDemo). reinitialiserDemo et
// reinitialiserDemoPourCron touchent la base : hors de ce fichier.
//
// Aucune connexion ni aucun mock : les modeles Mongoose ne servent qu'a lire
// leur schema (enumerations, champs obligatoires) et a appeler validate(),
// qui valide un document en memoire sans jamais toucher la base.

// Dates en ISO avec "Z" : le test ne depend jamais du fuseau de la machine.
const d = (iso: string) => new Date(iso);

// "Maintenant" fige : on ne lit jamais l'horloge reelle.
const MAINTENANT = d("2026-10-15T12:00:00.000Z");

const JOUR_MS = 24 * 60 * 60 * 1000;

const IDS: IdsDemo = {
  demo: "64f000000000000000000001",
  lea: "64f000000000000000000002",
  hugo: "64f000000000000000000003",
  camille: "64f000000000000000000004",
};
const TOUS = [IDS.demo, IDS.lea, IDS.hugo, IDS.camille] as string[];

// Correspondance id -> adresse, pour verifier que TOUT utilisateur cite dans les
// donnees a une adresse reconnue comme demo (donc qu'aucun mail ne peut partir).
const ADRESSE_DE: Record<string, string> = {
  [IDS.demo as string]: demoEmail.emailCompteDemo({}),
  [IDS.lea as string]: COLOCATAIRES_DEMO[0].email,
  [IDS.hugo as string]: COLOCATAIRES_DEMO[1].email,
  [IDS.camille as string]: COLOCATAIRES_DEMO[2].email,
};

const construire = (m: Date) => construireDonneesDemo(m, IDS);

const cents = (x: number) => Math.round(x * 100);

// ---------------------------------------------------------------------------
// Constantes et reexports
// ---------------------------------------------------------------------------

describe("constantes de la demo", () => {
  it("trois colocataires fictifs, aux cles et adresses distinctes, tous en .invalid", () => {
    expect(COLOCATAIRES_DEMO.map((c) => c.cle)).toEqual(["lea", "hugo", "camille"]);
    expect(new Set(COLOCATAIRES_DEMO.map((c) => c.email)).size).toBe(3);
    for (const c of COLOCATAIRES_DEMO) {
      expect(c.email.endsWith("@demo.roomflow.invalid")).toBe(true);
      expect(estEmailDemo(c.email)).toBe(true);
      expect(c.nom.trim()).not.toBe("");
    }
  });

  it("aucun colocataire fictif n'utilise l'adresse du compte demo", () => {
    expect(COLOCATAIRES_DEMO.map((c) => c.email)).not.toContain(DEMO_EMAIL_PAR_DEFAUT);
  });

  it("l'adresse du compte demo par defaut est reconnue comme demo", () => {
    expect(estEmailDemo(DEMO_EMAIL_PAR_DEFAUT, demoEmail.emailCompteDemo({}))).toBe(true);
  });

  it("reexporte les memes objets que demo-email.ts", () => {
    expect(estEmailDemo).toBe(demoEmail.estEmailDemo);
    expect(DEMO_EMAIL_PAR_DEFAUT).toBe(demoEmail.DEMO_EMAIL_PAR_DEFAUT);
  });

  it("noms et description sans tiret cadratin ni demi-cadratin", () => {
    for (const t of [NOM_COMPTE_DEMO, NOM_COLOCATION_DEMO, DESCRIPTION_COLOCATION_DEMO]) {
      expect(t.trim()).not.toBe("");
      expect(t).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

// ---------------------------------------------------------------------------
// motDePasseDemo et demoActive
// ---------------------------------------------------------------------------

describe("motDePasseDemo et demoActive", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // Mots de passe fabriques pour le test (jamais un vrai).
  const sept = "a".repeat(7);
  const huit = "a".repeat(8);

  it.each([
    ["variable absente", {}],
    ["variable undefined", { DEMO_PASSWORD: undefined }],
    ["chaine vide", { DEMO_PASSWORD: "" }],
    ["un espace", { DEMO_PASSWORD: " " }],
    ["sept espaces", { DEMO_PASSWORD: " ".repeat(7) }],
    ["7 caracteres", { DEMO_PASSWORD: sept }],
    ["7 caracteres unicode", { DEMO_PASSWORD: "ééééééé" }],
    ["retour a la ligne seul", { DEMO_PASSWORD: "\n" }],
    ["autres variables seulement", { DEMO_EMAIL: "moi@exemple.fr", AUTRE: huit }],
  ])("demo desactivee : %s", (_nom, env) => {
    expect(motDePasseDemo(env)).toBeNull();
    expect(demoActive(env)).toBe(false);
  });

  it("8 caracteres : active, et le mot de passe est rendu tel quel", () => {
    expect(motDePasseDemo({ DEMO_PASSWORD: huit })).toBe(huit);
    expect(demoActive({ DEMO_PASSWORD: huit })).toBe(true);
  });

  it("la limite est exactement 8 : 7 desactive, 8 et 9 activent", () => {
    expect(demoActive({ DEMO_PASSWORD: "x".repeat(7) })).toBe(false);
    expect(demoActive({ DEMO_PASSWORD: "x".repeat(8) })).toBe(true);
    expect(demoActive({ DEMO_PASSWORD: "x".repeat(9) })).toBe(true);
  });

  it("tres long : active, sans troncature ni exception", () => {
    const long = "p".repeat(10_000);
    expect(motDePasseDemo({ DEMO_PASSWORD: long })).toBe(long);
    expect(demoActive({ DEMO_PASSWORD: long })).toBe(true);
  });

  it("unicode : rendu tel quel, sans normalisation ni rognage", () => {
    const accents = "Éé-ü-ñ-ß-9";
    expect(motDePasseDemo({ DEMO_PASSWORD: accents })).toBe(accents);
    const cjk = "密码密码密码密码";
    expect(motDePasseDemo({ DEMO_PASSWORD: cjk })).toBe(cjk);
  });

  it("le mot de passe n'est pas rogne : les espaces autour comptent", () => {
    expect(motDePasseDemo({ DEMO_PASSWORD: " abcdefg " })).toBe(" abcdefg ");
  });

  it("ne lit que l'objet recu, jamais process.env", () => {
    vi.stubEnv("DEMO_PASSWORD", "mot-de-passe-de-test-xyz");
    expect(motDePasseDemo({})).toBeNull();
    expect(demoActive({})).toBe(false);
  });

  it("ne modifie pas l'objet env recu", () => {
    const env = Object.freeze({ DEMO_PASSWORD: huit });
    expect(demoActive(env)).toBe(true);
    expect(env.DEMO_PASSWORD).toBe(huit);
  });

  it("valeurs qui ne sont pas des chaines : desactive, sans exception", () => {
    for (const v of [null, 12345678, {}, [], ["abcdefgh"], true, Symbol("x"), BigInt(12345678)]) {
      const env = { DEMO_PASSWORD: v } as unknown as { DEMO_PASSWORD?: string };
      expect(() => motDePasseDemo(env)).not.toThrow();
      expect(motDePasseDemo(env)).toBeNull();
      expect(demoActive(env)).toBe(false);
    }
  });

  it("demoActive est vrai exactement quand motDePasseDemo n'est pas null", () => {
    for (const v of [undefined, "", "a", sept, huit, "é".repeat(20)]) {
      const env = { DEMO_PASSWORD: v };
      expect(demoActive(env)).toBe(motDePasseDemo(env) !== null);
    }
  });

  // Comportement actuel a connaitre (voir le rapport) : seule la longueur en
  // unites UTF-16 est controlee. Un mot de passe public fait d'espaces, ou de
  // 4 emojis, active donc la demo.
  it("8 espaces n'activent PAS la demo (mot de passe public trivial) ; 4 emojis (8 unites UTF-16) l'activent", () => {
    expect(demoActive({ DEMO_PASSWORD: " ".repeat(8) })).toBe(false);
    expect(demoActive({ DEMO_PASSWORD: " \t\n ".repeat(4) })).toBe(false);
    expect(demoActive({ DEMO_PASSWORD: "😀".repeat(4) })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Aucun mot de passe dans le code source
// ---------------------------------------------------------------------------

describe("aucun mot de passe ecrit dans le code source", () => {
  const lire = (nom: string) => readFileSync(fileURLToPath(new URL(nom, import.meta.url)), "utf8");
  const SOURCES: [string, string][] = [
    ["demo.ts", lire("./demo.ts")],
    ["demo-email.ts", lire("./demo-email.ts")],
  ];

  // Un identifiant qui parle de mot de passe, suivi de : ou =, puis un litteral
  // de plus de 7 caracteres. Les noms comme `passwordHash: hashDemo` ou
  // `const motDePasse = motDePasseDemo(env)` n'ont pas de litteral : pas de
  // faux positif. Les chaines de 7 caracteres ou moins sont ignorees (libelles).
  const AFFECTATION_LITTERALE =
    /\b\w*(?:password|passwd|pwd|motdepasse|mot_de_passe|secret|passphrase)\w*["']?\s*[:=]\s*["'`][^"'`\n]{8,}["'`]/i;
  const HASH_BCRYPT = /\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}/;
  // `env.DEMO_PASSWORD ?? "xxx"` : un mot de passe par defaut cache dans un repli.
  const REPLI_LITTERAL = /DEMO_PASSWORD\s*(?:\?\?|\|\|)\s*["'`]/;
  // Le mot de passe en clair stocke tel quel dans le champ de hash.
  const CLAIR_DANS_HASH = /passwordHash\s*:\s*(?:motDePasse|valeur|env\b|process\b)/;

  it("le detecteur reconnait bien les cas dangereux (il ne passe pas a cote)", () => {
    expect(AFFECTATION_LITTERALE.test('const motDePasse = "SuperSecret123"')).toBe(true);
    expect(AFFECTATION_LITTERALE.test("const DEMO_PASSWORD = 'abcdefghij'")).toBe(true);
    expect(AFFECTATION_LITTERALE.test('{ password: "hunter2hunter2" }')).toBe(true);
    expect(AFFECTATION_LITTERALE.test('const passwordDemo = `azertyuiop`')).toBe(true);
    expect(AFFECTATION_LITTERALE.test('secret: "0123456789abcdef"')).toBe(true);
    expect(REPLI_LITTERAL.test('env.DEMO_PASSWORD ?? "demo1234"')).toBe(true);
    expect(REPLI_LITTERAL.test("env.DEMO_PASSWORD || 'demo1234'")).toBe(true);
    expect(CLAIR_DANS_HASH.test("passwordHash: motDePasse,")).toBe(true);
    expect(HASH_BCRYPT.test(`x = "$2b$12$${"a".repeat(53)}"`)).toBe(true);
  });

  it("le detecteur ne declenche pas sur le code legitime (pas de faux positif)", () => {
    expect(AFFECTATION_LITTERALE.test("passwordHash: hashDemo,")).toBe(false);
    expect(AFFECTATION_LITTERALE.test("const motDePasse = motDePasseDemo(env);")).toBe(false);
    expect(AFFECTATION_LITTERALE.test("passwordChangedAt: maintenant,")).toBe(false);
    expect(AFFECTATION_LITTERALE.test('const secret = "court"')).toBe(false);
    expect(REPLI_LITTERAL.test("const valeur = env.DEMO_PASSWORD;")).toBe(false);
  });

  it.each(SOURCES)("%s : aucune affectation de litteral long a un identifiant de mot de passe", (_nom, source) => {
    const lignes = source.split("\n");
    const trouvees = lignes
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => AFFECTATION_LITTERALE.test(l))
      .map(([n]) => `ligne ${n}`);
    expect(trouvees).toEqual([]);
  });

  it.each(SOURCES)("%s : aucun hash bcrypt ecrit en dur", (_nom, source) => {
    expect(HASH_BCRYPT.test(source)).toBe(false);
  });

  it.each(SOURCES)("%s : aucun repli litteral pour DEMO_PASSWORD", (_nom, source) => {
    expect(REPLI_LITTERAL.test(source)).toBe(false);
  });

  it.each(SOURCES)("%s : le mot de passe en clair n'est jamais mis dans passwordHash", (_nom, source) => {
    expect(CLAIR_DANS_HASH.test(source)).toBe(false);
  });

  it("demo.ts : le mot de passe vient de DEMO_PASSWORD, via l'argument env", () => {
    const source = SOURCES[0][1];
    expect(source).toMatch(/env\.DEMO_PASSWORD/);
    expect(source).not.toMatch(/process\.env\.DEMO_PASSWORD/);
  });

  it("demo.ts : le mot de passe n'est ni affiche ni journalise", () => {
    const source = SOURCES[0][1];
    // Aucun console.* ne doit recevoir `motDePasse` ou `valeur`.
    const appels = source.match(/console\.\w+\([^)]*\)/g) ?? [];
    for (const appel of appels) {
      expect(appel).not.toMatch(/motDePasse|DEMO_PASSWORD|valeur|hashDemo/);
    }
  });

  it(".env.example : DEMO_PASSWORD est laissee vide (aucune valeur par defaut publiee)", () => {
    const exemple = readFileSync(
      fileURLToPath(new URL("../../.env.example", import.meta.url)),
      "utf8"
    );
    const lignes = exemple.split(/\r?\n/).filter((l) => /^\s*DEMO_PASSWORD\s*=/.test(l));
    expect(lignes.length).toBe(1);
    expect(lignes[0].replace(/^\s*DEMO_PASSWORD\s*=/, "").trim()).toBe("");
  });
});

// ---------------------------------------------------------------------------
// construireDonneesDemo : outils
// ---------------------------------------------------------------------------

const ENUM_CATEGORIE_DEPENSE = (ExpenseModel.schema.path("category") as unknown as { enumValues: string[] }).enumValues;
const ENUM_SPLIT_TYPE = (ExpenseModel.schema.path("splitType") as unknown as { enumValues: string[] }).enumValues;
const ENUM_STATUT_TACHE = (TaskModel.schema.path("status") as unknown as { enumValues: string[] }).enumValues;
const ENUM_RECURRENCE = (TaskModel.schema.path("recurrence") as unknown as { enumValues: string[] }).enumValues;
const ENUM_CATEGORIE_COURSES = (ShoppingItemModel.schema.path("category") as unknown as { enumValues: string[] }).enumValues;

/** Toutes les chaines (profondeur quelconque) d'une valeur, sans les Date. */
function chaines(v: unknown, sortie: string[] = []): string[] {
  if (typeof v === "string") sortie.push(v);
  else if (v instanceof Date) return sortie;
  else if (Array.isArray(v)) v.forEach((x) => chaines(x, sortie));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => chaines(x, sortie));
  return sortie;
}

/** Toutes les dates PASSEES (hors echeances de taches), avec une etiquette. */
function datesDuPasse(donnees: DonneesDemo): [string, Date][] {
  const r: [string, Date][] = [["creeLe", donnees.creeLe]];
  donnees.membres.forEach((m, i) => r.push([`membres[${i}].joinedAt`, m.joinedAt]));
  donnees.depenses.forEach((x, i) => {
    r.push([`depenses[${i}].date`, x.date], [`depenses[${i}].createdAt`, x.createdAt]);
  });
  donnees.remboursements.forEach((x, i) => r.push([`remboursements[${i}].settledAt`, x.settledAt]));
  donnees.taches.forEach((x, i) => {
    r.push([`taches[${i}].createdAt`, x.createdAt]);
    if (x.completedAt) r.push([`taches[${i}].completedAt`, x.completedAt]);
  });
  donnees.articles.forEach((x, i) => {
    r.push([`articles[${i}].createdAt`, x.createdAt]);
    if (x.checkedAt) r.push([`articles[${i}].checkedAt`, x.checkedAt]);
  });
  return r;
}

const debutMois = (date: Date, decalage: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + decalage, 1));

/** Depenses du mois courant (UTC) de `maintenant`. */
const depensesDuMois = (donnees: DonneesDemo, maintenant: Date, decalage: number) => {
  const debut = debutMois(maintenant, decalage).getTime();
  const fin = debutMois(maintenant, decalage + 1).getTime();
  return donnees.depenses.filter((x) => x.date.getTime() >= debut && x.date.getTime() < fin);
};

/** Chaque jour de 2026 a 2028 (annee bissextile 2028), a 00:00:00.000Z et 23:59:59.999Z. */
function* tousLesInstants(): Generator<Date> {
  const debut = Date.UTC(2026, 0, 1);
  const fin = Date.UTC(2028, 11, 31);
  for (let t = debut; t <= fin; t += JOUR_MS) {
    yield new Date(t);
    yield new Date(t + JOUR_MS - 1);
  }
}

/** Applique une verification a chaque instant et rend les problemes, etiquetes par date. */
function balayer(verif: (donnees: DonneesDemo, maintenant: Date) => string[]): string[] {
  const problemes: string[] = [];
  for (const m of tousLesInstants()) {
    for (const p of verif(construire(m), m)) problemes.push(`${m.toISOString()} : ${p}`);
  }
  return problemes;
}

// Grille de dates "difficiles" pour les tests ponctuels.
const DATES_DIFFICILES: [string, string][] = [
  ["premier du mois a minuit", "2026-10-01T00:00:00.000Z"],
  ["31 janvier", "2026-01-31T12:00:00.000Z"],
  ["fin fevrier, annee non bissextile", "2026-02-28T23:59:59.999Z"],
  ["fin fevrier, annee non bissextile (2027)", "2027-02-28T00:00:00.000Z"],
  ["29 fevrier, annee bissextile", "2028-02-29T12:00:00.000Z"],
  ["28 fevrier, annee bissextile", "2028-02-28T23:59:59.999Z"],
  ["15 du mois", "2026-10-15T12:00:00.000Z"],
  ["31 decembre 23:59", "2026-12-31T23:59:00.000Z"],
  ["31 decembre 23:59:59.999", "2027-12-31T23:59:59.999Z"],
  ["1er janvier", "2027-01-01T00:00:00.000Z"],
  ["1er mars, annee non bissextile", "2026-03-01T00:00:00.000Z"],
  ["31 mars apres un fevrier de 28 jours", "2027-03-31T12:00:00.000Z"],
  ["31 mars apres un fevrier de 29 jours", "2028-03-31T12:00:00.000Z"],
  ["30 novembre", "2026-11-30T23:59:59.999Z"],
  ["2 du mois", "2026-10-02T09:00:00.000Z"],
  ["10 du mois", "2026-10-10T09:00:00.000Z"],
  ["11 du mois", "2026-10-11T00:00:00.000Z"],
  ["12 du mois", "2026-10-12T00:00:00.000Z"],
];

// ---------------------------------------------------------------------------
// Determinisme, entree non modifiee, ids
// ---------------------------------------------------------------------------

describe("construireDonneesDemo : determinisme et entrees", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("meme entree, meme sortie (profondeur comprise)", () => {
    expect(construire(MAINTENANT)).toEqual(construire(MAINTENANT));
  });

  it("deux appels rendent des objets distincts (modifier l'un ne touche pas l'autre)", () => {
    const a = construire(MAINTENANT);
    const b = construire(MAINTENANT);
    expect(a).not.toBe(b);
    expect(a.depenses).not.toBe(b.depenses);
    a.depenses[0].amount = 999999;
    a.depenses[0].payers[0].amount = 1;
    a.depenses[0].date.setUTCFullYear(1999);
    expect(construire(MAINTENANT)).toEqual(b);
  });

  it("un autre objet Date de meme instant donne les memes donnees", () => {
    const autre = new Date(MAINTENANT.getTime());
    expect(autre).not.toBe(MAINTENANT);
    expect(construire(autre)).toEqual(construire(MAINTENANT));
  });

  it("ne lit pas l'horloge reelle : resultat inchange si l'heure systeme change", () => {
    const reference = construire(MAINTENANT);
    vi.useFakeTimers();
    vi.setSystemTime(d("1999-12-31T23:59:59.000Z"));
    expect(construire(MAINTENANT)).toEqual(reference);
    vi.setSystemTime(d("2099-01-01T00:00:00.000Z"));
    expect(construire(MAINTENANT)).toEqual(reference);
  });

  it("ne depend pas du fuseau horaire de la machine", () => {
    const fuseauAvant = process.env.TZ;
    const instant = d("2026-10-31T23:30:00.000Z");
    const reference = JSON.stringify(construire(instant));
    try {
      for (const tz of ["Pacific/Kiritimati", "America/Los_Angeles", "Asia/Kolkata", "UTC"]) {
        process.env.TZ = tz;
        expect(JSON.stringify(construire(instant)), `TZ=${tz}`).toBe(reference);
      }
    } finally {
      if (fuseauAvant === undefined) delete process.env.TZ;
      else process.env.TZ = fuseauAvant;
    }
  });

  it("un instant ecrit avec un decalage horaire est lu en UTC (31 oct 23:30 a UTC-5 = 1er nov)", () => {
    const donnees = construire(d("2026-10-31T23:30:00-05:00"));
    // 2026-11-01T04:30:00Z : le mois courant est novembre, le precedent octobre.
    const loyers = donnees.depenses.filter((x) => x.description === "Loyer").map((x) => x.date.toISOString());
    expect(loyers).toEqual(["2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]);
  });

  it("n'altere ni la date ni les ids recus", () => {
    const m = new Date(MAINTENANT.getTime());
    const ids = Object.freeze({ ...IDS });
    expect(() => construireDonneesDemo(m, ids)).not.toThrow();
    expect(m.getTime()).toBe(MAINTENANT.getTime());
    expect(ids).toEqual(IDS);
  });

  it("aucune date du resultat n'est le meme objet que `maintenant`", () => {
    const m = new Date(MAINTENANT.getTime());
    const donnees = construireDonneesDemo(m, IDS);
    for (const [, date] of datesDuPasse(donnees)) expect(date).not.toBe(m);
    for (const t of donnees.taches) if (t.dueDate) expect(t.dueDate).not.toBe(m);
    // Et modifier le resultat ne change pas `m`.
    donnees.depenses.forEach((x) => x.date.setUTCFullYear(1970));
    expect(m.getTime()).toBe(MAINTENANT.getTime());
  });

  it("ids en ObjectId : meme resultat que les memes ids en chaines hexadecimales", () => {
    const objectIds: IdsDemo = {
      demo: new Types.ObjectId(IDS.demo as string),
      lea: new Types.ObjectId(IDS.lea as string),
      hugo: new Types.ObjectId(IDS.hugo as string),
      camille: new Types.ObjectId(IDS.camille as string),
    };
    const avecObjectIds = construireDonneesDemo(MAINTENANT, objectIds);
    expect(avecObjectIds).toEqual(construire(MAINTENANT));
    // Rien n'est reste un ObjectId : tout est normalise en chaine.
    const bruts = JSON.stringify(avecObjectIds);
    expect(bruts).not.toContain('"$oid"');
    for (const m of avecObjectIds.membres) expect(typeof m.userId).toBe("string");
  });

  it("ids melanges (ObjectId et chaines) : meme resultat", () => {
    const melange: IdsDemo = {
      demo: new Types.ObjectId(IDS.demo as string),
      lea: IDS.lea,
      hugo: new Types.ObjectId(IDS.hugo as string),
      camille: IDS.camille,
    };
    expect(construireDonneesDemo(MAINTENANT, melange)).toEqual(construire(MAINTENANT));
  });

  it("des ids differents ne changent que les identifiants, pas les montants ni les dates", () => {
    const autres: IdsDemo = { demo: "u1", lea: "u2", hugo: "u3", camille: "u4" };
    const a = construire(MAINTENANT);
    const b = construireDonneesDemo(MAINTENANT, autres);
    expect(b.depenses.map((x) => [x.amount, x.date, x.description])).toEqual(
      a.depenses.map((x) => [x.amount, x.date, x.description])
    );
    expect(b.remboursements.map((x) => x.amount)).toEqual(a.remboursements.map((x) => x.amount));
    expect(b.membres.map((m) => m.userId)).toEqual(["u1", "u2", "u3", "u4"]);
  });

  // Comportement actuel (voir le rapport) : aucune verification des ids recus.
  it("(comportement actuel) des ids en double ne sont pas refuses", () => {
    const doublons: IdsDemo = { demo: "x", lea: "x", hugo: "x", camille: "x" };
    const donnees = construireDonneesDemo(MAINTENANT, doublons);
    expect(donnees.membres.map((m) => m.userId)).toEqual(["x", "x", "x", "x"]);
  });

  // Comportement actuel (voir le rapport) : une date invalide ne leve pas, elle
  // produit des dates invalides que Mongoose refuserait seulement a l'insertion.
  it("(comportement actuel) une date invalide ne leve pas mais donne des dates invalides", () => {
    const donnees = construire(new Date("x"));
    expect(Number.isNaN(donnees.creeLe.getTime())).toBe(true);
    expect(donnees.depenses.every((x) => Number.isNaN(x.date.getTime()))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dates relatives a `maintenant`
// ---------------------------------------------------------------------------

describe("construireDonneesDemo : dates relatives a `maintenant`", () => {
  const iso = (x: Date) => x.toISOString();
  const trouver = (donnees: DonneesDemo, description: string, mois: "precedent" | "courant", maintenant: Date) =>
    depensesDuMois(donnees, maintenant, mois === "courant" ? 0 : -1).find((x) => x.description === description);

  it("15 octobre 2026 : dates exactes", () => {
    const m = d("2026-10-15T12:00:00.000Z");
    const x = construire(m);
    expect(iso(x.creeLe)).toBe("2026-09-01T00:00:00.000Z");
    expect(iso(trouver(x, "Loyer", "precedent", m)!.date)).toBe("2026-09-01T00:00:00.000Z");
    expect(iso(trouver(x, "Loyer", "courant", m)!.date)).toBe("2026-10-01T00:00:00.000Z");
    expect(iso(trouver(x, "Perceuse et chevilles", "courant", m)!.date)).toBe("2026-10-11T00:00:00.000Z");
    expect(x.remboursements.map((r) => iso(r.settledAt))).toEqual([
      "2026-09-27T00:00:00.000Z",
      "2026-09-28T00:00:00.000Z",
    ]);
    const echeance = (titre: string) => iso(x.taches.find((t) => t.title === titre)!.dueDate!);
    expect(echeance("Sortir les poubelles")).toBe("2026-10-16T00:00:00.000Z");
    expect(echeance("Relever le compteur d'eau")).toBe("2026-10-12T00:00:00.000Z");
    expect(echeance("Faire le ménage de la cuisine")).toBe("2026-10-24T00:00:00.000Z");
  });

  it("1er du mois a minuit : toutes les depenses du mois courant tombent le 1er", () => {
    const m = d("2026-10-01T00:00:00.000Z");
    const x = construire(m);
    const courantes = depensesDuMois(x, m, 0);
    expect(courantes.length).toBeGreaterThanOrEqual(1);
    for (const e of courantes) expect(iso(e.date)).toBe("2026-10-01T00:00:00.000Z");
    expect(iso(x.creeLe)).toBe("2026-09-01T00:00:00.000Z");
  });

  it("le 10 du mois : la depense prevue le 11 est ramenee au 10 (jamais dans le futur)", () => {
    const m = d("2026-10-10T09:00:00.000Z");
    const x = construire(m);
    expect(iso(trouver(x, "Perceuse et chevilles", "courant", m)!.date)).toBe("2026-10-10T00:00:00.000Z");
    expect(iso(trouver(x, "Courses de la semaine", "courant", m)!.date)).toBe("2026-10-09T00:00:00.000Z");
  });

  it("31 janvier : le mois precedent est decembre de l'annee d'avant", () => {
    const m = d("2026-01-31T12:00:00.000Z");
    const x = construire(m);
    expect(iso(x.creeLe)).toBe("2025-12-01T00:00:00.000Z");
    expect(iso(trouver(x, "Loyer", "precedent", m)!.date)).toBe("2025-12-01T00:00:00.000Z");
    expect(iso(trouver(x, "Loyer", "courant", m)!.date)).toBe("2026-01-01T00:00:00.000Z");
    expect(iso(trouver(x, "Perceuse et chevilles", "courant", m)!.date)).toBe("2026-01-11T00:00:00.000Z");
  });

  it("31 decembre 23:59Z : echeances au lendemain a minuit (1er janvier)", () => {
    const m = d("2026-12-31T23:59:00.000Z");
    const x = construire(m);
    expect(iso(x.taches.find((t) => t.title === "Sortir les poubelles")!.dueDate!)).toBe("2027-01-01T00:00:00.000Z");
    expect(iso(x.taches.find((t) => t.title === "Relever le compteur d'eau")!.dueDate!)).toBe("2026-12-28T00:00:00.000Z");
    expect(iso(trouver(x, "Loyer", "courant", m)!.date)).toBe("2026-12-01T00:00:00.000Z");
    expect(iso(trouver(x, "Loyer", "precedent", m)!.date)).toBe("2026-11-01T00:00:00.000Z");
  });

  it("1er janvier : le mois precedent est decembre, toutes les depenses courantes le 1er", () => {
    const m = d("2027-01-01T00:00:00.000Z");
    const x = construire(m);
    expect(iso(x.creeLe)).toBe("2026-12-01T00:00:00.000Z");
    for (const e of depensesDuMois(x, m, 0)) expect(iso(e.date)).toBe("2027-01-01T00:00:00.000Z");
  });

  it("fin fevrier non bissextile (28 fev 2026) : mois courant fevrier, precedent janvier", () => {
    const m = d("2026-02-28T23:59:59.999Z");
    const x = construire(m);
    expect(iso(trouver(x, "Loyer", "courant", m)!.date)).toBe("2026-02-01T00:00:00.000Z");
    expect(iso(trouver(x, "Loyer", "precedent", m)!.date)).toBe("2026-01-01T00:00:00.000Z");
    expect(iso(trouver(x, "Perceuse et chevilles", "courant", m)!.date)).toBe("2026-02-11T00:00:00.000Z");
  });

  it("29 fevrier 2028 : le jour existe, les depenses restent dans fevrier 2028", () => {
    const m = d("2028-02-29T12:00:00.000Z");
    const x = construire(m);
    expect(iso(trouver(x, "Loyer", "courant", m)!.date)).toBe("2028-02-01T00:00:00.000Z");
    expect(iso(trouver(x, "Loyer", "precedent", m)!.date)).toBe("2028-01-01T00:00:00.000Z");
    // Tous les instants sont valides (pas de 30 fevrier ni de 1er mars deguise).
    for (const [, date] of datesDuPasse(x)) expect(Number.isNaN(date.getTime())).toBe(false);
    expect(iso(x.taches.find((t) => t.title === "Sortir les poubelles")!.dueDate!)).toBe("2028-03-01T00:00:00.000Z");
  });

  it("31 mars 2027 (fevrier de 28 jours) : remboursements les 27 et 28 fevrier", () => {
    const m = d("2027-03-31T12:00:00.000Z");
    const x = construire(m);
    expect(x.remboursements.map((r) => iso(r.settledAt))).toEqual([
      "2027-02-27T00:00:00.000Z",
      "2027-02-28T00:00:00.000Z",
    ]);
  });

  it("31 mars 2028 (fevrier de 29 jours) : toujours dans fevrier, jamais en mars", () => {
    const m = d("2028-03-31T12:00:00.000Z");
    const x = construire(m);
    for (const r of x.remboursements) {
      expect(r.settledAt.getUTCFullYear()).toBe(2028);
      expect(r.settledAt.getUTCMonth()).toBe(1);
    }
  });

  it("les dates de depenses et de remboursements sont toutes a minuit UTC pile", () => {
    for (const [, iso8601] of DATES_DIFFICILES) {
      const x = construire(d(iso8601));
      for (const e of x.depenses) expect(e.date.getTime() % JOUR_MS).toBe(0);
      for (const r of x.remboursements) expect(r.settledAt.getTime() % JOUR_MS).toBe(0);
    }
  });

  it("deux instants du meme jour donnent les memes dates de depenses", () => {
    const matin = construire(d("2026-10-15T00:00:00.000Z"));
    const soir = construire(d("2026-10-15T23:59:59.999Z"));
    expect(soir.depenses.map((x) => x.date)).toEqual(matin.depenses.map((x) => x.date));
  });

  it("quand `maintenant` avance d'un mois, toutes les dates de depenses avancent d'un mois", () => {
    const octobre = construire(d("2026-10-20T12:00:00.000Z"));
    const novembre = construire(d("2026-11-20T12:00:00.000Z"));
    expect(octobre.depenses.length).toBe(novembre.depenses.length);
    octobre.depenses.forEach((x, i) => {
      const y = novembre.depenses[i];
      expect(y.date.getUTCMonth() - x.date.getUTCMonth()).toBe(1);
      expect(y.date.getUTCDate()).toBe(x.date.getUTCDate());
    });
  });
});

// ---------------------------------------------------------------------------
// Aucune date dans le futur, mois, coherence (sur chaque jour de 2026 a 2028)
// ---------------------------------------------------------------------------

describe("construireDonneesDemo : coherence des dates (chaque jour de 2026 a 2028, debut et fin de journee)", () => {
  it("aucune date de creation, de depense, de remboursement ou de fin n'est dans le futur", () => {
    const problemes = balayer((donnees, m) =>
      datesDuPasse(donnees)
        .filter(([, date]) => !(date.getTime() <= m.getTime()))
        .map(([nom, date]) => `${nom} = ${date.toISOString()} est apres maintenant`)
    );
    expect(problemes).toEqual([]);
  });

  it("aucune date n'est invalide", () => {
    const problemes = balayer((donnees) =>
      [
        ...datesDuPasse(donnees),
        ...donnees.taches.filter((t) => t.dueDate).map((t) => [t.title, t.dueDate!] as [string, Date]),
      ]
        .filter(([, date]) => Number.isNaN(date.getTime()))
        .map(([nom]) => `${nom} invalide`)
    );
    expect(problemes).toEqual([]);
  });

  it("le mois courant contient au moins une depense, toutes bien dans ce mois (UTC)", () => {
    const problemes = balayer((donnees, m) => {
      const courantes = depensesDuMois(donnees, m, 0);
      const precedentes = depensesDuMois(donnees, m, -1);
      const out: string[] = [];
      if (courantes.length < 1) out.push("aucune depense dans le mois courant");
      if (precedentes.length < 1) out.push("aucune depense dans le mois precedent");
      if (courantes.length + precedentes.length !== donnees.depenses.length) {
        out.push("des depenses ne sont ni dans le mois courant ni dans le precedent");
      }
      return out;
    });
    expect(problemes).toEqual([]);
  });

  it("chaque depense du mois courant est a la date du jour ou avant (jamais dans le futur du mois)", () => {
    const problemes = balayer((donnees, m) =>
      depensesDuMois(donnees, m, 0)
        .filter((x) => x.date.getUTCDate() > m.getUTCDate())
        .map((x) => `${x.description} le ${x.date.toISOString()}`)
    );
    expect(problemes).toEqual([]);
  });

  it("les remboursements sont dans le mois precedent, apres la derniere depense de ce mois", () => {
    const problemes = balayer((donnees, m) => {
      const precedentes = depensesDuMois(donnees, m, -1);
      const derniere = Math.max(...precedentes.map((x) => x.date.getTime()));
      const debut = debutMois(m, -1).getTime();
      const fin = debutMois(m, 0).getTime();
      return donnees.remboursements
        .filter((r) => r.settledAt.getTime() < debut || r.settledAt.getTime() >= fin || r.settledAt.getTime() < derniere)
        .map((r) => `remboursement du ${r.settledAt.toISOString()}`);
    });
    expect(problemes).toEqual([]);
  });

  it("createdAt d'une depense = sa date (le dashboard classe par date)", () => {
    const problemes = balayer((donnees) =>
      donnees.depenses
        .filter((x) => x.createdAt.getTime() !== x.date.getTime())
        .map((x) => x.description)
    );
    expect(problemes).toEqual([]);
  });

  // Une tache ou un article ne peut pas avoir ete cree AVANT la colocation
  // elle-meme (creeLe = 1er du mois precedent). Les anciennetes sont des durees
  // fixes (30 jours pour la plus vieille tache) alors que le mois precedent peut
  // n'avoir que 28 jours : voir le rapport.
  it("rien n'est cree avant la creation de la colocation", () => {
    const problemes = balayer((donnees) => {
      const creation = donnees.creeLe.getTime();
      return datesDuPasse(donnees)
        .filter(([, date]) => date.getTime() < creation)
        .map(([nom, date]) => `${nom} = ${date.toISOString()} avant la creation ${donnees.creeLe.toISOString()}`);
    });
    expect(problemes).toEqual([]);
  });

  it("chaque membre est arrive avant la premiere depense", () => {
    const problemes = balayer((donnees) => {
      const premiere = Math.min(...donnees.depenses.map((x) => x.date.getTime()));
      return donnees.membres
        .filter((m) => m.joinedAt.getTime() > premiere)
        .map((m) => `${m.userId} arrive apres la premiere depense`);
    });
    expect(problemes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Depenses
// ---------------------------------------------------------------------------

describe("construireDonneesDemo : depenses (comptes au centime)", () => {
  it("somme des payers = montant et somme des splits = montant, en centimes entiers (chaque jour de 2026 a 2028)", () => {
    const problemes = balayer((donnees) => {
      const out: string[] = [];
      for (const x of donnees.depenses) {
        const total = cents(x.amount);
        const payeurs = x.payers.reduce((s, p) => s + cents(p.amount), 0);
        const parts = x.splits.reduce((s, p) => s + cents(p.amount), 0);
        if (payeurs !== total) out.push(`${x.description} : payers ${payeurs} != ${total}`);
        if (parts !== total) out.push(`${x.description} : splits ${parts} != ${total}`);
      }
      return out;
    });
    expect(problemes).toEqual([]);
  });

  it("payeurs et participants sont parmi les 4 ids fournis, sans doublon dans une meme depense", () => {
    for (const [, iso] of DATES_DIFFICILES) {
      for (const x of construire(d(iso)).depenses) {
        for (const liste of [x.payers, x.splits]) {
          expect(liste.length).toBeGreaterThanOrEqual(1);
          const ids = liste.map((p) => p.userId);
          for (const id of ids) expect(TOUS).toContain(id);
          expect(new Set(ids).size).toBe(ids.length);
        }
        expect(TOUS).toContain(x.createdBy);
        expect(x.payers.map((p) => p.userId)).toContain(x.createdBy);
      }
    }
  });

  it("montants : strictement positifs, finis, a 2 decimales au plus", () => {
    const x = construire(MAINTENANT);
    for (const e of x.depenses) {
      for (const valeur of [e.amount, ...e.payers.map((p) => p.amount), ...e.splits.map((p) => p.amount)]) {
        expect(Number.isFinite(valeur)).toBe(true);
        expect(valeur).toBeGreaterThanOrEqual(0);
        // 2 decimales au plus : le montant en centimes est un entier (a 1e-6 pres).
        expect(Math.abs(valeur * 100 - Math.round(valeur * 100))).toBeLessThan(1e-6);
      }
      expect(e.amount).toBeGreaterThan(0);
      expect(e.amount).toBeLessThan(10_000);
    }
  });

  it("categories dans l'enumeration du modele, splitType valide", () => {
    for (const e of construire(MAINTENANT).depenses) {
      expect(ENUM_CATEGORIE_DEPENSE).toContain(e.category);
      expect(ENUM_SPLIT_TYPE).toContain(e.splitType);
    }
  });

  it("splitType 'equal' seulement quand les parts different d'un centime au plus", () => {
    for (const e of construire(MAINTENANT).depenses) {
      const parts = e.splits.map((s) => cents(s.amount));
      const ecart = Math.max(...parts) - Math.min(...parts);
      if (e.splitType === "equal") expect(ecart).toBeLessThanOrEqual(1);
    }
  });

  it("couvre les cas de repartition : payeurs multiples, parts egales, personnalisees", () => {
    const deps = construire(MAINTENANT).depenses;
    expect(deps.some((e) => e.payers.length > 1)).toBe(true);
    expect(deps.some((e) => e.splitType === "equal")).toBe(true);
    expect(deps.some((e) => e.splitType === "custom")).toBe(true);
    expect(deps.some((e) => e.splits.length < TOUS.length)).toBe(true);
  });

  it("descriptions non vides, sans espaces autour, sans tiret cadratin ni demi-cadratin", () => {
    for (const e of construire(MAINTENANT).depenses) {
      expect(e.description.trim()).not.toBe("");
      expect(e.description).toBe(e.description.trim());
      expect(e.description).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("pas de doublon de description dans un meme mois", () => {
    const problemes = balayer((donnees, m) => {
      const out: string[] = [];
      for (const decalage of [-1, 0]) {
        const descriptions = depensesDuMois(donnees, m, decalage).map((x) => x.description);
        const doublons = descriptions.filter((x, i) => descriptions.indexOf(x) !== i);
        if (doublons.length) out.push(`mois ${decalage} : ${doublons.join(", ")}`);
      }
      return out;
    });
    expect(problemes).toEqual([]);
  });

  it("le total depense du mois precedent reste dans une fourchette realiste", () => {
    const x = construire(MAINTENANT);
    const total = depensesDuMois(x, MAINTENANT, -1).reduce((s, e) => s + cents(e.amount), 0);
    expect(total).toBeGreaterThan(0);
    expect(total / 100).toBeLessThan(5_000);
  });

  it("chaque depense passe la validation du modele Expense (sans base)", async () => {
    for (const [, iso] of DATES_DIFFICILES) {
      for (const e of construire(d(iso)).depenses) {
        const doc = new ExpenseModel({ ...e, householdId: new Types.ObjectId() });
        await expect(doc.validate(), e.description).resolves.toBeUndefined();
      }
    }
  });

  it("controle : la validation du modele refuse bien une depense invalide (le test ci-dessus n'est pas vide)", async () => {
    const e = construire(MAINTENANT).depenses[0];
    const householdId = new Types.ObjectId();
    await expect(new ExpenseModel({ ...e, householdId, category: "inconnue" }).validate()).rejects.toThrow();
    await expect(new ExpenseModel({ ...e, householdId, amount: -1 }).validate()).rejects.toThrow();
    await expect(new ExpenseModel({ ...e, householdId, description: "  " }).validate()).rejects.toThrow();
  });

  it("chaque depense fournit tous les champs obligatoires du modele (hors householdId)", () => {
    const obligatoires = ExpenseModel.schema.requiredPaths().filter((p) => p !== "householdId");
    for (const e of construire(MAINTENANT).depenses) {
      for (const champ of obligatoires) {
        expect((e as unknown as Record<string, unknown>)[champ], champ).not.toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Remboursements
// ---------------------------------------------------------------------------

describe("construireDonneesDemo : remboursements", () => {
  it("de et vers differents, membres valides, montant positif a 2 decimales", () => {
    for (const [, iso] of DATES_DIFFICILES) {
      const x = construire(d(iso));
      expect(x.remboursements.length).toBeGreaterThanOrEqual(1);
      for (const r of x.remboursements) {
        expect(r.fromUserId).not.toBe(r.toUserId);
        expect(TOUS).toContain(r.fromUserId);
        expect(TOUS).toContain(r.toUserId);
        expect(r.amount).toBeGreaterThan(0);
        expect(Math.abs(r.amount * 100 - Math.round(r.amount * 100))).toBeLessThan(1e-6);
      }
    }
  });

  it("un remboursement ne depasse ni ce que le debiteur doit ni ce que le creancier a avance (mois precedent)", () => {
    const x = construire(MAINTENANT);
    const nets = new Map<string, number>(TOUS.map((id) => [id, 0]));
    for (const e of depensesDuMois(x, MAINTENANT, -1)) {
      for (const p of e.payers) nets.set(p.userId, nets.get(p.userId)! + cents(p.amount));
      for (const s of e.splits) nets.set(s.userId, nets.get(s.userId)! - cents(s.amount));
    }
    // La somme des soldes nets est nulle : tout l'argent avance est du par quelqu'un.
    expect([...nets.values()].reduce((a, b) => a + b, 0)).toBe(0);
    for (const r of x.remboursements) {
      expect(nets.get(r.fromUserId)!).toBeLessThan(0);
      expect(nets.get(r.toUserId)!).toBeGreaterThan(0);
      expect(cents(r.amount)).toBeLessThanOrEqual(-nets.get(r.fromUserId)!);
      expect(cents(r.amount)).toBeLessThanOrEqual(nets.get(r.toUserId)!);
    }
  });

  it("pas deux remboursements identiques (meme de, vers, montant)", () => {
    const x = construire(MAINTENANT);
    const cles = x.remboursements.map((r) => `${r.fromUserId}>${r.toUserId}:${r.amount}`);
    expect(new Set(cles).size).toBe(cles.length);
  });

  it("chaque remboursement passe la validation du modele Settlement (sans base)", async () => {
    for (const [, iso] of DATES_DIFFICILES) {
      for (const r of construire(d(iso)).remboursements) {
        const doc = new SettlementModel({ ...r, householdId: new Types.ObjectId() });
        await expect(doc.validate()).resolves.toBeUndefined();
      }
    }
  });

  it("chaque remboursement fournit les champs obligatoires du modele (hors householdId)", () => {
    const obligatoires = SettlementModel.schema.requiredPaths().filter((p) => p !== "householdId");
    for (const r of construire(MAINTENANT).remboursements) {
      for (const champ of obligatoires) {
        expect((r as unknown as Record<string, unknown>)[champ], champ).not.toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Taches
// ---------------------------------------------------------------------------

describe("construireDonneesDemo : taches", () => {
  const sept = 7 * JOUR_MS;

  it("champs obligatoires du modele presents, statuts et recurrences dans les enumerations", () => {
    const obligatoires = TaskModel.schema.requiredPaths().filter((p) => p !== "householdId");
    for (const t of construire(MAINTENANT).taches) {
      for (const champ of obligatoires) {
        const valeur = (t as unknown as Record<string, unknown>)[champ];
        expect(valeur, `${t.title} : ${champ}`).not.toBeUndefined();
      }
      expect(t.title.trim()).not.toBe("");
      expect(ENUM_STATUT_TACHE).toContain(t.status);
      expect(ENUM_RECURRENCE).toContain(t.recurrence);
      expect(TOUS).toContain(t.createdBy);
      expect(t.assignedTo.length).toBeGreaterThanOrEqual(1);
      for (const a of t.assignedTo) expect(TOUS).toContain(a);
    }
  });

  it("au moins une tache en retard, une a venir et une terminee (chaque jour de 2026 a 2028)", () => {
    const problemes = balayer((donnees, m) => {
      const out: string[] = [];
      const enRetard = donnees.taches.filter((t) => t.status !== "done" && t.dueDate && t.dueDate.getTime() < m.getTime());
      const aVenir = donnees.taches.filter((t) => t.status !== "done" && t.dueDate && t.dueDate.getTime() > m.getTime());
      const terminees = donnees.taches.filter((t) => t.status === "done");
      if (enRetard.length < 1) out.push("aucune tache en retard");
      if (aVenir.length < 1) out.push("aucune tache a venir");
      if (terminees.length < 1) out.push("aucune tache terminee");
      return out;
    });
    expect(problemes).toEqual([]);
  });

  it("couvre tous les statuts, les deux recurrences et la rotation", () => {
    const taches = construire(MAINTENANT).taches;
    for (const statut of ENUM_STATUT_TACHE) expect(taches.some((t) => t.status === statut)).toBe(true);
    expect(taches.some((t) => t.recurrence === "weekly")).toBe(true);
    expect(taches.some((t) => t.recurrence === "monthly")).toBe(true);
    expect(taches.some((t) => t.rotation)).toBe(true);
  });

  it("une tache terminee a completedAt et completedBy, les autres n'en ont pas", () => {
    for (const t of construire(MAINTENANT).taches) {
      if (t.status === "done") {
        expect(t.completedAt).toBeInstanceOf(Date);
        expect(TOUS).toContain(t.completedBy);
        expect(t.completedAt!.getTime()).toBeGreaterThanOrEqual(t.createdAt.getTime());
      } else {
        expect(t.completedAt).toBeUndefined();
        expect(t.completedBy).toBeUndefined();
      }
    }
  });

  it("une tache non terminee a une echeance ; la creation precede l'echeance", () => {
    for (const t of construire(MAINTENANT).taches) {
      if (t.status !== "done") expect(t.dueDate).toBeInstanceOf(Date);
      if (t.dueDate) expect(t.createdAt.getTime()).toBeLessThan(t.dueDate.getTime());
    }
  });

  it("la rotation n'est activee que sur une tache recurrente", () => {
    for (const t of construire(MAINTENANT).taches) {
      if (t.rotation) expect(t.recurrence).not.toBe("none");
    }
  });

  it("rien n'est deja traite : aucune occurrence generee, aucun rappel envoye", () => {
    for (const t of construire(MAINTENANT).taches) {
      expect(t.occurrenceGeneree).toBe(false);
      expect(t.rappelEnvoye).toBe(false);
    }
  });

  it("des taches terminees dans les 7 derniers jours ET d'autres depuis plus de 7 jours", () => {
    const taches = construire(MAINTENANT).taches.filter((t) => t.status === "done");
    expect(taches.some((t) => MAINTENANT.getTime() - t.completedAt!.getTime() < sept)).toBe(true);
    expect(taches.some((t) => MAINTENANT.getTime() - t.completedAt!.getTime() > sept)).toBe(true);
  });

  it("titres et descriptions sans tiret cadratin, titres sans doublon", () => {
    const taches = construire(MAINTENANT).taches;
    for (const t of taches) {
      expect(t.title).not.toMatch(/[\u2013\u2014]/);
      expect(t.description ?? "").not.toMatch(/[\u2013\u2014]/);
      if (t.description !== undefined) expect(t.description.trim()).not.toBe("");
    }
    const titres = taches.map((t) => t.title);
    expect(new Set(titres).size).toBe(titres.length);
  });

  it("chaque tache passe la validation du modele Task (sans base)", async () => {
    for (const [, iso] of DATES_DIFFICILES) {
      for (const t of construire(d(iso)).taches) {
        const doc = new TaskModel({ ...t, householdId: new Types.ObjectId() });
        await expect(doc.validate(), t.title).resolves.toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Articles de courses
// ---------------------------------------------------------------------------

describe("construireDonneesDemo : articles de courses", () => {
  const sept = 7 * JOUR_MS;

  it("champs obligatoires presents, categories dans l'enumeration", () => {
    const obligatoires = ShoppingItemModel.schema.requiredPaths().filter((p) => p !== "householdId");
    for (const a of construire(MAINTENANT).articles) {
      for (const champ of obligatoires) {
        expect((a as unknown as Record<string, unknown>)[champ], `${a.name} : ${champ}`).not.toBeUndefined();
      }
      expect(a.name.trim()).not.toBe("");
      expect(TOUS).toContain(a.addedBy);
      if (a.category !== undefined) {
        expect(ENUM_CATEGORIE_COURSES).toContain(a.category);
        expect(VALEURS_CATEGORIES as readonly string[]).toContain(a.category);
      }
    }
  });

  it("un article coche a checkedBy et checkedAt, un article non coche n'en a pas", () => {
    for (const a of construire(MAINTENANT).articles) {
      if (a.checked) {
        expect(TOUS).toContain(a.checkedBy);
        expect(a.checkedAt).toBeInstanceOf(Date);
        expect(a.checkedAt!.getTime()).toBeGreaterThanOrEqual(a.createdAt.getTime());
      } else {
        expect(a.checkedBy).toBeUndefined();
        expect(a.checkedAt).toBeUndefined();
      }
    }
  });

  it("des articles a acheter, des articles coches recents et un coche depuis plus de 7 jours", () => {
    const articles = construire(MAINTENANT).articles;
    expect(articles.some((a) => !a.checked)).toBe(true);
    expect(articles.some((a) => a.checked && MAINTENANT.getTime() - a.checkedAt!.getTime() < sept)).toBe(true);
    expect(articles.some((a) => a.checked && MAINTENANT.getTime() - a.checkedAt!.getTime() > sept)).toBe(true);
  });

  it("noms sans doublon et sans tiret cadratin", () => {
    const articles = construire(MAINTENANT).articles;
    const noms = articles.map((a) => a.name);
    expect(new Set(noms).size).toBe(noms.length);
    for (const a of articles) {
      expect(a.name).not.toMatch(/[\u2013\u2014]/);
      expect(a.quantity ?? "").not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("chaque article passe la validation du modele ShoppingItem (sans base)", async () => {
    for (const [, iso] of DATES_DIFFICILES) {
      for (const a of construire(d(iso)).articles) {
        const doc = new ShoppingItemModel({ ...a, householdId: new Types.ObjectId() });
        await expect(doc.validate(), a.name).resolves.toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Membres, emails, textes
// ---------------------------------------------------------------------------

describe("construireDonneesDemo : membres et securite des adresses", () => {
  it("4 membres distincts : le compte demo est admin, les 3 autres sont membres", () => {
    const { membres } = construire(MAINTENANT);
    expect(membres.map((m) => m.userId)).toEqual(TOUS);
    expect(membres.filter((m) => m.role === "admin").map((m) => m.userId)).toEqual([IDS.demo]);
    expect(membres.filter((m) => m.role === "member").length).toBe(3);
    expect(new Set(membres.map((m) => m.userId)).size).toBe(4);
  });

  it("aucune adresse email dans les donnees produites (pas de '@' dans une chaine)", () => {
    for (const [, iso] of DATES_DIFFICILES) {
      const avecArobase = chaines(construire(d(iso))).filter((s) => s.includes("@"));
      expect(avecArobase).toEqual([]);
    }
  });

  it("les 4 utilisateurs de la colocation ont une adresse reconnue comme demo (aucun mail ne peut partir)", () => {
    // Les donnees ne citent que des ids ; ADRESSE_DE les relie aux adresses
    // reelles du compte demo et des colocataires fictifs.
    const x = construire(MAINTENANT);
    const cites = new Set<string>([
      ...x.membres.map((m) => m.userId),
      ...x.depenses.flatMap((e) => [e.createdBy, ...e.payers.map((p) => p.userId), ...e.splits.map((p) => p.userId)]),
      ...x.remboursements.flatMap((r) => [r.fromUserId, r.toUserId]),
      ...x.taches.flatMap((t) => [t.createdBy, ...t.assignedTo, ...(t.completedBy ? [t.completedBy] : [])]),
      ...x.articles.flatMap((a) => [a.addedBy, ...(a.checkedBy ? [a.checkedBy] : [])]),
    ]);
    expect(cites.size).toBe(4);
    for (const id of cites) {
      const adresse = ADRESSE_DE[id];
      expect(adresse, `id ${id} sans adresse connue`).toBeDefined();
      expect(estEmailDemo(adresse, demoEmail.emailCompteDemo({}))).toBe(true);
    }
  });

  it("les taches a rappeler (echeance proche, rappel non envoye) ne visent que des adresses de demo", () => {
    // Les rappels par email partent d'une tache non terminee avec echeance :
    // chaque assigne doit etre protege par estEmailDemo.
    const x = construire(MAINTENANT);
    const rappelables = x.taches.filter((t) => t.status !== "done" && t.dueDate && !t.rappelEnvoye);
    expect(rappelables.length).toBeGreaterThanOrEqual(1);
    for (const t of rappelables) {
      for (const a of t.assignedTo) {
        expect(estEmailDemo(ADRESSE_DE[a], demoEmail.emailCompteDemo({}))).toBe(true);
      }
    }
  });

  it("aucun texte du jeu de donnees ne contient de tiret cadratin ni de demi-cadratin", () => {
    for (const [, iso] of DATES_DIFFICILES) {
      for (const s of chaines(construire(d(iso)))) {
        expect(s).not.toMatch(/[\u2013\u2014]/);
      }
    }
  });

  it("aucun texte ne contient de caractere de controle (NUL, retour a la ligne)", () => {
    for (const s of chaines(construire(MAINTENANT))) {
      expect(s).not.toMatch(/[\u0000-\u001F\u007F]/);
    }
  });

  it("toutes les chaines sont soit un id fourni, soit un texte lisible non vide", () => {
    for (const s of chaines(construire(MAINTENANT))) {
      expect(s.trim()).not.toBe("");
    }
  });
});
