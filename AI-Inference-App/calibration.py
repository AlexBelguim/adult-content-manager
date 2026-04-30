import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import HuberRegressor
from scipy.stats import spearmanr

class CalibrationEngine:
    def __init__(self):
        # Default population prior: star = raw_score / 20
        self.grid = np.linspace(0, 100, 101)
        self.population_curve = self.grid / 20.0
        
        # User model (will be loaded/updated)
        self.user_breakpoints = self.grid.tolist()
        self.user_values = self.population_curve.tolist()
        self.n_effective = 0

    def fit_user_curve(self, ratings, n_threshold=20):
        """
        ratings: list of dicts {'raw_ai_score': float, 'manual_star': float, 'confidence': float}
        """
        if not ratings:
            return self.get_model()

        X = np.array([r['raw_ai_score'] for r in ratings])
        y = np.array([r['manual_star'] for r in ratings])
        weights = np.array([r['confidence'] for r in ratings])

        # 1. Winsorise extremes (avoid stretching endpoints)
        lower, upper = np.percentile(X, [1, 99]) if len(X) > 10 else (0, 100)
        X_clipped = np.clip(X, lower, upper)

        # 2. Fit weighted isotonic regression (Monotonic constraint)
        iso = IsotonicRegression(increasing=True, out_of_bounds='clip')
        try:
            iso.fit(X_clipped, y, sample_weight=weights)
            user_curve = iso.predict(self.grid)
        except Exception as e:
            print(f"[Calibration] Fit failed: {e}")
            user_curve = self.population_curve

        # 3. Bayesian Blending (Shrinkage toward prior)
        n_eff = np.sum(weights)
        alpha = min(1.0, n_eff / n_threshold)
        
        blended = alpha * user_curve + (1.0 - alpha) * self.population_curve
        blended = np.clip(blended, 0, 5)

        self.user_values = blended.tolist()
        self.n_effective = n_eff
        
        return self.get_model()

    def predict_batch(self, performers_data, manual_ratings, ranks=None):
        """
        performers_data: list of dicts {'id': int, 'raw_ai_score': float}
        manual_ratings: dict {performer_id: star_rating}
        """
        if not performers_data:
            return {}

        ids = [p['id'] for p in performers_data]
        raw_scores = [p['raw_ai_score'] for p in performers_data]
        
        # 1. Global star prediction from the fitted curve
        global_stars = np.interp(raw_scores, self.grid, self.user_values)
        
        # 2. Batch Correction (if we have manual ratings in this batch)
        rated_ids = [pid for pid in ids if pid in manual_ratings]
        n_rated = len(rated_ids)
        
        a, b = 1.0, 0.0 # Identity
        r2 = 0.0
        
        if n_rated >= 2:
            # Robust linear fit: manual = a * global_pred + b
            g_pred = np.interp([p['raw_ai_score'] for p in performers_data if p['id'] in rated_ids], 
                               self.grid, self.user_values)
            y_true = np.array([manual_ratings[pid] for pid in rated_ids])
            
            try:
                huber = HuberRegressor()
                huber.fit(g_pred.reshape(-1, 1), y_true)
                a = huber.coef_[0]
                b = huber.intercept_
                
                # Quality metric (Spearman correlation)
                corr, _ = spearmanr(g_pred, y_true)
                r2 = corr ** 2 if not np.isnan(corr) else 0.0
            except:
                pass

        # 3. Dynamic blending weight
        w_batch = min(1.0, n_rated / 5.0) * max(0.0, r2)
        
        final_results = {}
        for i, pid in enumerate(ids):
            g = global_stars[i]
            corrected = a * g + b
            final = (1 - w_batch) * g + w_batch * corrected
            final_results[pid] = float(np.clip(final, 0, 5))
            
        # 4. Apply Monotonicity Shift based on 'ranks' order (Robust PAVA)
        if ranks and len(ranks) > 1:
            # Extract values in rank order
            ordered_vals = np.array([final_results[pid] for pid in ranks if pid in final_results])
            n = len(ordered_vals)
            
            # Recursive PAVA to ensure strictly non-increasing: ordered_vals[i] >= ordered_vals[i+1]
            def pava(y):
                y = np.array(y)
                n = len(y)
                if n <= 1:
                    return y
                
                # While there is a violator (y[i] < y[i+1])
                while True:
                    violation_idx = -1
                    for i in range(n - 1):
                        if y[i] < y[i+1]:
                            violation_idx = i
                            break
                    
                    if violation_idx == -1:
                        break
                        
                    # Pool the two values
                    avg = (y[violation_idx] + y[violation_idx+1]) / 2.0
                    y[violation_idx] = avg
                    y[violation_idx+1] = avg
                    
                    # Optional: Add tiny epsilon to force strict distinction
                    epsilon = 0.01
                    y[violation_idx] += epsilon
                    y[violation_idx+1] -= epsilon
                
                return y

            final_vals = pava(ordered_vals)
            
            # Final pass to ensure clip and final assignment
            for i, pid in enumerate(ranks):
                if pid in final_results:
                    final_results[pid] = float(np.clip(final_vals[i], 0, 5))

        return final_results

    def get_model(self):
        return {
            'breakpoints': self.user_breakpoints,
            'values': self.user_values,
            'n_effective': self.n_effective
        }

    def load_model(self, model_data):
        if not model_data:
            return
        if 'values' in model_data:
            self.user_values = model_data['values']
        if 'n_effective' in model_data:
            self.n_effective = model_data['n_effective']
