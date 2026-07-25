"""Compatibility exports for the legacy xgb_peak_060b module name."""
from __future__ import annotations

from .xgb_peak import (
    DEFAULT_MODEL_NAME,
    DEFAULT_TOP_K,
    DinoFrame,
    DinoSidecarInfo,
    FinalPeakDecision,
    XgbPeakResult,
    add_dino_temporal_features,
    agreement_bucket,
    arbitrate_final_peak,
    decision_to_dict,
    dino_features_for_frame,
    feature_columns_for_set,
    load_dino_info_for_sidecar,
    model_dir_from_env,
    predict_xgb_peak,
    temporal_mode_for_set,
    xgb_payload_fields,
)

predict_xgb_peak_060b = predict_xgb_peak
