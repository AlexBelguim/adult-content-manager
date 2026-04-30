# Roadmap: The "Agent of Taste" Model (Level 2)

This document outlines the implementation plan for the **Agent of Taste**, a next-generation model that combines all our current machine learning techniques into a single, personalized intelligence.

## The Vision
Unlike current models that just guess "Keep" or "Delete," the Agent of Taste understands **why** it's making a decision. It can distinguish between your love for a performer and the technical quality of a specific photo.

---

## 1. Capabilities Matrix
How the Agent of Taste compares to our current Level 1 models.

| Feature | Simple Binary | Pairwise (Elo) | Context-Aware | **Agent of Taste** |
| :--- | :--- | :--- | :--- | :--- |
| **Keep/Delete Sorting** | ✅ | ❌ | ✅ | ✅ |
| **Continuous Rating (0-100)**| ❌ | ✅ | ❌ | ✅ |
| **Performer Recognition** | ❌ | ❌ | ✅ | ✅ |
| **Disentanglement** | ❌ | ❌ | ❌ | ✅ |
| **Personalized Baseline** | ❌ | ❌ | ✅ | ✅ |
| **"Bad Photo/Good Person"** | ❌ | ❌ | ❌ | ✅ |

---

## 2. Implementation Strategy

To create this model, we move from **Single-Task** training to **Multi-Task Preference Learning**.

### Step A: Data Categorization
We must feed the model 4 types of signal simultaneously:
1.  **Intra-Performer Pairs:** Comparisons of the same person (Teaches technical quality).
2.  **Inter-Performer Pairs:** Comparisons of different people (Teaches subject preference).
3.  **Absolute Ratings:** Performer-level Elo scores (Teaches personal favorites).
4.  **Binary Labels:** Keep/Delete folder locations (Teaches the final "Line").

### Step B: The Multi-Head Architecture
The model will use a DINOv2 backbone but with three specialized output "heads":
*   **Aesthetic Head (Regression):** Predicts a 0.0 - 1.0 quality score.
*   **Preference Head (Regression):** Predicts a 0.0 - 1.0 performer sentiment score.
*   **Action Head (Classifier):** Predicts the final 0 or 1 (Keep/Delete).

### Step C: Joint Optimization (The "Total Loss")
During training, the model is punished if it gets *any* of the three heads wrong. 
*   If it predicts a "Keep" but gets the "Performer Rating" wrong, the error cascades.
*   This forces the model to learn that `Keep = (High Quality) AND (High Preference)`.

---

## 3. Training Requirements

| Resource | Requirement |
| :--- | :--- |
| **Backbone** | DINOv2 (Large or Giant) |
| **Dataset Size** | 500+ Pairs (Mixed) and 20+ Performers with 10+ images each |
| **Training Time** | 30-60 minutes on a modern GPU |
| **Storage** | ~2GB for model weights and context cache |

---

## 4. How to Create It (Technical Steps)

1.  **Unified Dataset Loader:** Create a `MultiTaskDataset` that can draw from the SQLite database (pairs/scores) and the filesystem (folders) at the same time.
2.  **Latent Identity Table:** Implement a "Lookup Table" for performer IDs, allowing the model to have a unique memory for every performer in your library.
3.  **Disentanglement Loss:** Use a "Contrastive" training method where the model is shown a "Positive" and "Negative" of the same person to specifically isolate what makes a photo "bad" regardless of the subject.

---

## Conclusion
The Agent of Taste is the final goal of the Pairwise project. It transforms the system from a simple tool into a **curator** that knows your taste better than you do, allowing for automated organization of massive libraries with professional-grade precision.
