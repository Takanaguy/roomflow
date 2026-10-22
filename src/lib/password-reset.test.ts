import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DELAI_MIN_ENTRE_DEMANDES_SECONDES,
  DUREE_JETON_MINUTES,
  demandeTropRecente,
  genererJeton,
  hacherJeton,
  jetonExpire,
  seuilDemandeRecente,
} from "@/lib/password-reset";

// Seules les fonctions pures sont testees ici. Importer password-reset.ts
// charge aussi le client Mongo et les modeles, mais sans aucune connexion :
// connectDB() n'est appelee que par les fonctions qui touchent la base, que ce
// fichier n'appelle jamais.

// Dates ecrites en ISO avec "Z" : le test ne depend jamais du fuseau de la
// machine, ni de l'horloge reelle (sinon un test casserait selon le jour).
const d = (iso: string) => new Date(iso);
const MAINTENANT = d("2026-10-21T12:00:00.000Z");

const HEX_SHA256 = /^[0-9a-f]{64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

describe("constantes de la reinitialisation", () => {
  it("le jeton est valable 60 minutes", () => {
    expect(DUREE_JETON_MINUTES).toBe(60);
  });

  it("deux demandes doivent etre espacees d'au moins 60 secondes", () => {
    expect(DELAI_MIN_ENTRE_DEMANDES_SECONDES).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// hacherJeton
// ---------------------------------------------------------------------------

describe("hacherJeton", () => {
  it("vecteur connu : sha256 de 'abc' (la fonction hache la chaine telle quelle)", () => {
    expect(hacherJeton("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("vecteur connu : sha256 de la chaine vide", () => {
    expect(hacherJeton("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  it("deterministe : meme entree, meme sortie", () => {
    expect(hacherJeton("mon-jeton")).toBe(hacherJeton("mon-jeton"));
  });

  it("entrees differentes : sorties differentes", () => {
    expect(hacherJeton("jeton-a")).not.toBe(hacherJeton("jeton-b"));
  });

  it("sensible a la casse", () => {
    expect(hacherJeton("Abc")).not.toBe(hacherJeton("abc"));
  });

  it.each([" abc", "abc ", "a bc", "abc\n", "\tabc"])(
    "sensible aux espaces et retours a la ligne (%j)",
    (variante) => {
      // Pas de trim cache : un jeton copie avec un espace en trop ne doit pas
      // retrouver le meme hash qu'un jeton propre.
      expect(hacherJeton(variante)).not.toBe(hacherJeton("abc"));
    }
  );

  it.each(["a+b/c=d", "<script>alert(1)</script>", "'; DROP TABLE users;--", "\0", "%20%2F"])(
    "caracteres speciaux (%j) : hash hexadecimal valide",
    (entree) => {
      expect(hacherJeton(entree)).toMatch(HEX_SHA256);
    }
  );

  it("unicode et emoji : hache l'UTF-8 de la chaine", () => {
    for (const entree of ["éàü", "日本語", "😀🔥", "é"]) {
      const attendu = createHash("sha256").update(Buffer.from(entree, "utf8")).digest("hex");
      expect(hacherJeton(entree)).toBe(attendu);
    }
  });

  it("'é' composee et 'e' + accent combinant : hash differents (pas de normalisation)", () => {
    expect(hacherJeton("é")).not.toBe(hacherJeton("é"));
  });

  it("tres longue chaine (1 million de caracteres) : toujours 64 caracteres hex", () => {
    const longue = "x".repeat(1_000_000);
    const h = hacherJeton(longue);
    expect(h).toMatch(HEX_SHA256);
    expect(hacherJeton(longue)).toBe(h);
    // Un seul caractere change a la fin suffit a changer tout le hash.
    expect(hacherJeton(longue + "y")).not.toBe(h);
  });

  it("la sortie ne contient jamais l'entree", () => {
    expect(hacherJeton("jeton-secret")).not.toContain("jeton-secret");
  });
});

// ---------------------------------------------------------------------------
// genererJeton
// ---------------------------------------------------------------------------

describe("genererJeton", () => {
  it("jeton en base64url : alphabet A-Za-z0-9_-, sans '=', '+' ni '/'", () => {
    // Lot de plusieurs jetons : un caractere interdit n'apparait pas a chaque
    // tirage, un seul essai pourrait passer par chance.
    for (let i = 0; i < 200; i++) {
      const { jeton } = genererJeton();
      expect(jeton).toMatch(BASE64URL);
      expect(jeton).not.toMatch(/[=+/]/);
    }
  });

  it("32 octets : 43 caracteres base64url (sans bourrage)", () => {
    for (let i = 0; i < 50; i++) {
      expect(genererJeton().jeton).toHaveLength(43);
    }
  });

  it("le jeton passe tel quel dans une URL (encodeURIComponent ne change rien)", () => {
    const { jeton } = genererJeton();
    expect(encodeURIComponent(jeton)).toBe(jeton);
  });

  it("le hash est du sha256 hexadecimal : 64 caracteres hex minuscules", () => {
    expect(genererJeton().hash).toMatch(HEX_SHA256);
  });

  it("hash === hacherJeton(jeton)", () => {
    const { jeton, hash } = genererJeton();
    expect(hash).toBe(hacherJeton(jeton));
  });

  it("le hash est different du jeton et ne le contient pas", () => {
    const { jeton, hash } = genererJeton();
    expect(hash).not.toBe(jeton);
    expect(hash).not.toContain(jeton);
    expect(jeton).not.toContain(hash);
  });

  it("1000 jetons generes : tous distincts, leurs hash aussi", () => {
    const jetons = new Set<string>();
    const hashs = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const g = genererJeton();
      jetons.add(g.jeton);
      hashs.add(g.hash);
    }
    expect(jetons.size).toBe(1000);
    expect(hashs.size).toBe(1000);
  });

  it("imprevisible : les 8 premiers caracteres ne se repetent pas dans un lot", () => {
    // 8 caracteres base64url = 48 bits. Sur 200 jetons, la chance de voir deux
    // prefixes identiques par hasard est de l'ordre de 1 sur 10 milliards :
    // le test n'est pas fragile, mais un generateur previsible (compteur,
    // horloge, Math.random mal utilise) le ferait echouer.
    const prefixes = new Set<string>();
    for (let i = 0; i < 200; i++) {
      prefixes.add(genererJeton().jeton.slice(0, 8));
    }
    expect(prefixes.size).toBe(200);
  });

  it("deux appels successifs ne partagent pas de long prefixe", () => {
    for (let i = 0; i < 50; i++) {
      const a = genererJeton().jeton;
      const b = genererJeton().jeton;
      expect(a.slice(0, 8)).not.toBe(b.slice(0, 8));
    }
  });
});

// ---------------------------------------------------------------------------
// jetonExpire
// ---------------------------------------------------------------------------

describe("jetonExpire", () => {
  const expiresAt = d("2026-10-21T13:00:00.000Z");
  const ms = (date: Date, delta: number) => new Date(date.getTime() + delta);

  it("1 ms avant l'expiration : pas expire", () => {
    expect(jetonExpire(expiresAt, ms(expiresAt, -1))).toBe(false);
  });

  it("exactement a l'expiration : expire (maintenant >= expiresAt)", () => {
    expect(jetonExpire(expiresAt, new Date(expiresAt.getTime()))).toBe(true);
  });

  it("1 ms apres l'expiration : expire", () => {
    expect(jetonExpire(expiresAt, ms(expiresAt, 1))).toBe(true);
  });

  it("jeton tout juste cree (duree complete devant lui) : pas expire", () => {
    const fin = new Date(MAINTENANT.getTime() + DUREE_JETON_MINUTES * 60_000);
    expect(jetonExpire(fin, MAINTENANT)).toBe(false);
  });

  it("jeton cree il y a plus que la duree de vie : expire", () => {
    const fin = new Date(MAINTENANT.getTime() + DUREE_JETON_MINUTES * 60_000);
    const plusTard = new Date(fin.getTime() + 60_000);
    expect(jetonExpire(fin, plusTard)).toBe(true);
  });

  it("expiresAt invalide : expire (par prudence)", () => {
    expect(jetonExpire(new Date("x"), MAINTENANT)).toBe(true);
  });

  it("maintenant invalide : expire (par prudence)", () => {
    expect(jetonExpire(expiresAt, new Date("x"))).toBe(true);
  });

  it("les deux dates invalides : expire", () => {
    expect(jetonExpire(new Date("x"), new Date("y"))).toBe(true);
  });

  it("annees differentes : expiration en 2027, on est en 2026 : pas expire", () => {
    expect(jetonExpire(d("2027-01-01T00:00:00.000Z"), d("2026-12-31T23:59:59.999Z"))).toBe(false);
  });

  it("annees differentes : expiration en 2025, on est en 2026 : expire", () => {
    expect(jetonExpire(d("2025-12-31T23:59:59.999Z"), d("2026-01-01T00:00:00.000Z"))).toBe(true);
  });

  it("annees tres eloignees (an 1970 et an 2100)", () => {
    expect(jetonExpire(d("2100-01-01T00:00:00.000Z"), MAINTENANT)).toBe(false);
    expect(jetonExpire(d("1970-01-01T00:00:00.000Z"), MAINTENANT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// demandeTropRecente
// ---------------------------------------------------------------------------

describe("demandeTropRecente", () => {
  const delaiMs = DELAI_MIN_ENTRE_DEMANDES_SECONDES * 1000;
  // Date de la derniere demande, situee `ecouleMs` avant MAINTENANT.
  const ilYa = (ecouleMs: number) => new Date(MAINTENANT.getTime() - ecouleMs);

  it("aucune demande connue (null) : ne bloque pas", () => {
    expect(demandeTropRecente(null, MAINTENANT)).toBe(false);
  });

  it("aucune demande connue (undefined) : ne bloque pas", () => {
    expect(demandeTropRecente(undefined, MAINTENANT)).toBe(false);
  });

  it("demande a l'instant meme (0 ms) : trop recente", () => {
    expect(demandeTropRecente(ilYa(0), MAINTENANT)).toBe(true);
  });

  it("il y a 1 s : trop recente", () => {
    expect(demandeTropRecente(ilYa(1000), MAINTENANT)).toBe(true);
  });

  it("il y a (delai - 1 s) : trop recente", () => {
    expect(demandeTropRecente(ilYa(delaiMs - 1000), MAINTENANT)).toBe(true);
  });

  it("frontiere : 1 ms avant le delai : trop recente", () => {
    expect(demandeTropRecente(ilYa(delaiMs - 1), MAINTENANT)).toBe(true);
  });

  it("frontiere : exactement le delai : autorisee (le code compare avec < strict)", () => {
    expect(demandeTropRecente(ilYa(delaiMs), MAINTENANT)).toBe(false);
  });

  it("frontiere : 1 ms apres le delai : autorisee", () => {
    expect(demandeTropRecente(ilYa(delaiMs + 1), MAINTENANT)).toBe(false);
  });

  it("il y a (delai + 1 s) : autorisee", () => {
    expect(demandeTropRecente(ilYa(delaiMs + 1000), MAINTENANT)).toBe(false);
  });

  it("il y a un an : autorisee", () => {
    expect(demandeTropRecente(d("2025-10-21T12:00:00.000Z"), MAINTENANT)).toBe(false);
  });

  it("date de derniere demande invalide : ne bloque pas", () => {
    expect(demandeTropRecente(new Date("x"), MAINTENANT)).toBe(false);
  });

  it("date 'maintenant' invalide : ne bloque pas", () => {
    expect(demandeTropRecente(ilYa(1000), new Date("x"))).toBe(false);
  });

  it("date future proche (horloge decalee) : comportement actuel = trop recente", () => {
    // Documente le code actuel : une date future donne un ecart negatif, donc
    // inferieur au delai, donc la demande est bloquee. Un decalage d'horloge
    // de quelques secondes bloque seulement un peu plus longtemps.
    expect(demandeTropRecente(ilYa(-5000), MAINTENANT)).toBe(true);
  });

  it("date future lointaine (1 an) : comportement actuel = bloquee aussi", () => {
    // Memes raisons que ci-dessus, mais ici le blocage durerait un an si une
    // date aussi aberrante etait stockee. Pas un bug en pratique (createdAt
    // est ecrit par le serveur), mais a savoir.
    expect(demandeTropRecente(d("2027-10-21T12:00:00.000Z"), MAINTENANT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// seuilDemandeRecente
// ---------------------------------------------------------------------------

describe("seuilDemandeRecente", () => {
  // Toujours calcule avec la constante : si le delai change un jour, ces tests
  // suivent au lieu de casser sur un "60" ecrit en dur.
  const delaiMs = DELAI_MIN_ENTRE_DEMANDES_SECONDES * 1000;

  it("vaut exactement maintenant moins le delai, a la milliseconde", () => {
    expect(seuilDemandeRecente(MAINTENANT).getTime()).toBe(MAINTENANT.getTime() - delaiMs);
  });

  it("avec le delai actuel de 60 s : 12:00:00.000 devient 11:59:00.000", () => {
    // Valeur litterale en plus de la formule : elle ne depend pas de la
    // constante, donc elle detecte une formule fausse (signe, unite).
    expect(seuilDemandeRecente(MAINTENANT).toISOString()).toBe("2026-10-21T11:59:00.000Z");
  });

  it("les millisecondes sont conservees : .123 reste .123", () => {
    const m = d("2026-10-21T12:00:00.123Z");
    expect(seuilDemandeRecente(m).toISOString()).toBe("2026-10-21T11:59:00.123Z");
    expect(seuilDemandeRecente(m).getTime()).toBe(m.getTime() - delaiMs);
  });

  it("le seuil est anterieur a maintenant, jamais egal ni posterieur", () => {
    expect(seuilDemandeRecente(MAINTENANT).getTime()).toBeLessThan(MAINTENANT.getTime());
  });

  it("la date passee en entree n'est pas modifiee", () => {
    const m = new Date(MAINTENANT.getTime());
    seuilDemandeRecente(m);
    expect(m.getTime()).toBe(MAINTENANT.getTime());
  });

  it("renvoie un nouvel objet Date, pas l'entree elle-meme", () => {
    const m = new Date(MAINTENANT.getTime());
    const seuil = seuilDemandeRecente(m);
    expect(seuil).toBeInstanceOf(Date);
    expect(seuil).not.toBe(m);
  });

  it("deterministe : deux appels avec la meme date donnent le meme seuil", () => {
    expect(seuilDemandeRecente(MAINTENANT).getTime()).toBe(seuilDemandeRecente(MAINTENANT).getTime());
  });

  it("passage de minute et d'heure : 13:00:30 donne 12:59:30", () => {
    expect(seuilDemandeRecente(d("2026-10-21T13:00:30.000Z")).toISOString()).toBe(
      "2026-10-21T12:59:30.000Z"
    );
  });

  it("passage de jour : minuit pile donne la veille a 23:59:00", () => {
    expect(seuilDemandeRecente(d("2026-10-22T00:00:00.000Z")).toISOString()).toBe(
      "2026-10-21T23:59:00.000Z"
    );
  });

  it("passage de mois : 1er mars 00:00:00 (annee non bissextile) donne le 28 fevrier 23:59:00", () => {
    expect(seuilDemandeRecente(d("2026-03-01T00:00:00.000Z")).toISOString()).toBe(
      "2026-02-28T23:59:00.000Z"
    );
  });

  it("passage de mois, annee bissextile : 1er mars 2028 donne le 29 fevrier 23:59:00", () => {
    expect(seuilDemandeRecente(d("2028-03-01T00:00:00.000Z")).toISOString()).toBe(
      "2028-02-29T23:59:00.000Z"
    );
  });

  it("passage d'annee : 1er janvier 00:00:30 donne le 31 decembre 23:59:30", () => {
    expect(seuilDemandeRecente(d("2027-01-01T00:00:30.000Z")).toISOString()).toBe(
      "2026-12-31T23:59:30.000Z"
    );
  });

  it("passage d'annee a la milliseconde : 1er janvier 00:00:00.000 donne le 31 decembre 23:59:00.000", () => {
    expect(seuilDemandeRecente(d("2027-01-01T00:00:00.000Z")).toISOString()).toBe(
      "2026-12-31T23:59:00.000Z"
    );
  });

  it("epoque Unix : donne -60000 ms (date avant 1970, valide)", () => {
    expect(seuilDemandeRecente(new Date(0)).getTime()).toBe(-delaiMs);
  });

  it("date invalide : renvoie une date invalide, sans lever d'exception", () => {
    // Comportement actuel (aucune garde dans le code) : NaN - 60000 = NaN.
    // Pas dangereux en pratique, l'appelant passe new Date(). Mais si une
    // date invalide arrivait dans le filtre Mongo, la comparaison $lte ne
    // trouverait aucune ligne (donc plus aucune demande ne passerait).
    let seuil: Date | undefined;
    expect(() => {
      seuil = seuilDemandeRecente(new Date("x"));
    }).not.toThrow();
    expect(seuil).toBeInstanceOf(Date);
    expect(Number.isNaN(seuil!.getTime())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Coherence entre seuilDemandeRecente (requete Mongo) et demandeTropRecente
// ---------------------------------------------------------------------------

describe("coherence seuilDemandeRecente / demandeTropRecente", () => {
  const delaiMs = DELAI_MIN_ENTRE_DEMANDES_SECONDES * 1000;
  const ilYa = (ecouleMs: number) => new Date(MAINTENANT.getTime() - ecouleMs);

  // Ce que fait la requete de traiterDemandeReinitialisation :
  // { derniereDemandeMdpAt: { $lte: seuilDemandeRecente(maintenant) } }.
  // Le test refait la meme comparaison en JS, sans base.
  const autoriseParMongo = (createdAt: Date, maintenant: Date) =>
    createdAt.getTime() <= seuilDemandeRecente(maintenant).getTime();

  it("createdAt exactement egal au seuil : la demande est autorisee par les deux", () => {
    const createdAt = seuilDemandeRecente(MAINTENANT);
    expect(autoriseParMongo(createdAt, MAINTENANT)).toBe(true);
    expect(demandeTropRecente(createdAt, MAINTENANT)).toBe(false);
  });

  it("1 ms apres le seuil (donc 1 ms trop tot) : refusee par les deux", () => {
    const createdAt = new Date(seuilDemandeRecente(MAINTENANT).getTime() + 1);
    expect(autoriseParMongo(createdAt, MAINTENANT)).toBe(false);
    expect(demandeTropRecente(createdAt, MAINTENANT)).toBe(true);
  });

  it("1 ms avant le seuil : autorisee par les deux", () => {
    const createdAt = new Date(seuilDemandeRecente(MAINTENANT).getTime() - 1);
    expect(autoriseParMongo(createdAt, MAINTENANT)).toBe(true);
    expect(demandeTropRecente(createdAt, MAINTENANT)).toBe(false);
  });

  it.each([-2, -1, 0, 1, 2])(
    "frontiere a la milliseconde (delai %i ms) : les deux fonctions donnent la meme reponse",
    (decalage) => {
      const createdAt = ilYa(delaiMs + decalage);
      expect(autoriseParMongo(createdAt, MAINTENANT)).toBe(!demandeTropRecente(createdAt, MAINTENANT));
    }
  );

  it("balayage de -2 s a +2 s autour de la frontiere, pas de 1 ms : jamais de desaccord", () => {
    // 4001 valeurs, dont la frontiere exacte : un "<" contre un "<=" inverse
    // sur une seule milliseconde ferait echouer ce test.
    for (let decalage = -2000; decalage <= 2000; decalage++) {
      const createdAt = ilYa(delaiMs + decalage);
      expect(
        autoriseParMongo(createdAt, MAINTENANT),
        `decalage ${decalage} ms`
      ).toBe(!demandeTropRecente(createdAt, MAINTENANT));
    }
  });

  it("memes reponses loin de la frontiere : maintenant, il y a 1 s, 10 min, 1 an", () => {
    for (const ecoule of [0, 1000, 10 * 60_000, 365 * 24 * 3600_000]) {
      const createdAt = ilYa(ecoule);
      expect(autoriseParMongo(createdAt, MAINTENANT)).toBe(!demandeTropRecente(createdAt, MAINTENANT));
    }
  });

  it("derniere demande dans le futur (horloge decalee) : bloquee par les deux, de facon coherente", () => {
    const createdAt = ilYa(-5000);
    expect(autoriseParMongo(createdAt, MAINTENANT)).toBe(false);
    expect(demandeTropRecente(createdAt, MAINTENANT)).toBe(true);
  });

  it("la coherence tient aussi a un autre instant, ms non nulles et autre annee", () => {
    const autre = d("2028-02-29T23:59:59.999Z");
    const frontiere = new Date(autre.getTime() - delaiMs);
    for (const decalage of [-1, 0, 1]) {
      const createdAt = new Date(frontiere.getTime() + decalage);
      expect(autoriseParMongo(createdAt, autre), `decalage ${decalage} ms`).toBe(
        !demandeTropRecente(createdAt, autre)
      );
    }
  });
});
