import logging
from io import BytesIO
from pathlib import Path
from typing import Dict

import numpy as np
import requests
from PIL import Image
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing import image

logger = logging.getLogger(__name__)


def preprocess_image(source_image: Image.Image, size: int) -> np.ndarray:
    """Resize and normalize an image tensor for model inference."""
    rgb_image = source_image.convert("RGB")
    resized_image = rgb_image.resize((size, size), Image.Resampling.LANCZOS)
    img_array = image.img_to_array(resized_image, dtype=np.uint8)
    img_array = img_array / 255.0
    return np.expand_dims(img_array, axis=0)


def predict_with_model_file(source_image: Image.Image, model_path: Path, size: int) -> Dict[str, object]:
    """Load a model from disk and run prediction on the provided image."""
    loaded_model = load_model(str(model_path))
    return predict_image(loaded_model, source_image, size)


def predict_image(model, source_image: Image.Image, size: int) -> Dict[str, object]:
    """Run inference and return class probabilities."""
    preprocessed_image = preprocess_image(source_image, size)

    logger.info("Preprocessed image shape: %s", preprocessed_image.shape)
    assert preprocessed_image.shape == (1, size, size, 3), f"Unexpected shape: {preprocessed_image.shape}"

    prediction = model.predict(preprocessed_image)
    probability = float(prediction[0][0])
    
    return {
        "probability": probability,
        "predicted_class": int(round(probability)),
        "class_probabilities": {
            0: float(round((1 - probability) * 100, 2)),
            1: float(round(probability * 100, 2))
        },
    }


def load_image_from_file(image_path: Path) -> Image.Image:
    """Open an image from disk."""
    try:
        return Image.open(image_path)
    except Exception as exc:
        raise ValueError(f"Unable to open image from path '{image_path}': {exc}") from exc


def load_image_from_url(image_url: str) -> Image.Image:
    """Download and open an image from a remote URL."""
    try:
        response = requests.get(image_url, timeout=10)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise ValueError(f"Unable to download image from URL '{image_url}': {exc}") from exc

    try:
        return Image.open(BytesIO(response.content))
    except Exception as exc:
        raise ValueError(f"Unable to decode image from URL '{image_url}': {exc}") from exc
