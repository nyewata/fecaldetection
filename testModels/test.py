from pathlib import Path

import numpy as np
from PIL import Image
from tensorflow.keras.models import load_model

MODEL_FILENAME = "HELMINTHS_BINARY_EfficientNetB0_Round1.keras"
IMAGE_FILENAME = "test.jpg"
IMAGE_SIZE = 224

MODEL_PATH = Path(__file__).resolve().parent / MODEL_FILENAME
IMAGE_PATH = Path(__file__).resolve().parent / IMAGE_FILENAME


def preprocess_image(image_path: Path, image_size: int) -> np.ndarray:
    image = Image.open(image_path).convert("RGB")
    image = image.resize((image_size, image_size), Image.Resampling.LANCZOS)
    array = np.asarray(image, dtype=np.float32) / 255.0
    return np.expand_dims(array, axis=0)


def main() -> None:
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model file not found: {MODEL_PATH}")
    if not IMAGE_PATH.exists():
        raise FileNotFoundError(f"Image file not found: {IMAGE_PATH}")

    print(f"Model: {MODEL_PATH.name}")
    print(f"Image: {IMAGE_PATH.name}")

    model = load_model(
        str(MODEL_PATH)
    )
    print("Model loaded successfully.")

    input_tensor = preprocess_image(IMAGE_PATH, IMAGE_SIZE)
    print(f"Input tensor shape: {input_tensor.shape}")

    predictions = model.predict(input_tensor)
    print("Predictions:")
    print(predictions)

    if predictions.ndim == 2 and predictions.shape[1] == 1:
        probability = float(predictions[0, 0])
        label = int(round(probability))
        print(f"Probability: {probability:.4f}")
        print(f"Predicted class: {label}")


if __name__ == "__main__":
    main()
