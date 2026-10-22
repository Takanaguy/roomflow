import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { fenetreRappel, secretCronValide, tacheARappeler } from "@/lib/rappels";

// Seules les fonctions pures sont testees ici. Importer rappels.ts charge aussi
// Mongo, Resend et les gabarits d'email, mais sans connexion ni envoi :
// connectDB() et envoyerEmail() ne sont appelees que par envoyerRappelsTaches,
// que ce fichier n'appelle jamais. Aucun vrai email ne peut partir.

// Dates ecrites en ISO avec "Z" : le test ne depend jamais du fuseau de la
// machine, ni de l'horloge reelle.
const d = (iso: string) => new Date(iso);
const iso = (date: Date) => date.toISOString();

// ---------------------------------------------------------------------------
// fenetreRappel
// ---------------------------------------------------------------------------

describe("fenetreRappel", () => {
  it("cas nominal : debut = minuit UTC du jour, fin = minuit UTC du surlendemain", () => {
    const { debut, fin } = fenetreRappel(d("2026-10-21T12:34:56.789Z"));
    expect(iso(debut)).toBe("2026-10-21T00:00:00.000Z");
    expect(iso(fin)).toBe("2026-10-23T00:00:00.000Z");
  });

  it("maintenant a 00:00:00.000Z pile : meme fenetre que dans la journee", () => {
    const { debut, fin } = fenetreRappel(d("2026-10-21T00:00:00.000Z"));
    expect(iso(debut)).toBe("2026-10-21T00:00:00.000Z");
    expect(iso(fin)).toBe("2026-10-23T00:00:00.000Z");
  });

  it("maintenant a 23:59:59.999Z : on reste sur le jour courant, pas le lendemain", () => {
    const { debut, fin } = fenetreRappel(d("2026-10-21T23:59:59.999Z"));
    expect(iso(debut)).toBe("2026-10-21T00:00:00.000Z");
    expect(iso(fin)).toBe("2026-10-23T00:00:00.000Z");
  });

  it("1 ms apres minuit : la fenetre avance d'un jour", () => {
    const { debut } = fenetreRappel(d("2026-10-22T00:00:00.001Z"));
    expect(iso(debut)).toBe("2026-10-22T00:00:00.000Z");
  });

  it("la fenetre dure toujours exactement 48 heures", () => {
    for (const jour of ["2026-10-21", "2026-12-31", "2027-02-28", "2028-02-29", "2026-10-25"]) {
      const { debut, fin } = fenetreRappel(d(`${jour}T10:00:00.000Z`));
      expect(fin.getTime() - debut.getTime()).toBe(48 * 3600 * 1000);
    }
  });

  describe("debordements de fin de mois et d'annee", () => {
    it("31 decembre : la fin passe au 2 janvier de l'annee suivante", () => {
      const { debut, fin } = fenetreRappel(d("2026-12-31T08:00:00.000Z"));
      expect(iso(debut)).toBe("2026-12-31T00:00:00.000Z");
      expect(iso(fin)).toBe("2027-01-02T00:00:00.000Z");
    });

    it("30 decembre : la fin tombe pile au 1er janvier", () => {
      expect(iso(fenetreRappel(d("2026-12-30T08:00:00.000Z")).fin)).toBe("2027-01-01T00:00:00.000Z");
    });

    it("28 fevrier d'une annee non bissextile (2027) : la fin est le 2 mars", () => {
      const { debut, fin } = fenetreRappel(d("2027-02-28T08:00:00.000Z"));
      expect(iso(debut)).toBe("2027-02-28T00:00:00.000Z");
      expect(iso(fin)).toBe("2027-03-02T00:00:00.000Z");
    });

    it("27 fevrier 2027 : la fin est le 1er mars (le 29 fevrier n'existe pas)", () => {
      expect(iso(fenetreRappel(d("2027-02-27T08:00:00.000Z")).fin)).toBe("2027-03-01T00:00:00.000Z");
    });

    it("28 fevrier d'une annee bissextile (2028) : la fin est le 1er mars", () => {
      const { debut, fin } = fenetreRappel(d("2028-02-28T08:00:00.000Z"));
      expect(iso(debut)).toBe("2028-02-28T00:00:00.000Z");
      expect(iso(fin)).toBe("2028-03-01T00:00:00.000Z");
    });

    it("29 fevrier 2028 : la fin est le 2 mars", () => {
      const { debut, fin } = fenetreRappel(d("2028-02-29T08:00:00.000Z"));
      expect(iso(debut)).toBe("2028-02-29T00:00:00.000Z");
      expect(iso(fin)).toBe("2028-03-02T00:00:00.000Z");
    });

    it("30 avril (mois de 30 jours) : la fin est le 2 mai", () => {
      expect(iso(fenetreRappel(d("2026-04-30T08:00:00.000Z")).fin)).toBe("2026-05-02T00:00:00.000Z");
    });
  });

  describe("changement d'heure europeen : jamais d'effet", () => {
    it("dimanche 25 octobre 2026 (passage a l'heure d'hiver) : 48 h UTC exactement", () => {
      const { debut, fin } = fenetreRappel(d("2026-10-25T00:30:00.000Z"));
      expect(iso(debut)).toBe("2026-10-25T00:00:00.000Z");
      expect(iso(fin)).toBe("2026-10-27T00:00:00.000Z");
    });

    it("samedi 24 octobre 2026 : la fin enjambe le changement d'heure sans decalage", () => {
      const { debut, fin } = fenetreRappel(d("2026-10-24T23:00:00.000Z"));
      expect(iso(debut)).toBe("2026-10-24T00:00:00.000Z");
      expect(iso(fin)).toBe("2026-10-26T00:00:00.000Z");
    });

    it("dimanche 29 mars 2026 (passage a l'heure d'ete) : meme chose", () => {
      const { debut, fin } = fenetreRappel(d("2026-03-29T01:30:00.000Z"));
      expect(iso(debut)).toBe("2026-03-29T00:00:00.000Z");
      expect(iso(fin)).toBe("2026-03-31T00:00:00.000Z");
    });
  });

  describe("erreurs et immutabilite", () => {
    it("date invalide : RangeError", () => {
      expect(() => fenetreRappel(new Date("pas une date"))).toThrow(RangeError);
      expect(() => fenetreRappel(new Date(NaN))).toThrow(/invalide/i);
    });

    it("l'entree n'est pas modifiee", () => {
      const entree = d("2026-10-21T12:34:56.789Z");
      const avant = entree.getTime();
      fenetreRappel(entree);
      expect(entree.getTime()).toBe(avant);
    });

    it("les dates rendues sont de nouveaux objets, pas l'entree", () => {
      const entree = d("2026-10-21T00:00:00.000Z");
      const { debut, fin } = fenetreRappel(entree);
      expect(debut).not.toBe(entree);
      expect(fin).not.toBe(entree);
    });

    it("deux appels avec la meme entree rendent la meme fenetre", () => {
      const entree = d("2026-10-21T12:00:00.000Z");
      expect(fenetreRappel(entree)).toEqual(fenetreRappel(entree));
    });
  });
});

// ---------------------------------------------------------------------------
// fenetreRappel : independance vis-a-vis du fuseau de la machine
// ---------------------------------------------------------------------------

describe("fenetreRappel : fuseau de la machine", () => {
  const TZ_ORIGINE = process.env.TZ;
  afterEach(() => {
    // Remet le fuseau d'origine pour ne pas contaminer les autres tests.
    if (TZ_ORIGINE === undefined) delete process.env.TZ;
    else process.env.TZ = TZ_ORIGINE;
  });

  // Auckland (UTC+13 en ete), Los Angeles (UTC-8), Kiritimati (UTC+14) et
  // Samoa/Pago Pago (UTC-11) : les extremes ou la date locale differe le plus
  // de la date UTC. Node relit TZ quand process.env.TZ change, donc on peut
  // changer de fuseau en cours de test sans relancer le processus.
  it.each([
    ["Pacific/Auckland", -13 * 60],
    ["America/Los_Angeles", 8 * 60],
    ["Pacific/Kiritimati", -14 * 60],
    ["Pacific/Pago_Pago", 11 * 60],
    ["UTC", 0],
  ])("fuseau %s : memes bornes UTC", (fuseau, decalageAttendu) => {
    process.env.TZ = fuseau;
    // Garde-fou : prouve que le changement de fuseau a bien eu lieu, sinon ce
    // test passerait pour de mauvaises raisons.
    expect(new Date("2026-01-15T12:00:00Z").getTimezoneOffset()).toBe(decalageAttendu);

    // 21 octobre 23:30 UTC = deja le 22 a Auckland, encore le 21 a Los Angeles.
    const tard = fenetreRappel(d("2026-10-21T23:30:00.000Z"));
    expect(iso(tard.debut)).toBe("2026-10-21T00:00:00.000Z");
    expect(iso(tard.fin)).toBe("2026-10-23T00:00:00.000Z");

    // 21 octobre 00:30 UTC = encore le 20 a Los Angeles.
    const tot = fenetreRappel(d("2026-10-21T00:30:00.000Z"));
    expect(iso(tot.debut)).toBe("2026-10-21T00:00:00.000Z");
    expect(iso(tot.fin)).toBe("2026-10-23T00:00:00.000Z");

    // Le jour du changement d'heure europeen, vu d'un fuseau qui change aussi.
    const dst = fenetreRappel(d("2026-10-25T00:30:00.000Z"));
    expect(iso(dst.debut)).toBe("2026-10-25T00:00:00.000Z");
    expect(iso(dst.fin)).toBe("2026-10-27T00:00:00.000Z");
  });

  it.each(["Pacific/Auckland", "America/Los_Angeles"])(
    "fuseau %s : tacheARappeler garde les memes bornes",
    (fuseau) => {
      process.env.TZ = fuseau;
      const maintenant = d("2026-10-21T23:30:00.000Z");
      const tache = (dueDate: string) => ({
        status: "todo",
        dueDate: d(dueDate),
        rappelEnvoye: false,
        assignedTo: ["U1"],
      });
      expect(tacheARappeler(tache("2026-10-21T00:00:00.000Z"), maintenant)).toBe(true);
      expect(tacheARappeler(tache("2026-10-22T00:00:00.000Z"), maintenant)).toBe(true);
      expect(tacheARappeler(tache("2026-10-23T00:00:00.000Z"), maintenant)).toBe(false);
      expect(tacheARappeler(tache("2026-10-20T23:59:59.999Z"), maintenant)).toBe(false);
    }
  );
});

// ---------------------------------------------------------------------------
// tacheARappeler
// ---------------------------------------------------------------------------

describe("tacheARappeler", () => {
  // Fenetre pour cette date : [2026-10-21T00:00Z, 2026-10-23T00:00Z).
  const MAINTENANT = d("2026-10-21T12:00:00.000Z");

  const base = {
    status: "todo",
    dueDate: d("2026-10-22T00:00:00.000Z") as Date | null | undefined,
    rappelEnvoye: false as boolean | null | undefined,
    assignedTo: ["U1"],
  };
  const avec = (changements: Partial<typeof base>) => ({ ...base, ...changements });

  it("cas nominal : tache a faire, demain, assignee, pas encore rappelee", () => {
    expect(tacheARappeler(base, MAINTENANT)).toBe(true);
  });

  describe("bornes de la fenetre", () => {
    it("echeance aujourd'hui a minuit UTC (borne debut incluse) : true", () => {
      expect(tacheARappeler(avec({ dueDate: d("2026-10-21T00:00:00.000Z") }), MAINTENANT)).toBe(true);
    });

    it("echeance aujourd'hui en milieu de journee : true", () => {
      expect(tacheARappeler(avec({ dueDate: d("2026-10-21T15:00:00.000Z") }), MAINTENANT)).toBe(true);
    });

    it("echeance demain minuit : true", () => {
      expect(tacheARappeler(avec({ dueDate: d("2026-10-22T00:00:00.000Z") }), MAINTENANT)).toBe(true);
    });

    it("echeance demain 23:59:59.999Z (dernier instant de la fenetre) : true", () => {
      expect(tacheARappeler(avec({ dueDate: d("2026-10-22T23:59:59.999Z") }), MAINTENANT)).toBe(true);
    });

    it("echeance exactement au surlendemain 00:00Z (borne fin exclue) : false", () => {
      expect(tacheARappeler(avec({ dueDate: d("2026-10-23T00:00:00.000Z") }), MAINTENANT)).toBe(false);
    });

    it("echeance dans 3 jours : false", () => {
      expect(tacheARappeler(avec({ dueDate: d("2026-10-24T00:00:00.000Z") }), MAINTENANT)).toBe(false);
    });

    it("la veille a 23:59:59.999Z : false (deja en retard, on ne rappelle pas un retard)", () => {
      expect(tacheARappeler(avec({ dueDate: d("2026-10-20T23:59:59.999Z") }), MAINTENANT)).toBe(false);
    });

    it("echeance tres ancienne : false", () => {
      expect(tacheARappeler(avec({ dueDate: d("2020-01-01T00:00:00.000Z") }), MAINTENANT)).toBe(false);
    });

    it("la fenetre suit `maintenant` : a 00:00:00.000Z la veille redevient hors fenetre", () => {
      const pile = d("2026-10-22T00:00:00.000Z");
      expect(tacheARappeler(avec({ dueDate: d("2026-10-21T12:00:00.000Z") }), pile)).toBe(false);
      expect(tacheARappeler(avec({ dueDate: d("2026-10-22T00:00:00.000Z") }), pile)).toBe(true);
    });
  });

  describe("statut", () => {
    it("done : false", () => {
      expect(tacheARappeler(avec({ status: "done" }), MAINTENANT)).toBe(false);
    });
    it("todo : true", () => {
      expect(tacheARappeler(avec({ status: "todo" }), MAINTENANT)).toBe(true);
    });
    it("in_progress : true", () => {
      expect(tacheARappeler(avec({ status: "in_progress" }), MAINTENANT)).toBe(true);
    });
    it("statut inconnu : true (seul done exclut, on fige ce comportement)", () => {
      expect(tacheARappeler(avec({ status: "autre" }), MAINTENANT)).toBe(true);
    });
  });

  describe("rappelEnvoye", () => {
    it("true : false (deja rappelee)", () => {
      expect(tacheARappeler(avec({ rappelEnvoye: true }), MAINTENANT)).toBe(false);
    });
    it.each([false, undefined, null])("%s : true (absent = pas encore rappelee)", (valeur) => {
      expect(tacheARappeler(avec({ rappelEnvoye: valeur }), MAINTENANT)).toBe(true);
    });
  });

  describe("assignes", () => {
    it("aucun assigne : false", () => {
      expect(tacheARappeler(avec({ assignedTo: [] }), MAINTENANT)).toBe(false);
    });
    it("plusieurs assignes : true", () => {
      expect(tacheARappeler(avec({ assignedTo: ["U1", "U2", "U3"] }), MAINTENANT)).toBe(true);
    });
  });

  describe("echeance absente ou invalide", () => {
    it.each([undefined, null])("dueDate %s : false", (valeur) => {
      expect(tacheARappeler(avec({ dueDate: valeur }), MAINTENANT)).toBe(false);
    });

    it("dueDate invalide (Invalid Date) : false", () => {
      expect(tacheARappeler(avec({ dueDate: new Date("nimporte quoi") }), MAINTENANT)).toBe(false);
    });

    it("maintenant invalide : false, sans exception (contrairement a fenetreRappel)", () => {
      expect(() => tacheARappeler(base, new Date(NaN))).not.toThrow();
      expect(tacheARappeler(base, new Date(NaN))).toBe(false);
    });
  });

  describe("combinaisons", () => {
    it("done + rappelEnvoye + sans assigne + sans echeance : false", () => {
      expect(
        tacheARappeler(
          { status: "done", dueDate: null, rappelEnvoye: true, assignedTo: [] },
          MAINTENANT
        )
      ).toBe(false);
    });

    it("chaque critere seul suffit a exclure une tache par ailleurs valide", () => {
      const exclusions = [
        avec({ status: "done" }),
        avec({ rappelEnvoye: true }),
        avec({ assignedTo: [] }),
        avec({ dueDate: null }),
        avec({ dueDate: d("2026-10-23T00:00:00.000Z") }),
        avec({ dueDate: d("2026-10-20T23:59:59.999Z") }),
      ];
      for (const t of exclusions) expect(tacheARappeler(t, MAINTENANT)).toBe(false);
    });

    it("in_progress + rappelEnvoye null + deux assignes + echeance aujourd'hui : true", () => {
      expect(
        tacheARappeler(
          {
            status: "in_progress",
            dueDate: d("2026-10-21T00:00:00.000Z"),
            rappelEnvoye: null,
            assignedTo: ["U1", "U2"],
          },
          MAINTENANT
        )
      ).toBe(true);
    });

    it("n'est pas modifiee par l'appel (tache et date)", () => {
      const t = avec({});
      const dueAvant = (t.dueDate as Date).getTime();
      const maintenantAvant = MAINTENANT.getTime();
      tacheARappeler(t, MAINTENANT);
      expect((t.dueDate as Date).getTime()).toBe(dueAvant);
      expect(MAINTENANT.getTime()).toBe(maintenantAvant);
      expect(t.assignedTo).toEqual(["U1"]);
    });
  });
});

// ---------------------------------------------------------------------------
// secretCronValide
// ---------------------------------------------------------------------------

describe("secretCronValide", () => {
  const SECRET = "s3cr3t-de-test-0123456789";

  describe("cas valide", () => {
    it("'Bearer <secret>' exact : true", () => {
      expect(secretCronValide(`Bearer ${SECRET}`, SECRET)).toBe(true);
    });

    it("secret d'un seul caractere : true", () => {
      expect(secretCronValide("Bearer x", "x")).toBe(true);
    });

    it("secret contenant des espaces internes : true si l'en-tete est identique", () => {
      expect(secretCronValide("Bearer un secret avec espaces", "un secret avec espaces")).toBe(true);
    });

    it("secret avec caracteres speciaux : true", () => {
      const secret = "a/b+c=d?e&f#g%h!@$^*()[]{}|\\<>\"'`~;:,.";
      expect(secretCronValide(`Bearer ${secret}`, secret)).toBe(true);
    });

    it("secret avec unicode (accents, CJK, emoji) : true", () => {
      const secret = "sécrét-€-日本語-😀";
      expect(secretCronValide(`Bearer ${secret}`, secret)).toBe(true);
    });

    it("secret tres long (100 000 caracteres) : true et sans exception", () => {
      const secret = "a".repeat(100_000);
      expect(secretCronValide(`Bearer ${secret}`, secret)).toBe(true);
    });
  });

  describe("fermee par defaut : secret non configure", () => {
    it("secret undefined, en-tete 'Bearer undefined' : false", () => {
      expect(secretCronValide("Bearer undefined", undefined)).toBe(false);
    });

    it("secret undefined, en-tete valide d'apparence : false", () => {
      expect(secretCronValide("Bearer ", undefined)).toBe(false);
    });

    it("secret vide, en-tete 'Bearer ' (qui correspond au vide) : false", () => {
      expect(secretCronValide("Bearer ", "")).toBe(false);
    });

    it("secret vide, en-tete 'Bearer' sans espace : false", () => {
      expect(secretCronValide("Bearer", "")).toBe(false);
    });

    it("secret fait d'espaces, en-tete qui correspond ('Bearer    ') : false", () => {
      expect(secretCronValide("Bearer    ", "   ")).toBe(false);
    });

    it.each(["\t", "\n", " \t\r\n ", " ", " "])(
      "secret blanc %j, en-tete qui correspond : false",
      (blanc) => {
        expect(secretCronValide(`Bearer ${blanc}`, blanc)).toBe(false);
      }
    );

    it("secret vide et en-tete absent : false", () => {
      expect(secretCronValide(undefined, "")).toBe(false);
      expect(secretCronValide(null, undefined)).toBe(false);
    });
  });

  describe("en-tete absent ou vide", () => {
    it.each([null, undefined, ""])("en-tete %j : false", (entete) => {
      expect(secretCronValide(entete, SECRET)).toBe(false);
    });

    it("en-tete 'Bearer' seul : false", () => {
      expect(secretCronValide("Bearer", SECRET)).toBe(false);
    });

    it("en-tete 'Bearer ' sans secret : false", () => {
      expect(secretCronValide("Bearer ", SECRET)).toBe(false);
    });

    it("en-tete qui est juste le secret, sans 'Bearer ' : false", () => {
      expect(secretCronValide(SECRET, SECRET)).toBe(false);
    });
  });

  describe("mauvais secret", () => {
    it("meme longueur, un seul caractere different : false", () => {
      const faux = SECRET.slice(0, -1) + "X";
      expect(faux.length).toBe(SECRET.length);
      expect(secretCronValide(`Bearer ${faux}`, SECRET)).toBe(false);
    });

    it("meme longueur, premier caractere different : false", () => {
      const faux = "X" + SECRET.slice(1);
      expect(secretCronValide(`Bearer ${faux}`, SECRET)).toBe(false);
    });

    it("secret recu plus court (prefixe du bon) : false, sans exception", () => {
      expect(() => secretCronValide(`Bearer ${SECRET.slice(0, 5)}`, SECRET)).not.toThrow();
      expect(secretCronValide(`Bearer ${SECRET.slice(0, 5)}`, SECRET)).toBe(false);
    });

    it("secret recu plus long (le bon suivi d'autre chose) : false, sans exception", () => {
      expect(() => secretCronValide(`Bearer ${SECRET}x`, SECRET)).not.toThrow();
      expect(secretCronValide(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    });

    it("casse differente du secret : false", () => {
      expect(secretCronValide(`Bearer ${SECRET.toUpperCase()}`, SECRET)).toBe(false);
    });

    it("meme longueur en caracteres mais pas en octets (unicode) : false, sans exception", () => {
      // "é" fait 2 octets, "e" en fait 1 : meme nombre de caracteres, longueurs
      // d'octets differentes. timingSafeEqual leverait une erreur si le test des
      // longueurs se faisait en caracteres au lieu d'octets.
      expect(() => secretCronValide("Bearer e", "é")).not.toThrow();
      expect(secretCronValide("Bearer e", "é")).toBe(false);
      expect(secretCronValide("Bearer é", "e")).toBe(false);
    });

    it("meme longueur en octets, contenu different (unicode) : false", () => {
      expect(secretCronValide("Bearer ab", "é")).toBe(false);
    });
  });

  describe("forme de l'en-tete", () => {
    it("'bearer <secret>' en minuscules : false (le mot Bearer est compare octet par octet)", () => {
      // Comportement fige : le code ne normalise pas la casse du schema, alors
      // que la RFC 7235 dit que le nom du schema est insensible a la casse.
      // Vercel Cron envoie bien 'Bearer' avec la majuscule, donc sans impact
      // en pratique, mais ce n'est pas la lecture stricte de la RFC.
      expect(secretCronValide(`bearer ${SECRET}`, SECRET)).toBe(false);
      expect(secretCronValide(`BEARER ${SECRET}`, SECRET)).toBe(false);
    });

    it("deux espaces apres Bearer : false", () => {
      expect(secretCronValide(`Bearer  ${SECRET}`, SECRET)).toBe(false);
    });

    it("espace en trop a la fin : false", () => {
      expect(secretCronValide(`Bearer ${SECRET} `, SECRET)).toBe(false);
    });

    it("espace en trop au debut : false", () => {
      expect(secretCronValide(` Bearer ${SECRET}`, SECRET)).toBe(false);
    });

    it("tabulation a la place de l'espace : false", () => {
      expect(secretCronValide(`Bearer\t${SECRET}`, SECRET)).toBe(false);
    });

    it("retour a la ligne a la fin : false", () => {
      expect(secretCronValide(`Bearer ${SECRET}\n`, SECRET)).toBe(false);
    });

    it("schema 'Basic <secret>' : false", () => {
      expect(secretCronValide(`Basic ${SECRET}`, SECRET)).toBe(false);
    });

    it("schema 'Token <secret>' de meme longueur que 'Bearer' : false", () => {
      expect(secretCronValide(`Bearee ${SECRET}`, SECRET)).toBe(false);
    });

    it("'Bearer Bearer <secret>' : false", () => {
      expect(secretCronValide(`Bearer Bearer ${SECRET}`, SECRET)).toBe(false);
    });

    it("secret qui commence lui-meme par 'Bearer ' : l'en-tete doit le contenir en entier", () => {
      expect(secretCronValide("Bearer Bearer abc", "Bearer abc")).toBe(true);
      expect(secretCronValide("Bearer abc", "Bearer abc")).toBe(false);
    });
  });

  describe("entrees bizarres : jamais d'exception", () => {
    const bizarres = [
      "\0",
      "\0\0\0\0\0\0\0",
      `Bearer \0${SECRET}`,
      "\r\n",
      "Bearer \r\nX-Injection: 1",
      "\u0001\u0002\u001f\u007f",
      "\ud800", // moitie de paire de substitution (chaine UTF-16 invalide)
      "😀".repeat(1000),
      "a".repeat(1_000_000),
      "Bearer " + "a".repeat(1_000_000),
      " ".repeat(10_000),
    ];

    it.each(bizarres.map((v) => [v.length > 40 ? `${v.slice(0, 12)}... (${v.length} car.)` : JSON.stringify(v), v]))(
      "en-tete %s : false et pas d'exception",
      (_nom, entete) => {
        expect(() => secretCronValide(entete, SECRET)).not.toThrow();
        expect(secretCronValide(entete, SECRET)).toBe(false);
      }
    );

    it.each(bizarres.map((v) => [v.length > 40 ? `${v.slice(0, 12)}... (${v.length} car.)` : JSON.stringify(v), v]))(
      "secret attendu %s : pas d'exception, et false avec un en-tete different",
      (_nom, secret) => {
        expect(() => secretCronValide(`Bearer ${SECRET}`, secret)).not.toThrow();
        expect(secretCronValide(`Bearer ${SECRET}`, secret)).toBe(false);
      }
    );

    it("secret de caracteres de controle non blancs : accepte si l'en-tete est identique", () => {
      const secret = "\u0001\u0002\u001f\u007f";
      expect(secretCronValide(`Bearer ${secret}`, secret)).toBe(true);
    });

    it("secret fait d'un caractere nul : accepte si identique (trim() ne retire pas \\0)", () => {
      // Comportement fige : \0 n'est pas un blanc pour trim(), donc ce n'est
      // pas traite comme un secret vide. Cas irrealiste (une variable
      // d'environnement ne peut pas contenir \0), note pour memoire.
      expect(secretCronValide("Bearer \0", "\0")).toBe(true);
    });

    it("secret avec espaces autour mais non vide : l'en-tete doit les contenir tels quels", () => {
      // Comportement fige : seul un secret ENTIEREMENT blanc est refuse. Un
      // secret ' abc ' est accepte avec 'Bearer  abc ', mais un serveur HTTP
      // rogne en general les espaces d'un en-tete, donc ce secret ne
      // passerait jamais en pratique (voir le rapport).
      expect(secretCronValide("Bearer  abc ", " abc ")).toBe(true);
      expect(secretCronValide("Bearer abc", " abc ")).toBe(false);
    });
  });

  describe("comparaison a temps constant", () => {
    // Test de coherence simple, pas une preuve de securite : un test de
    // chronometrage serait instable. Il lit le code source, donc il est FRAGILE
    // si la fonction est reecrite autrement (par exemple avec une librairie) :
    // dans ce cas, mettre ce test a jour, ne pas le supprimer.
    const source = readFileSync(fileURLToPath(new URL("./rappels.ts", import.meta.url)), "utf8");
    const debut = source.indexOf("export function secretCronValide");
    const corps = source.slice(debut, source.indexOf("\n}\n", debut));

    it("rappels.ts importe timingSafeEqual depuis node:crypto", () => {
      expect(source).toMatch(/import\s*\{[^}]*\btimingSafeEqual\b[^}]*\}\s*from\s*"node:crypto"/);
    });

    it("secretCronValide compare les deux valeurs avec timingSafeEqual", () => {
      expect(debut).toBeGreaterThan(-1);
      expect(corps).toMatch(/timingSafeEqual\(\s*recu\s*,\s*attendu\s*\)/);
    });

    it("secretCronValide ne compare jamais le secret avec === ou !== (comparaison qui s'arrete au premier octet different)", () => {
      // On retire les comparaisons de longueur et de vide, legitimes, puis on
      // verifie qu'aucune ne porte sur le contenu.
      const sansLongueurs = corps
        .replace(/recu\.length\s*!==\s*attendu\.length/g, "")
        .replace(/secretAttendu\.trim\(\)\s*===\s*""/g, "");
      expect(sansLongueurs).not.toMatch(/enteteAuthorization\s*[!=]==?/);
      expect(sansLongueurs).not.toMatch(/\brecu\s*[!=]==?\s*attendu/);
      expect(sansLongueurs).not.toMatch(/secretAttendu\s*[!=]==?/);
    });
  });
});
