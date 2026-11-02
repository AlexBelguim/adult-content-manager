# The Picture Models

The models that judge pictures and what they train on. Their results so far are on the AI & Training page, under Models ("Results so far"). acm-gpu trains and runs them; this app holds the labels and the training queue.

| Model | Type | Answers | Trains on |
| :--- | :--- | :--- | :--- |
| **CLIP Siamese** (1st order) | `clip_siamese` | An order inside one performer | Kept > deleted pairs of each performer, plus your same-performer hand pairs |
| **CLIP Taste** (2nd order) | `clip_taste` | A keep % with a fixed 50% line | The same, plus disliked and blacklisted performers, stars 2+ apart and hand pairs across performers |
| **K** (keep / delete) | `clip_keepdelete` | A keep % with a fixed 50% line | Keeps and deletes alone; the filter view's AI toggle refits it on the performer you are sorting |

P and P2, the performer models of the profile page, are separate: they run in acm-gpu by themselves.

## Where the labels come from

- **Keep and delete folders:** `after filter performer` and `deleted keep for training`, pushed to acm-gpu from the Train tab.
- **Rank images** (`/pairwise-rank`): saved straight to the app's `pairwise_pairs`, so they train the CLIP models at once.
- **The Labeler** (`/pairwise`, `/pairwise-mobile`): saved by the labelling server (`npm run start:pairwise`) in `backend-pairwise/pairwise.db`. They reach the CLIP models through `backend/scripts/import_pairwise_db.js`, which can be run again: pairs already imported are skipped.
- **Smart Compare and Group Rate:** performer ratings and duels. CLIP Taste uses the stars to pick pairs.

## Removed on 2026-11-02

Simple Binary (`binary`), Ranked Binary (`ranked_binary`), DINO Pairwise Preference (`pairwise`) and Performer Ranker (`performer_ranker`). They added nothing in tests: CLIP Siamese beats the DINO models on keep vs delete and on your own pairs, and the ranker picked the winner in 49% of duels. Their old files still show under Models, where they can be deleted; nothing can train or load them. The Context-Aware Binary that only ran from `backend-pairwise/python` went with them.
