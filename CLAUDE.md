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
  - **Prochaine étape** : Tanguy doit créer les 4 comptes listés dans `.env.example` (au moins MongoDB Atlas pour pouvoir tester la connexion) avant qu'on attaque NextAuth et la création/le rejoint d'une colocation (fin de la Semaine 1 du planning section 9).
