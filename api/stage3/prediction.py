import logging
from io import BytesIO
from pathlib import Path
from typing import Dict

import requests
from PIL import Image
from ultralytics import RTDETR

logger = logging.getLogger(__name__)


def load_image_from_url(image_url: str) -> Image.Image:
    try:
        response = requests.get(image_url, timeout=15)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise ValueError(f"Unable to download image from URL '{image_url}': {exc}") from exc

    try:
        return Image.open(BytesIO(response.content)).convert("RGB")
    except Exception as exc:
        raise ValueError(f"Unable to decode image from URL '{image_url}': {exc}") from exc


def predict_with_model_file(source_image: Image.Image, model_path: Path, size: int) -> Dict[str, object]:
    model = RTDETR(str(model_path))
    results = model.predict(source_image, imgsz=size, conf=0.25, save=False)

    predictions = []
    for result in results:
        boxes = result.boxes
        if boxes is None or len(boxes) == 0:
            continue

        for idx in range(len(boxes)):
            cls_id = int(boxes.cls[idx].item())
            confidence = float(boxes.conf[idx].item())
            x1, y1, x2, y2 = [float(v) for v in boxes.xyxy[idx].tolist()]
            class_name = model.names.get(cls_id, str(cls_id)) if hasattr(model, "names") else str(cls_id)

            predictions.append(
                {
                    "class_id": cls_id,
                    "class_name": class_name,
                    "confidence": confidence,
                    "box": [x1, y1, x2, y2],
                }
            )

    return {
        "model_filename": model_path.name,
        "detections": len(predictions),
        "predictions": predictions,
    }
