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
- [ ] **Lot 6 — Tâches** : CRUD, récurrence, vue Kanban avec drag & drop (dnd-kit), historique
- [ ] **Lot 7 — Liste de courses** : ajout/coche/suppression partagés, historique
- [ ] **Lot 8 — Dashboard** : vue d'ensemble + graphique des dépenses par catégorie (Recharts)
- [ ] **Lot 9 — Emails** (Resend, compte à créer à ce moment-là) : ajout à une colocation, dépense qui concerne, rappel de tâche, **mot de passe oublié** (demandé par Tanguy le 08/09/2026 — regroupé ici plutôt que fait à part, car ça dépend de Resend pour l'envoi du lien de réinitialisation ; le faire avant aurait voulu dire soit attendre, soit bricoler un envoi factice puis tout refaire)
- [ ] **Lot 10 — Export PDF** : récapitulatif mensuel
- [ ] **Lot 11 — Finitions** : responsive, erreurs/chargements, README pro (stack, captures, choix techniques, limites), déploiement Vercel + lien ajouté au portfolio, Swagger/OpenAPI en option si le temps le permet, **panneau admin** (décidé le 23/09/2026 — voir section 15)

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
  - ~~TODO lots 4-7 : cascade de suppression~~ — **Expense fait, lot 4** (voir journal ci-dessous). Reste Task et ShoppingItem, aux lots 6-7.
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
