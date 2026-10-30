# RoomFlow — Cahier des charges

> Reçu de Tanguy le 06/09/2026, sous forme de document destiné à être transmis tel quel à Claude Code pour démarrer le développement. Conservé ici sans modification : c'est la source de vérité du projet, à lire en entier avant de commencer.
>
> ⚠ `AGENTS.md` à la racine est auto-généré par `next dev` (rappel des spécificités de cette version de Next.js) — ne pas le modifier à la main, il se régénère tout seul.

Gestionnaire de colocation intelligent : dépenses partagées, remboursements simplifiés, tâches communes.

---

## 1. Contexte et objectif

Projet personnel de portfolio, développé par un étudiant en alternance (profil développeur full-stack), destiné à :
- Monter en compétence sur Next.js (App Router), TypeScript, Tailwind CSS, MongoDB, NextAuth.js
- Être ajouté au portfolio en ligne (https://portfolio-tanguy-theta.vercel.app)
- Être hébergé sur Vercel, code sur un dépôt GitHub public
- Servir d'appui concret dans des candidatures en alternance (développeur full-stack)

Contraintes : réalisable seul, budget nul (free tiers uniquement), durée cible 2 à 3 semaines.

---

## 2. Problème et proposition de valeur

Dans une colocation, les dépenses communes (courses, factures, loyer partagé, sorties) sont difficiles à suivre équitablement. Les gens paient à des moments différents, pour des montants différents, avec une répartition parfois inégale (tout le monde ne consomme pas pareil). Résultat : personne ne sait vraiment qui doit combien à qui, et les comptes ne sont jamais soldés proprement.

RoomFlow centralise les dépenses, calcule automatiquement qui doit combien à qui, et **simplifie les remboursements** pour qu'il y ait le moins de transactions possible entre colocataires (au lieu que chacun rembourse chacun, l'algorithme trouve le minimum de virements nécessaires pour que tout le monde soit à zéro).

En bonus, l'application gère aussi les tâches communes du quotidien (ménage, courses, poubelles).

---

## 3. Utilisateurs et rôles

Un seul type d'utilisateur fonctionnellement, mais deux niveaux de permission au sein d'une colocation :

- **Admin de la colocation** : celui qui a créé la colocation. Peut inviter/retirer des membres, modifier les paramètres de la colocation, supprimer des dépenses de n'importe qui.
- **Membre** : peut ajouter des dépenses, voir tous les comptes, gérer ses propres tâches, modifier/supprimer uniquement ses propres dépenses.

Un même utilisateur peut appartenir à plusieurs colocations (ex : ancien coloc qui garde un historique, ou quelqu'un qui teste avec deux groupes différents).

---

## 4. Fonctionnalités (MVP obligatoire)

### 4.1 Authentification
- Inscription / connexion par email + mot de passe (NextAuth Credentials Provider)
- Connexion via Google OAuth
- Connexion via GitHub OAuth
- Session persistante, déconnexion

### 4.2 Colocations
- Créer une colocation (nom, description optionnelle)
- Inviter des membres par email (génération d'un lien d'invitation à usage unique ou code à partager)
- Rejoindre une colocation via lien/code d'invitation
- Voir la liste des membres
- Quitter une colocation (avec vérification qu'il n'y a pas de dette en cours, sinon avertissement)
- L'admin peut retirer un membre

### 4.3 Dépenses
- Ajouter une dépense : montant, description, payeur (par défaut soi-même), date, catégorie (courses, factures, loyer, sorties, autre)
- Choisir la répartition :
  - Répartition égale entre tous les membres sélectionnés
  - Répartition personnalisée (montants ou pourcentages différents par personne)
- Modifier / supprimer une dépense (auteur ou admin uniquement)
- Liste des dépenses avec filtres (par catégorie, par période, par membre)
- Détail d'une dépense (qui doit quoi précisément dessus)

### 4.4 Calcul des dettes et simplification
- Calcul automatique du solde de chaque membre (combien il a payé vs combien il doit réellement)
- **Algorithme de simplification des dettes** : à partir de la matrice des soldes de chacun, calculer le nombre minimum de transactions nécessaires pour que tout le monde soit à zéro (algorithme de type "minimum cash flow" : trier les créditeurs/débiteurs, apparier le plus gros débiteur avec le plus gros créditeur itérativement)
- Affichage clair : "Tu dois 23,50 € à Marie" plutôt qu'une liste confuse de toutes les dépenses
- Marquer une dette comme remboursée manuellement (pas de vrai paiement en ligne, juste un pointage "c'est fait")

### 4.5 Tâches communes
- Créer une tâche (titre, description, récurrence optionnelle : une fois / hebdomadaire / mensuelle)
- Assigner une tâche à un ou plusieurs membres (rotation automatique optionnelle pour les tâches récurrentes)
- Marquer une tâche comme faite
- Vue Kanban simple (À faire / En cours / Fait) avec drag & drop (librairie `dnd-kit`)
- Historique des tâches complétées

### 4.6 Liste de courses
- Liste de courses partagée par colocation (nom de l'article, quantité optionnelle, catégorie optionnelle)
- Ajouter / cocher / supprimer un article
- Voir qui a ajouté quel article
- Historique simple des articles cochés (optionnel, non bloquant si trop juste en temps)

### 4.7 Dashboard
- Vue d'ensemble de la colocation : solde de chacun, dernières dépenses, tâches en cours
- Graphique simple des dépenses par catégorie sur le mois (Recharts ou Chart.js)

### 4.8 Notifications par email (Resend)
- Email quand on est ajouté à une colocation
- Email quand une dépense te concerne (tu dois de l'argent)
- Email de rappel optionnel pour une tâche assignée

### 4.9 Export
- Export PDF du récapitulatif mensuel des comptes de la colocation (liste des dépenses + soldes finaux)

---

## 5. Hors scope (explicitement non traité dans le MVP)

- Paiement réel en ligne (Stripe, virement automatique) — on reste sur du pointage manuel "remboursé / pas remboursé"
- Application mobile native
- Chat / messagerie intégrée
- Gestion de plusieurs devises
- Notifications push (uniquement email)

---

## 6. Stack technique

| Techno | Usage |
|---|---|
| Next.js (App Router) | Framework fullstack |
| TypeScript | Typage |
| Tailwind CSS | Styling |
| MongoDB (Atlas free tier) + Mongoose | Base de données |
| NextAuth.js (Auth.js) | Authentification (Credentials + Google + GitHub OAuth) |
| dnd-kit | Drag & drop pour les tâches |
| Resend (free tier) | Emails transactionnels |
| Recharts | Graphiques dashboard |
| React-PDF ou équivalent | Génération du PDF d'export |
| Vercel | Hébergement / déploiement |
| GitHub | Versioning, dépôt public |

---

## 7. Modèle de données (collections MongoDB)

**User**
- `_id`, `name`, `email`, `passwordHash` (si credentials), `image`, `provider`, `createdAt`

**Household** (colocation)
- `_id`, `name`, `description`, `createdBy` (ref User), `members` [{ `userId`, `role`: "admin" | "member", `joinedAt` }], `inviteCode`, `createdAt`

**Expense**
- `_id`, `householdId`, `payerId` (ref User), `amount`, `description`, `category`, `date`, `splitType`: "equal" | "custom", `splits`: [{ `userId`, `amount` }], `createdAt`

**Settlement** (remboursement pointé comme fait)
- `_id`, `householdId`, `fromUserId`, `toUserId`, `amount`, `settledAt`

**Task**
- `_id`, `householdId`, `title`, `description`, `assignedTo`: [userId], `status`: "todo" | "in_progress" | "done", `recurrence`: "none" | "weekly" | "monthly", `dueDate`, `completedAt`, `createdAt`

**ShoppingItem**
- `_id`, `householdId`, `name`, `quantity`, `category`, `addedBy` (ref User), `checked`: boolean, `checkedBy` (ref User), `createdAt`

---

## 8. Parcours utilisateurs principaux

1. **Inscription → création de colocation** : inscription → création d'une colocation → génération du code d'invitation → partage du code aux colocataires
2. **Rejoindre une colocation** : inscription/connexion → saisie du code d'invitation → ajout automatique comme membre
3. **Ajout d'une dépense** : sélection colocation → "Ajouter une dépense" → montant/description/catégorie → choix de la répartition → validation → recalcul automatique des soldes → email aux personnes concernées
4. **Consultation des dettes** : dashboard → vue "Qui doit quoi" (déjà simplifiée) → possibilité de marquer un remboursement comme fait
5. **Gestion des tâches** : vue Kanban → créer une tâche → assigner → drag & drop entre colonnes → marquer comme fait
6. **Liste de courses** : accès à la liste partagée → ajout d'un article → les autres membres voient l'ajout en temps réel (ou au rechargement) → coche à l'achat
7. **Export mensuel** : dashboard → bouton "Exporter le mois" → génération et téléchargement du PDF

---

## 9. Découpage en semaines (planning indicatif)

### Semaine 1 — Fondations
- Setup Next.js + TypeScript + Tailwind
- Connexion MongoDB + modèles Mongoose
- NextAuth (Credentials + Google + GitHub)
- Création / rejoindre une colocation (avec code d'invitation)
- Layout général + navigation

### Semaine 2 — Cœur métier
- CRUD dépenses (répartition égale + personnalisée)
- Calcul des soldes
- Algorithme de simplification des dettes
- Vue "Qui doit quoi"
- Marquer un remboursement comme fait

### Semaine 3 — Finitions et portfolio
- Tâches + Kanban + drag & drop
- Liste de courses partagée
- Dashboard avec graphique
- Notifications email (Resend)
- Export PDF
- Gestion des erreurs, états de chargement, responsive
- README professionnel (stack, captures d'écran, choix techniques, limites connues)
- Déploiement Vercel + repo GitHub public

---

## 10. Objectif final

Un dépôt GitHub public + une démo Vercel fonctionnelle, avec un README clair présentant : la stack, l'architecture, les fonctionnalités, quelques captures d'écran, les choix techniques (notamment l'algorithme de simplification des dettes), les difficultés rencontrées et les limites connues.

Le projet doit donner l'impression d'un vrai petit produit terminé et soigné, pas d'un tutoriel recopié.

---

## 11. Journal d'avancement

- **06/09/2026** — Scaffolding Next.js 16.3.4 (App Router) + TypeScript + Tailwind + ESLint. Dépendances installées : mongoose, next-auth@beta (Auth.js v5.0.0-beta.32), bcryptjs, zod. Connexion MongoDB (`src/lib/mongodb.ts`, cache anti-reconnexion en hot-reload) et les 6 modèles Mongoose de la section 7 (`src/models/`). `.env.example` documente les 4 comptes externes à créer : MongoDB Atlas, Google OAuth, GitHub OAuth, Resend. Premier commit `30a895f`, dépôt local uniquement (pas encore sur GitHub).
  - ⚠ Next.js 16 introduit `LayoutProps<'/route'>` et `PageProps<'/route'>`, des helpers de types globaux générés à partir de l'arborescence — à utiliser au lieu de typer `params: Promise<{...}>` à la main. Voir `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/{layout,page}.md`.
- **08/09/2026** — MongoDB Atlas créé (cluster gratuit M0), `.env.local` rempli avec la vraie chaîne de connexion et un `AUTH_SECRET` généré. Connexion vérifiée en conditions réelles via `/api/health` (nouvelle route, `src/app/api/health/route.ts`) : `{"ok":true,"database":"roomflow",...}`. Cache de connexion confirmé efficace (8,1s à froid, 77ms ensuite).
- **08/09/2026 (suite)** — Google OAuth et GitHub OAuth créés et vérifiés (Client ID confirmé légitime en visitant l'URL d'autorisation réelle : GitHub et Google affichent tous deux "RoomFlow", pas d'erreur `redirect_uri_mismatch`). NextAuth v5 câblé dans `src/auth.ts` : Credentials + Google + GitHub, session JWT (imposé par Credentials), `_id` Mongo propagé dans le token via les callbacks `signIn`/`jwt`/`session`. Route `/api/auth/[...nextauth]`, route d'inscription `/api/register` (validation Zod, hash bcrypt, provider "credentials"). Décision de sécurité : un email déjà utilisé avec un autre provider ne peut pas se connecter en OAuth (`signIn` callback refuse plutôt que de lier silencieusement les comptes).
  - Testé en conditions réelles, pas simulé : inscription → connexion refusée avec mauvais mot de passe (session `null`) → connexion acceptée avec le bon (session avec le bon `_id` Mongo) → clic réel sur "Sign in with Google"/GitHub jusqu'à leurs pages de consentement respectives, qui affichent "RoomFlow". Compte de test nettoyé après vérification.
  - **Prochaine étape** : page de connexion/inscription "à la main" (l'UI par défaut de NextAuth testée ci-dessus n'est qu'un gabarit de secours, pas destinée à rester) + création/rejoint d'une colocation avec code d'invitation (fin de la Semaine 1, section 9).
- **08/09/2026 (suite)** — Dépôt GitHub public créé et poussé : github.com/Takanaguy/roomflow. Tanguy a testé "Se connecter avec Google" avec son vrai compte, vérifié en base : utilisateur créé correctement (`provider: "google"`). Décisions actées : design minimal/fonctionnel (pas de pass design dédié, Tanguy s'en désintéresse), tests **par lots** plutôt qu'à chaque fichier, blocage de la fusion silencieuse de comptes confirmé (aucun changement de code, déjà en place).

## 12. Feuille de route (source de vérité pour "où on en est")

Cocher au fur et à mesure. Découpée en lots testables d'un coup, pas fichier par fichier (décision du 08/09/2026).

- [x] **Lot 1 — Fondations** : Next.js/TS/Tailwind, MongoDB + modèles, NextAuth (Credentials + Google + GitHub), inscription
- [x] **Lot 2 — UI auth + layout** : vraie page de connexion/inscription (remplace le gabarit NextAuth), navigation générale, structure des pages protégées (redirection si pas connecté)
- [x] **Lot 3 — Colocations** : créer, code d'invitation, rejoindre, liste des membres, quitter (avec vérif dette en cours), retrait d'un membre par l'admin
- [x] **Lot 4 — Dépenses** : ajout (répartition égale/personnalisée), modification/suppression, liste avec filtres (catégorie/période/membre), détail d'une dépense
- [x] **Lot 5 — Dettes** : calcul des soldes, algorithme de simplification (minimum cash flow), vue "qui doit quoi", marquer un remboursement comme fait
- [x] **Lot 6 — Tâches** : CRUD, récurrence, vue Kanban avec drag & drop (dnd-kit), historique
- [x] **Lot 7 — Liste de courses** : ajout/coche/suppression partagés, historique
- [x] **Lot 8 — Dashboard** : vue d'ensemble + graphique des dépenses par catégorie (Recharts)
- [x] **Lot 9 — Emails** (Resend, compte à créer à ce moment-là) : ajout à une colocation, dépense qui concerne, rappel de tâche, **mot de passe oublié** (demandé par Tanguy le 08/09/2026 — regroupé ici plutôt que fait à part, car ça dépend de Resend pour l'envoi du lien de réinitialisation ; le faire avant aurait voulu dire soit attendre, soit bricoler un envoi factice puis tout refaire)
- [x] **Lot 9 bis — Sécurité des comptes** (proposé puis validé par Tanguy le 22/10/2026, après le lot 9) : sessions révocables, limite d'essais de connexion, suppression de compte, en-têtes de sécurité, mise à jour de `next`
- [x] **Lot 10 — Export PDF** : récapitulatif mensuel
- [ ] **Lot 11 — Finitions** (EN COURS : bloc A panneau admin + nettoyage FAIT le 30/10/2026, voir son journal ; reste : B pages d'erreur, responsive et /api/health, C compte démo, D déploiement Vercel, E README et captures) : responsive, erreurs/chargements, README pro (stack, captures, choix techniques, limites), déploiement Vercel + lien ajouté au portfolio, Swagger/OpenAPI en option si le temps le permet, **panneau admin** (décidé le 23/09/2026 — voir section 15)

Chaque lot = plusieurs fichiers construits d'un coup, puis une passe de test groupée (build, lint, et vérification fonctionnelle réelle) avant de committer et passer au suivant.

### Journal du lot 2 (08/09/2026)

- **Découverte importante** : `middleware.js` est **déprécié en Next.js 16**, renommé `proxy.js` (fichier `src/proxy.ts`, export par défaut nommé `proxy` par convention, ici juste `export default auth`). Un `middleware.ts` classique n'aurait pas été détecté. Voir `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`.
- Protection des pages : `callbacks.authorized` dans `src/auth.ts` (retourne `!!session?.user`) + `matcher` dans `src/proxy.ts`. **Toute nouvelle zone réservée aux connectés doit être ajoutée au matcher**, sinon elle reste publique.
- `pages.signIn: "/connexion"` dans `auth.ts` : sans ça, la redirection tombe sur le gabarit générique NextAuth (`/api/auth/signin`), pas notre page.
- Après `signIn()`/`fetch("/api/register")`, utiliser `router.push() + router.refresh()`, jamais `window.location.href` (repéré par le lint) : `refresh()` est nécessaire pour que `useSession()` et les Server Components voient la session fraîchement posée sans recharger toute la page.
- Design volontairement minimal (Tailwind par défaut, zinc/gris) — décision de Tanguy du 08/09/2026, pas de pass design dédié pour RoomFlow.
- Testé en conditions réelles : accès direct à `/tableau-de-bord` sans session → redirigé vers `/connexion?callbackUrl=...` (pas le gabarit générique) ; inscription complète par formulaire → connexion auto → atterrissage sur la page protégée avec le bon nom ; en-tête reflète l'état connecté sans rechargement de page. Compte de test nettoyé après coup.

### Corrections du 08/09/2026 (retours de Tanguy après test)

- **Sélecteur de compte Google** : sans `authorization.params.prompt: "select_account"`, Google reconnecte automatiquement sur le dernier compte ayant autorisé l'app, sans jamais proposer d'en choisir un autre. Corrigé dans `src/auth.ts`. Vérifié en conditions réelles : Google affiche désormais "Sélectionnez un compte" avec "Utiliser un autre compte" (avant : redirection directe, aucun choix).
- **Nom affiché modifiable** : `/profil` (protégée, ajoutée au matcher de `proxy.ts`) + `PATCH /api/profil`. Le nom Google d'origine ("L&T gaming") n'était déjà écrasé qu'à la création du compte, jamais aux connexions suivantes — il manquait juste un endroit pour le changer soi-même.
  - Piège rencontré : `useSession().update({ name })` ne suffit pas seul. Il faut aussi gérer `trigger === "update"` dans le callback `jwt` (`auth.ts`) pour que la nouvelle valeur soit réellement écrite dans le jeton signé, sinon le nouveau nom ne persiste que le temps de la page en cours et redisparaît au rechargement suivant. La doc Auth.js prévient explicitement que `session` (la donnée passée par le client à `update()`) doit être revalidée avant d'être utilisée : c'est fait (non vide, trim).
  - Vérifié en conditions réelles, deux niveaux : la base Mongo reflète le nouveau nom juste après le PATCH, ET une navigation fraîche vers une autre page (pas juste un changement d'état React) affiche toujours le nouveau nom, preuve que le cookie de session a bien été réémis.

### Journal du lot 3 (08/09/2026) — Colocations

- `src/lib/households.ts` centralise l'accès + permissions : `getHouseholdForMember` (charge une colocation ET vérifie l'appartenance en un appel — sinon un membre d'une AUTRE colocation pourrait lire/agir dessus juste en devinant son id dans l'URL), `isAdminMember`, `serializeHousehold` (mise en forme partagée par la route API et la page detail, pour ne pas dupliquer la logique deux fois).
- `hasOutstandingDebt` est un **stub qui renvoie toujours `false`** (documenté en commentaire) : sans dépenses (lot 4), aucune dette n'est possible, donc c'est correct pour l'instant, pas une simplification hasardeuse. Le lot 5 le remplacera par le vrai calcul.
- `/colocations/[id]` est un **Server Component** qui charge les données côté serveur, avec un petit Client Component (`ColocationClient.tsx`) uniquement pour l'interactivité (copier le code, quitter, retirer un membre) — pas de fetch au montage. Choix motivé par une vraie règle de lint (`react-hooks/set-state-in-effect`, nouvelle règle stricte de ce ESLint) plutôt que contournée : le refactor colle aussi mieux à l'architecture documentée en section 13 (Server Components lisent directement).
- ~~Limite connue : si l'unique admin quitte, la colocation reste sans administrateur~~ — **résolue le 09/09/2026**, voir journal de gouvernance ci-dessous.
- **Testé en conditions réelles**, deux comptes distincts (script curl avec sessions séparées, plus une vérification visuelle dans le navigateur) : création → code généré → un 2ᵉ compte rejoint avec le code → rejoindre deux fois échoue (409) → un non-admin ne peut pas retirer quelqu'un (403) → l'admin retire bien un membre → quitter sans dette réussit directement (pas d'avertissement, cohérent avec le stub) → après avoir quitté, la colocation redevient inaccessible (404), pas de fuite d'information sur son existence. Toutes les données de test nettoyées après coup.

### Journal — gouvernance des colocations (09/09/2026, demande de Tanguy)

Tanguy a proposé deux approches pour la succession d'admin : promotion automatique du membre le plus ancien, OU obliger l'admin à désigner un successeur avant de pouvoir partir. **Décision : les deux, mais pas comme un choix exclusif.** La promotion automatique règle le cas normal sans aucune friction (un admin qui part sans y penser ne laisse jamais le groupe orphelin) ; un bouton « Nommer admin », disponible à tout moment (pas seulement au moment de partir), permet en plus une désignation délibérée. Confirmé avec Tanguy.

- `promouvoirDoyen(members)` (`src/lib/households.ts`) : promeut le membre au `joinedAt` le plus ancien. Appelée dans `/leave` uniquement quand la personne qui part était admin.
- `/api/colocations/join` : si la colocation est vidée (0 membre, cas où l'admin était seul et vient de partir), le prochain arrivant devient admin automatiquement plutôt que membre — referme la boucle sans qu'une colocation reste bloquée durablement sans admin.
- `PATCH /api/colocations/[id]/members/[userId]` (`{ role: "admin" }`) : transfert volontaire. Modèle à **un seul admin à la fois** — transférer, c'est promouvoir la cible ET se rétrograder soi-même, pas ajouter un deuxième admin.
- `PATCH /api/colocations/[id]` : modifier nom/description, admin uniquement.
- `DELETE /api/colocations/[id]` : destruction définitive, admin uniquement, confirmée en deux clics côté UI (zone de danger). C'est désormais la **seule** façon de vraiment supprimer une colocation — quitter ne fait que la vider.
  - ~~TODO lots 4-7 : cascade de suppression~~ — **Expense fait, lot 4** (voir journal ci-dessous). Task et Settlement faits au lot 6 (Settlement était un oubli du lot 5). ShoppingItem fait au lot 7 : plus aucune cascade en attente.
- **Testé en conditions réelles avec trois comptes** (script curl, ordre d'ancienneté A → B → C) : A (admin) part → B (plus ancien restant) promu automatiquement → B transfère volontairement à C → B redevient un simple membre → B ne peut plus modifier le nom (403) → C modifie bien nom/description → B ne peut pas détruire (403) → C (admin, seul admin) part → B (dernier restant) promu automatiquement → B (admin, dernier membre) part → colocation vidée → A la rejoint via le code toujours valide → A devient admin automatiquement → A détruit la colocation → accès impossible ensuite (404). Les 10 scénarios passent. Données de test nettoyées.

### Journal du lot 4 (23/09/2026) — Dépenses

- **`createdBy` ajouté au modèle Expense**, distinct de `payerId`. Le cahier des charges (4.3) permet de saisir une dépense payée par quelqu'un d'autre ("payeur par défaut soi-même") : "auteur" (droit de modifier/supprimer) et "payeur" (qui a sorti l'argent) ne sont donc pas forcément la même personne. Modèle initial du lot 1 ne portait que `payerId` — corrigé avant de construire les routes plutôt qu'après.
- **`src/lib/expenses.ts`** porte le calcul le plus délicat du lot : répartir un montant sans perdre un centime dans l'arrondi flottant JS (`10.01 / 2` ou un pourcentage ne tombent presque jamais juste en flottant natif). `repartirEgalement` et `repartirParPourcentages` travaillent en **centimes entiers** en interne et distribuent le reste de la division aux premiers de la liste (égale) ou au dernier (pourcentages), pour que la somme colle **toujours** exactement au montant — sinon le calcul de solde du lot 5 accumulerait des écarts au fil des dépenses.
- Répartition personnalisée : **montants exacts OU pourcentages** (4.3), les deux passent par le même mécanisme anti-arrondi. Les montants exacts saisis à la main sont vérifiés (somme = montant, tolérance 0,005 €) plutôt que recalculés.
- Permissions : modifier/supprimer réservé à `createdBy` (l'auteur) ou l'admin — **pas** le payeur, qui peut être un tiers. Vérifié explicitement en testant : le payeur seul, qui n'est pas l'auteur, est bien refusé (403).
- Cross-tenant : `getExpenseInHousehold(householdId, expenseId)` vérifie que la dépense appartient bien à la colocation de l'URL, même logique que `getHouseholdForMember` pour les colocations elles-mêmes.
- **Cascade de suppression corrigée en le testant** : détruire une colocation ne supprimait pas ses dépenses (le TODO laissé au lot 3). Constaté concrètement (dépense orpheline en base après destruction), corrigé immédiatement dans `DELETE /api/colocations/[id]` plutôt que reporté.
- **Testé en conditions réelles**, deux comptes : répartition égale 10,01 €/2 personnes → 5,01 + 5,00 (exact) ; répartition 70/30 sur 33,33 € avec payeur ≠ auteur → 23,33 + 10,00 (exact) ; montants personnalisés qui ne tombent pas juste → refusés (400) ; payeur hors colocation → refusé (400) ; liste + filtre par catégorie corrects ; non-auteur/non-admin refusé en modification et suppression (403) ; auteur (même non-payeur) autorisé ; dépense d'une colocation inaccessible via l'id d'une autre (404) ; cascade de suppression vérifiée par un deuxième test ciblé (dépense bien absente de la base après destruction de sa colocation). Données de test nettoyées.

### Journal — payeurs multiples (23/09/2026, demande de Tanguy)

Tanguy a fait remarquer, en testant lui-même, qu'une dépense peut être avancée par **plusieurs personnes à la fois** (ex. un repas où un membre n'a pas d'argent sur lui, deux ou trois autres avancent sa part entre eux, pas forcément à parts égales). Le modèle initial n'avait qu'un `payerId` unique — changé **avant** de construire le lot 5 (calcul de solde), pas après, pour ne pas devoir réécrire cet algorithme une fois posé.

- `payerId` remplacé par `payers: [{userId, amount}]` dans le modèle Expense — **structurellement identique à `splits`** (qui doit quoi). `resoudreRepartition()` et `construireRepartitionInput()` (`src/lib/expenses.ts`) sont génériques et servent aux deux sens, éliminant 4 blocs de validation qui auraient sinon été quasi dupliqués (POST/PATCH × payeurs/participants).
- Le cas simple "une seule personne paye" reste le comportement par défaut dans le formulaire (menu déroulant, comme avant) ; "plusieurs personnes" révèle le même éditeur de répartition que "qui doit quoi" (égale ou personnalisée, montants ou pourcentages) — factorisé dans un composant `RepartitionEditor` partagé entre les deux usages plutôt que dupliqué.
- **Piège rencontré et documenté** : après avoir changé le schéma Mongoose, les premiers tests échouaient en 500 (`payerId requis`) alors que le code ne référence plus ce champ nulle part. Cause : **Mongoose conserve son modèle compilé en mémoire pour la durée de vie du processus** ; le rechargement à chaud de Turbopack recompile bien le fichier, mais ne réinitialise pas le registre interne de Mongoose (`models.Expense ?? model(...)` continue de renvoyer l'ancien modèle déjà enregistré). **Un changement de schéma Mongoose exige un vrai redémarrage du serveur (tuer le processus, pas juste sauvegarder le fichier), contrairement à tout le reste de Next.js.** Repéré en lisant les logs serveur (pas en devinant), corrigé en redémarrant, retesté avec succès ensuite.
- Anciennes données de démo (format `payerId`) incompatibles avec le nouveau schéma, supprimées et recréées proprement — sans conséquence, aucune donnée réelle n'existe encore.
- **Testé en conditions réelles** avec l'exemple exact de Tanguy (repas 100 €, un membre sans argent, deux autres avancent 40 €/60 € - pas un 50/50 arbitraire) : payeurs et montant total cohérents, participants qui doivent leur part même sans avoir payé. Payeurs dont la somme ne tombe pas juste → refusés (400). Trois payeurs à parts égales sur 100 € → anti-arrondi vérifié aussi côté payeurs (33,34 + 33,33 + 33,33). Aucun payeur précisé → défaut sur le créateur seul (comportement simple préservé).

### Journal du lot 5 (24/09/2026) — Dettes

Avant de coder, deux décisions de confiance ont été posées avec Tanguy (le même réflexe qu'à chaque fois qu'une fonctionnalité touche à qui a le droit de faire quoi) :
- **Seul le créditeur confirme avoir reçu son argent** — jamais le débiteur qui se déclarerait lui-même à jour. Empêche une fausse déclaration de remboursement.
- **Tout ou rien, pas de remboursement partiel en v1** — on règle exactement le montant calculé, pas un montant libre saisi à la main.

- **`src/lib/settlements.ts`** — nouveau, porte tout le calcul :
  - `calculerSoldesNets` : solde par membre en **centimes** (même anti-arrondi que `expenses.ts`) = ce qu'il a payé − ce qu'il doit, ajusté des remboursements déjà confirmés (`Settlement`, modèle défini au lot 3 mais jamais utilisé jusqu'ici).
  - `simplifier` : algorithme glouton "minimum cash flow" (section 4.4) — à chaque tour, le plus gros créditeur éponge le plus gros débiteur, jusqu'à ce que tout le monde soit à zéro. Réduit les dettes croisées au nombre minimal de transactions plutôt que d'afficher chaque dépense séparément.
  - `confirmerReglement(householdId, fromUserId, toUserId)` : **recalcule la dette au moment de l'appel et ignore tout montant fourni par le client** — le montant réglé est toujours celui recalculé côté serveur pour cette paire précise. Ça bloque à la fois un montant inventé et une tentative de régler une dette qui n'existe pas (ou plus, déjà réglée).
- **`hasOutstandingDebt`** (stub du lot 3, renvoyait toujours `false`) supprimé de `src/lib/households.ts`, remplacé par `aUneDetteEnCours` dans `settlements.ts` — branché sur `POST /api/colocations/[id]/leave`, qui avertit (409, pas un blocage dur) avant de laisser quitter avec un solde non nul.
- **Vue "qui doit quoi"** (`/colocations/[id]/dettes`) sur la dette **simplifiée agrégée**, pas dépense par dépense — conforme à la formulation du cahier des charges ("Tu dois 23,50 € à Marie"). Server Component (calcul direct, pas de fetch) + Client Component pour le bouton "Confirmer réception", visible uniquement sur les lignes où le membre connecté est le créditeur.
- **Testé en conditions réelles**, 3 comptes, avec la colocation de démo existante (5 dépenses, soldes calculés à la main puis vérifiés) : Test 1 créditeur de 296,49 € (Test 3) et 92,60 € (Test 2) — chiffres confirmés identiques entre le calcul manuel et l'affichage réel. Tentative de Test 2 de réclamer un remboursement de Test 1 (dette inexistante) → refusée (400). Tentative de Test 3 de réclamer un remboursement de Test 2 (mauvaise paire) → refusée (400). Test 1 confirme la réception des 296,49 € de Test 3 → la dette disparaît pour tout le monde, nouvelle tentative de règlement → refusée (déjà soldée). Sur une colocation temporaire isolée : départ d'un membre endetté sans `force` → averti (409, pas retiré) ; après règlement de sa dette → part librement. Colocation temporaire nettoyée après test. Vérifié aussi dans le navigateur (compte Google réel de Tanguy) : affichage correct de la dette restante de Test 2, laissée volontairement en l'état dans la colocation de démo pour que Tanguy puisse tester lui-même le bouton "Confirmer réception" en se connectant en Test 1.

### Journal du lot 6 (20/10/2026), Tâches

Décisions validées avec Tanguy avant de coder : changer le statut = assignés ou admin (ajout : si personne n'est assigné, tout membre peut agir, sinon la tâche serait bloquée) ; créer = tout membre ; modifier le contenu ou supprimer = créateur ou admin (même règle que les dépenses) ; rotation entre tous les membres à l'ancienneté ; prochaine échéance = date de complétion + intervalle.

- **Modèle `Task`** : ajout de `createdBy`, `rotation` (activable par tâche), `completedBy` (pour l'historique) et `occurrenceGeneree` (verrou anti-doublon). Changement de schéma Mongoose, donc redémarrage du serveur obligatoire (section 14).
- **`src/lib/tasks.ts`** : fonctions pures testées (droits, rotation circulaire à l'ancienneté, échéance en UTC avec écrêtage de fin de mois : 31/01 + 1 mois = 28 ou 29/02) et fonctions base (`changerStatutTache`, `retirerMembreDesTaches`, `listerTachesKanban`, `listerHistorique`). `src/lib/ids.ts` : `estObjectIdValide` (regex 24 hex, plus stricte que `ObjectId.isValid`).
- **Pas de doublon d'occurrence** : le verrou `occurrenceGeneree` est posé par un `findOneAndUpdate` atomique conditionnel, pas par un "lire puis écrire". Vérifié avec deux validations simultanées (une seule occurrence créée) et avec fait, à faire, fait.
- **Routes** : `POST /taches`, `PATCH` et `DELETE /taches/[tacheId]`. Pas de GET de liste, les pages lisent directement la base. Dans le PATCH, les droits sont vérifiés sur l'état AVANT modification (on ne peut pas s'assigner et déplacer dans la même requête).
- **UI** : Kanban 3 colonnes avec `@dnd-kit/core` 6.3.1, mise à jour optimiste avec retour en arrière si l'API refuse, verrou par carte pendant sa requête, menu Statut en alternative au glisser-déposer (clavier et mobile). La colonne Fait ne montre que les 7 derniers jours, le reste est dans `/taches/historique` (paginé).
- **Relecture par l'agent `relecteur`** : 1 bloquant et 3 importants trouvés puis corrigés. Bloquant : un id mal formé dans l'URL d'une page donnait un 500 (CastError), corrigé à la source dans `getHouseholdForMember`, ce qui protège aussi les pages et routes des lots 3 à 5. Importants : une tâche terminée gardait un assigné parti (rouverte, elle devenait déplaçable par l'admin seul) ; le formulaire d'édition renvoyait un assigné parti (400 sans cause visible) ; deux déplacements rapides pouvaient désynchroniser l'état.
- **Cascade** : détruire une colocation supprime maintenant aussi ses tâches ET ses remboursements (oubli du lot 5, repéré par `dev`). Quitter ou être retiré retire la personne des assignés des tâches non terminées (les terminées gardent leur assigné pour l'historique).
- **Testé en conditions réelles** (script multi-comptes : 48 vérifications sur 48, plus 323 tests Vitest) : validations (400), permissions combinées statut+titre, cross-tenant et ids invalides (404), rotation et circularité, échéances hebdo et mensuelle, doublons, départ d'un membre, cascade en base. Vérifié aussi dans le navigateur : vrai glisser-déposer persisté après rechargement, rotation visible (Tanguy remplacé par Test 1, échéance +7 jours), formulaire de création, historique. Données de démo : 7 tâches dans "Colocation Test".
- **Dette connue** : pas de test automatique des fonctions qui touchent la base (`changerStatutTache` etc.), couvertes par le script multi-comptes ; `listerHistorique` trie sur `completedAt` sans index dédié (suffisant au volume actuel) ; une tâche est "en retard" à partir du lendemain de son échéance, en jour UTC.
- **Compte MongoDB Atlas** : créé le 06/09/2026 avec **tanguyh1209@gmail.com** via "Se connecter avec Google" (pas GitHub). Atlas bloque toute IP non autorisée (Network Access) : si `/api/health` répond 503 `{"ok":false}` (le message "Could not connect to any servers" n'apparaît plus que dans le terminal du serveur, la route ne renvoie plus de détail), c'est probablement ça (arrivé le 18/10/2026 après un changement de réseau).

### Journal du lot 7 (21/10/2026), Liste de courses

Décisions validées avec Tanguy avant de coder : tout membre ajoute et coche ; supprimer = l'auteur ou l'admin ; catégories = liste fixe optionnelle (Fruits et légumes, Frais, Épicerie, Boissons, Hygiène, Entretien, Autre) ; mise à jour automatique toutes les 15 s plutôt que "au rechargement seulement" ; pas de modification du contenu d'un article (ajouter, cocher, supprimer). Écart assumé par rapport au plan annoncé : pas de bouton "vider les cochés", qui aurait détruit l'historique ; à la place, les articles cochés depuis plus de 7 jours quittent la page principale et ne restent que dans l'historique paginé (même logique que le Kanban).

- **Modèle `ShoppingItem`** : ajout de `checkedAt` et `category` en enum. Changement de schéma Mongoose, redémarrage du serveur obligatoire (section 14).
- **`src/lib/shopping-constants.ts`** : fichier PUR sans aucun import, pour qu'un composant client puisse utiliser les libellés et `grouperParCategorie` sans embarquer Mongoose dans le navigateur. Les composants clients n'importent que des TYPES de `shopping.ts`.
- **`src/lib/shopping.ts`** : droits, normalisation du nom, cocher/décocher, listes "à acheter" / "achetés" / historique. Cocher envoie un état EXPLICITE (`checked: true/false`), jamais un basculement : un double clic ne rend pas l'inverse.
- **Coche atomique** : trouvé par `relecteur`. La première version lisait puis écrivait, donc deux colocataires qui cochaient exactement en même temps se réécrasaient l'heure et l'auteur de l'achat. Remplacé par un `findOneAndUpdate` conditionnel (filtre sur l'état opposé), comme le verrou des tâches récurrentes. Vérifié : deux coches simultanées donnent le même gagnant dans les deux réponses.
- **Interface** : `useOptimistic` (React 19) au lieu de `useState(props)`, car un `useState` copie les props une seule fois et ignorerait les nouvelles données après `router.refresh()`. Rafraîchissement par `setInterval` de 15 s et `visibilitychange` (pas de setState dans l'effet, donc compatible avec la règle ESLint), sauté pendant une mutation et quand l'onglet est caché. Cases de 48 px minimum pour le tactile (usage en magasin). Après un ajout, la catégorie choisie est conservée (on ajoute souvent plusieurs articles du même rayon).
- **Quantité vide** : acceptée et traitée comme "pas de quantité" (la validation `.min(1)` suggérée par la relecture a été écartée volontairement : plus souple, et l'interface omet déjà le champ vide).
- **Cascade** : détruire une colocation supprime aussi ses articles. Plus aucune cascade en attente. Quitter une colocation ne touche pas aux articles : le nom de l'auteur reste affiché.
- **Testé en conditions réelles** (script multi-comptes : 45 vérifications sur 45, plus 407 tests Vitest) : validations (400), suppression auteur/admin (403 sinon), coche idempotente et concurrente, base (champs bien effacés au décochage), cross-tenant et ids invalides (404), règle des 7 jours (achat à 10 jours absent de la liste mais présent dans l'historique), pages d'historique hors limites, départ d'un membre, cascade. Vérifié aussi dans le navigateur : groupement par rayon, ajout, coche, et mise à jour automatique (article ajouté par un autre compte apparu seul en environ 14 s). Données de démo : 8 articles dans "Colocation Test".
- **Dette connue** : pas de test automatique des fonctions qui touchent la base (couvertes par le script) ; un article décoché depuis "Achetés" passe brièvement en fin de son groupe avant de retrouver sa place au rafraîchissement.

### Journal, détail des remboursements par dépense (21/10/2026, demande de Tanguy)

Tanguy a demandé, en regardant sa dépense "Repas" (100 €, avancée 40 € par Test 1 et 60 € par Test 2), que la page de la dépense dise combien le troisième doit rembourser à chacun. Décidé avec lui : affichage sur la page de la dépense seulement (pas dans la liste), et pas de prix sur la liste de courses (le cahier des charges 4.6 n'en prévoit pas, les montants vivent dans les Dépenses).

- **`remboursementsDepense(payers, splits)`** (`src/lib/settlements.ts`) : fonction pure. Solde net de chaque personne sur CETTE dépense (payé moins part, en centimes), puis réutilisation de `simplifier` (le même minimum cash flow que la page "Qui doit quoi"), donc aucun second algorithme à maintenir. Sur l'exemple : Test 3 rembourse 6,66 € à Test 1 et 26,67 € à Test 2.
- **Page de la dépense** : section "Qui rembourse qui" avec le vocabulaire de la page des dettes ("Tu dois X à A", "B te doit X", "C doit X à D"), une phrase qui rappelle que c'est pour cette dépense seulement et un lien vers "Qui doit quoi", qui additionne toutes les dépenses et reste la référence pour payer.
- **Testé** : 49 tests Vitest (cas de Tanguy aux centimes exacts, payeur qui ne participe pas, personne qui paie ET doit, pièges flottants, 100 jeux pseudo-aléatoires à graine fixe : les soldes retombent tous à 0). Total 456 tests. Vérifié dans le navigateur sur la dépense "Repas" de la colocation de démo.
- **Limite connue** : c'est une information, pas un suivi : on ne coche pas un remboursement par dépense. Les remboursements confirmés restent ceux de la page "Qui doit quoi" (tout ou rien, par le créditeur).

### Journal du lot 8 (21/10/2026), Dashboard

Décisions validées avec Tanguy avant de coder : le dashboard est EN HAUT de la page `/colocations/[id]` (pas une page séparée) ; le graphique change de mois par flèches (`?mois=YYYY-MM`, mois en cours par défaut) ; la page `/tableau-de-bord` affiche en plus une ligne de solde par colocation.

- **`src/lib/dashboard.ts`** : `parserMois` (bornes en UTC, car les dates de dépenses sont stockées à minuit UTC ; tout paramètre mal formé, en double ou hors 2000..2100 retombe sur le mois courant sans erreur, jamais de confiance dans l'URL), `totauxParCategorie` (sommes en centimes, pourcentages ENTIERS dont la somme fait exactement 100 par la méthode du plus fort reste), `selectionnerTachesEnCours`, `calculerSoldesMembres` (réutilise `calculerSoldesNets`, donc les remboursements confirmés sont pris en compte ; seuls les membres actuels), `soldesPourUtilisateur`, `donneesDashboard` (lectures en parallèle, noms en requêtes groupées, pas de N+1).
- **Interface** : `DashboardColocation` (Server Component) injecté dans `ColocationClient` par une prop `apercu` : un Server Component peut être rendu DANS un Client Component s'il arrive en prop (pas importé), ce qui évite deux `<main>` imbriqués. Seul le graphique `GraphiqueCategories` (Recharts 3.10, anneau) est un composant client ; il n'importe que des types de `dashboard.ts` pour ne pas embarquer Mongoose dans le navigateur. Montage du graphique par `useSyncExternalStore` (équivalent d'un setState dans un effect, interdit par la règle ESLint). La légende texte porte toute l'information (graphique `aria-hidden`), les soldes se lisent au signe et au texte, pas seulement à la couleur.
- **Relecture par `relecteur`** : verdict OK, un point important corrigé : après avoir retiré un membre ou transféré l'admin, le dashboard (calculé par le serveur) ne se rafraîchissait pas ; `recharger()` appelle maintenant `router.refresh()`. Une catégorie minuscule affichait "0 %" alors que son montant est positif : affiche maintenant "< 1 %".
- **Testé en conditions réelles** : script multi-comptes, 49 vérifications sur 49 avec des chiffres CALCULÉS À LA MAIN avant le test (total du mois 699,60 €, pourcentages 86/8/6, mois précédent 109,90 € à 82/18, soldes +375,76 / -125,94 / -249,82 en Test 1/2/3), navigation de mois et 9 paramètres invalides, tri et limite des dernières dépenses et des tâches, compteurs sur toutes les tâches, remboursement confirmé qui met à jour le dashboard, membre retiré qui disparaît, cross-tenant et ids invalides (404), non-régression de la page. 573 tests Vitest (117 pour `dashboard.ts`). Vérifié dans le navigateur sur la colocation de démo (septembre 2026 : 889,50 €, 68 + 17 + 10 + 5 = 100 %), flèches de mois, `/tableau-de-bord`, console sans erreur.
- **Dette connue** : `calculerSoldesMembres` relit la colocation et `calculerSoldesNets` charge des documents complets (acceptable au volume actuel) ; `/tableau-de-bord` fait un calcul de solde par colocation ; le "en retard" du dashboard est calculé avec `new Date()` côté composant et `maintenant` côté lib (équivalents sauf à minuit UTC pile) ; la page reste en `max-w-2xl` (le dashboard n'a pas sa propre largeur).

### Journal du lot 9 (22/10/2026), Emails et mot de passe oublié

Décisions validées avec Tanguy avant de coder : mail de BIENVENUE au nouveau membre (pas de mail aux autres) ; mail de DÉPENSE aux seules personnes qui doivent de l'argent, à la CRÉATION seulement (jamais à la modification ni à la suppression), jamais à l'auteur ; rappel de tâche la veille de l'échéance par Cron Vercel quotidien ; case "Recevoir les notifications par email" sur le profil (les mails de sécurité ne dépendent pas de cette case) ; démarrage SANS nom de domaine.

- **Contrainte Resend sans domaine** : expéditeur `onboarding@resend.dev` et destinataire limité à l'adresse du compte Resend (tanguyh1209@gmail.com). Pour tester avec les comptes `@roomflow.test`, variable `EMAIL_REDIRECT_TO` : tout part vers cette adresse avec l'objet `[pour : vrai destinataire]` et un bandeau "Mode test". **Elle est ignorée en production par le code** (`VERCEL_ENV === "production"`, ou `NODE_ENV` sans `VERCEL_ENV`), pas seulement par discipline : une variable oubliée dans Vercel ne peut pas détourner les liens de réinitialisation. Un vrai domaine (environ 10 € par an) se branche plus tard sans changer le code (`EMAIL_FROM`). La clé API Resend est restreinte à l'envoi (on ne peut pas lire l'historique avec).
- **`src/lib/email.ts` et `email-templates.ts`** : `envoyerEmail` ne lève JAMAIS d'exception (un mail en échec ne casse pas l'action de l'utilisateur) et masque les adresses dans les logs. Toute donnée saisie par un utilisateur passe par `echapperHtml` ; les sujets sont aplatis (anti-injection d'en-têtes) ; les liens viennent de `APP_URL`, jamais d'un en-tête `Host`. Les liens du pied de mail ne sont cliquables que s'ils sont explicitement autorisés (`liensAutorises`) : un admin qui nommerait sa colocation avec une URL ne produit pas de lien cliquable dans les mails des autres.
- **Mot de passe oublié** : jeton aléatoire de 256 bits, seul son hash SHA-256 est stocké (index TTL), durée 60 minutes, usage UNIQUE garanti par un `findOneAndDelete` atomique (vérifié avec 10 réinitialisations simultanées : une seule réussit). Réponse identique que l'email existe ou non (statut, corps et temps de réponse comparables, travail fait dans `after()`). Un compte Google/GitHub ne reçoit jamais de mot de passe (filtre `provider: "credentials"` à l'ÉCRITURE) et reçoit un mail "connecte-toi avec Google". Une faute de frappe dans le nouveau mot de passe ne brûle pas le jeton. Page du lien avec `referrer: no-referrer`.
- **Relecture par `relecteur` (modèle Opus, lot le plus sensible)** : un bloquant trouvé et corrigé. La limite de fréquence de 60 s ne protégeait pas les comptes Google/GitHub (on pouvait inonder une adresse de mails et vider le quota Resend) et se contournait en concurrence pour les comptes email (lire, supprimer, créer n'est pas atomique : même piège que la coche des courses au lot 7). Remplacé par UN `findOneAndUpdate` conditionnel sur `User.derniereDemandeMdpAt`, posé AVANT de regarder le provider. Vérifié : 20 demandes simultanées pour un compte email = 1 seul mail ; 15 pour un compte Google = limiteur posé, aucun jeton ni mot de passe.
- **Notifications** (`src/lib/notifications.ts`) : le mail de dépense réutilise `remboursementsDepense` (le calcul de la page de la dépense) : "tu dois 6,66 € à Test 1 et 26,67 € à Test 2". Tout part dans `after()` après la réponse HTTP. Préférence `User.notificationsEmail` : absent = actif (`!== false`, car une requête `.lean()` n'applique pas les valeurs par défaut Mongoose).
- **Rappels de tâche** (`src/lib/rappels.ts`, `GET /api/cron/rappels-taches`, `vercel.json` à 7 h UTC) : fenêtre [aujourd'hui, surlendemain) en UTC, une seule fois par tâche (`rappelEnvoye` posé de façon atomique AVANT l'envoi ; contrepartie assumée : un envoi qui échoue n'est pas retenté), remis à false quand l'échéance change. La route est FERMÉE par défaut : sans `CRON_SECRET` configuré, 401 pour tout le monde, comparaison à temps constant.
- **Testé en conditions réelles avec de vrais mails** : script multi-comptes (61 vérifications sur 62, la 62e était une erreur de MON test : la modification d'une dépense exige les payeurs, refait ensuite correctement) + parcours complet avec le VRAI lien reçu par mail dans Gmail (réinitialisation, nouveau mot de passe accepté, ancien refusé, lien non rejouable). Mails vérifiés dans la boîte : bienvenue, dépense (montants exacts), rappels de tâche, mot de passe oublié (exactement 1 par demande malgré 20 requêtes simultanées), et AUCUN mail pour la modification ni la suppression d'une dépense. 1171 tests Vitest.
- **Non vérifié** : la réception du mail "connecte-toi avec Google" (compte OAuth). La logique est prouvée par la base (limiteur posé, aucun jeton, aucun mot de passe) et le code d'envoi est le même que pour les autres mails, mais le mail n'est pas apparu dans la recherche Gmail (qui exclut le spam). Hypothèse : classé en spam par Gmail (texte "Se connecter avec Google" + lien localhost). À confirmer dans le dossier Spam et le tableau de bord Resend.
- **Limites connues, à reprendre au lot 11 / README** : (les sessions JWT déjà ouvertes restaient valides après une réinitialisation : CORRIGÉ par le lot 9 bis ci-dessous) ; pas de limite par IP ni globale sur la route de demande (il faudrait un stockage partagé type Upstash ou une règle de pare-feu Vercel), donc un attaquant qui connaît beaucoup d'adresses peut consommer le quota quotidien Resend (un mail par compte et par minute) ; le jeton passe dans l'URL (visible dans les journaux de requêtes Vercel, risque faible : 60 minutes et usage unique) ; pas de longueur maximale de mot de passe (bcrypt ignore ce qui dépasse 72 octets) ; `/api/register` répond 409 pour un email existant, ce qui permet de savoir qu'un compte existe (affaiblit l'anti-énumération, antérieur au lot 9) ; deux appels simultanés à `/join` pourraient ajouter deux fois le même membre et envoyer deux mails de bienvenue ; `estEnProduction` compare `VERCEL_ENV` en minuscules exactement (Vercel l'écrit ainsi) ; `construireUrl` retombe sur localhost avec un avertissement si `APP_URL` est absente en production.

### Journal du lot 9 bis (28 et 29/10/2026), Sécurité des comptes

Question de départ de Tanguy : comment sont protégés les comptes (session ou cookie, durée, http ou https, suppression de compte). Réponse : JWT dans un cookie HttpOnly et SameSite=Lax, `Secure` en HTTPS (automatique sur Vercel), 30 jours glissants. Il a validé un lot de durcissement, réalisé en trois parties.

- **A, sessions révocables et limite d'essais** (`src/auth.ts`, `src/lib/login-limiter.ts`, `src/lib/session-guard.ts`, `src/models/LoginAttempt.ts`, `User.passwordChangedAt`). Un JWT vit dans le navigateur, le serveur ne peut pas l'effacer : on relit donc le compte au plus tard toutes les 300 s (`SESSION_RECHECK_SECONDS` ne sert qu'aux tests). Session refusée si le compte n'existe plus ou si le mot de passe a changé après la connexion. Le `iat` natif est réécrit à chaque lecture, donc deux claims PROPRES : `connecteLe` (posé à la connexion seulement) et `verifieLe`. Si la base ne répond pas, la session est conservée (sinon une panne déconnecterait tout le monde). Le délai maximal de révocation est donc de 5 minutes.
- **Limite d'essais de connexion** : 5 par email et 20 par IP sur 15 minutes (fenêtre fixe, index TTL). Le compteur est incrémenté AVANT de regarder le mot de passe, par un seul `findOneAndUpdate` atomique (une rafale de 50 requêtes laisse passer exactement 5 vérifications). Même comportement pour un email inconnu (ne révèle pas si le compte existe), et un hash bcrypt bidon égalise les temps de réponse (mesuré : 682 ms contre 655 ms). Ordre : IP d'abord et seule (une IP bloquée ne fait plus monter de compteur email), puis email. Un email qui n'a pas la forme d'une adresse ou dépasse 254 caractères ne crée aucun compteur. Une IPv6 est comptée par bloc /64 (`normaliserIp`), sinon un abonné aurait des milliards de compteurs neufs ; une IPv4 mappée en IPv6 redevient une IPv4. Le compteur email est remis à zéro après une connexion réussie, jamais le compteur IP.
- **B, suppression de compte** (`src/lib/account.ts`, `DELETE /api/profil`, zone de danger dans `/profil`). Garde-fous : phrase « SUPPRIMER », mot de passe (avec la même limite d'essais que la connexion) ou, pour un compte Google/GitHub, connexion de moins de 10 minutes (sinon code `connexion_ancienne`). Refus s'il reste une DETTE (liste des colocations concernées). Une CRÉANCE n'empêche pas la suppression mais demande un accord explicite d'abandon (`accepterAbandonCreances`), enregistré comme remboursements. Le compte quitte ses colocations (tâches désassignées, admin passé au plus ancien, colocation détruite si c'est le dernier membre), l'historique des autres reste au nom de « Utilisateur supprimé ». Les colocations concernées sont trouvées PAR LES DONNÉES (dépenses, remboursements), pas par l'appartenance : quelqu'un qui est parti avec une dette est déjà retiré des membres, mais sa dette existe encore. Verrou atomique `User.suppressionDebut` (10 minutes, repris si périmé) contre deux suppressions simultanées, puis réévaluation complète sous verrou avant toute écriture. Le document User est supprimé EN DERNIER.
- **C, en-têtes et dépendances** (`next.config.ts`, `package.json`). `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS, `poweredByHeader: false` et une CSP PARTIELLE (`frame-ancestors 'none'; base-uri 'self'; object-src 'none'`). Pas de `script-src` ni de `form-action` volontairement : ils casseraient les scripts inline de Next et les redirections Google/GitHub. `npm audit` : 0 vulnérabilité (`next` 16.4.3, `sharp`, `zod` mis à jour sans changement de version majeure).
- **Réseau local** : si le DNS du réseau refuse les requêtes SRV (`querySrv ECONNREFUSED` malgré une IP autorisée dans Atlas), variable optionnelle `MONGODB_DNS_SERVERS=1.1.1.1,8.8.8.8` dans `.env.local`, ignorée en production Vercel par le code. L'IP autorisée dans Atlas change avec le réseau (Network Access).
- **Relectures par `relecteur` (Opus)** : deux bloquants sur la partie B trouvés et corrigés (colocations découvertes par l'appartenance au lieu des données, donc une dette dans une colocation quittée était ignorée ; double suppression simultanée qui pouvait abandonner les créances deux fois), plus la validation de l'email avant le limiteur et le regroupement IPv6.
- **Testé en conditions réelles** sur MongoDB Atlas, serveur lancé avec `SESSION_RECHECK_SECONDS=2` : 37 vérifications sur la sécurité (limiteur, rafale, IP, temps de réponse, révocation après réinitialisation et après suppression) et 55 sur la suppression (garde-fous, dette bloquante, créance, suppression complète, pages au nom de « Utilisateur supprimé » sans plantage, session révoquée, compte OAuth avec fausse session forgée, zone de danger vérifiée dans le navigateur). Un KO apparent venait de mon script : `/profil` n'est rendu qu'après chargement de la session côté client (`if (status === "loading") return null`), donc le HTML serveur est vide ; vérifié dans le navigateur. 1519 tests Vitest.
- **Limites connues, à garder pour le README** : pas de vérification d'email à l'inscription (prévue avec un nom de domaine, lot 11) ; le blocage de 15 minutes peut être utilisé pour bloquer un compte visé (compromis assumé, la limite par IP freine l'ampleur) ; `x-forwarded-for` est fiable sur Vercel mais pas en hébergement quelconque ; pas de limite par IP sur la demande de réinitialisation ; le jeton de réinitialisation passe dans l'URL ; pas de longueur maximale de mot de passe ; `/api/register` répond 409 pour un email existant ; `/join` n'est pas protégé contre un double ajout simultané. **Cas bloquant non résolu** : une dette dans une colocation QUITTÉE, envers un créditeur qui l'a quittée aussi, ne peut plus être confirmée par personne (seul le créditeur confirme), donc le compte ne peut jamais être supprimé. Fenêtres résiduelles de quelques millisecondes pendant la suppression (dépense créée au même instant, membre qui rejoint une colocation en cours de destruction) documentées dans `account.ts`. Un plantage au milieu d'une suppression laisse le verrou jusqu'à 10 minutes.

### Journal du lot 10 (29/10/2026), Export PDF du récapitulatif mensuel

Décisions validées avec Tanguy avant de coder : `@react-pdf/renderer` (le PDF est décrit avec des composants React, généré côté serveur) ; contenu complet (en-tête, total et totaux par catégorie en tableau, liste des dépenses, soldes, virements simplifiés, pas de graphique) ; bouton sur le dashboard pour le mois affiché, ouvert à tout membre ; soldes du JOUR de génération (« Soldes au JJ/MM/AAAA », pas ceux de la fin du mois) ; virements calculés comme la page « Qui doit quoi », donc un ancien membre parti avec une dette peut y figurer, suffixé « (ancien membre) » (repéré par les IDS, jamais par les noms) ; vraie police embarquée plutôt qu'Helvetica.

- **Données** (`src/lib/recap-mensuel.ts`) : `donneesRecapMensuel` lit, `construireRecapMensuel` met en forme (partie PURE, testée sans base). Aucun calcul dupliqué : `parserMois`, `totauxParCategorie`, `calculerSoldesMembres` (dashboard) et `calculerDettesSimplifiees` (dettes), donc le PDF ne peut pas afficher d'autres chiffres que l'écran. Retour en union discriminée `ResultatRecap` (`ok`, `introuvable`, `trop_de_depenses`) : le dépassement du plafond est un cas normal, pas une exception. `nomFichierRecap` fabrique un nom `roomflow-<slug>-AAAA-MM.pdf` en ASCII pur (le nom de la colocation est saisi par un utilisateur et part dans un en-tête HTTP : aucune injection possible).
- **Route** `GET /api/colocations/[id]/export?mois=AAAA-MM` : 401 sans session ; 404 identique pour colocation inconnue, id mal formé ou non-membre (rien n'est révélé) ; 422 au-delà de 300 dépenses ; 500 JSON propre (le log dit l'étape « lecture » ou « rendu », jamais de donnée personnelle) ; mois invalide = mois courant ; `Cache-Control: private, no-store` ; `maxDuration = 30`.
- **Plafond de 300 dépenses par export** : le temps de rendu de react-pdf est quadratique (mesuré en local : 126 dépenses = 3 s, 300 = 6 s, 500 = 12 s, 10 exports simultanés de 126 = 21 s). Comptage AVANT lecture avec le même filtre de dates. Un mois ne devrait jamais en avoir autant dans une colocation.
- **Police Noto Sans embarquée** (`src/assets/fonts/`, 1,3 Mo, licence SIL OFL jointe) : Helvetica (police standard du PDF) n'affiche que le Windows-1252 et sort des lettres FAUSSES sans erreur pour du cyrillique ou du polonais. Noto Sans couvre latin, latin étendu, grec et cyrillique ; emoji et caractères CJK ne sont pas couverts et `textePourPdf` les remplace par « ? » plutôt que de laisser corrompre les lettres voisines (constaté avant correction). Sur Vercel, un fichier lu à l'exécution n'est copié dans la fonction que si Next le « trace » : `outputFileTracingIncludes` dans `next.config.ts` (clé de route avec crochets échappés), vérifié dans `.next/server/app/api/colocations/[id]/export/route.js.nft.json` après un vrai `npm run build` Turbopack (à reconfirmer au premier déploiement).
- **Piège fontkit corrigé** : avec Noto Sans, le texte EXTRAIT du PDF (copier-coller, Ctrl+F, lecteurs d'écran) lisait « . » comme « ! » alors que le rendu visuel était juste. Cause : cache de glyphes de fontkit « le premier créé gagne » ; un glyphe créé d'abord par une substitution n'a pas de point de code, et pdfkit écrit alors une entrée VIDE dans la table ToUnicode. Dépend de l'ordre des documents dans le processus (donc aléatoire sur un serveur qui reste allumé). Correctif isolé dans `preparerPolice()` (`recap-mensuel-pdf.tsx`) : une fois par processus, chaque point de code de la police est créé en premier. Il repose sur un détail interne de fontkit : une mise à jour de `@react-pdf/renderer` peut le rendre inutile (il lève une erreur explicite si la police n'expose plus ce qu'il utilise). Autre point : la bibliothèque PDF étant externe au code rechargé à chaud, il faut REDÉMARRER le serveur de dev après toute modification de la gestion de police.
- **Mots très longs** : sans règle de coupure, un mot sans espace (URL, nom de 60 lettres) débordait sur les colonnes voisines ; coupure au-delà de 12 caractères (un mot qui tient dans la ligne reste entier). Réglage GLOBAL à react-pdf (`registerHyphenationCallback`), à revoir si un second document apparaît.
- **Bouton** (`BoutonExportPdf.tsx`, Client Component) : `fetch` puis téléchargement par Blob, et non un simple lien `download` (sur un 404 ou un 500, le navigateur aurait enregistré le JSON d'erreur sous le nom du PDF). Bouton désactivé pendant la génération, message d'erreur lisible pour 401, 404, 422, 500 et coupure réseau.
- **Relectures par `relecteur` (Sonnet)** : première passe A CORRIGER (mots longs débordants, caractères faux d'Helvetica, pas de plafond de taille, formatage resté dans le `.tsx` sans test) ; seconde passe sur les corrections VALIDÉE (erreur explicite si la police ne se charge pas, début du `try` avant la lecture, plus de tiret cadratin littéral dans les tests).
- **Testé en conditions réelles** (3 comptes sur MongoDB Atlas, 61 vérifications, serveur redémarré) : accès, 54 vérifications de la route (en-têtes, nom de fichier, bornes du mois : 1er à 00:00 UTC inclus, 1er du mois suivant exclu ; mois invalides ; noms de colocation hostiles ; non-membre ; départ d'un membre), contenu du PDF extrait et comparé aux données (total, payeurs multiples, alphabets, caractères spéciaux), exactement 300 dépenses = 200 et 301 = 422, exports simultanés ; bouton dans le navigateur (succès, 5 cas d'erreur simulés, suivi du mois affiché, mise en page sur téléphone). 1704 tests Vitest, build Turbopack de production OK.
- **Limites connues** : pas de limitation de débit sur cette route (génération coûteuse, réservée aux membres connectés ; sur Vercel chaque appel tourne dans sa propre fonction) ; les soldes et les virements sont lus en deux fois (une dépense créée entre les deux pourrait donner un écart de quelques millisecondes) et chargent TOUTES les dépenses de la colocation, pas seulement celles du mois ; la colocation est lue deux fois ; « Généré le » est en UTC (entre 0 h et 2 h heure de Paris, la date affichée est celle de la veille) ; un mot très long coupé garde son trait d'union dans le texte copié ; emoji et CJK deviennent « ? » ; `npm run build` doit être lancé SERVEUR DE DEV ARRÊTÉ (sur Windows, Turbopack échoue sinon avec `0xc0000142`, et il écrit dans `.next` : supprimer `.next` avant de relancer `npm run dev`).

### Journal du lot 11, bloc A (30/10/2026), Panneau admin et nettoyage automatique

Décisions validées avec Tanguy avant de coder : ordre « admin d'abord, déploiement ensuite » ; colocation VIDE supprimée 30 jours après le départ du dernier membre ; colocation INACTIVE (plus de 90 jours sans activité) avertie par email à tous ses membres puis supprimée 30 jours plus tard si rien ne bouge ; la suppression AUTOMATIQUE est désactivée par défaut (interrupteur `NETTOYAGE_AUTO_ACTIF`, exactement "true") ; le panneau n'accepte que des comptes Google ou GitHub ; version complète du cron avec mode simulation ; l'email « vidée » contient le code d'invitation ; Vercel confirmé pour le déploiement ; nom de domaine plus tard.

- **Notion d'activité** (`src/lib/nettoyage.ts`) : la dernière activité d'une colocation est la plus récente parmi sa création, l'arrivée d'un membre (`joinedAt`) et la CRÉATION ou l'action réelle sur ses dépenses, tâches (création, terminée), articles (création, coche) et remboursements. Jamais la `date` saisie d'une dépense (elle peut être dans le futur). Cinq requêtes `$group` pour toutes les colocations. Modifier une dépense ou une tâche ne compte pas (pas de date de modification).
- **Règles pures** : `evaluerNettoyage` rend UNE action (ignorer, rien, planifier_vide, avertir_inactive, annuler, supprimer). `supprimer` n'est rendu que si l'échéance est posée, cohérente, atteinte ET si la raison est encore vraie à cet instant ; tout état incohérent mène à annuler, planifier ou rien, jamais à une suppression (grille de 187 000 combinaisons). Inactive = STRICTEMENT plus de 90 jours. Colocation de démo (`demo: true`) toujours ignorée. Champs Household ajoutés : `demo`, `videDepuis`, `avertieLe`, `suppressionPrevueLe`, `motifSuppression`, `destructionDebut`.
- **Panneau `/admin`** (`src/lib/admin.ts`, `src/app/admin/`, `DELETE /api/admin/colocations/[id]`) : réservé aux emails de `SITE_ADMIN_EMAILS` ET aux comptes `google` ou `github`, provider et email relus EN BASE à chaque requête (jamais ceux de la session). Un non-admin et un non-connecté reçoivent un 404 (page : `notFound()`, même titre qu'une page inconnue ; API : 404 JSON). `/admin` n'est pas dans le matcher de `proxy.ts` (une redirection vers /connexion trahirait la page). Le panneau ne montre AUCUN nom d'utilisateur, email ni contenu : nom de la colocation, compteurs, état, dernière activité. Destruction : il faut retaper le nom exact, contrôlé côté serveur, puis `detruireColocation`. Comparaison d'emails en minuscules ASCII seulement (le signe Kelvin U+212A passait pour un « k » avec `toLowerCase()`, trouvé par les tests).
- **Email « colocation vidée »** (`/leave` → `planifierSuppressionVide`) : écriture CONDITIONNELLE (`members.0` absent, pas démo, hors destruction) ; le mail part dans `after()` seulement si l'écriture a eu lieu. Rejoindre efface les 4 champs de plan (un seul `save`). Il part même si les notifications sont décochées (avertissement de suppression de données).
- **Cron `GET /api/cron/nettoyage`** (`src/lib/nettoyage-cron.ts`, 3 h UTC, `vercel.json` ; 2 crons quotidiens = le maximum du plan gratuit) : protégé par `CRON_SECRET`, fermé par défaut. Chaque écriture répète ses préconditions dans le filtre MongoDB (évalué au moment de l'écriture). Avertissement d'inactivité envoyé UN PAR UN à tous les membres, plan posé SEULEMENT si tous les envois ont réussi (sinon on retente demain : un double mail vaut mieux qu'une suppression sans préavis). Plafonds par passage : 50 actions, 30 emails, 45 s (`tronque: true`). Échéance en retard de plus de 7 jours : replanifiée (nouveau préavis de 30 jours, nouvel avertissement pour les inactives), jamais supprimée, pour que le jour où l'interrupteur s'ouvre il n'y ait pas de suppression en rafale sans préavis.
- **Garde d'envoi** (`envoiReelPossible`) : sans domaine vérifié chez Resend les mails ne partent qu'à l'adresse du compte, donc un « préavis » serait fictif. En production : il faut `EMAIL_FROM` avec un domaine valide qui n'est ni `resend.dev` ni un sous-domaine ; sinon le cron ne pose AUCUN plan (ni inactive ni vide) et `/leave` ne planifie rien. Hors production, une redirection de test (`EMAIL_REDIRECT_TO`) ne compte PAS comme un envoi réel, sauf `NETTOYAGE_ACCEPTER_ENVOI_REDIRIGE=true` (TESTS UNIQUEMENT). Le domaine de l'expéditeur est validé par un motif strict (un point final ou un caractère invisible passait pour un autre domaine).
- **Verrou de destruction** : avant `detruireColocation`, relecture fraîche puis pose atomique de `destructionDebut` (filtre : même plan, même motif, pas démo, verrou absent ou plus vieux que 10 minutes). `/join` et `/leave` sauvegardent avec `household.$where = filtreHorsDestruction()` : Mongoose ajoute ce filtre à l'écriture, donc soit le verrou passe d'abord (le `save` ne trouve plus le document, réponse « code invalide »), soit le `join` passe d'abord (la pose du verrou échoue). PIÈGE : sur un tableau modifié Mongoose lève une `VersionError` et non `DocumentNotFoundError` quand le filtre ne correspond plus ; `ecritureRefuseeParFiltre` attrape les deux. Un plantage au milieu de la destruction est repris le lendemain (la colocation est supprimée en dernier).
- **Corrections trouvées par les tests** : `nettoyerSujet` coupait les sujets d'email au milieu d'un emoji (tous les modèles) et laissait passer des caractères de contrôle ; le mail d'inactivité pouvait afficher « depuis 0 jour » ; garde d'envoi contournable par un domaine `resend.dev.`.
- **Relecture par `relecteur` (Opus)** : aucun bloquant ; 4 points importants corrigés (course join/destruction, avertissement partiel et quota Resend, cron lancé en local sur la base de production avec une redirection de test, préavis fictif le jour d'ouverture de l'interrupteur).
- **Testé en conditions réelles** (MongoDB Atlas, vrais emails reçus dans la boîte de Tanguy, comptes jetables, session Google forgée avec `AUTH_SECRET` en local) : 49 vérifications (37 en simulation, 12 avec suppression réelle) : accès au cron (401, 405), départ du dernier membre, email reçu, rejoindre annule, avertissement d'une inactive (un mail par membre), idempotence, annulation par l'activité, simulation sans suppression, retard de plus de 7 jours, verrou face à `/join`, panneau (404 pour anonyme et comptes à mot de passe, 200 pour l'admin sans donnée personnelle, destruction avec mauvaise ou bonne confirmation), suppression réelle des seules colocations dues et protection de la démo, des plans périmés, des échéances à venir et des colocations déjà verrouillées. 2775 tests Vitest.
- **Limites connues** : la détection de production est sensible à la casse (`VERCEL_ENV=Production` ne compterait pas, Vercel écrit en minuscules) ; un `EMAIL_FROM` de la forme `Nom <a@b.fr> <x@resend.dev>` est lu sur la première paire de chevrons ; le contrôle admin suppose que Google ou GitHub garantit l'email (Auth.js ne vérifie pas `email_verified` : utiliser un compte Google) ; le bouton « Détruire » existe aussi pour la démo ; les doublons `ColocationLue` et la cohérence d'un plan écrite deux fois (`etatColocation` et `nettoyage.ts`) ; si les 50 colocations les plus anciennes échouent tous les jours elles affament les suivantes ; modifier une dépense ou une tâche ne compte pas comme activité ; aucun code ne pose `demo: true` (à faire avec le compte démo, AVANT d'ouvrir l'interrupteur) ; le cron ne doit JAMAIS être lancé en local sur la base de production ; la colocation « Test » vide de Tanguy (septembre) est un cas réel de colocation vide sans plan, qui attendra l'envoi réel.
- **Pour activer la suppression automatique un jour** : 1) nom de domaine vérifié chez Resend et `EMAIL_FROM` dessus ; 2) poser `demo: true` sur la colocation de démo ; 3) laisser tourner le cron en simulation quelques jours et lire `simulees` dans les journaux ; 4) mettre `NETTOYAGE_AUTO_ACTIF=true` dans Vercel.

### Journal du lot 11, bloc B (30/10/2026), Pages d'erreur, chargement, responsive, santé

- **Pages** : `src/app/not-found.tsx` (statique : aucune logique de session ni de route, pour que le 404 de `/admin` soit celui de n'importe quelle URL inconnue), `src/app/error.tsx` (client ; « Une erreur est survenue », numéro de référence = `error.digest`, jamais `error.message` ni la pile ; bouton « Réessayer » basé sur `retry()` et non `reset()` : dans ce Next, `retry()` refait la requête serveur alors que `reset()` ne vide que l'état de l'erreur), `src/app/global-error.tsx` (filet quand le layout racine plante : ses propres `<html>`/`<body>`, styles en ligne, pas de metadata), `loading.tsx` avec squelettes pour `colocations/[id]` (s'applique à ses sous-pages) et `tableau-de-bord`. **Pas de `loading.tsx` à la racine** : dès qu'un fallback de chargement s'affiche, le statut HTTP est figé à 200, donc `/admin` (qui appelle `notFound()` après un `await`) aurait répondu 200 au lieu de 404 et se serait distingué d'une URL inconnue.
- **`/api/health`** : ne renvoie plus que `{ ok: true }` (200) ou `{ ok: false }` (503), `no-store`. Avant, route publique, elle donnait le NOM de la base et l'ADRESSE du cluster, et le message d'erreur brut.
- **Piège trouvé en production : le titre de l'onglet** : `export const metadata` d'une page se résout même quand la page appelle `notFound()`. L'onglet d'un visiteur non admin affichait « Administration ». Titre et `robots` sont maintenant dans le JSX de `/admin` (rendus seulement après la vérification d'accès). Limite restante : le HTML SERVEUR du 404 de `/admin` a l'enveloppe d'erreur de Next (`<html id="__next_error__">`) alors qu'une URL inconnue a le site complet ; statut, titre et rendu final dans le navigateur sont identiques, mais un `curl` peut les distinguer. L'accès reste protégé côté serveur.
- **Audit responsive à 375 px** (navigateur, toutes les pages avec une colocation « piégée » : nom de 72 caractères, description avec un mot de 62 caractères sans espace, dépenses et tâches à titres de 60 caractères) : trois vrais débordements corrigés dans `globals.css` : `overflow-wrap: anywhere` sur `body` (un mot très long n'élargit plus la page ; `anywhere` et non `break-word` car seul `anywhere` réduit la largeur minimale du texte) ; `main { width: 100% }` (un `<main mx-auto max-w-*>` dans le conteneur flex en colonne se calait sur la largeur naturelle de son contenu, et un titre `truncate` l'élargissait à 672 px) ; `select, input, textarea { max-width: 100% }` (un `<select>` a la largeur de son option la plus longue). Résultat : 20 pages mesurées, `scrollWidth` = 375 partout. Thèmes clair et sombre vérifiés sur le tableau de bord d'une colocation.
- **Page d'erreur vérifiée** avec une page de test qui plante (supprimée ensuite) : en production le HTML ne contient PAS le message interne (0 occurrence), seulement le numéro de référence.
- **Test de production en local** : `next start` hors Vercel exige `AUTH_TRUST_HOST=true` (sinon Auth.js répond « problème de configuration du serveur » sur un hôte qu'il ne reconnaît pas) ; sur Vercel l'hôte est reconnu tout seul. À retenir si on déploie un jour avec Docker. `npm run build` doit rester lancé serveur de dev arrêté (Windows).
- **Test flaky corrigé** : deux tests bcrypt (coût 12) de `auth-schemas.test.ts` échouaient par intermittence à cause du délai par défaut de 5 s quand les 20 fichiers tournent en parallèle ; délai porté à 30 s (3 exécutions complètes de suite : 2775/2775).

## 13. Architecture technique (pourquoi pas MVC/OOP classique)

Question de Tanguy le 08/09/2026. Décision : **pas de MVC explicite avec des classes Controller**, ni d'archi orientée objet côté domaine (les modèles Mongoose ne sont pas manipulés comme des objets métier riches, juste des schémas + requêtes). Structure retenue, 4 couches :

```
src/models/       Schémas Mongoose (donnée)
src/lib/          Logique métier pure (fonctions), independante du framework
src/app/api/**    Route Handlers : couche HTTP fine, validation Zod + appel a src/lib
src/app/**/page   Server Components : lisent les donnees directement pour le premier rendu
src/components/   UI reutilisable, Client Components la ou il faut de l'interactivite
```

**Pourquoi pas de classe Controller à la Laravel/Symfony (dont Tanguy a l'habitude via CodeIgniter/Laravel)** : Next.js App Router fait déjà ce travail via le routage par fichiers + les Server Components. Rajouter une couche de classes `HouseholdController`, `ExpenseController` etc. par-dessus reviendrait à réimplémenter à la main ce que le framework fait déjà, sans bénéfice réel sur un projet de cette taille — juste de la cérémonie en plus.

**Pourquoi extraire `src/lib/` plutôt que tout écrire dans les Route Handlers** : l'algorithme de simplification des dettes (section 4.4) est la pièce la plus complexe et la plus valorisable du projet — explicitement mise en avant dans le README attendu (section 10). En la gardant comme fonction pure sans dépendance à Next.js ou HTTP (entrée : soldes, sortie : liste de virements), elle devient : testable isolément sans lancer de serveur, réutilisable depuis plusieurs endroits (une route API, une page Server Component, l'export PDF), et facile à montrer/expliquer telle quelle à un recruteur.

**Convention à suivre pour les prochains lots** : toute logique de calcul un peu significative (soldes, simplification des dettes, rotation des tâches récurrentes) va dans `src/lib/`, pas directement dans une route. Les routes API restent fines : valider l'entrée, appeler `src/lib/`, mettre en forme la réponse.

## 14. Conventions de travail (décisions du 09/09/2026)

- **Toujours expliquer ce qui est fait et pourquoi**, à chaque étape d'un lot — pas seulement dans le récapitulatif de fin de lot. Demandé explicitement par Tanguy.
- **Commenter le "pourquoi", pas le "quoi"** : un commentaire n'a de valeur que s'il explique une décision non évidente (ex. `hasOutstandingDebt` qui renvoie toujours `false` en attendant le lot 5), pas ce que le code fait déjà de façon lisible.
- **Pas de Doxygen** : mauvais outil, pensé pour C/C++/Java, pas pour TypeScript. L'équivalent de l'écosystème JS/TS s'appelle TypeDoc.
- **Pas de TypeDoc ni de doc générée non plus** : ce genre d'outil a du sens pour une bibliothèque consommée par d'autres développeurs. RoomFlow est une application, pas une lib — personne ne naviguera un site de doc généré. Le temps va plutôt dans de bons commentaires "pourquoi" et un README soigné (lot 11).
- **Swagger/OpenAPI : pas prioritaire.** L'API RoomFlow n'a qu'un seul consommateur (son propre frontend) — la valeur pratique d'une doc API interactive est faible ici. Argument portfolio réel cela dit (montre une API bien structurée) : à envisager en option au **lot 11**, si le temps restant le permet, jamais comme prérequis bloquant le cœur du projet.
- **Modifier un schéma Mongoose exige de redémarrer le serveur, pas juste sauvegarder le fichier.** Mongoose garde son modèle compilé en mémoire pour la durée de vie du processus ; le rechargement à chaud de Turbopack recompile le fichier mais ne vide pas le registre interne de Mongoose, qui continue de renvoyer l'ancien modèle. Symptôme si oublié : une erreur de validation sur un champ qui n'existe plus nulle part dans le code (`Path "x" is required` alors que `x` a été supprimé du schéma). Rencontré et documenté le 23/09/2026 (journal du lot 4, payeurs multiples).
- **Tests automatiques avec Vitest (16/10/2026)** : `npm test` rejoue les tests de la logique pure de `src/lib/` (config `vitest.config.mts`, fichiers `src/**/*.test.ts` à côté du code testé). Pas de mock nécessaire pour les fonctions pures, car la connexion Mongo est paresseuse (ne s'ouvre que dans `connectDB()`). Les fonctions qui lisent la base restent testées par scripts curl multi-comptes. **Toute nouvelle logique de calcul dans `src/lib/` doit venir avec ses tests Vitest** (ex. rotation des tâches, lot 6). Vitest 4 volontairement (la v5 exige `@types/node` 22+, le projet est en 20). 205 tests au démarrage (dépenses : anti-arrondi, validation des répartitions ; dettes : algorithme `simplifier`, dont 200 jeux aléatoires à graine fixe). Dette `npm audit` (`next` critical, `sharp` high) : SOLDÉE par le lot 9 bis (0 vulnérabilité, `next` 16.4.3, `sharp` 0.35.5, `zod` 4.6.7). À relancer `npm audit` avant le déploiement.

- **Routes API imbriquées qui répondent 404 HTML alors que les fichiers existent (21/10/2026)** : après un arrêt brutal de session, le cache de compilation `.next` peut devenir incohérent (même les anciennes routes `/api/colocations/[id]/...` répondaient 404, alors que `/api/colocations/[id]` et les pages marchaient). Remède : arrêter le serveur, supprimer le dossier `.next` (cache régénérable, ignoré par git), lancer `npx next typegen` puis `npm run dev`.

## 15. Panneau admin + nettoyage automatique (décidé le 23/09/2026)

Idée de Tanguy, absente du cahier des charges d'origine : repérer les colocations vides ou inactives pour libérer de l'espace, avec deux angles — un panneau pour les voir/détruire à la main, et un mécanisme automatique.

**Placé au lot 11**, confirmé par Tanguy, pour deux raisons concrètes :
- Le panneau lui-même n'a pas de dépendance technique, mais l'auto-nettoyage en a deux : Resend (lot 9, pour l'envoi des emails) et une vraie notion d'activité (Expense/Task/ShoppingItem, lots 4/6/7 — sans eux, "inactif" ne veut encore rien dire).
- Les deux volets sont liés (le panneau sert aussi à vérifier/déclencher le nettoyage à la main) : les faire ensemble plutôt qu'en deux morceaux dispersés.

**Règles confirmées par Tanguy :**
- Colocation **vide** (0 membre) → email automatique au **dernier admin** avant qu'elle se vide. Déclenché par **événement** (au moment précis où `/leave` la vide), pas par un scan périodique — capturer qui vient de partir à cet instant est plus simple et plus fiable que de le retrouver après coup.
- Colocation **inactive** (a des membres, mais rien ne s'y passe depuis un moment) → email à **tous les membres**. Celui-là a besoin d'un vrai job périodique (Vercel Cron Jobs, gratuit sur ce plan) qui scanne les colocations et compare la dernière activité (dépense/tâche/course la plus récente) à un seuil à définir.
- Le panneau admin lui-même : accès à Tanguy uniquement (opérateur unique de l'app pour l'instant). Prévu via une variable d'environnement (`SITE_ADMIN_EMAILS`) plutôt qu'un vrai système de rôles dans `User` — plus simple, cohérent avec "on définira les permissions plus tard" (section 3).

**À construire au lot 11** : le panneau (liste de toutes les colocations, taille, dernière activité, bouton détruire), le déclencheur d'email sur colocation vidée, et le Cron Job d'inactivité + son email.
