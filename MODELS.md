# Pairwise Modeling Architecture & Comparison

This document explains the different machine learning models available in the Pairwise Labeling system, their strengths, weaknesses, and use cases.

## Overview of Models

Currently, the system uses **DINOv2** (Vision Transformer) from Meta AI as the core backbone for all visual understanding.

| Model Type | Focus | Use Case |
| :--- | :--- | :--- |
| **Pairwise (Elo)** | Relative Preference | Ranking performers or images from best to worst. |
| **Binary (Simple)** | Absolute Quality | Quick filtering (Keep vs. Delete). |
| **Context-Aware Binary** | Personalized Quality | Filtering based on the "baseline" of a specific performer. |

---

## 1. Pairwise Preference Model (`train_dinov2.py`)
This model is trained on "Image A vs. Image B" samples. It learns which features make one image superior to another.

*   **Pros:**
    *   **High Precision:** Extremely good at fine-grained differences (e.g., better lighting, better pose).
    *   **Scale Invariant:** Works well even if your "taste" changes over time, as it only cares about which of two images is better *now*.
    *   **Active Learning:** Used to drive the "Next Pair" selection to find the most uncertain rankings.
*   **Cons:**
    *   **Data Intensive:** Requires many comparisons to build a stable Elo ranking.
    *   **No Absolute Baseline:** It knows A is better than B, but it doesn't inherently know if both are "garbage" or both are "perfect."

## 2. Simple Binary Model (`train_binary.py`)
A standard classifier trained on your `Keep` (After Filter) and `Delete` (Training) folders.

*   **Pros:**
    *   **Fast Training:** Learns a general "quality" threshold quickly.
    *   **Direct Application:** Can be used to automatically sort new images into "Keep" or "Delete" buckets.
*   **Cons:**
    *   **Subject Bias:** Tends to collapse if you like one performer much more than another. It might learn "Blonde = Keep" just because your favorite performer is blonde, failing on other performers.
    *   **Global Average:** It tries to find one single rule for everything, which often fails because "good" for a home-photo is different from "good" for a professional studio photo.

## 3. Context-Aware Binary Model (`train_context_binary.py`) [NEW]
This model "views" a performer's entire gallery (average embedding) before judging a specific image.

*   **Pros:**
    *   **Personalized:** Understands that "Keep" criteria for Performer A might be different than for Performer B.
    *   **Performer Baseline:** Learns the "typical" look of a performer so it can identify when a specific photo is better or worse than their usual standard.
    *   **Highest Accuracy:** Best for mixed libraries where you have varying standards for different performers.
*   **Cons:**
    *   **Complex Inference:** Requires computing or storing the "performer profile" (average embedding) before it can judge a single image.
    *   **Cold Start:** Needs at least 5-10 images of a performer to build a reliable context profile.

---

## Technical Comparison

| Feature | Pairwise | Simple Binary | Context-Aware Binary |
| :--- | :--- | :--- | :--- |
| **Backbone** | DINOv2 Large | DINOv2 Large | DINOv2 Large |
| **Input** | 2 Images | 1 Image | 1 Image + Performer Gallery |
| **Output** | Probability (A > B) | Keep Probability (0-1) | Keep Probability (0-1) |
| **Bias Resistance** | High | Low | Medium-High |
| **Inference Speed** | Medium | Fast | Slow (or requires cache) |
