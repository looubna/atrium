"""The face-metrics upload accepts what the app's FaceTracker sends, and bounds every number."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.platform.media.face_metrics import FaceMetricsBody

SECOND = {"t": 3, "present": 1.0, "eye": 0.5, "smile": 0.1, "move": 0.0}


def test_what_the_app_sends_today_is_accepted() -> None:
    # `clear` is in every second the app records; refusing it lost all face measurements.
    body = FaceMetricsBody.model_validate({"seconds": [{**SECOND, "clear": 0.9, "body": 1, "hands": 0.5,
                                                         "handsFace": 0, "full": 0}]})
    assert body.seconds[0].clear == 0.9


def test_body_numbers_and_pose_rate() -> None:
    body = FaceMetricsBody.model_validate({
        "poseHz": 4,
        "seconds": [{**SECOND, "yaw": -12.5, "pitch": 3, "tilt": 4, "shoulderW": 0.6, "faceW": 0.3, "neck": 0.8,
                     "handPath": 0.4, "sx": [0.9, None, 0.91, 0.9], "lw": [[0.3, 1.0], None], "rw": []}],
    })
    assert body.poseHz == 4
    assert body.seconds[0].lw == [(0.3, 1.0), None]


@pytest.mark.parametrize("bad", [
    {"tilt": 400}, {"shoulderW": -1}, {"sx": [0.1] * 9}, {"lw": [[0.1, 0.2, 0.3]]}, {"handPath": 1000},
    {"landmarks": [[0.1, 0.2]]},
])
def test_out_of_bounds_or_unknown_fields_are_refused(bad: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        FaceMetricsBody.model_validate({"seconds": [{**SECOND, **bad}]})


def test_pose_rate_is_bounded() -> None:
    with pytest.raises(ValidationError):
        FaceMetricsBody.model_validate({"seconds": [SECOND], "poseHz": 30})
